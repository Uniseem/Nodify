import { BadRequestException, NotFoundException } from "@nestjs/common";
import {
  TrafficHistoryQuery,
  ServerTrafficSettings,
  directionBytes,
} from "@nodify/contract";
import { NodifyService } from "./nodify.service";
type Totals = {
  upload: bigint;
  download: bigint;
  charged: bigint;
  rated: bigint;
  unratedRaw: bigint;
  unchargedRaw: bigint;
  reports: number;
  receivedDateReports: number;
  hasData: boolean;
  discontinuities: number;
  crossDateReports: number;
};
const empty = (): Totals => ({
  upload: 0n,
  download: 0n,
  charged: 0n,
  rated: 0n,
  unratedRaw: 0n,
  unchargedRaw: 0n,
  reports: 0,
  receivedDateReports: 0,
  hasData: false,
  discontinuities: 0,
  crossDateReports: 0,
});
const add = (target: Totals, row: Record<string, any>) => {
  for (const key of [
    "upload",
    "download",
    "charged",
    "rated",
    "unratedRaw",
    "unchargedRaw",
  ] as const)
    target[key] += BigInt(row[key]);
  target.reports += row.reports;
  target.receivedDateReports += row.receivedDateReports;
  target.discontinuities += row.discontinuities || 0;
  target.crossDateReports += row.crossDateReports || 0;
  target.hasData = true;
};
const serialize = (value: Totals) => ({
  ...value,
  upload: value.hasData ? value.upload.toString() : null,
  download: value.hasData ? value.download.toString() : null,
  charged: value.hasData ? value.charged.toString() : null,
  rated: value.hasData ? value.rated.toString() : null,
  unratedRaw: value.hasData ? value.unratedRaw.toString() : null,
  unchargedRaw: value.hasData ? value.unchargedRaw.toString() : null,
});
export class TrafficHistory {
  constructor(private readonly service: NodifyService) {}
  async options() {
    const [servers, users] = await Promise.all([
      this.service.db.nodifyServer.findMany({
        select: { id: true, node: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      }),
      this.service.db.nodifyEntitlement.findMany({
        select: { userId: true, user: { select: { username: true } } },
        orderBy: { userId: "asc" },
      }),
    ]);
    return {
      servers: servers.map((row) => ({ id: row.id, name: row.node.name })),
      users: users.map((row) => ({
        id: row.userId.toString(),
        name: row.user.username,
      })),
    };
  }
  async read(query: unknown) {
    const input = TrafficHistoryQuery.parse(query);
    return this.service.db.$transaction(async (tx) => {
      const servers = await tx.nodifyServer.findMany({
        where: input.serverId ? { id: input.serverId } : {},
        select: {
          id: true,
          node: { select: { name: true } },
          trafficSettings: true,
          ledgerStartedAt: true,
          networkTraffic: true,
        },
      });
      if (input.serverId && !servers.length)
        throw new NotFoundException("服务器不存在");
      const settings = new Map(
        servers.map((server) => [
          server.id,
          ServerTrafficSettings.parse(server.trafficSettings),
        ]),
      );
      const protocolIds = servers
        .filter(
          (server) =>
            input.userId || settings.get(server.id)!.source === "protocol",
        )
        .map((server) => server.id);
      const networkServers = input.userId
        ? []
        : servers.filter(
            (server) => settings.get(server.id)!.source === "network",
          );
      const rows = await tx.nodifyDailyTraffic.findMany({
        where: {
          serverId: { in: protocolIds },
          userId: input.userId || "",
          day: { gte: input.from, lte: input.to },
        },
        take: 50001,
        orderBy: [{ day: "asc" }, { serverId: "asc" }],
      });
      const networkRows = networkServers.length
        ? await tx.nodifyNetworkDaily.findMany({
            where: {
              day: { gte: input.from, lte: input.to },
              OR: networkServers.map((server) => ({
                serverId: server.id,
                interface: { in: settings.get(server.id)!.interfaces },
              })),
            },
            take: 50001,
            orderBy: [{ day: "asc" }, { serverId: "asc" }],
          })
        : [];
      if (rows.length + networkRows.length > 50000)
        throw new BadRequestException(
          "结果过大，请缩短日期范围或选择单台服务器",
        );
      const byDay = new Map<string, Totals>(),
        byServer = new Map<string, Totals>(),
        reported = new Map<string, Set<string>>(),
        total = empty();
      for (const row of [
        ...rows,
        ...networkRows.map((row) => ({
          ...row,
          charged: "0",
          rated: "0",
          unratedRaw: "0",
          unchargedRaw: "0",
        })),
      ]) {
        const day = byDay.get(row.day) || empty(),
          server = byServer.get(row.serverId) || empty();
        add(day, row);
        add(server, row);
        add(total, row);
        byDay.set(row.day, day);
        byServer.set(row.serverId, server);
        const seen = reported.get(row.day) || new Set<string>();
        seen.add(row.serverId);
        reported.set(row.day, seen);
      }
      const days = [];
      for (
        let timestamp = Date.parse(input.from);
        timestamp <= Date.parse(input.to);
        timestamp += 86400000
      ) {
        const day = new Date(timestamp).toISOString().slice(0, 10);
        days.push({
          day,
          ...serialize(byDay.get(day) || empty()),
          reportedServers: reported.get(day)?.size || 0,
        });
      }
      const details = servers.map((server) => {
        const tally = byServer.get(server.id) || empty(),
          settings = ServerTrafficSettings.parse(server.trafficSettings);
        return {
          id: server.id,
          name: server.node.name,
          source: input.userId ? "protocol" : settings.source,
          interfaces: settings.interfaces,
          missingInterfaces:
            !input.userId && settings.source === "network"
              ? settings.interfaces.filter(
                  (name) =>
                    !networkRows.some(
                      (row) =>
                        row.serverId === server.id && row.interface === name,
                    ),
                )
              : [],
          ledgerStartedAt:
            input.userId || settings.source === "protocol"
              ? server.ledgerStartedAt
              : settings.interfaces
                  .map(
                    (name) =>
                      (server.networkTraffic as Record<string, any>)
                        .interfaces?.[name]?.startedAt,
                  )
                  .filter(Boolean)
                  .sort()[0] || null,
          ...serialize(tally),
          direction: settings.direction,
          displayBytes: tally.hasData
            ? input.userId
              ? tally.rated.toString()
              : directionBytes(
                  tally.upload.toString(),
                  tally.download.toString(),
                  settings.direction,
                )
            : null,
        };
      });
      const user = input.userId
        ? await tx.users.findUnique({
            where: { id: BigInt(input.userId) },
            select: { username: true },
          })
        : null;
      return {
        query: input,
        timezone: "UTC",
        scope: input.userId ? "user" : "servers",
        coverage: "reported-only",
        userName: user?.username ?? null,
        totals: {
          ...serialize(total),
          displayBytes: total.hasData
            ? details
                .reduce((sum, row) => sum + BigInt(row.displayBytes || "0"), 0n)
                .toString()
            : null,
        },
        days,
        servers: details,
        selectedServers: servers.length,
      };
    });
  }
}
