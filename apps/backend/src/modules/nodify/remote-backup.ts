import { createHash, createHmac } from "node:crypto";
import { BackupDestination, type TBackupDestination } from "@nodify/contract";
export { BackupSchedule } from "@nodify/contract";
type Destination = TBackupDestination;
const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
function objectUrl(endpoint: string, key: string, bucket?: string) {
  if (!key || key.split("/").some((part) => part === "." || part === ".."))
    throw new Error("Invalid backup object key");
  const url = new URL(endpoint);
  const prefix = url.pathname
    .replace(/\/$/, "")
    .split("/")
    .map((part) => encode(decodeURIComponent(part)))
    .join("/");
  url.pathname = `${prefix}/${bucket ? `${bucket}/` : ""}${key.split("/").map(encode).join("/")}`;
  return url;
}
const digest = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
const hmac = (key: Buffer | string, value: string) =>
  createHmac("sha256", key).update(value).digest();
export function signedS3Request(
  destination: Extract<Destination, { type: "s3" }>,
  key: string,
  method: string,
  body: Buffer = Buffer.alloc(0),
  now = new Date(),
) {
  BackupDestination.parse(destination);
  const url = objectUrl(destination.endpoint, key, destination.bucket);
  const timestamp = now.toISOString().replace(/[:-]|\.\d{3}/g, ""),
    day = timestamp.slice(0, 8),
    payload = digest(body);
  const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payload}\nx-amz-date:${timestamp}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonical = [
    method,
    url.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    payload,
  ].join("\n");
  const scope = `${day}/${destination.region}/s3/aws4_request`;
  const keyDate = hmac(`AWS4${destination.secretAccessKey}`, day),
    keyRegion = hmac(keyDate, destination.region),
    keyService = hmac(keyRegion, "s3"),
    keySigning = hmac(keyService, "aws4_request");
  const signature = hmac(
    keySigning,
    `AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${digest(canonical)}`,
  ).toString("hex");
  return {
    url,
    headers: {
      "x-amz-date": timestamp,
      "x-amz-content-sha256": payload,
      Authorization: `AWS4-HMAC-SHA256 Credential=${destination.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}
export async function remoteBackup(
  destination: Destination,
  key: string,
  body: Buffer | undefined,
  signal?: AbortSignal,
) {
  BackupDestination.parse(destination);
  if (destination.type === "local") return;
  const timeout = AbortSignal.timeout(120000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const request = async (method: "PUT" | "GET" | "DELETE", data?: Buffer) => {
    combined.throwIfAborted();
    const target =
      destination.type === "s3"
        ? signedS3Request(destination, key, method, data)
        : {
            url: objectUrl(destination.url, key),
            headers: {
              Authorization: `Basic ${Buffer.from(`${destination.username}:${destination.password}`).toString("base64")}`,
            },
          };
    try {
      return await fetch(target.url, {
        method,
        headers: target.headers,
        body: data as any,
        redirect: "error",
        signal: combined,
      });
    } catch {
      // Fetch errors can contain provider URLs. Keep persisted task errors free of credentials.
      throw new Error(
        combined.aborted
          ? "Remote backup request interrupted"
          : "Remote backup request failed",
      );
    }
  };
  const method = body === undefined ? "DELETE" : "PUT";
  const response = await request(method, body);
  await response.body?.cancel();
  if (!response.ok && !(method === "DELETE" && response.status === 404))
    throw new Error(`Remote backup storage returned ${response.status}`);
  if (body === undefined) return;

  // A successful PUT is insufficient for retention: read back and hash the ciphertext.
  // Limit bytes while streaming; a broken destination must not allocate an unbounded response.
  const verification = await request("GET");
  if (!verification.ok || !verification.body) {
    await verification.body?.cancel();
    throw new Error(
      `Remote backup verification returned ${verification.status}`,
    );
  }
  const reader = verification.body.getReader();
  const hash = createHash("sha256");
  let size = 0;
  try {
    for (;;) {
      combined.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > body.byteLength)
        throw new Error("Remote backup size mismatch");
      hash.update(chunk.value);
    }
    if (size !== body.byteLength || hash.digest("hex") !== digest(body))
      throw new Error("Remote backup integrity mismatch");
  } catch {
    throw new Error(
      combined.aborted
        ? "Remote backup verification interrupted"
        : "Remote backup integrity verification failed",
    );
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
