import { z } from "zod";
export const AgentConnectionMode = z.enum(["auto", "ws", "pull", "direct"]);

export const DirectAgentEndpoint = z
  .string()
  .trim()
  .max(2048)
  .superRefine((value, ctx) => {
    try {
      const url = new URL(value);
      if (
        url.protocol !== "https:" ||
        !url.hostname ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        /\s/.test(value)
      )
        throw Error();
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "直连地址须为 HTTPS，不得包含凭据、查询参数或片段",
      });
    }
  });
export const DirectAgentToken = z
  .string()
  .regex(
    /^[A-Za-z0-9_-]{32,128}$/,
    "直连凭据须为 32–128 位字母、数字、下划线或连字符",
  );
export const AgentConnectionInput = z.object({
  version: z.number().int().nonnegative(),
  enabled: z.boolean(),
  endpoint: DirectAgentEndpoint,
  token: DirectAgentToken.optional(),
});
export const AgentRelayFrame = z.object({
  id: z.string().uuid(),
  credential: z.string().min(32).max(256),
  type: z.enum([
    "heartbeat",
    "traffic",
    "network",
    "result",
    "terminal-exchange",
  ]),
  data: z.unknown(),
});
