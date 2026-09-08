import { ConflictException, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { NodifyService } from "./nodify.service";

type Transaction = Prisma.TransactionClient;
export type LocalTask = {
  id: string;
  signal: AbortSignal;
  checkpoint: Record<string, any>;
  commit: <T>(work: (tx: Transaction) => Promise<T>) => Promise<T>;
};
type Handler = (payload: any, task: LocalTask) => Promise<unknown>;
const released = { localKey: null, leaseOwner: null, leaseUntil: null };
const LEASE_MS = 30000;

/** SQLite is the authority. A late process cannot commit after losing its lease. */
export class LocalOperations {
  private readonly owner = randomUUID();
  private readonly logger = new Logger(LocalOperations.name);
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<void>;
  private controller?: AbortController;
  private stopped = false;
  constructor(
    private readonly service: NodifyService,
    private readonly handlers: Record<string, Handler>,
  ) {}

  async enqueue(
    kind: string,
    key: string,
    payload: unknown,
    checkpoint: Record<string, any> = {},
    created?: (tx: Transaction) => Promise<void>,
    retryOf?: string,
  ) {
    if (!this.handlers[kind]) throw new Error("Unknown local operation");
    await this.recover();
    try {
      const op = await this.service.db.$transaction(async (tx) => {
        const row = await tx.nodifyOperation.create({
          data: {
            kind,
            executor: "local",
            localKey: key,
            state: "queued",
            retryOf,
            payload: this.service.box.seal(JSON.stringify(payload)),
            result: checkpoint,
            expiresAt: new Date(Date.now() + 15 * 60000),
          },
        });
        if (created) await created(tx);
        return row;
      });
      this.wake();
      return { id: op.id, state: op.state };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        if (retryOf) {
          const prior = await this.service.db.nodifyOperation.findUnique({
            where: { retryOf },
          });
          if (prior) return { id: prior.id, state: prior.state };
        }
        throw new ConflictException(
          "该资源已有排队或执行中的任务，请等待完成后再操作",
        );
      }
      throw error;
    }
  }

  start() {
    this.stopped = false;
    this.timer = setInterval(() => this.wake(), 2000);
    this.wake();
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.controller?.abort();
    await this.active;
  }
  private wake() {
    if (!this.timer || this.stopped || this.active) return;
    this.active = this.drain()
      .catch(() =>
        this.logger.error("无法处理本地任务队列；已保留任务，稍后重试"),
      )
      .finally(() => {
        this.active = undefined;
      });
  }

  async recover() {
    const now = new Date();
    await this.service.db.$transaction(async (tx) => {
      const rows = await tx.nodifyOperation.findMany({
        where: {
          executor: "local",
          state: { in: ["queued", "running"] },
          OR: [
            { expiresAt: { lte: now } },
            { state: "running", leaseUntil: { lte: now } },
          ],
        },
      });
      for (const row of rows) {
        const checkpoint = row.result as Record<string, any>;
        const resume =
          row.expiresAt > now &&
          row.attempts < 3 &&
          (row.kind === "backup" ||
            row.kind === "scheduled-backup" ||
            checkpoint.phase === "certificate-saved");
        await tx.nodifyOperation.update({
          where: { id: row.id },
          data: resume
            ? {
                state: "queued",
                leaseOwner: null,
                leaseUntil: null,
                message: "执行进程中断，正在恢复任务",
              }
            : {
                ...released,
                state: "failed",
                finishedAt: now,
                message:
                  row.expiresAt <= now
                    ? "本地任务超时，已停止提交结果；请检查资源后重试"
                    : ["backup", "scheduled-backup"].includes(row.kind)
                      ? "任务连续中断，已停止自动恢复；请检查备份后手动重试"
                      : "签发进程中断，未能确认签发结果；请检查证书后手动重试",
              },
        });
        if (!resume && ["backup", "scheduled-backup"].includes(row.kind)) {
          const backupId = this.backupId(row.payload);
          if (backupId)
            await tx.nodifyBackup.updateMany({
              where: { id: backupId, state: "running" },
              data: {
                state: "failed",
                message: "备份任务中断或超时，现有可用备份已保留",
              },
            });
        }
      }
    });
  }

  private backupId(encrypted: string): string | undefined {
    try {
      const value = JSON.parse(this.service.box.open(encrypted)).backupId;
      return typeof value === "string" && /^[a-f0-9-]{36}$/.test(value)
        ? value
        : undefined;
    } catch {
      return undefined;
    }
  }

  /** Also used by integration tests to drive the same persisted worker without timers. */
  async drain() {
    await this.recover();
    if (this.stopped) return;
    const candidates = await this.service.db.nodifyOperation.findMany({
      where: {
        executor: "local",
        state: "queued",
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "asc" },
      take: 10,
    });
    for (const row of candidates) {
      if (this.stopped) break;
      const claimed = await this.service.db.nodifyOperation.updateMany({
        where: { id: row.id, state: "queued", expiresAt: { gt: new Date() } },
        data: {
          state: "running",
          leaseOwner: this.owner,
          leaseUntil: new Date(Date.now() + LEASE_MS),
          attempts: { increment: 1 },
        },
      });
      if (claimed.count !== 1) continue;
      const controller = new AbortController();
      this.controller = controller;
      let renewing = false;
      const heartbeat = setInterval(() => {
        if (renewing) return;
        renewing = true;
        void this.service.db.nodifyOperation
          .updateMany({
            where: {
              id: row.id,
              state: "running",
              leaseOwner: this.owner,
              leaseUntil: { gt: new Date() },
              expiresAt: { gt: new Date() },
            },
            data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
          })
          .then((result) => {
            if (!result.count) controller.abort();
          })
          .catch(() => controller.abort())
          .finally(() => {
            renewing = false;
          });
      }, 5000);
      const task: LocalTask = {
        id: row.id,
        signal: controller.signal,
        checkpoint: row.result as Record<string, any>,
        commit: async (work) =>
          this.service.db.$transaction(async (tx) => {
            controller.signal.throwIfAborted();
            const owned = await tx.nodifyOperation.count({
              where: {
                id: row.id,
                state: "running",
                leaseOwner: this.owner,
                leaseUntil: { gt: new Date() },
                expiresAt: { gt: new Date() },
              },
            });
            if (!owned) throw new Error("Local operation lease lost");
            return work(tx);
          }),
      };
      try {
        const handler = this.handlers[row.kind];
        if (!handler) throw new Error("Unknown local operation");
        const result = await handler(
          JSON.parse(this.service.box.open(row.payload)),
          task,
        );
        await task.commit((tx) =>
          tx.nodifyOperation.update({
            where: { id: row.id },
            data: {
              ...released,
              state: "succeeded",
              message: "",
              result: JSON.parse(JSON.stringify(result ?? {})),
              finishedAt: new Date(),
            },
          }),
        );
      } catch {
        if (!controller.signal.aborted) {
          await task
            .commit(async (tx) => {
              await tx.nodifyOperation.update({
                where: { id: row.id },
                data: {
                  ...released,
                  state: "failed",
                  message: "本地任务失败；请检查备份或证书状态后重试",
                  finishedAt: new Date(),
                },
              });
              if (["backup", "scheduled-backup"].includes(row.kind)) {
                const backupId = this.backupId(row.payload);
                if (backupId)
                  await tx.nodifyBackup.updateMany({
                    where: { id: backupId, state: "running" },
                    data: {
                      state: "failed",
                      message: "备份失败，现有可用备份已保留",
                    },
                  });
              }
            })
            .catch(() => {});
        }
      } finally {
        clearInterval(heartbeat);
        this.controller = undefined;
        // Expire only our own unfinished lease, allowing another process to recover it.
        if (controller.signal.aborted)
          await this.service.db.nodifyOperation.updateMany({
            where: { id: row.id, state: "running", leaseOwner: this.owner },
            data: { leaseUntil: new Date(0) },
          });
      }
    }
  }
}
