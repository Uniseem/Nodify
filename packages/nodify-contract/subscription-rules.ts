import { z } from "zod";

export const RuleSetSelection = z.object({
  ruleMode: z.enum(["all", "selected", "none"]).default("all"),
  ruleSetIds: z
    .array(z.uuid())
    .max(100)
    .default([])
    .refine((ids) => new Set(ids).size === ids.length, "不能包含重复规则集"),
});

/** Keep the global rule order, independent of the order of selected IDs. */
export function selectSubscriptionRuleSets<
  T extends { id: string; enabled: boolean },
>(sets: T[], selection: z.infer<typeof RuleSetSelection>) {
  return sets.filter(
    (set) =>
      set.enabled &&
      (selection.ruleMode === "all" ||
        (selection.ruleMode === "selected" &&
          selection.ruleSetIds.includes(set.id))),
  );
}

export const SUBSCRIPTION_RULE_TYPES = [
  "DOMAIN",
  "DOMAIN-SUFFIX",
  "DOMAIN-KEYWORD",
  "IP-CIDR",
  "IP-CIDR6",
  "GEOIP",
] as const;
export const SubscriptionRule = z
  .object({
    type: z.enum(SUBSCRIPTION_RULE_TYPES),
    value: z
      .string()
      .trim()
      .min(1)
      .max(253)
      .regex(/^[^\s,\x00-\x1f]+$/, "规则值不能包含空格、逗号或控制字符"),
    policy: z.enum(["PROXY", "DIRECT", "REJECT"]),
  })
  .superRefine((rule, ctx) => {
    const error = (message: string) =>
      ctx.addIssue({ code: "custom", path: ["value"], message });
    if (
      ["DOMAIN", "DOMAIN-SUFFIX"].includes(rule.type) &&
      !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(rule.value)
    )
      error("请输入域名，不包含协议、路径或通配符");
    if (
      ["DOMAIN", "DOMAIN-SUFFIX"].includes(rule.type) &&
      rule.value
        .split(".")
        .some(
          (label) =>
            label.length > 63 ||
            !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
        )
    )
      error("域名格式错误");
    if (rule.type === "GEOIP" && !/^[a-z]{2}$/i.test(rule.value))
      error("GEOIP 使用两位国家代码，例如 CN");
    if (rule.type === "IP-CIDR" || rule.type === "IP-CIDR6") {
      const [address, prefix, extra] = rule.value.split("/");
      const schema = rule.type === "IP-CIDR" ? z.ipv4() : z.ipv6();
      if (
        !schema.safeParse(address).success ||
        !/^(0|[1-9]\d*)$/.test(prefix || "") ||
        Number(prefix) > (rule.type === "IP-CIDR" ? 32 : 128) ||
        extra !== undefined
      )
        error("请输入有效的 IP/CIDR 网段");
    }
  });
export const RuleSetInput = z.object({
  name: z.string().trim().min(1, "请输入规则集名称").max(100),
  enabled: z.boolean().default(true),
  rules: z.array(SubscriptionRule).min(1, "至少添加一条规则").max(10000),
});
export type TRuleSet = z.infer<typeof RuleSetInput>;

export function parseSubscriptionRules(text: string) {
  if (text.length > 1024 * 1024) throw new Error("规则内容不能超过 1 MiB");
  return text.split(/\r?\n/).flatMap((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    const [type, value, policy, extra] = trimmed
      .split(",")
      .map((part) => part.trim());
    if (extra !== undefined)
      throw new Error(`第 ${index + 1} 行：使用 类型,匹配值,策略 格式`);
    const parsed = SubscriptionRule.safeParse({
      type: type?.toUpperCase(),
      value,
      policy: policy?.toUpperCase(),
    });
    if (!parsed.success)
      throw new Error(
        `第 ${index + 1} 行：${parsed.error.issues.map((issue) => issue.message).join("；")}`,
      );
    return [parsed.data];
  });
}
export function subscriptionRulesText(rules: TRuleSet["rules"]) {
  return rules
    .map((rule) => `${rule.type},${rule.value},${rule.policy}`)
    .join("\n");
}
export function compileSubscriptionRules(sets: TRuleSet[]) {
  const mihomo: string[] = [],
    singbox: Record<string, unknown>[] = [];
  const providers = new Map<string, Record<string, unknown>>();
  for (const set of sets) {
    const parsed = RuleSetInput.parse(set);
    if (!parsed.enabled) continue;
    for (const rule of parsed.rules) {
      const value =
        rule.type === "GEOIP" ? rule.value.toUpperCase() : rule.value;
      mihomo.push(
        `${rule.type},${value},${rule.policy === "PROXY" ? "Nodify" : rule.policy}`,
      );
      const match: Record<string, unknown> = {};
      if (rule.type === "GEOIP") {
        const tag = `nodify-geoip-${value.toLowerCase()}`;
        match.rule_set = [tag];
        providers.set(tag, {
          type: "remote",
          tag,
          format: "binary",
          url: `https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-${value.toLowerCase()}.srs`,
          download_detour: "direct",
          update_interval: "1d",
        });
      } else {
        const key = {
          DOMAIN: "domain",
          "DOMAIN-SUFFIX": "domain_suffix",
          "DOMAIN-KEYWORD": "domain_keyword",
          "IP-CIDR": "ip_cidr",
          "IP-CIDR6": "ip_cidr",
        }[rule.type];
        match[key] = [value];
      }
      singbox.push({
        ...match,
        ...(rule.policy === "REJECT"
          ? { action: "reject" }
          : {
              action: "route",
              outbound: rule.policy === "DIRECT" ? "direct" : "Nodify",
            }),
      });
    }
  }
  return { mihomo, singbox, ruleSets: [...providers.values()] };
}
