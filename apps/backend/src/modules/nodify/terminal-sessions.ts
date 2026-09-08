import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import {
  TerminalOpen,
  TerminalInput,
  TerminalExchange,
  TERMINAL_INPUT_LIMIT,
  TERMINAL_OUTPUT_LIMIT,
  type TTerminalInput,
} from "@nodify/contract";
import { randomUUID } from "node:crypto";
import type { NodifyService } from "./nodify.service";
import type { Prisma, NodifyTerminalSession } from "@prisma/client";

type Contents = { inputs: TTerminalInput[] };
const active = (state: string) => ["pending", "running"].includes(state);

export class TerminalSessions {
  constructor(private readonly service: NodifyService) {}
  private decode(row: NodifyTerminalSession): Contents {
    return JSON.parse(this.service.box.open(row.encryptedData));
  }
  private encode(data: Contents) {
    return this.service.box.seal(JSON.stringify(data));
  }
  private async row(
    tx: Prisma.TransactionClient,
    serverId: string,
    id: string,
  ) {
    let row = await tx.nodifyTerminalSession.findFirst({
      where: { id, serverId },
    });
    if (!row) throw new NotFoundException("终端会话不存在");
    if (active(row.state) || row.state === "closing") {
      const op = await tx.nodifyOperation.findUnique({
        where: { id: row.operationId },
      });
      const now = Date.now();
      const reason =
        row.expiresAt.getTime() <= now
          ? "expired"
          : row.clientUntil.getTime() <= now
            ? "idle"
            : op?.state === "failed"
              ? "helper-failed"
              : (row.agentSeenAt || row.createdAt).getTime() < now - 30000
                ? "disconnected"
                : "";
      if (reason) {
        row = await tx.nodifyTerminalSession.update({
          where: { id },
          data: { state: "closed", reason },
        });
        await tx.nodifyOperation.updateMany({
          where: { id: row.operationId, state: { in: ["queued", "running"] } },
          data: {
            state: "failed",
            message: "Terminal session ended before launch acknowledgement",
            finishedAt: new Date(),
          },
        });
      }
    }
    return row;
  }
  async open(serverId: string, body: unknown) {
    const input = TerminalOpen.parse(body);
    return this.service.db.$transaction(async (tx) => {
      const prior = await tx.nodifyTerminalSession.findUnique({
        where: { id: input.requestId },
      });
      if (prior) {
        if (prior.serverId !== serverId)
          throw new NotFoundException("终端会话不存在");
        return {
          id: prior.id,
          operationId: prior.operationId,
          state: prior.state,
          expiresAt: prior.expiresAt,
        };
      }
      const server = await tx.nodifyServer.findUnique({
        where: { id: serverId },
      });
      if (!server) throw new NotFoundException("服务器不存在");
      if (
        !server.lastSeenAt ||
        server.lastSeenAt.getTime() < Date.now() - 30000 ||
        !(server.metrics as any)?.terminalAvailable
      )
        throw new ConflictException(
          "服务器离线或 Agent 未提供交互终端，请升级包含 PTY 辅助程序的 Agent",
        );
      await tx.nodifyTerminalSession.deleteMany({
        where: { expiresAt: { lt: new Date(Date.now() - 3600000) } },
      });
      for (const old of await tx.nodifyTerminalSession.findMany({
        where: { serverId, state: { in: ["pending", "running", "closing"] } },
      }))
        await this.row(tx, serverId, old.id);
      if (
        (await tx.nodifyTerminalSession.count({
          where: { serverId, state: { in: ["pending", "running", "closing"] } },
        })) >= 2
      )
        throw new ConflictException("每台服务器最多同时开启两个终端");
      const id = input.requestId,
        operationId = randomUUID(),
        now = new Date(),
        expiresAt = new Date(Date.now() + input.minutes * 60000);
      await tx.nodifyOperation.create({
        data: {
          id: operationId,
          serverId,
          kind: "terminal-session",
          expiresAt,
          payload: this.service.box.seal(
            JSON.stringify({
              id,
              cols: input.cols,
              rows: input.rows,
              expiresAt: expiresAt.toISOString(),
            }),
          ),
        },
      });
      await tx.nodifyTerminalSession.create({
        data: {
          id,
          serverId,
          operationId,
          expiresAt,
          createdAt: now,
          clientUntil: new Date(Date.now() + 30000),
          encryptedData: this.encode({ inputs: [] }),
        },
      });
      return { id, operationId, state: "pending", expiresAt };
    });
  }
  async read(serverId: string, id: string, after: number) {
    if (!Number.isSafeInteger(after) || after < 0)
      throw new BadRequestException("无效的终端输出位置");
    return this.service.db.$transaction(async (tx) => {
      const row = await this.row(tx, serverId, id);
      if (after > row.outputSequence)
        throw new BadRequestException("终端输出位置超出范围");
      if (active(row.state))
        await tx.nodifyTerminalSession.update({
          where: { id },
          data: { clientUntil: new Date(Date.now() + 30000) },
        });
      return {
        id,
        operationId: row.operationId,
        state: row.state,
        reason: row.reason,
        expiresAt: row.expiresAt,
        inputSequence: row.inputSequence,
        inputAck: row.inputAck,
        outputSequence: row.outputSequence,
        exitCode: row.exitCode,
        output: (
          await tx.nodifyTerminalOutput.findMany({
            where: { sessionId: id, sequence: { gt: after } },
            orderBy: { sequence: "asc" },
            take: 32,
          })
        ).map((f) => ({
          sequence: f.sequence,
          data: this.service.box.open(f.encryptedData),
        })),
      };
    });
  }
  async input(serverId: string, id: string, body: unknown) {
    const input = TerminalInput.parse(body);
    if (input.type === "input" && Buffer.byteLength(input.data) > 16384)
      throw new BadRequestException("终端输入过大");
    return this.service.db.$transaction(async (tx) => {
      const row = await this.row(tx, serverId, id);
      if (!active(row.state)) throw new ConflictException("终端会话已经结束");
      if (input.sequence <= row.inputSequence)
        return { acknowledged: row.inputSequence };
      if (input.sequence !== row.inputSequence + 1)
        throw new ConflictException("终端输入顺序不连续");
      const data = this.decode(row);
      if (
        data.inputs.length >= 128 ||
        Buffer.byteLength(JSON.stringify(data.inputs)) +
          Buffer.byteLength(JSON.stringify(input)) >
          TERMINAL_INPUT_LIMIT
      )
        throw new ConflictException("终端输入仍在同步，请稍后重试");
      data.inputs.push(input);
      await tx.nodifyTerminalSession.update({
        where: { id },
        data: {
          encryptedData: this.encode(data),
          inputSequence: input.sequence,
          clientUntil: new Date(Date.now() + 30000),
        },
      });
      return { acknowledged: input.sequence };
    });
  }
  async close(serverId: string, id: string) {
    return this.service.db.$transaction(async (tx) => {
      const row = await this.row(tx, serverId, id);
      if (active(row.state))
        await tx.nodifyTerminalSession.update({
          where: { id },
          data: { state: "closing", reason: "closed" },
        });
      await tx.nodifyOperation.updateMany({
        where: { id: row.operationId, state: "queued" },
        data: {
          state: "failed",
          message: "Terminal cancelled before launch",
          finishedAt: new Date(),
        },
      });
      return { closed: true };
    });
  }
  async exchange(serverId: string, body: unknown) {
    const input = TerminalExchange.parse(body),
      result = [];
    if (new Set(input.sessions.map((s) => s.id)).size !== input.sessions.length)
      throw new BadRequestException("重复终端会话");
    for (const report of input.sessions)
      result.push(
        await this.service.db.$transaction(async (tx) => {
          const existing = await tx.nodifyTerminalSession.findUnique({
            where: { id: report.id },
          });
          if (!existing)
            return {
              id: report.id,
              outputAck: report.output.at(-1)?.sequence || 0,
              close: true,
              inputs: [],
              leaseUntil: new Date(0),
              discardOutput: true,
            };
          // Scope is checked even for closed sessions and output retransmissions.
          const row = await this.row(tx, serverId, report.id),
            data = this.decode(row);
          if (
            report.inputAck < row.inputAck ||
            report.inputAck > row.inputSequence
          )
            throw new BadRequestException("无效的终端输入确认");
          let outputSequence = row.outputSequence,
            outputBytes = row.outputBytes,
            state = row.state,
            reason = row.reason;
          for (const frame of report.output) {
            if (frame.sequence <= outputSequence) continue;
            if (frame.sequence !== outputSequence + 1)
              throw new BadRequestException("终端输出顺序不连续");
            const size = Buffer.byteLength(frame.data, "base64");
            if (
              size > 16384 ||
              outputBytes + size > TERMINAL_OUTPUT_LIMIT ||
              outputSequence >= 8192
            ) {
              state = "closed";
              reason = "output-limit";
              break;
            }
            outputSequence = frame.sequence;
            outputBytes += size;
            await tx.nodifyTerminalOutput.create({
              data: {
                sessionId: row.id,
                sequence: frame.sequence,
                encryptedData: this.service.box.seal(frame.data),
              },
            });
          }
          data.inputs = data.inputs.filter((f) => f.sequence > report.inputAck);
          if (active(state)) {
            state = report.state;
            reason = report.reason;
          } else if (state === "closing" && report.state !== "running") {
            state = report.state;
            reason ||= report.reason;
          }
          await tx.nodifyTerminalSession.update({
            where: { id: row.id },
            data: {
              state,
              reason,
              inputAck: report.inputAck,
              outputSequence,
              outputBytes,
              ...(report.inputAck === row.inputAck
                ? {}
                : { encryptedData: this.encode(data) }),
              agentSeenAt: new Date(),
              ...(report.exitCode === undefined
                ? {}
                : { exitCode: report.exitCode }),
            },
          });
          return {
            id: row.id,
            outputAck: outputSequence,
            close: !active(state),
            inputs: active(state) ? data.inputs : [],
            leaseUntil: row.clientUntil,
            discardOutput: reason === "output-limit",
          };
        }),
      );
    return { sessions: result };
  }
}
