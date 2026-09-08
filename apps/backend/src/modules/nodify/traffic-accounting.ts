import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  ServerTrafficSettings,
  TrafficAccountingAction,
  trafficPeriod,
  serverTrafficRaw,
  directionBytes,
} from "@nodify/contract";
import { z } from "zod";
import type { NodifyService } from "./nodify.service";
type Row = Record<string, any>;
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const basis = (settings: z.infer<typeof ServerTrafficSettings>) =>
  JSON.stringify([
    settings.source,
    [...settings.interfaces].sort(),
    settings.direction,
    settings.resetDay,
  ]);

export class TrafficAccounting {
  constructor(private readonly service: NodifyService) {}
  async current(tx: Prisma.TransactionClient, server: Row, now = new Date()) {
    const settings = ServerTrafficSettings.parse(server.trafficSettings);
    const period = trafficPeriod(settings.resetDay, now);
    const epoch = server.trafficEpoch || 1;
    const record = await tx.nodifyTrafficAccounting.findUnique({
      where: {
        serverId_epoch_periodStart: {
          serverId: server.id,
          epoch,
          periodStart: period.start,
        },
      },
    });
    let upload = 0n,
      download = 0n,
      hasData = false,
      reports = 0,
      discontinuities = 0,
      crossDateReports = 0,
      receivedDateReports = 0;
    let missingInterfaces: string[] = [];
    const observed = new Set<string>();
    if (period.start === "lifetime") {
      const raw = serverTrafficRaw(server);
      hasData = raw.upload != null;
      upload = BigInt(raw.upload || "0");
      download = BigInt(raw.download || "0");
      missingInterfaces = raw.missingInterfaces;
      discontinuities = raw.discontinuities || 0;
    } else {
      const where = {
        serverId: server.id,
        day: { gte: period.start, lt: period.end! },
      };
      const rows =
        settings.source === "network"
          ? await tx.nodifyNetworkDaily.findMany({
              where: { ...where, interface: { in: settings.interfaces } },
              take: 50001,
            })
          : await tx.nodifyDailyTraffic.findMany({
              where: { ...where, userId: "" },
              take: 50001,
            });
      if (rows.length > 50000)
        throw new BadRequestException("周期记录过多，请减少统计网卡");
      for (const row of rows) {
        upload += BigInt(row.upload);
        download += BigInt(row.download);
        hasData = true;
        reports += row.reports;
        receivedDateReports += row.receivedDateReports;
        observed.add(row.day);
        if ("discontinuities" in row) {
          discontinuities += row.discontinuities;
          crossDateReports += row.crossDateReports;
        }
      }
      if (settings.source === "network")
        missingInterfaces = settings.interfaces.filter(
          (name) =>
            !rows.some((row) => "interface" in row && row.interface === name),
        );
    }
    const baselineUpload = BigInt(record?.baselineUpload || "0"),
      baselineDownload = BigInt(record?.baselineDownload || "0");
    const inconsistent = upload < baselineUpload || download < baselineDownload;
    const measured = BigInt(
      directionBytes(
        upload.toString(),
        download.toString(),
        settings.direction,
      ),
    );
    const sinceBaseline = inconsistent
      ? 0n
      : BigInt(
          directionBytes(
            (upload - baselineUpload).toString(),
            (download - baselineDownload).toString(),
            settings.direction,
          ),
        );
    const manual = BigInt(record?.adjustment || "0"),
      billed = sinceBaseline + manual;
    const known =
      (hasData || record?.calibrated) && !inconsistent && billed >= 0n;
    return {
      period,
      asOf: now.toISOString(),
      periodKey: `${epoch}:${period.start}`,
      epoch,
      settingsVersion: server.trafficSettingsVersion,
      version: record?.version || 0,
      source: settings.source,
      interfaces: settings.interfaces,
      direction: settings.direction,
      rawUpload: hasData ? upload.toString() : null,
      rawDownload: hasData ? download.toString() : null,
      measuredBytes: hasData ? measured.toString() : null,
      baselineUpload: baselineUpload.toString(),
      baselineDownload: baselineDownload.toString(),
      baselineAdjustment: (sinceBaseline - measured).toString(),
      manualAdjustment: manual.toString(),
      totalAdjustment: (sinceBaseline - measured + manual).toString(),
      usedBytes: known ? billed.toString() : null,
      limitBytes: settings.limitBytes,
      remainingBytes:
        known && settings.limitBytes != null && settings.limitBytes !== "0"
          ? (BigInt(settings.limitBytes) > billed
              ? BigInt(settings.limitBytes) - billed
              : 0n
            ).toString()
          : null,
      coverage: "reported-only",
      hasData,
      missingInterfaces,
      observedDays: observed.size,
      expectedDays:
        period.start === "lifetime"
          ? null
          : Math.floor(
              (Date.parse(now.toISOString().slice(0, 10)) -
                Date.parse(period.start)) /
                86400000,
            ) + 1,
      reports,
      discontinuities,
      crossDateReports,
      receivedDateReports,
      inconsistent: inconsistent || billed < 0n,
      calibrated: record?.calibrated || false,
      updatedAt: record?.updatedAt || null,
    };
  }
  async augment<T extends Row>(
    tx: Prisma.TransactionClient,
    servers: T[],
    now = new Date(),
  ) {
    return Promise.all(
      servers.map(async (server) => ({
        ...server,
        billing: await this.current(tx, server, now),
      })),
    );
  }
  async saveSettings(serverId: string, body: unknown) {
    const { version, ...settings } = ServerTrafficSettings.safeExtend({
      version: z.number().int().positive(),
    }).parse(body);
    return this.service.db.$transaction(async (tx) => {
      const server = await tx.nodifyServer.findUnique({
        where: { id: serverId },
      });
      if (!server) throw new NotFoundException("服务器不存在");
      if (server.trafficSettingsVersion !== version)
        throw new ConflictException("统计设置已变化，请刷新后重试");
      const newEpoch =
        server.trafficEpoch +
        Number(
          basis(settings) !==
            basis(ServerTrafficSettings.parse(server.trafficSettings)),
        );
      await tx.nodifyServer.update({
        where: { id: serverId, trafficSettingsVersion: version },
        data: {
          trafficSettings: settings,
          trafficSettingsVersion: { increment: 1 },
          trafficEpoch: newEpoch,
        },
      });
      return { version: version + 1, epoch: newEpoch };
    });
  }
  async read(serverId: string, cursor?: string, now = new Date()) {
    return this.service.db.$transaction(async (tx) => {
      const server = await tx.nodifyServer.findUnique({
        where: { id: serverId },
      });
      if (!server) throw new NotFoundException("服务器不存在");
      if (
        cursor &&
        !(await tx.nodifyTrafficAdjustment.findFirst({
          where: { id: cursor, accounting: { serverId } },
        }))
      )
        throw new BadRequestException("记录游标无效");
      const events = await tx.nodifyTrafficAdjustment.findMany({
        where: { accounting: { serverId } },
        include: {
          accounting: {
            select: {
              epoch: true,
              periodStart: true,
              periodEnd: true,
              settings: true,
            },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 51,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      return {
        current: await this.current(tx, server, now),
        events: events.slice(0, 50),
        nextCursor: events.length > 50 ? events[49].id : null,
      };
    });
  }
  async change(serverId: string, body: unknown, now = new Date()) {
    const input = TrafficAccountingAction.parse(body);
    return this.service.db.$transaction(
      async (tx) => {
        const replay = await tx.nodifyTrafficAdjustment.findUnique({
          where: { id: input.requestId },
          include: { accounting: true },
        });
        if (replay) {
          if (
            replay.accounting.serverId !== serverId ||
            Object.entries(input).some(
              ([key, value]) => (replay.request as Row)[key] !== value,
            )
          )
            throw new ConflictException("请求标识已用于其他操作");
          return { replayed: true, eventId: replay.id };
        }
        const server = await tx.nodifyServer.findUnique({
          where: { id: serverId },
        });
        if (!server) throw new NotFoundException("服务器不存在");
        const before = await this.current(tx, server, now);
        if (
          before.periodKey !== input.periodKey ||
          before.settingsVersion !== input.settingsVersion ||
          before.version !== input.version
        )
          throw new ConflictException(
            "周期、设置或对账版本已变化，请刷新后重试",
          );
        const identity = {
          serverId,
          epoch: before.epoch,
          periodStart: before.period.start,
        };
        let baselineUpload = before.baselineUpload,
          baselineDownload = before.baselineDownload,
          adjustment = before.manualAdjustment;
        if (input.action === "clear") {
          baselineUpload = "0";
          baselineDownload = "0";
          adjustment = "0";
        } else if (input.action === "reset") {
          baselineUpload = before.rawUpload || "0";
          baselineDownload = before.rawDownload || "0";
          adjustment = "0";
        } else {
          if (before.inconsistent)
            throw new ConflictException(
              "账本小于已保存基线，请先检查数据或清除手工调整",
            );
          const measuredAfterBaseline =
            BigInt(before.measuredBytes || "0") +
            BigInt(before.baselineAdjustment);
          adjustment = (
            BigInt(input.targetBytes!) - measuredAfterBaseline
          ).toString();
        }
        const data = {
          baselineUpload,
          baselineDownload,
          adjustment,
          calibrated: input.action !== "clear",
          version: before.version + 1,
        };
        const accounting = await tx.nodifyTrafficAccounting.upsert({
          where: { serverId_epoch_periodStart: identity },
          create: {
            ...identity,
            periodEnd: before.period.end,
            settings: server.trafficSettings as Prisma.InputJsonValue,
            ...data,
          },
          update: data,
        });
        const after = await this.current(tx, server, now);
        await tx.nodifyTrafficAdjustment.create({
          data: {
            id: input.requestId,
            accountingId: accounting.id,
            request: json(input),
            before: json(before),
            after: json(after),
          },
        });
        return { replayed: false, eventId: input.requestId, current: after };
      },
      { maxWait: 5000, timeout: 25000 },
    );
  }
}
