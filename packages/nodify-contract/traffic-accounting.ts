import { z } from "zod";
import { CounterBytes } from "./traffic-display";
export function trafficPeriod(resetDay: number | null, now = new Date()) {
  if (resetDay == null)
    return { start: "lifetime", end: null, timezone: "UTC" };
  const boundary = (year: number, month: number) => {
    const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(resetDay, last)));
  };
  let month = now.getUTCMonth();
  const year = now.getUTCFullYear();
  if (now < boundary(year, month)) month--;
  return {
    start: boundary(year, month).toISOString().slice(0, 10),
    end: boundary(year, month + 1)
      .toISOString()
      .slice(0, 10),
    timezone: "UTC",
  };
}
export const TrafficAccountingAction = z
  .object({
    requestId: z.uuid(),
    settingsVersion: z.number().int().positive(),
    periodKey: z
      .string()
      .regex(/^[1-9][0-9]*:(lifetime|[0-9]{4}-[0-9]{2}-[0-9]{2})$/),
    version: z.number().int().nonnegative(),
    action: z.enum(["calibrate", "reset", "clear"]),
    targetBytes: z
      .string()
      .refine(
        (value) => CounterBytes.safeParse(value).success,
        "目标用量须为非负十进制整数字节",
      )
      .optional(),
    reason: z
      .string()
      .trim()
      .min(1, "请填写操作原因")
      .max(200, "操作原因最多 200 字"),
  })
  .refine(
    (value) => value.action !== "calibrate" || value.targetBytes !== undefined,
    "校准需要输入目标用量",
  );
