import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:https";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, createHmac } from "node:crypto";
import { ruleFixture } from "./rule-fixture.mjs";
import { decryptBackup } from "../deploy/restore.mjs";
const require = createRequire(import.meta.url);
const {
  remoteBackup,
  signedS3Request,
  BackupSchedule,
} = require("../apps/backend/src/modules/nodify/remote-backup.ts");
const {
  NodifyResourcesService,
} = require("../apps/backend/src/modules/nodify/resources.service.ts");
let directory, tls;
const originalCAs = getCACertificates();
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "nodify-backup-tls-"));
  const gitOpenSSL = "C:/Program Files/Git/usr/bin/openssl.exe";
  const openssl =
    process.env.NODIFY_TEST_OPENSSL ||
    (process.platform === "win32" && existsSync(gitOpenSSL)
      ? gitOpenSSL
      : "openssl");
  await promisify(execFile)(
    openssl,
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
      "-keyout",
      join(directory, "key.pem"),
      "-out",
      join(directory, "cert.pem"),
    ],
    { windowsHide: true },
  );
  tls = {
    key: await readFile(join(directory, "key.pem")),
    cert: await readFile(join(directory, "cert.pem")),
  };
  setDefaultCACertificates([...originalCAs, tls.cert.toString()]);
});
after(async () => {
  setDefaultCACertificates(originalCAs);
  if (directory) await rm(directory, { recursive: true, force: true });
});
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const s3Credentials = {
  type: "s3",
  region: "us-east-1",
  bucket: "nodify",
  accessKeyId: "TESTACCESS",
  secretAccessKey: "only-a-test-secret",
};
function verifySignature(req, body) {
  const auth = req.headers.authorization;
  const match =
    /^AWS4-HMAC-SHA256 Credential=([^/]+)\/([^,]+), SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/.exec(
      auth || "",
    );
  assert.ok(match, "S3 authentication header is present");
  const [, access, scope, signedHeaders, signature] = match;
  assert.equal(access, s3Credentials.accessKeyId);
  assert.equal(req.headers["x-amz-content-sha256"], sha(body));
  const [date, region, service, terminator] = scope.split("/");
  assert.equal(region, s3Credentials.region);
  assert.equal(service, "s3");
  assert.equal(terminator, "aws4_request");
  const canonicalHeaders = signedHeaders
    .split(";")
    .map(
      (header) =>
        `${header}:${req.headers[header].trim().replace(/\s+/g, " ")}\n`,
    )
    .join("");
  const canonical = `${req.method}\n${req.url}\n\n${canonicalHeaders}\n${signedHeaders}\n${sha(body)}`;
  let key = Buffer.from(`AWS4${s3Credentials.secretAccessKey}`);
  for (const part of [date, region, service, terminator])
    key = createHmac("sha256", key).update(part).digest();
  assert.equal(
    signature,
    createHmac("sha256", key)
      .update(
        `AWS4-HMAC-SHA256\n${req.headers["x-amz-date"]}\n${scope}\n${sha(canonical)}`,
      )
      .digest("hex"),
  );
}
async function storage(t, type = "webdav") {
  const objects = new Map(),
    requests = [],
    failures = [];
  const state = { mode: "normal", reached: undefined };
  const server = createServer(tls, async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      requests.push({ method: req.method, path: req.url });
      if (type === "s3") verifySignature(req, bytes);
      else
        assert.equal(
          req.headers.authorization,
          `Basic ${Buffer.from("user:private-password").toString("base64")}`,
        );
      if (state.mode === "redirect") {
        res.writeHead(307, { Location: "/credential-leak" });
        res.end();
        return;
      }
      if (req.method === "PUT") {
        objects.set(req.url, bytes);
        res.writeHead(201);
        res.end();
        return;
      }
      if (req.method === "DELETE") {
        if (state.mode === "delete-denied") {
          res.writeHead(403);
          res.end();
          return;
        }
        res.writeHead(objects.delete(req.url) ? 204 : 404);
        res.end();
        return;
      }
      if (state.mode === "read-denied") {
        res.writeHead(403);
        res.end("private provider error");
        return;
      }
      const saved = objects.get(req.url);
      if (!saved) {
        res.writeHead(404);
        res.end();
        return;
      }
      if (state.mode === "interrupted") {
        res.writeHead(200);
        res.write(saved.subarray(0, 1));
        state.reached?.();
        return;
      }
      if (state.mode === "short") {
        res.end(saved.subarray(0, Math.max(0, saved.length - 1)));
        return;
      }
      if (state.mode === "long") {
        res.end(Buffer.concat([saved, Buffer.alloc(65536)]));
        return;
      }
      if (state.mode === "corrupt") {
        const corrupt = Buffer.from(saved);
        corrupt[0] ^= 1;
        res.end(corrupt);
        return;
      }
      res.end(saved);
    } catch (error) {
      failures.push(error);
      res.writeHead(500);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    assert.deepEqual(failures, []);
  });
  const origin = `https://127.0.0.1:${server.address().port}`;
  const destination =
    type === "s3"
      ? { ...s3Credentials, endpoint: `${origin}/store` }
      : {
          type,
          url: `${origin}/dav`,
          username: "user",
          password: "private-password",
        };
  return { destination, objects, requests, state };
}

test("backup contract rejects ambiguous endpoints and invalid credentials before network access", () => {
  const base = {
    enabled: true,
    password: "encryption-password",
    destination: {
      type: "webdav",
      url: "https://store.example/backups",
      username: "user",
      password: "secret",
    },
  };
  assert.ok(BackupSchedule.safeParse(base).success);
  for (const url of [
    "http://store.example",
    "https://user:secret@store.example",
    "https://store.example/path?secret=value",
    "https://store.example/path#fragment",
    "https://store.example/?",
    "https://store.example/\npath",
    "https://store.example\\path",
  ]) {
    assert.equal(
      BackupSchedule.safeParse({
        ...base,
        destination: { ...base.destination, url },
      }).success,
      false,
      url,
    );
  }
  assert.equal(
    BackupSchedule.safeParse({
      ...base,
      destination: { ...base.destination, username: "user:other" },
    }).success,
    false,
  );
  assert.throws(
    () =>
      signedS3Request(
        { ...s3Credentials, endpoint: "https://store.example" },
        "../elsewhere",
        "GET",
      ),
    /object key/,
  );
});

test("HTTPS WebDAV verifies ciphertext, encodes object keys and supports empty uploads and idempotent deletion", async (t) => {
  const { destination, requests, objects } = await storage(t);
  const key = "目录/a !'()*?#.nodify",
    body = Buffer.from("encrypted-backup-payload");
  await remoteBackup(destination, key, body);
  assert.deepEqual(
    requests.map((r) => r.method),
    ["PUT", "GET"],
  );
  assert.equal(
    requests[0].path,
    "/dav/%E7%9B%AE%E5%BD%95/a%20%21%27%28%29%2A%3F%23.nodify",
  );
  assert.deepEqual([...objects.values()][0], body);
  await remoteBackup(destination, "empty.nodify", Buffer.alloc(0));
  await remoteBackup(destination, key, undefined);
  await remoteBackup(destination, key, undefined);
});

test("HTTPS S3 validates SigV4 independently for PUT, GET and DELETE, including path prefixes", async (t) => {
  const { destination, requests } = await storage(t, "s3");
  await remoteBackup(
    destination,
    "folder/a !'()*.nodify",
    Buffer.from("ciphertext"),
  );
  await remoteBackup(destination, "folder/a !'()*.nodify", undefined);
  assert.deepEqual(
    requests.map((r) => r.method),
    ["PUT", "GET", "DELETE"],
  );
  assert.ok(
    requests.every(
      (r) => r.path === "/store/nodify/folder/a%20%21%27%28%29%2A.nodify",
    ),
  );
});

test("remote verification rejects corrupted, truncated, oversized and unreadable objects", async (t) => {
  const { destination, state, requests } = await storage(t);
  for (const mode of ["corrupt", "short", "long", "read-denied"]) {
    state.mode = mode;
    await assert.rejects(
      remoteBackup(destination, `${mode}.nodify`, Buffer.from("ciphertext")),
      /verification/,
    );
  }
  assert.equal(
    requests.some((r) => r.method === "DELETE"),
    false,
  );
});

test("storage refuses redirects and honors aborts while reading a stalled HTTPS response", async (t) => {
  const { destination, state, requests } = await storage(t);
  state.mode = "redirect";
  await assert.rejects(
    remoteBackup(destination, "redirect.nodify", Buffer.from("secret")),
    /request failed/,
  );
  assert.equal(requests.length, 1);
  state.mode = "interrupted";
  const controller = new AbortController();
  state.reached = () => controller.abort();
  await assert.rejects(
    remoteBackup(
      destination,
      "stalled.nodify",
      Buffer.from("secret"),
      controller.signal,
    ),
    /interrupted/,
  );
  const before = requests.length;
  await assert.rejects(
    remoteBackup(
      destination,
      "never-sent.nodify",
      undefined,
      AbortSignal.abort(),
    ),
  );
  assert.equal(requests.length, before);
});

test(
  "scheduled HTTPS backups preserve local recovery and retention on verification failure, then retry the same backup",
  { timeout: 30000 },
  async (t) => {
    const { destination, state, requests } = await storage(t, "s3");
    const { db, service } = await ruleFixture();
    t.after(() => db.$disconnect());
    const resources = new NodifyResourcesService(service),
      password = "remote-backup-test-password";
    const previous = await resources.backup(password);
    await db.nodifyBackup.update({
      where: { id: previous.id },
      data: { createdAt: new Date(0) },
    });
    await resources.saveBackupSettings({
      enabled: true,
      intervalHours: 1,
      retain: 1,
      password,
      destination,
    });
    const settings = await resources.backupSettings();
    assert.equal(settings.destination, "s3");
    assert.equal(
      JSON.stringify(settings).includes(destination.secretAccessKey),
      false,
    );
    assert.equal(
      (
        await db.nodifySetting.findUniqueOrThrow({
          where: { key: "backup.schedule" },
        })
      ).value.includes(destination.secretAccessKey),
      false,
    );
    await resources.scheduledBackup();
    const op = await db.nodifyOperation.findFirstOrThrow({
      where: { kind: "scheduled-backup" },
    });
    const payload = JSON.parse(service.box.open(op.payload));
    state.mode = "corrupt";
    await resources.localOperations.drain();
    let result = await db.nodifyOperation.findUniqueOrThrow({
      where: { id: op.id },
    });
    assert.equal(result.state, "failed");
    assert.equal(await db.nodifyBackup.count(), 2);
    assert.ok(
      decryptBackup(
        await readFile(await resources.backupFile(payload.backupId)),
        password,
      ).database,
    );
    assert.ok(await readFile(await resources.backupFile(previous.id)));
    assert.equal(
      requests.some((r) => r.method === "DELETE"),
      false,
    );
    assert.match(
      (
        await db.nodifyBackup.findUniqueOrThrow({
          where: { id: payload.backupId },
        })
      ).message,
      /verification failed/,
    );
    assert.equal(
      JSON.stringify(result).includes(destination.secretAccessKey),
      false,
    );
    state.mode = "delete-denied";
    const denied = await resources.retryOperation(op.id);
    await resources.localOperations.drain();
    assert.equal(
      (await db.nodifyOperation.findUniqueOrThrow({ where: { id: denied.id } }))
        .state,
      "failed",
    );
    assert.equal(await db.nodifyBackup.count(), 2);
    assert.ok(await readFile(await resources.backupFile(previous.id)));
    state.mode = "normal";
    const retry = await resources.retryOperation(denied.id);
    await resources.localOperations.drain();
    result = await db.nodifyOperation.findUniqueOrThrow({
      where: { id: retry.id },
    });
    assert.equal(result.state, "succeeded");
    assert.equal(result.result.id, payload.backupId);
    assert.equal(await db.nodifyBackup.count(), 1);
    assert.equal(
      (
        await db.nodifyBackup.findUniqueOrThrow({
          where: { id: payload.backupId },
        })
      ).message,
      "",
    );
    assert.equal(requests.filter((r) => r.method === "DELETE").length, 2);
  },
);
