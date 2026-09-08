import { z } from "zod";
import { CounterBytes } from "./traffic-display";
export const InterfaceName = z
  .string()
  .min(1)
  .max(15)
  .regex(/^[a-zA-Z0-9_.:-]+$/);
export const NetworkBatch = z
  .object({
    session: z.uuid(),
    sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    bootId: z.uuid(),
    collectedAt: z.iso.datetime(),
    interfaces: z
      .array(
        z.object({
          name: InterfaceName,
          index: z.number().int().positive(),
          upload: CounterBytes,
          download: CounterBytes,
          discontinuity: z.boolean(),
          intervalStart: z.iso.datetime().nullable(),
        }),
      )
      .min(1)
      .max(128)
      .refine(
        (rows) => new Set(rows.map((row) => row.name)).size === rows.length,
        "网卡名称重复",
      ),
  })
  .refine(
    (batch) =>
      batch.interfaces.every((row) =>
        row.discontinuity
          ? row.intervalStart === null
          : row.intervalStart !== null &&
            Date.parse(row.intervalStart) < Date.parse(batch.collectedAt),
      ),
    "网卡增量需提供有效采集间隔；基线中断时不声明连续区间",
  );
export const InterfaceCounters = z.record(
  InterfaceName,
  z.object({
    rx: CounterBytes,
    tx: CounterBytes,
    index: z.number().int().positive().optional(),
    preferred: z.boolean().optional(),
  }),
);
