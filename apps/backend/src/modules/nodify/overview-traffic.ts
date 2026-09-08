import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  OverviewTrafficSettings,
  OverviewTraffic,
  TOverviewTraffic,
  ServerTrafficSettings,
  SourceTraffic,
  directionBytes,
} from "@nodify/contract";
import type { NodifyService } from "./nodify.service";
import { TrafficAccounting } from "./traffic-accounting";
type Item = TOverviewTraffic["items"][number];
const bucket = (items: Item[]): TOverviewTraffic["finite"] => {
  const finite = items.filter(
    (row) => row.limitBytes != null && row.limitBytes !== "0",
  );
  const known = items.filter((row) => row.usedBytes != null);
  const comparable = finite.filter((row) => row.usedBytes != null);
  const sum = (rows: Item[], value: (row: Item) => bigint) =>
    rows.length
      ? rows.reduce((total, row) => total + value(row), 0n).toString()
      : null;
  return {
    count: items.length,
    limitBytes: sum(finite, (row) => BigInt(row.limitBytes!)),
    usedBytes: sum(known, (row) => BigInt(row.usedBytes!)),
    remainingBytes: sum(comparable, (row) =>
      BigInt(row.limitBytes!) > BigInt(row.usedBytes!)
        ? BigInt(row.limitBytes!) - BigInt(row.usedBytes!)
        : 0n,
    ),
    overageBytes: sum(comparable, (row) =>
      BigInt(row.usedBytes!) > BigInt(row.limitBytes!)
        ? BigInt(row.usedBytes!) - BigInt(row.limitBytes!)
        : 0n,
    ),
    unknownUsageCount: items.length - known.length,
    partialCount: items.filter((row) => row.partial).length,
    staleCount: items.filter((row) => row.stale).length,
    expiredCount: items.filter((row) => row.expired).length,
  };
};
export class TrafficOverview {
  constructor(private readonly service: NodifyService) {}
  async save(body: unknown) {
    const input = OverviewTrafficSettings.parse(body);
    return this.service.db.$transaction(async (tx) => {
      const current = await tx.nodifyOverviewSettings.findUnique({
        where: { id: "global" },
      });
      if ((current?.version || 0) !== input.version)
        throw new ConflictException("首页统计设置已变化，请重新载入后再保存");
      const data = {
        version: input.version + 1,
        includeExternal: input.includeExternal,
      };
      await tx.nodifyOverviewSettings.upsert({
        where: { id: "global" },
        create: { id: "global", ...data },
        update: data,
      });
      return data;
    });
  }
  async read(now = new Date()): Promise<TOverviewTraffic> {
    return this.service.db.$transaction(
      async (tx) => {
        const stored = await tx.nodifyOverviewSettings.findUnique({
          where: { id: "global" },
        });
        const settings = {
          version: stored?.version || 0,
          includeExternal: stored?.includeExternal || false,
        };
        const all = await tx.nodifyServer.findMany({
          select: {
            id: true,
            node: { select: { name: true } },
            trafficSettings: true,
            trafficSettingsVersion: true,
            trafficEpoch: true,
            protocolTraffic: true,
            networkTraffic: true,
            lastSeenAt: true,
            createdAt: true,
            ledgerStartedAt: true,
          },
        });
        const selected = all.filter(
          (server) =>
            ServerTrafficSettings.parse(server.trafficSettings)
              .includeInOverview,
        );
        const servers = await new TrafficAccounting(this.service).augment(
          tx,
          selected,
          now,
        );
        const serverItems: Item[] = servers.map((server) => ({
          id: server.id,
          name: server.node.name,
          kind: "server",
          source: server.billing.source,
          direction: server.billing.direction,
          usedBytes: server.billing.usedBytes,
          limitBytes: server.billing.limitBytes,
          stale:
            !server.lastSeenAt ||
            now.getTime() - server.lastSeenAt.getTime() > 45000,
          expired: false,
          partial:
            server.billing.inconsistent ||
            server.billing.missingInterfaces.length > 0 ||
            !server.billing.hasData ||
            server.billing.discontinuities > 0 ||
            server.billing.crossDateReports > 0 ||
            server.billing.receivedDateReports > 0 ||
            (server.billing.expectedDays != null &&
              server.billing.observedDays < server.billing.expectedDays),
          periodStart: server.billing.period.start,
          periodEnd: server.billing.period.end,
        }));
        const sources = await tx.nodifySubscriptionSource.findMany({
          where: { enabled: true },
          select: {
            id: true,
            name: true,
            traffic: true,
            trafficStale: true,
            lastSyncedAt: true,
            intervalMinutes: true,
          },
        });
        const externalItems: Item[] = !settings.includeExternal
          ? []
          : sources.map((source) => {
              const parsed = SourceTraffic.safeParse(source.traffic),
                data = parsed.success ? parsed.data : null;
              return {
                id: source.id,
                name: source.name,
                kind: "external",
                source: "external",
                direction: "both",
                usedBytes: data
                  ? (BigInt(data.upload) + BigInt(data.download)).toString()
                  : null,
                limitBytes: data?.total ?? null,
                stale:
                  source.trafficStale ||
                  !source.lastSyncedAt ||
                  Boolean(
                    source.intervalMinutes > 0 &&
                    now.getTime() - source.lastSyncedAt.getTime() >
                      source.intervalMinutes * 120000,
                  ),
                expired: Boolean(
                  data?.expire &&
                  BigInt(data.expire) > 0n &&
                  BigInt(data.expire) * 1000n <= BigInt(now.getTime()),
                ),
                partial: !data,
                periodStart: null,
                periodEnd: null,
              };
            });
        const start = new Date(now.getTime() - 29 * 86400000)
            .toISOString()
            .slice(0, 10),
          end = now.toISOString().slice(0, 10);
        const protocolIds = servers
          .filter((row) => row.billing.source === "protocol")
          .map((row) => row.id);
        const network = servers.filter(
          (row) => row.billing.source === "network",
        );
        const where = { day: { gte: start, lte: end } };
        const protocolRows = await tx.nodifyDailyTraffic.findMany({
          where: { ...where, serverId: { in: protocolIds }, userId: "" },
          take: 50001,
        });
        const networkRows = network.length
          ? await tx.nodifyNetworkDaily.findMany({
              where: {
                ...where,
                OR: network.map((server) => ({
                  serverId: server.id,
                  interface: { in: server.billing.interfaces },
                })),
              },
              take: 50001,
            })
          : [];
        if (protocolRows.length + networkRows.length > 50000)
          throw new BadRequestException(
            "首页趋势记录过多，请减少计入首页的服务器或网卡",
          );
        const byServerDay = new Map<
          string,
          {
            upload: bigint;
            download: bigint;
            interfaces: Set<string>;
            discontinuities: number;
            crossDateReports: number;
            receivedDateReports: number;
          }
        >();
        for (const row of [...protocolRows, ...networkRows]) {
          const key = `${row.serverId}/${row.day}`,
            value = byServerDay.get(key) || {
              upload: 0n,
              download: 0n,
              interfaces: new Set<string>(),
              discontinuities: 0,
              crossDateReports: 0,
              receivedDateReports: 0,
            };
          value.upload += BigInt(row.upload);
          value.download += BigInt(row.download);
          value.receivedDateReports += row.receivedDateReports;
          if ("interface" in row) {
            value.interfaces.add(row.interface);
            value.discontinuities += row.discontinuities;
            value.crossDateReports += row.crossDateReports;
          }
          byServerDay.set(key, value);
        }
        const days: TOverviewTraffic["days"] = [];
        for (let i = 0; i < 30; i++) {
          const day = new Date(Date.parse(start) + i * 86400000)
            .toISOString()
            .slice(0, 10);
          let upload = 0n,
            download = 0n,
            used = 0n,
            reportedServers = 0,
            missingInterfaces = 0,
            discontinuities = 0,
            crossDateReports = 0,
            receivedDateReports = 0;
          for (const server of servers) {
            const row = byServerDay.get(`${server.id}/${day}`);
            if (!row) continue;
            reportedServers++;
            upload += row.upload;
            download += row.download;
            used += BigInt(
              directionBytes(
                row.upload.toString(),
                row.download.toString(),
                server.billing.direction,
              ),
            );
            if (server.billing.source === "network")
              missingInterfaces += server.billing.interfaces.filter(
                (name) => !row.interfaces.has(name),
              ).length;
            discontinuities += row.discontinuities;
            crossDateReports += row.crossDateReports;
            receivedDateReports += row.receivedDateReports;
          }
          days.push({
            day,
            upload: reportedServers ? upload.toString() : null,
            download: reportedServers ? download.toString() : null,
            usedBytes: reportedServers ? used.toString() : null,
            reportedServers,
            missingInterfaces,
            discontinuities,
            crossDateReports,
            receivedDateReports,
          });
        }
        const items = [...serverItems, ...externalItems];
        return OverviewTraffic.parse({
          generatedAt: now.toISOString(),
          settings,
          finite: bucket(
            items.filter(
              (row) => row.limitBytes != null && row.limitBytes !== "0",
            ),
          ),
          unlimited: bucket(items.filter((row) => row.limitBytes === "0")),
          unknownCapacity: bucket(
            items.filter((row) => row.limitBytes == null),
          ),
          items,
          days,
          selectedServers: servers.length,
          excludedServers: all.length - servers.length,
          enabledExternalSources: sources.length,
          timezone: "UTC",
          coverage: "reported-only",
        });
      },
      { maxWait: 5000, timeout: 25000 },
    );
  }
}
