import { z } from "zod";
export const OverviewTrafficSettings = z.object({
  version: z.number().int().nonnegative(),
  includeExternal: z.boolean(),
});
const NullableBytes = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .nullable();
const Bucket = z.object({
  count: z.number().int(),
  limitBytes: NullableBytes,
  usedBytes: NullableBytes,
  remainingBytes: NullableBytes,
  overageBytes: NullableBytes,
  unknownUsageCount: z.number().int(),
  partialCount: z.number().int(),
  staleCount: z.number().int(),
  expiredCount: z.number().int(),
});
const Item = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: z.enum(["server", "external"]),
  source: z.enum(["protocol", "network", "external"]),
  direction: z.enum(["both", "upload", "download", "max"]),
  usedBytes: NullableBytes,
  limitBytes: NullableBytes,
  stale: z.boolean(),
  expired: z.boolean(),
  partial: z.boolean(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
});
const Day = z.object({
  day: z.iso.date(),
  usedBytes: NullableBytes,
  upload: NullableBytes,
  download: NullableBytes,
  reportedServers: z.number().int(),
  missingInterfaces: z.number().int(),
  discontinuities: z.number().int(),
  crossDateReports: z.number().int(),
  receivedDateReports: z.number().int(),
});
export const OverviewTraffic = z.object({
  generatedAt: z.iso.datetime(),
  settings: OverviewTrafficSettings,
  finite: Bucket,
  unlimited: Bucket,
  unknownCapacity: Bucket,
  items: z.array(Item),
  days: z.array(Day),
  selectedServers: z.number().int(),
  excludedServers: z.number().int(),
  enabledExternalSources: z.number().int(),
  timezone: z.literal("UTC"),
  coverage: z.literal("reported-only"),
});
export type TOverviewTraffic = z.infer<typeof OverviewTraffic>;
