import { z } from "zod";
const Day = z.iso.date();
export const TrafficHistoryQuery = z
  .object({
    from: Day,
    to: Day,
    serverId: z.uuid().optional(),
    userId: z
      .string()
      .regex(/^[1-9][0-9]{0,18}$/)
      .refine(
        (value) =>
          /^[1-9][0-9]{0,18}$/.test(value) &&
          BigInt(value) <= 9223372036854775807n,
      )
      .optional(),
  })
  .superRefine((value, ctx) => {
    const days = (Date.parse(value.to) - Date.parse(value.from)) / 86400000;
    if (days < 0 || days > 89)
      ctx.addIssue({ code: "custom", message: "日期范围需要为连续 1–90 天" });
    if (value.to > new Date().toISOString().slice(0, 10))
      ctx.addIssue({ code: "custom", message: "结束日期不能晚于今天（UTC）" });
  });
