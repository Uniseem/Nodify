import { z } from "zod";
export const SubscriptionAlias = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9][a-z0-9_-]{11,63}$/,
    "短链别名需要 12–64 位小写字母、数字、下划线或连字符，并以字母或数字开头",
  );
export const SubscriptionFileInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    statisticServerIds: z.array(z.uuid()).max(1000).default([]),
    alias: SubscriptionAlias.nullable().default(null),
    displayTrafficLimitBytes: z
      .string()
      .regex(/^(0|[1-9][0-9]{0,18})$/, "展示额度请输入十进制字节数")
      .nullable()
      .default(null),
    enabled: z.boolean().default(true),
    templateId: z.uuid().nullable().default(null),
    nodeMode: z.enum(["all", "selected"]).default("all"),
    nodeIds: z.array(z.uuid()).max(1000).default([]),
    tags: z.array(z.string().trim().min(1).max(40)).max(100).default([]),
    ruleMode: z.enum(["template", "all", "selected", "none"]).default("all"),
    ruleSetIds: z.array(z.uuid()).max(100).default([]),
    expiresAt: z.iso.datetime().nullable().default(null),
  })
  .superRefine((value, ctx) => {
    for (const key of [
      "nodeIds",
      "tags",
      "ruleSetIds",
      "statisticServerIds",
    ] as const)
      if (new Set(value[key]).size !== value[key].length)
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "不能包含重复项",
        });
  });
export const SubscriptionFileCreate = SubscriptionFileInput.safeExtend({
  entitlementId: z.uuid(),
});
export const SubscriptionFileUpdate = SubscriptionFileInput.safeExtend({
  version: z.number().int().positive(),
});
export type TSubscriptionFile = z.infer<typeof SubscriptionFileInput>;
export function fileAllowsNode(
  file: Pick<TSubscriptionFile, "nodeMode" | "nodeIds" | "tags">,
  node: { id: string; tags: string[] },
) {
  return (
    file.nodeMode === "all" ||
    file.nodeIds.includes(node.id) ||
    node.tags.some((tag) => file.tags.includes(tag))
  );
}
