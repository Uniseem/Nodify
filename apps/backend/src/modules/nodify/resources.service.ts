import {
  NODIFY_VERSION,
  CertificateRequest,
  SourceInput,
  SourceUpdateInput,
  SourceNodeInput,
  parseTrafficHeader,
} from "@nodify/contract";
import { Prisma } from "@prisma/client";
import { load } from "js-yaml";
import { execFile } from "node:child_process";
import {
  randomUUID,
  createHash,
  randomBytes,
  scryptSync,
  createCipheriv,
} from "node:crypto";
import { lookup } from "node:dns";
import {
  mkdir,
  readFile,
  writeFile,
  stat,
  unlink,
  mkdtemp,
  readdir,
  rm,
  rename,
  open,
} from "node:fs/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { resolve, join, relative, dirname, sep } from "node:path";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import { NodifyService } from "./nodify.service";
import { BackupSchedule, remoteBackup } from "./remote-backup";
import { sourceIdentity, sourceNodes } from "./source-nodes";
import { LocalOperations, LocalTask } from "./local-operations";
const exec = promisify(execFile);
const dataDir = () => resolve(process.env.NODIFY_DATA_DIR || "data/nodify");

function publicAddress(ip: string): boolean {
  if (ip.includes(":"))
    return !/^(::|fe|f[cd]|ff|2001:db8)/i.test(ip) && !ip.includes(".");
  const [a, b] = ip.split(".").map(Number);
  return (
    ![0, 10, 127, 169].includes(a) &&
    a < 224 &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && (b === 168 || b === 0)) &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 198 && (b === 18 || b === 19))
  );
}
export async function fetchSubscription(value: string): Promise<string> {
  return (await fetchSubscriptionResult(value)).text;
}
export function fetchSubscriptionResult(
  value: string,
): Promise<{ text: string; traffic: ReturnType<typeof parseTrafficHeader> }> {
  const url = new URL(value);
  const literalHost = url.hostname.replace(/^\[|\]$/g, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (isIP(literalHost) && !publicAddress(literalHost))
  )
    throw new BadRequestException("A public HTTPS endpoint is required");
  return new Promise((accept, reject) => {
    const req = request(
      url,
      {
        timeout: 15000,
        signal: AbortSignal.timeout(15000),
        headers: {
          "User-Agent": `Nodify/${NODIFY_VERSION}`,
          "Accept-Encoding": "identity",
        },
        maxHeaderSize: 16384,
        lookup: (hostname, options, callback) => {
          lookup(hostname, { all: true }, (err, addresses) => {
            if (err) return (callback as any)(err);
            if (
              !addresses.length ||
              addresses.some((a) => !publicAddress(a.address))
            )
              return (callback as any)(new Error("Non-public destination"));
            if ((options as any).all) (callback as any)(null, addresses);
            else
              (callback as any)(
                null,
                addresses[0].address,
                addresses[0].family,
              );
          });
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.destroy();
          reject(
            new Error(
              `Source returned HTTP ${res.statusCode}; redirects are disabled`,
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 5 * 1024 * 1024)
            req.destroy(new Error("Source exceeds 5 MB"));
          else chunks.push(chunk);
        });
        res.on("end", () => {
          try {
            const header = res.headers["subscription-userinfo"];
            if (Array.isArray(header))
              throw new Error("Duplicate subscription traffic header");
            accept({
              text: Buffer.concat(chunks).toString("utf8"),
              traffic: parseTrafficHeader(header),
            });
          } catch (error) {
            reject(error);
          }
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Source timed out")));
    req.on("error", reject);
    req.end();
  });
}
export function parseSource(text: string, sourceId: string) {
  let document: unknown;
  try {
    document = load(text);
  } catch {
    document = null;
  }
  let values: unknown[];
  if (
    document &&
    typeof document === "object" &&
    Array.isArray((document as any).proxies)
  )
    values = (document as any).proxies;
  else {
    if (!text.includes("://"))
      text = Buffer.from(text.trim(), "base64").toString("utf8");
    values = text
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean)
      .map((uri) => {
        if (uri.startsWith("vmess://")) {
          const v = JSON.parse(Buffer.from(uri.slice(8), "base64").toString());
          return {
            type: "vmess",
            name: v.ps || v.add,
            server: v.add,
            port: Number(v.port),
            uuid: v.id,
            cipher: "auto",
            alterId: 0,
            tls: v.tls === "tls",
            servername: v.sni || v.host || v.add,
            ...(v.alpn
              ? {
                  alpn: String(v.alpn)
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
                }
              : {}),
            network: v.net || "tcp",
            ...(v.net === "ws"
              ? {
                  "ws-opts": {
                    path: v.path || "/",
                    headers: { Host: v.host || "" },
                  },
                }
              : {}),
            ...(v.net === "grpc"
              ? { "grpc-opts": { "grpc-service-name": v.path || "" } }
              : {}),
            ...(v.net === "xhttp"
              ? {
                  "xhttp-opts": {
                    path: v.path || "/",
                    host: v.host || "",
                    mode: v.mode || "auto",
                  },
                }
              : {}),
          };
        }
        if (
          uri.startsWith("ss://") &&
          !uri.slice(5).split(/[?#]/)[0].includes("@")
        ) {
          const [encoded, fragment] = uri.slice(5).split("#");
          uri = `ss://${Buffer.from(encoded, "base64").toString("utf8")}${fragment ? `#${fragment}` : ""}`;
        }
        const url = new URL(uri);
        const type =
          url.protocol === "hy2:" ? "hysteria2" : url.protocol.slice(0, -1);
        const q = url.searchParams;
        const common: Record<string, unknown> = {
          type,
          name: decodeURIComponent(url.hash.slice(1)) || url.hostname,
          server: url.hostname.replace(/^\[|\]$/g, ""),
          port: Number(url.port || 443),
        };
        if (type === "ss") {
          if (q.has("plugin"))
            throw new Error(
              "Shadowsocks plugins are not supported by all subscription renderers",
            );
          const raw = url.password
            ? `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`
            : decodeURIComponent(url.username);
          const credential = raw.includes(":")
            ? raw
            : Buffer.from(raw, "base64").toString();
          const separator = credential.indexOf(":");
          if (separator < 1) throw new Error("Invalid Shadowsocks URI");
          return {
            ...common,
            type: "ss",
            cipher: credential.slice(0, separator),
            password: credential.slice(separator + 1),
          };
        }
        if (!["vless", "trojan", "hysteria2", "anytls"].includes(type))
          throw new Error("Unsupported URI protocol");
        return {
          ...common,
          ...(type === "vless"
            ? { uuid: decodeURIComponent(url.username) }
            : {
                password:
                  decodeURIComponent(url.username) +
                  (url.password ? `:${decodeURIComponent(url.password)}` : ""),
              }),
          tls: q.get("security") !== "none",
          servername: q.get("sni") || url.hostname,
          ...(q.get("alpn")
            ? {
                alpn: q
                  .get("alpn")!
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean),
              }
            : {}),
          ...(q.get("type") && q.get("type") !== "tcp"
            ? { network: q.get("type") }
            : {}),
          ...(q.get("type") === "ws"
            ? {
                "ws-opts": {
                  path: q.get("path") || "/",
                  headers: { Host: q.get("host") || "" },
                },
              }
            : {}),
          ...(q.get("type") === "grpc"
            ? {
                "grpc-opts": {
                  "grpc-service-name": q.get("serviceName") || "",
                },
              }
            : {}),
          ...(q.get("type") === "xhttp"
            ? {
                "xhttp-opts": {
                  path: q.get("path") || "/",
                  host: q.get("host") || "",
                  mode: q.get("mode") || "auto",
                },
              }
            : {}),
          ...(q.get("pbk")
            ? {
                "reality-opts": {
                  "public-key": q.get("pbk"),
                  "short-id": q.get("sid") || "",
                },
              }
            : {}),
          ...(q.get("flow") ? { flow: q.get("flow") } : {}),
        };
      });
  }
  if (!values.length || values.length > 2000)
    throw new Error("Expected 1–2000 nodes");
  const seen = new Set<string>();
  return values
    .map((raw: any) => {
      if (
        !raw ||
        !["vless", "vmess", "trojan", "ss", "hysteria2", "anytls"].includes(
          raw.type,
        ) ||
        typeof raw.server !== "string" ||
        !raw.server ||
        raw.server.length > 253 ||
        /[\s\[\]]/.test(raw.server) ||
        !Number.isInteger(raw.port) ||
        raw.port < 1 ||
        raw.port > 65535
      )
        throw new Error("Invalid node in source");
      if (
        ["vless", "vmess"].includes(raw.type)
          ? typeof raw.uuid !== "string" || !raw.uuid
          : typeof raw.password !== "string" || !raw.password
      )
        throw new Error("Source node credentials are missing");
      if (raw.type === "ss" && (typeof raw.cipher !== "string" || !raw.cipher))
        throw new Error("Shadowsocks cipher is missing");
      if (
        raw.alpn !== undefined &&
        (!Array.isArray(raw.alpn) ||
          raw.alpn.length > 16 ||
          raw.alpn.some(
            (value: unknown) =>
              typeof value !== "string" ||
              !/^[\x21-\x2b\x2d-\x7e]{1,255}$/.test(value),
          ))
      )
        throw new Error("Invalid source TLS ALPN");
      const id = sourceIdentity(sourceId, raw);
      return {
        id,
        name: String(raw.name || raw.server).slice(0, 80),
        sourceId,
        distributionOnly: true,
        proxy: raw,
      };
    })
    .filter((node) => {
      if (seen.has(node.id)) return false;
      seen.add(node.id);
      return true;
    });
}
@Injectable()
export class NodifyResourcesService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private readonly logger = new Logger(NodifyResourcesService.name);
  readonly localOperations: LocalOperations;
  constructor(private readonly service: NodifyService) {
    this.localOperations = new LocalOperations(service, {
      backup: (payload, task) =>
        this.backup(payload.password, payload.backupId, task),
      "scheduled-backup": (payload, task) =>
        this.runScheduledBackup(payload, task),
      certificate: (payload, task) =>
        this.issueCertificate(
          CertificateRequest.parse(payload),
          undefined,
          task,
        ),
      "renew-certificate": (payload, task) =>
        this.renew(payload.certificateId, task),
    });
  }
  async onModuleInit() {
    await this.localOperations.recover();
    await this.cleanupTaskArtifacts();
    this.localOperations.start();
    this.timer = setInterval(() => {
      void this.tick().catch((e) => this.logger.error(e.message));
    }, 60000);
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.localOperations.stop();
  }
  async listSources() {
    const rows = await this.service.db.nodifySubscriptionSource.findMany({
      orderBy: { name: "asc" },
    });
    return Promise.all(
      rows.map(async (row) => {
        const operation = row.operationId
          ? await this.service.db.nodifyOperation.findUnique({
              where: { id: row.operationId },
              select: {
                id: true,
                state: true,
                message: true,
                result: true,
                expiresAt: true,
                finishedAt: true,
              },
            })
          : null;
        const expired =
          operation &&
          ["queued", "running"].includes(operation.state) &&
          operation.expiresAt <= new Date();
        return {
          id: row.id,
          name: row.name,
          version: row.version,
          enabled: row.enabled,
          tags: row.tags,
          intervalMinutes: row.intervalMinutes,
          traffic: row.traffic,
          trafficDirection: row.trafficDirection,
          trafficStale: row.trafficStale,
          endpointHost: new URL(this.service.box.open(row.encryptedUrl)).host,
          lastSyncedAt: row.lastSyncedAt,
          lastAttemptAt: row.lastAttemptAt,
          lastError: row.lastError,
          operation: operation
            ? {
                ...operation,
                ...(expired
                  ? { state: "failed", message: "同步任务已超时，请重新同步" }
                  : {}),
              }
            : null,
          nodes: sourceNodes(row).map(({ proxy, ...node }) => ({
            ...node,
            protocol: proxy.type,
            server: proxy.server,
            port: proxy.port,
          })),
        };
      }),
    );
  }
  private async sourceBusy(
    tx: Prisma.TransactionClient,
    operationId: string | null,
  ) {
    if (!operationId) return;
    const op = await tx.nodifyOperation.findUnique({
      where: { id: operationId },
    });
    if (
      op &&
      ["queued", "running"].includes(op.state) &&
      op.expiresAt > new Date()
    )
      throw new ConflictException("来源正在同步，请等待完成或超时后重试");
  }
  async updateSource(id: string, body: unknown) {
    const { url, version, ...input } = SourceUpdateInput.parse(body);
    await this.service.db.$transaction(async (tx) => {
      const row = await tx.nodifySubscriptionSource.findUniqueOrThrow({
        where: { id },
      });
      await this.sourceBusy(tx, row.operationId);
      const result = await tx.nodifySubscriptionSource.updateMany({
        where: { id, version },
        data: {
          ...input,
          ...(url
            ? { encryptedUrl: this.service.box.seal(url), trafficStale: true }
            : {}),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1)
        throw new ConflictException("来源已变化，请刷新后重试");
    });
    return { id };
  }
  async updateSourceNode(id: string, nodeId: string, body: unknown) {
    const { version, ...input } = SourceNodeInput.parse(body);
    await this.service.db.$transaction(async (tx) => {
      const row = await tx.nodifySubscriptionSource.findUniqueOrThrow({
        where: { id },
      });
      await this.sourceBusy(tx, row.operationId);
      if (!(row.nodes as any[]).some((node) => node.id === nodeId))
        throw new NotFoundException("节点已从来源移除，请刷新列表");
      const nodeOverrides = {
        ...(row.nodeOverrides as Record<string, any>),
        [nodeId]: input,
      };
      const result = await tx.nodifySubscriptionSource.updateMany({
        where: { id, version },
        data: { nodeOverrides, version: { increment: 1 } },
      });
      if (result.count !== 1)
        throw new ConflictException("来源已变化，请刷新后重试");
    });
    return { id: nodeId };
  }
  async deleteSource(id: string, version: number) {
    await this.service.db.$transaction(async (tx) => {
      const row = await tx.nodifySubscriptionSource.findUniqueOrThrow({
        where: { id },
      });
      await this.sourceBusy(tx, row.operationId);
      if (
        (
          await tx.nodifySubscriptionSource.deleteMany({
            where: { id, version },
          })
        ).count !== 1
      )
        throw new ConflictException("来源已变化，请刷新后重试");
    });
    return { deleted: true };
  }
  async createSource(body: unknown) {
    const input = SourceInput.parse(body);
    const row = await this.service.db.$transaction(async (tx) => {
      if ((await tx.nodifySubscriptionSource.count()) >= 100)
        throw new BadRequestException("最多保存 100 个外部来源");
      return tx.nodifySubscriptionSource.create({
        data: {
          name: input.name,
          intervalMinutes: input.intervalMinutes,
          enabled: input.enabled,
          tags: input.tags,
          trafficDirection: input.trafficDirection,
          encryptedUrl: this.service.box.seal(input.url),
        },
      });
    });
    const operation = await this.syncSource(row.id);
    return { id: row.id, operationId: operation.id };
  }
  async syncSource(id: string) {
    const { row, operation } = await this.service.db.$transaction(
      async (tx) => {
        const row = await tx.nodifySubscriptionSource.findUniqueOrThrow({
          where: { id },
        });
        await this.sourceBusy(tx, row.operationId);
        const operation = await tx.nodifyOperation.create({
          data: {
            kind: "subscription-sync",
            state: "running",
            payload: this.service.box.seal(JSON.stringify({ sourceId: id })),
            expiresAt: new Date(Date.now() + 60000),
          },
        });
        await tx.nodifySubscriptionSource.update({
          where: { id },
          data: { operationId: operation.id, lastAttemptAt: new Date() },
        });
        return { row, operation };
      },
    );
    void this.runSourceSync(row, operation.id).catch(() =>
      this.logger.error(
        "Unable to persist subscription synchronization result",
      ),
    );
    return { id: operation.id, state: operation.state };
  }
  protected fetchSource(
    url: string,
  ): Promise<string | Awaited<ReturnType<typeof fetchSubscriptionResult>>> {
    return fetchSubscriptionResult(url);
  }
  private async runSourceSync(
    row: Awaited<
      ReturnType<
        NodifyService["db"]["nodifySubscriptionSource"]["findUniqueOrThrow"]
      >
    >,
    operationId: string,
  ) {
    const id = row.id;
    try {
      const response = await this.fetchSource(
        this.service.box.open(row.encryptedUrl),
      );
      const nodes = parseSource(
        typeof response === "string" ? response : response.text,
        id,
      );
      const traffic = typeof response === "string" ? null : response.traffic;
      await this.service.db.$transaction(async (tx) => {
        const op = await tx.nodifyOperation.findUnique({
          where: { id: operationId },
        });
        if (!op || op.state !== "running" || op.expiresAt <= new Date())
          throw new Error("Expired synchronization");
        const nodeOverrides = Object.fromEntries(
          Object.entries(row.nodeOverrides as Record<string, any>).filter(
            ([id]) => nodes.some((node) => node.id === id),
          ),
        );
        const updated = await tx.nodifySubscriptionSource.updateMany({
          where: { id, version: row.version, operationId },
          data: {
            nodes,
            traffic: traffic ?? Prisma.DbNull,
            trafficStale: false,
            nodeOverrides,
            lastSyncedAt: new Date(),
            lastError: null,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1)
          throw new Error("Source was changed during synchronization");
        await tx.nodifyOperation.update({
          where: { id: operationId },
          data: {
            state: "succeeded",
            result: { count: nodes.length },
            finishedAt: new Date(),
          },
        });
      });
    } catch {
      const message =
        "无法下载或解析订阅，或来源已发生变化；保留上次有效节点与流量快照。请检查地址、证书和订阅内容后重试。";
      await this.service.db.$transaction(async (tx) => {
        await tx.nodifySubscriptionSource.updateMany({
          where: { id, version: row.version, operationId },
          data: { lastError: message, trafficStale: true },
        });
        await tx.nodifyOperation.updateMany({
          where: { id: operationId, state: "running" },
          data: { state: "failed", message, finishedAt: new Date() },
        });
      });
    }
  }
  async requestCertificate(body: unknown) {
    const input = CertificateRequest.parse(body);
    return this.localOperations.enqueue(
      "certificate",
      this.certificateTaskKey(input),
      input,
    );
  }
  private certificateTaskKey(
    input: ReturnType<typeof CertificateRequest.parse>,
  ) {
    return `acme:${createHash("sha256")
      .update([...input.domains].sort().join("\n"))
      .digest("hex")}`;
  }
  private async issueCertificate(
    input: ReturnType<typeof CertificateRequest.parse>,
    existingId: string | undefined,
    task: LocalTask,
  ) {
    if (task.checkpoint.phase === "certificate-saved") {
      const id = task.checkpoint.certificateId;
      await this.service.db.nodifyCertificate.findUniqueOrThrow({
        where: { id },
      });
      if (existingId) await this.deployRenewed(id, task);
      return { id };
    }
    const workRoot = join(dataDir(), "acme");
    await mkdir(workRoot, { recursive: true, mode: 0o700 });
    const path = await mkdtemp(join(workRoot, `job-${task.id}-`));
    try {
      if (existingId) {
        const existing =
          await this.service.db.nodifyCertificate.findUniqueOrThrow({
            where: { id: existingId },
          });
        const stored = JSON.parse(
          this.service.box.open(existing.encryptedAccount!),
        );
        for (const [name, content] of Object.entries(
          stored.accountFiles || {},
        )) {
          const destination = resolve(path, name);
          if (
            !destination.startsWith(resolve(path, "accounts") + sep) ||
            typeof content !== "string"
          )
            throw new Error("Invalid ACME account archive");
          await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
          await writeFile(destination, Buffer.from(content, "base64"), {
            mode: 0o600,
          });
        }
      }
      const names: Record<string, string[]> = {
        cloudflare: ["CF_DNS_API_TOKEN", "CF_ZONE_API_TOKEN"],
        alidns: ["ALICLOUD_ACCESS_KEY", "ALICLOUD_SECRET_KEY"],
        tencentcloud: ["TENCENTCLOUD_SECRET_ID", "TENCENTCLOUD_SECRET_KEY"],
      };
      const env = { ...process.env };
      for (const key of names[input.provider])
        if (input.credentials[key]) env[key] = input.credentials[key];
      const args = [
        "--path",
        path,
        "--email",
        input.email,
        "--accept-tos",
        "--dns",
        input.provider,
        ...(input.staging
          ? [
              "--server",
              "https://acme-staging-v02.api.letsencrypt.org/directory",
            ]
          : []),
        ...input.domains.flatMap((d) => ["--domains", d]),
        "run",
      ];
      await exec(process.env.NODIFY_LEGO_BINARY || "lego", args, {
        env,
        signal: task.signal,
        timeout: 12 * 60000,
        maxBuffer: 2 * 1024 * 1024,
      });
      const domain = input.domains[0].replace("*", "_");
      const certPem = await readFile(
        join(path, "certificates", `${domain}.crt`),
        "utf8",
      );
      const keyPem = await readFile(
        join(path, "certificates", `${domain}.key`),
        "utf8",
      );
      const accountFiles: Record<string, string> = {};
      const collectAccounts = async (directory: string) => {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const file = join(directory, entry.name);
          if (entry.isDirectory()) await collectAccounts(file);
          else if (entry.isFile())
            accountFiles[relative(path, file)] = (
              await readFile(file)
            ).toString("base64");
        }
      };
      await collectAccounts(join(path, "accounts"));
      const encryptedAccount = this.service.box.seal(
        JSON.stringify({ ...input, accountFiles }),
      );
      const data = {
        ...this.service.certificateData({ name: input.name, certPem, keyPem }),
        encryptedAccount,
        provider: input.provider,
        lastError: null,
      };
      const certificate = await task.commit(async (tx) => {
        const row = existingId
          ? await tx.nodifyCertificate.update({
              where: { id: existingId },
              data,
            })
          : await tx.nodifyCertificate.create({ data });
        await tx.nodifyOperation.update({
          where: { id: task.id },
          data: {
            result: { phase: "certificate-saved", certificateId: row.id },
          },
        });
        return row;
      });
      if (existingId) await this.deployRenewed(existingId, task);
      return { id: certificate.id };
    } finally {
      if (!resolve(path).startsWith(resolve(workRoot) + sep + "job-"))
        throw new Error("Refusing to clean an unexpected ACME directory");
      await rm(path, { recursive: true, force: true });
    }
  }
  async renew(id: string, task: LocalTask) {
    const c = await this.service.db.nodifyCertificate.findUniqueOrThrow({
      where: { id },
    });
    if (!c.encryptedAccount)
      throw new BadRequestException(
        "Upload a replacement for manually managed certificates",
      );
    return this.issueCertificate(
      CertificateRequest.parse(
        JSON.parse(this.service.box.open(c.encryptedAccount)),
      ),
      id,
      task,
    );
  }
  async queueRenew(id: string) {
    const certificate =
      await this.service.db.nodifyCertificate.findUniqueOrThrow({
        where: { id },
      });
    if (!certificate.encryptedAccount)
      throw new BadRequestException("手动证书请上传替换证书");
    return this.localOperations.enqueue(
      "renew-certificate",
      `certificate:${id}`,
      { certificateId: id },
      {},
      async (tx) => {
        await tx.nodifyCertificate.update({
          where: { id },
          data: { lastError: null },
        });
      },
    );
  }
  async queueBackup(password: string) {
    return this.localOperations.enqueue("backup", "backup", {
      password,
      backupId: randomUUID(),
    });
  }
  async retryOperation(id: string) {
    const row = await this.service.db.nodifyOperation.findUniqueOrThrow({
      where: { id },
    });
    if (row.executor !== "local" || row.state !== "failed")
      throw new BadRequestException(
        "只能重试失败的主控本地任务；服务器任务请从资源页面重新提交",
      );
    const payload = JSON.parse(this.service.box.open(row.payload));
    const key = ["backup", "scheduled-backup"].includes(row.kind)
      ? "backup"
      : row.kind === "renew-certificate"
        ? `certificate:${payload.certificateId}`
        : row.kind === "certificate"
          ? this.certificateTaskKey(CertificateRequest.parse(payload))
          : null;
    if (!key) throw new BadRequestException("此任务不支持重试");
    return this.localOperations.enqueue(
      row.kind,
      key,
      payload,
      row.result as Record<string, any>,
      undefined,
      id,
    );
  }
  async cleanupTaskArtifacts() {
    const list = async (path: string) =>
      readdir(path, { withFileTypes: true }).catch((error) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
    const backupDirectory = join(dataDir(), "backups"),
      acmeDirectory = join(dataDir(), "acme");
    await this.service.db.$transaction(async (tx) => {
      const active = await tx.nodifyOperation.findMany({
        where: {
          executor: "local",
          state: { in: ["queued", "running"] },
          kind: { in: ["backup", "scheduled-backup"] },
        },
      });
      const activeIds = new Set(
        active.flatMap((operation) => {
          try {
            return [
              JSON.parse(this.service.box.open(operation.payload)).backupId,
            ];
          } catch {
            return [];
          }
        }),
      );
      for (const entry of await list(backupDirectory)) {
        const match = /^([a-f0-9-]{36})\.[a-zA-Z0-9-]+\.(sqlite|partial)$/.exec(
          entry.name,
        );
        if (entry.isFile() && match && !activeIds.has(match[1]))
          await unlink(join(backupDirectory, entry.name));
      }
      for (const entry of await list(acmeDirectory)) {
        const match = /^job-([a-f0-9-]{36})-[a-zA-Z0-9]+$/.exec(entry.name);
        if (!entry.isDirectory() || !match) continue;
        const operation = await tx.nodifyOperation.findUnique({
          where: { id: match[1] },
        });
        if (operation && ["queued", "running"].includes(operation.state))
          continue;
        const path = resolve(acmeDirectory, entry.name);
        if (!path.startsWith(resolve(acmeDirectory) + sep + "job-"))
          throw new Error("Unexpected ACME path");
        await rm(path, { recursive: true, force: true });
      }
    });
  }
  private async deployRenewed(id: string, task: LocalTask) {
    let failures = 0;
    const publish = async (
      target: string,
      action: (commit: LocalTask["commit"]) => Promise<unknown>,
    ) => {
      try {
        const current = await this.service.db.nodifyOperation.findUniqueOrThrow(
          { where: { id: task.id } },
        );
        const checkpoint = current.result as Record<string, any>;
        const previousId = checkpoint.deployments?.[target];
        if (previousId) {
          const previous = await this.service.db.nodifyOperation.findUnique({
            where: { id: previousId },
          });
          if (previous && previous.state !== "failed") return;
        }
        await action(<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
          task.commit(async (tx) => {
            const result = await work(tx);
            const row = await tx.nodifyOperation.findUniqueOrThrow({
              where: { id: task.id },
            });
            const state = row.result as Record<string, any>;
            await tx.nodifyOperation.update({
              where: { id: task.id },
              data: {
                result: {
                  ...state,
                  deployments: {
                    ...state.deployments,
                    [target]: (result as any).id,
                  },
                },
              },
            });
            return result;
          }),
        );
      } catch {
        failures++;
      }
    };
    const servers = await this.service.db.nodifyServer.findMany({
      where: { appliedVersion: { gt: 0 } },
    });
    for (const server of servers) {
      const rows = await this.service.revisions(server.id);
      const row = rows.find((r) => r.version === server.appliedVersion);
      if (row && JSON.stringify(row.config).includes(id))
        await publish(`server:${server.id}`, (commit) =>
          this.service.apply(server.id, row.version, commit),
        );
    }
    const sites = await this.service.db.nodifyWebsite.findMany();
    for (const site of sites)
      if (
        site.appliedVersion &&
        (site.appliedConfig as any)?.certificateId === id
      )
        await publish(`website:${site.id}`, (commit) =>
          this.service.publishWebsite(
            site.serverId,
            site.id,
            site.appliedVersion,
            commit,
          ),
        );
    if (failures)
      throw new Error("Some certificate deployments could not be queued");
  }
  async backup(password: string, id = randomUUID(), task?: LocalTask) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid backup identity");
    const commit = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
      task ? task.commit(work) : this.service.db.$transaction(work);
    const directory = join(dataDir(), "backups");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const filename = `${id}.nodify`;
    const existing = await this.service.db.nodifyBackup.findUnique({
      where: { id },
    });
    if (existing?.state === "succeeded") {
      try {
        await stat(join(directory, filename));
        return { id, state: "succeeded" };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    await commit(async (tx) => {
      await tx.nodifyBackup.upsert({
        where: { id },
        create: { id, filename },
        update: { state: "running", message: "" },
      });
      for (const name of await readdir(directory)) {
        if (name.startsWith(`${id}.`) && /\.(sqlite|partial)$/.test(name))
          await unlink(join(directory, name)).catch((e) => {
            if (e.code !== "ENOENT") throw e;
          });
      }
    });
    const attempt = randomUUID();
    const snapshot = join(directory, `${id}.${attempt}.sqlite`);
    const partial = join(directory, `${id}.${attempt}.partial`);
    try {
      await this.service.db.$executeRawUnsafe(
        `VACUUM INTO '${snapshot.replace(/'/g, "''")}'`,
      );
      if ((await stat(snapshot)).size > 128 * 1024 * 1024)
        throw new Error("Database exceeds in-memory backup limit (128 MB)");
      const database = await readFile(snapshot);
      const masterKey = await readFile(join(dataDir(), "master.key"));
      const archive = gzipSync(
        Buffer.from(
          JSON.stringify({
            format: 1,
            version: process.env.NODIFY_VERSION || NODIFY_VERSION,
            applicationSecret: process.env.APP_SECRET,
            createdAt: new Date().toISOString(),
            database: database.toString("base64"),
            databaseHash: createHash("sha256").update(database).digest("hex"),
            masterKey: masterKey.toString("base64"),
          }),
        ),
      );
      const salt = randomBytes(16),
        iv = randomBytes(12);
      const cipher = createCipheriv(
        "aes-256-gcm",
        scryptSync(password, salt, 32),
        iv,
      );
      const ciphertext = Buffer.concat([
        cipher.update(archive),
        cipher.final(),
      ]);
      const bytes = Buffer.concat([
        Buffer.from("NODIFY01"),
        salt,
        iv,
        cipher.getAuthTag(),
        ciphertext,
      ]);
      const handle = await open(partial, "wx", 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await commit(async (tx) => {
        await rename(partial, join(directory, filename));
        if (process.platform !== "win32") {
          const directoryHandle = await open(directory, "r");
          try {
            await directoryHandle.sync();
          } finally {
            await directoryHandle.close();
          }
        }
        await tx.nodifyBackup.update({
          where: { id },
          data: { state: "succeeded" },
        });
      });
      return { id, state: "succeeded" };
    } catch (error) {
      await commit((tx) =>
        tx.nodifyBackup.update({
          where: { id },
          data: {
            state: "failed",
            message: "Backup failed; existing backups retained",
          },
        }),
      ).catch(() => {});
      throw error;
    } finally {
      await unlink(snapshot).catch(() => {});
      await unlink(partial).catch(() => {});
    }
  }
  async backupFile(id: string) {
    const row = await this.service.db.nodifyBackup.findUniqueOrThrow({
      where: { id },
    });
    if (row.state !== "succeeded")
      throw new BadRequestException("Backup is not available");
    return join(dataDir(), "backups", row.filename);
  }
  async backupSettings() {
    const value = await this.service.db.nodifySetting.findUnique({
      where: { key: "backup.schedule" },
    });
    if (!value)
      return {
        enabled: false,
        intervalHours: 24,
        retain: 7,
        destination: "local",
      };
    const settings = BackupSchedule.parse(
      JSON.parse(this.service.box.open(value.value)),
    );
    return {
      enabled: settings.enabled,
      intervalHours: settings.intervalHours,
      retain: settings.retain,
      destination: settings.destination.type,
    };
  }
  async saveBackupSettings(body: unknown) {
    const settings = BackupSchedule.parse(body);
    const value = this.service.box.seal(JSON.stringify(settings));
    await this.service.db.nodifySetting.upsert({
      where: { key: "backup.schedule" },
      create: { key: "backup.schedule", value },
      update: { value },
    });
    return this.backupSettings();
  }
  private async scheduledBackup() {
    const row = await this.service.db.nodifySetting.findUnique({
      where: { key: "backup.schedule" },
    });
    if (!row) return;
    const settings = BackupSchedule.parse(
      JSON.parse(this.service.box.open(row.value)),
    );
    if (!settings.enabled) return;
    const last = await this.service.db.nodifySetting.findUnique({
      where: { key: "backup.lastAttempt" },
    });
    if (
      last &&
      Date.now() - Number(last.value) < settings.intervalHours * 3600000
    )
      return;
    return this.localOperations.enqueue(
      "scheduled-backup",
      "backup",
      { settings, backupId: randomUUID() },
      {},
      async (tx) => {
        const current = await tx.nodifySetting.findUnique({
          where: { key: "backup.lastAttempt" },
        });
        if (
          current &&
          Date.now() - Number(current.value) < settings.intervalHours * 3600000
        )
          throw new ConflictException("本周期已经创建备份任务");
        const stamp = Date.now().toString();
        await tx.nodifySetting.upsert({
          where: { key: "backup.lastAttempt" },
          create: { key: "backup.lastAttempt", value: stamp },
          update: { value: stamp },
        });
      },
    );
  }
  private async runScheduledBackup(payload: any, task: LocalTask) {
    const settings = BackupSchedule.parse(payload.settings);
    const result = await this.backup(settings.password, payload.backupId, task);
    const file = await this.backupFile(result.id);
    try {
      await remoteBackup(
        settings.destination,
        `${result.id}.nodify`,
        await readFile(file),
        task.signal,
      );
    } catch {
      await task.commit((tx) =>
        tx.nodifyBackup.update({
          where: { id: result.id },
          data: {
            message:
              "Local backup succeeded, remote upload or verification failed",
          },
        }),
      );
      throw new Error("Remote backup upload or integrity verification failed");
    }
    const old = await this.service.db.nodifyBackup.findMany({
      where: { state: "succeeded" },
      orderBy: { createdAt: "desc" },
      skip: settings.retain,
    });
    for (const backup of old) {
      if (!/^[a-f0-9-]{36}\.nodify$/.test(backup.filename)) continue;
      task.signal.throwIfAborted();
      await remoteBackup(
        settings.destination,
        backup.filename,
        undefined,
        task.signal,
      );
      await task.commit(async (tx) => {
        await unlink(join(dataDir(), "backups", backup.filename)).catch((e) => {
          if (e.code !== "ENOENT") throw e;
        });
        await tx.nodifyBackup.deleteMany({ where: { id: backup.id } });
      });
    }
    await task.commit((tx) =>
      tx.nodifyBackup.update({
        where: { id: result.id },
        data: { message: "" },
      }),
    );
    return { ...result, destination: settings.destination.type };
  }
  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.localOperations.recover();
      await this.cleanupTaskArtifacts();
      await this.scheduledBackup().catch((e) => this.logger.error(e.message));
      const sources = await this.service.db.nodifySubscriptionSource.findMany();
      for (const source of sources)
        if (
          source.enabled &&
          source.intervalMinutes > 0 &&
          (!source.lastAttemptAt ||
            Date.now() - source.lastAttemptAt.getTime() >
              source.intervalMinutes * 60000)
        )
          await this.syncSource(source.id).catch(() => {});
      const certificates = await this.service.db.nodifyCertificate.findMany({
        where: {
          encryptedAccount: { not: null },
          expiresAt: { lt: new Date(Date.now() + 21 * 86400000) },
          updatedAt: { lt: new Date(Date.now() - 86400000) },
        },
      });
      for (const cert of certificates)
        await this.queueRenew(cert.id).catch(() => {});
    } finally {
      this.busy = false;
    }
  }
}
