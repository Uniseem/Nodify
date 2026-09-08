import {
  NetworkBatch,
  InterfaceCounters,
  ServerTrafficSettings,
} from "@nodify/contract";
import type { NodifyService } from "./nodify.service";
import { accountingTime } from "./daily-traffic";

export class NetworkAccounting {
  constructor(private readonly service: NodifyService) {}
  async ingest(serverId: string, body: unknown) {
    const batch = NetworkBatch.parse(body);
    await this.service.db.$transaction(
      async (tx) => {
        const key = {
          serverId,
          session: batch.session,
          sequence: BigInt(batch.sequence),
        };
        if (
          await tx.nodifyNetworkBatch.findUnique({
            where: { serverId_session_sequence: key },
          })
        )
          return;
        const server = await tx.nodifyServer.findUniqueOrThrow({
          where: { id: serverId },
        });
        const stamp = accountingTime(batch.collectedAt, server.createdAt);
        await tx.nodifyNetworkBatch.create({
          data: {
            ...key,
            bootId: batch.bootId,
            ...stamp,
            collectedAt: new Date(batch.collectedAt),
          },
        });
        const cumulative =
          (server.networkTraffic as Record<string, any>).interfaces || {};
        const now = new Date().toISOString();
        for (const item of batch.interfaces) {
          const id = {
            serverId,
            day: stamp.accountingDay,
            interface: item.name,
          };
          const old = await tx.nodifyNetworkDaily.findUnique({
            where: { serverId_day_interface: id },
          });
          const crossDate =
            item.intervalStart != null &&
            item.intervalStart.slice(0, 10) !== batch.collectedAt.slice(0, 10);
          const data = {
            upload: (
              BigInt(old?.upload || "0") + BigInt(item.upload)
            ).toString(),
            download: (
              BigInt(old?.download || "0") + BigInt(item.download)
            ).toString(),
            reports: (old?.reports || 0) + 1,
            discontinuities:
              (old?.discontinuities || 0) + Number(item.discontinuity),
            crossDateReports: (old?.crossDateReports || 0) + Number(crossDate),
            receivedDateReports:
              (old?.receivedDateReports || 0) +
              Number(stamp.timeSource !== "collected"),
          };
          await tx.nodifyNetworkDaily.upsert({
            where: { serverId_day_interface: id },
            create: { ...id, ...data },
            update: data,
          });
          const prior = cumulative[item.name] || {};
          cumulative[item.name] = {
            upload: (
              BigInt(prior.upload || "0") + BigInt(item.upload)
            ).toString(),
            download: (
              BigInt(prior.download || "0") + BigInt(item.download)
            ).toString(),
            startedAt: prior.startedAt || now,
            updatedAt: now,
            discontinuities:
              (prior.discontinuities || 0) + Number(item.discontinuity),
          };
        }
        await tx.nodifyServer.update({
          where: { id: serverId },
          data: { networkTraffic: { interfaces: cumulative } },
        });
      },
      { maxWait: 5000, timeout: 25000 },
    );
    return { acknowledged: batch.sequence };
  }
}

export function networkMetrics(
  metrics: Record<string, any>,
  previous: Record<string, any>,
) {
  const interfaces = InterfaceCounters.parse(metrics.interfaces || {});
  const settings = ServerTrafficSettings.parse(previous.trafficSettings || {});
  const selected = settings.interfaces.length
    ? settings.interfaces
    : Object.keys(interfaces).filter(
        (name) =>
          interfaces[name].preferred ||
          (!Object.values(interfaces).some((row) => row.preferred) &&
            !/^(lo$|docker|veth|br-|wg|tun|tailscale|warp)/.test(name)),
      );
  const old = previous.metrics || {};
  const seconds =
    (Date.parse(metrics.networkCollectedAt) -
      Date.parse(old.networkCollectedAt)) /
    1000;
  let rx = 0n,
    tx = 0n,
    rxDelta = 0n,
    txDelta = 0n;
  let comparable =
    selected.length > 0 &&
    Boolean(
      metrics.networkBootId &&
      metrics.networkBootId === old.networkBootId &&
      seconds > 0,
    );
  for (const name of selected) {
    const row = interfaces[name],
      before = old.interfaces?.[name];
    if (!row) {
      comparable = false;
      continue;
    }
    rx += BigInt(row.rx);
    tx += BigInt(row.tx);
    if (
      !before ||
      row.index !== before.index ||
      BigInt(row.rx) < BigInt(before.rx) ||
      BigInt(row.tx) < BigInt(before.tx)
    )
      comparable = false;
    else {
      rxDelta += BigInt(row.rx) - BigInt(before.rx);
      txDelta += BigInt(row.tx) - BigInt(before.tx);
    }
  }
  return {
    ...metrics,
    interfaces,
    networkInterfaces: selected,
    networkRxBytes: rx.toString(),
    networkTxBytes: tx.toString(),
    networkRxRate: comparable ? Number(rxDelta) / seconds : 0,
    networkTxRate: comparable ? Number(txDelta) / seconds : 0,
    networkRateAvailable: comparable,
  };
}
