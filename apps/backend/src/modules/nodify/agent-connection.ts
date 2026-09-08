import { AgentConnectionInput, AgentRelayFrame } from "@nodify/contract";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { request } from "node:https";
import { randomUUID } from "node:crypto";
import { NodifyService } from "./nodify.service";
import { agentMessage } from "./agent-message";

export class AgentConnections {
  constructor(private readonly service: NodifyService) {}
  async read(serverId: string) {
    if (
      !(await this.service.db.nodifyServer.count({ where: { id: serverId } }))
    )
      throw new NotFoundException("服务器不存在");
    const row = await this.service.db.nodifyAgentConnection.findUnique({
      where: { serverId },
    });
    if (!row)
      return {
        version: 0,
        enabled: false,
        endpoint: "",
        configured: false,
        lastContactAt: null,
        lastError: "",
      };
    const config = JSON.parse(this.service.box.open(row.encryptedData));
    return {
      version: row.version,
      enabled: row.enabled,
      endpoint: config.endpoint,
      configured: true,
      lastContactAt: row.lastContactAt,
      lastError: row.lastError,
    };
  }
  async save(serverId: string, body: unknown) {
    const input = AgentConnectionInput.parse(body);
    await this.service.db.$transaction(async (tx) => {
      if (!(await tx.nodifyServer.count({ where: { id: serverId } })))
        throw new NotFoundException("服务器不存在");
      const prior = await tx.nodifyAgentConnection.findUnique({
        where: { serverId },
      });
      if ((prior?.version || 0) !== input.version)
        throw new ConflictException("连接配置已变化，请重新载入后修改");
      const token =
        input.token ||
        (prior
          ? JSON.parse(this.service.box.open(prior.encryptedData)).token
          : "");
      if (!token) throw new BadRequestException("首次保存需要直连凭据");
      const encryptedData = this.service.box.seal(
        JSON.stringify({ endpoint: input.endpoint.replace(/\/$/, ""), token }),
      );
      if (prior)
        await tx.nodifyAgentConnection.update({
          where: { serverId },
          data: {
            enabled: input.enabled,
            encryptedData,
            version: { increment: 1 },
            lastContactAt: null,
            lastError: "",
            leaseOwner: null,
            leaseUntil: null,
          },
        });
      else
        await tx.nodifyAgentConnection.create({
          data: { serverId, enabled: input.enabled, encryptedData },
        });
    });
    return this.read(serverId);
  }
}

export function exchangeDirect(
  endpoint: string,
  token: string,
  reply: unknown,
  signal: AbortSignal,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ reply });
    if (Buffer.byteLength(data) > 8 * 1024 * 1024) {
      reject(Error("直连响应超过 8 MiB"));
      return;
    }
    const req = request(
      `${endpoint}/api/nodify/exchange`,
      {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(Error(`Agent 直连接口返回 HTTP ${res.statusCode}`));
          return;
        }
        const buffers: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024) {
            req.destroy();
            reject(Error("Agent 直连数据超过 2 MiB"));
          } else buffers.push(chunk);
        });
        res.on("error", () => reject(Error("Agent 直连响应中断")));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(buffers).toString()));
          } catch {
            reject(Error("Agent 直连响应格式错误"));
          }
        });
      },
    );
    req.on("error", () =>
      reject(Error("Agent 直连失败，请检查网络、TLS 证书与监听配置")),
    );
    req.end(data);
  });
}

@Injectable()
export class NodifyDirectGateway implements OnModuleInit, OnModuleDestroy {
  readonly owner = randomUUID();
  private timer?: ReturnType<typeof setInterval>;
  private active = new Map<
    string,
    { abort: AbortController; task: Promise<void>; version: number }
  >();
  private stopped = false;
  private scanning = false;
  constructor(private readonly service: NodifyService) {}
  onModuleInit() {
    if (process.env.INSTANCE_TYPE && process.env.INSTANCE_TYPE !== "api")
      return;
    this.timer = setInterval(() => {
      void this.tick().catch(() => {});
    }, 1000);
  }
  async tick() {
    if (this.stopped || this.scanning) return;
    this.scanning = true;
    try {
      const rows = await this.service.db.nodifyAgentConnection.findMany({
        where: { enabled: true },
      });
      for (const [id, value] of this.active)
        if (
          !rows.some(
            (row) => row.serverId === id && row.version === value.version,
          )
        )
          value.abort.abort();
      for (const row of rows) {
        if (this.stopped) break;
        if (this.active.has(row.serverId)) continue;
        const claimed = await this.service.db.nodifyAgentConnection.updateMany({
          where: {
            serverId: row.serverId,
            version: row.version,
            enabled: true,
            OR: [
              { leaseUntil: null },
              { leaseUntil: { lt: new Date() } },
              { leaseOwner: this.owner },
            ],
          },
          data: {
            leaseOwner: this.owner,
            leaseUntil: new Date(Date.now() + 40000),
          },
        });
        if (!claimed.count) continue;
        const abort = new AbortController();
        const task = this.pump(row.serverId, row.version, abort.signal)
          .catch(() => {})
          .finally(async () => {
            await this.service.db.nodifyAgentConnection
              .updateMany({
                where: { serverId: row.serverId, leaseOwner: this.owner },
                data: { leaseOwner: null, leaseUntil: null },
              })
              .catch(() => {});
            this.active.delete(row.serverId);
          });
        this.active.set(row.serverId, { abort, task, version: row.version });
      }
    } finally {
      this.scanning = false;
    }
  }
  private async pump(serverId: string, version: number, signal: AbortSignal) {
    let reply: any = null,
      replyCredential = "";
    while (!signal.aborted && !this.stopped) {
      const row = await this.service.db.nodifyAgentConnection.findUnique({
        where: { serverId },
      });
      if (
        !row?.enabled ||
        row.version !== version ||
        row.leaseOwner !== this.owner
      )
        return;
      await this.service.db.nodifyAgentConnection.updateMany({
        where: { serverId, version, leaseOwner: this.owner },
        data: { leaseUntil: new Date(Date.now() + 40000) },
      });
      const config = JSON.parse(this.service.box.open(row.encryptedData));
      try {
        if (reply) {
          try {
            if (
              (await this.service.authenticate(replyCredential)).id !== serverId
            )
              throw Error();
          } catch {
            reply = null;
            replyCredential = "";
          }
        }
        const response = await exchangeDirect(
          config.endpoint,
          config.token,
          reply,
          AbortSignal.any([signal, AbortSignal.timeout(22000)]),
        );
        if (signal.aborted) return;
        if (
          !(await this.service.db.nodifyAgentConnection.count({
            where: { serverId, version, enabled: true, leaseOwner: this.owner },
          }))
        )
          return;
        if (response?.frame == null) continue;
        const frame = AgentRelayFrame.parse(response.frame);
        const authenticated = await this.service.authenticate(frame.credential);
        if (authenticated.id !== serverId)
          throw Error("Agent 直连身份与服务器不匹配");
        if (reply?.id !== frame.id) {
          replyCredential = frame.credential;
          try {
            const data =
              frame.type === "heartbeat"
                ? { ...(frame.data as any), connectionTransport: "direct" }
                : frame.data;
            reply = {
              id: frame.id,
              result: await agentMessage(
                this.service,
                serverId,
                frame.type,
                data,
              ),
            };
          } catch {
            reply = { id: frame.id, error: "Agent request rejected" };
          }
        }
        await this.service.db.nodifyAgentConnection.updateMany({
          where: { serverId, version, leaseOwner: this.owner },
          data: {
            lastContactAt: new Date(),
            lastError: reply.error
              ? "Agent 请求未通过校验，请检查 Agent 日志"
              : "",
          },
        });
      } catch (error) {
        if (signal.aborted) return;
        const message =
          error instanceof Error && error.message.startsWith("Agent 直连")
            ? error.message
            : "Agent 直连认证或数据校验失败";
        await this.service.db.nodifyAgentConnection.updateMany({
          where: { serverId, version, leaseOwner: this.owner },
          data: { lastError: message },
        });
        await new Promise<void>((resolve) => {
          const timer = setTimeout(done, 3000);
          function done() {
            clearTimeout(timer);
            signal.removeEventListener("abort", done);
            resolve();
          }
          signal.addEventListener("abort", done, { once: true });
        });
      }
    }
  }
  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    while (this.scanning)
      await new Promise((resolve) => setTimeout(resolve, 10));
    for (const value of this.active.values()) value.abort.abort();
    await Promise.allSettled(
      [...this.active.values()].map((value) => value.task),
    );
  }
}
