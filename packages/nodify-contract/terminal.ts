import { z } from "zod";

export const TerminalSize = z.object({
  cols: z.number().int().min(20).max(400),
  rows: z.number().int().min(5).max(200),
});
export const TerminalOpen = TerminalSize.extend({
  requestId: z.uuid(),
  minutes: z.number().int().min(1).max(30).default(10),
});
export const TerminalInput = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("input"),
    sequence: z.number().int().min(1).max(1000000),
    data: z.string().min(1).max(8192),
  }),
  TerminalSize.extend({
    type: z.literal("resize"),
    sequence: z.number().int().min(1).max(1000000),
  }),
]);
export const TerminalExchange = z.object({
  sessions: z
    .array(
      z.object({
        id: z.uuid(),
        inputAck: z.number().int().nonnegative().max(1000000),
        output: z
          .array(
            z.object({
              sequence: z.number().int().min(1).max(1000000),
              data: z
                .string()
                .max(24000)
                .regex(
                  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
                ),
            }),
          )
          .max(16),
        state: z.enum(["running", "closed", "failed"]),
        exitCode: z.number().int().min(-1).max(255).optional(),
        reason: z
          .enum([
            "",
            "closed",
            "expired",
            "idle",
            "output-limit",
            "helper-failed",
          ])
          .default(""),
      }),
    )
    .max(2),
});
export const TERMINAL_OUTPUT_LIMIT = 1024 * 1024;
export const TERMINAL_INPUT_LIMIT = 65536;
export type TTerminalInput = z.infer<typeof TerminalInput>;
