import { Prisma } from "@prisma/client";
export type DailyIncrement = {
  upload: bigint;
  download: bigint;
  charged: bigint;
  rated: bigint;
  unratedRaw: bigint;
  unchargedRaw: bigint;
};
export const zeroIncrement = (): DailyIncrement => ({
  upload: 0n,
  download: 0n,
  charged: 0n,
  rated: 0n,
  unratedRaw: 0n,
  unchargedRaw: 0n,
});
export function accountingTime(
  collectedAt: string | undefined,
  policyCreatedAt: Date,
  receivedAt = new Date(),
) {
  const collected = collectedAt ? new Date(collectedAt) : null;
  const valid =
    collected &&
    collected.getTime() <= receivedAt.getTime() + 300000 &&
    collected.getTime() >= policyCreatedAt.getTime() - 300000;
  return {
    collectedAt: collected,
    accountingDay: (valid ? collected : receivedAt).toISOString().slice(0, 10),
    timeSource: valid ? "collected" : collected ? "clock-skew" : "received",
  };
}
export async function addDaily(
  tx: Prisma.TransactionClient,
  serverId: string,
  day: string,
  userId: string,
  increment: DailyIncrement,
  receivedDate: boolean,
) {
  const key = { serverId, day, userId };
  const old = await tx.nodifyDailyTraffic.findUnique({
    where: { serverId_day_userId: key },
  });
  const data = {
    upload: (BigInt(old?.upload || "0") + increment.upload).toString(),
    download: (BigInt(old?.download || "0") + increment.download).toString(),
    charged: (BigInt(old?.charged || "0") + increment.charged).toString(),
    rated: (BigInt(old?.rated || "0") + increment.rated).toString(),
    unratedRaw: (
      BigInt(old?.unratedRaw || "0") + increment.unratedRaw
    ).toString(),
    unchargedRaw: (
      BigInt(old?.unchargedRaw || "0") + increment.unchargedRaw
    ).toString(),
    reports: (old?.reports || 0) + 1,
    receivedDateReports:
      (old?.receivedDateReports || 0) + (receivedDate ? 1 : 0),
  };
  await tx.nodifyDailyTraffic.upsert({
    where: { serverId_day_userId: key },
    create: { ...key, ...data },
    update: data,
  });
}
