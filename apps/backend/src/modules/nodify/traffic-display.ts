import {
  ServerTrafficSettings,
  SourceTraffic,
  directionBytes,
  serverTrafficRaw,
} from "@nodify/contract";
type Row = Record<string, any>;
export function fileTraffic(file: Row, servers: Row[], sources: Row[]) {
  const ids = file.statisticServerIds as string[];
  const selected = ids.length
    ? servers.filter((server) => ids.includes(server.id))
    : servers;
  const serverRows = selected.map((server) => {
    const settings = ServerTrafficSettings.parse(server.trafficSettings);
    const raw = serverTrafficRaw(server);
    return {
      id: server.id,
      name: server.node.name,
      source: settings.source === "network" ? "network" : "protocol-users",
      missingInterfaces: raw.missingInterfaces,
      direction: settings.direction,
      upload: raw.upload ?? null,
      download: raw.download ?? null,
      usedBytes: server.billing
        ? server.billing.usedBytes
        : settings.resetDay != null
          ? null
          : raw.upload != null
            ? directionBytes(raw.upload, raw.download, settings.direction)
            : null,
      limitBytes: settings.limitBytes,
      startedAt: raw.startedAt ?? null,
      updatedAt: raw.updatedAt ?? null,
      period: server.billing?.period ?? null,
      adjustment: server.billing?.totalAdjustment ?? "0",
    };
  });
  const externalRows = sources
    .filter(
      (source) =>
        source.enabled &&
        (source.tags as string[]).some((tag) =>
          (file.tags as string[]).includes(tag),
        ),
    )
    .map((source) => {
      const parsed = SourceTraffic.safeParse(source.traffic);
      const traffic = parsed.success ? parsed.data : null;
      return {
        id: source.id,
        name: source.name,
        direction: source.trafficDirection,
        usedBytes: traffic
          ? directionBytes(
              traffic.upload,
              traffic.download,
              source.trafficDirection,
            )
          : null,
        upload: traffic?.upload ?? null,
        download: traffic?.download ?? null,
        limitBytes: traffic?.total ?? null,
        updatedAt: source.lastSyncedAt,
        stale:
          source.trafficStale ||
          Boolean(
            source.intervalMinutes > 0 &&
            source.lastSyncedAt &&
            Date.now() - new Date(source.lastSyncedAt).getTime() >
              source.intervalMinutes * 120000,
          ),
      };
    });
  const all = [...serverRows, ...externalRows];
  const finiteLimitBytes = all
    .reduce((sum, row) => sum + BigInt(row.limitBytes ?? "0"), 0n)
    .toString();
  return {
    servers: serverRows,
    externalSources: externalRows,
    usedBytes: all
      .reduce((sum, row) => sum + BigInt(row.usedBytes ?? "0"), 0n)
      .toString(),
    finiteLimitBytes,
    displayLimitBytes:
      file.displayTrafficLimitBytes ??
      (!all.length || all.some((row) => row.limitBytes == null)
        ? null
        : all.some((row) => row.limitBytes === "0")
          ? "0"
          : finiteLimitBytes),
    unknownUsageCount: all.filter(
      (row) =>
        row.usedBytes == null ||
        ("missingInterfaces" in row && row.missingInterfaces.length > 0),
    ).length,
    unknownLimitCount: all.filter((row) => row.limitBytes == null).length,
    unlimitedCount: all.filter((row) => row.limitBytes === "0").length,
    staleSourceCount: externalRows.filter((row) => row.stale).length,
    missingServerIds: ids.filter(
      (id) => !servers.some((server) => server.id === id),
    ),
  };
}
