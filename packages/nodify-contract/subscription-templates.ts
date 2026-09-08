import { z } from "zod";
import { RuleSetSelection } from "./subscription-rules";

const object = z.record(z.string(), z.unknown());
// Mihomo v1.19.30 AdapterType names; group filters use these, not YAML aliases.
export const TEMPLATE_PROTOCOL_TYPES = [
  "Shadowsocks",
  "ShadowsocksR",
  "Snell",
  "Socks5",
  "Http",
  "Vmess",
  "Vless",
  "Trojan",
  "Hysteria",
  "Hysteria2",
  "WireGuard",
  "Tuic",
  "Ssh",
  "Mieru",
  "AnyTLS",
  "Sudoku",
  "Masque",
  "TrustTunnel",
  "ShadowQuic",
  "OpenVPN",
  "Tailscale",
  "ZeroTier",
  "GostRelay",
] as const;
const aliases: Record<string, string> = {
  ss: "Shadowsocks",
  shadowsock: "Shadowsocks",
  ssr: "ShadowsocksR",
  socks: "Socks5",
  hy2: "Hysteria2",
  wg: "WireGuard",
};
export const templateProtocolType = (value: string) =>
  aliases[value.trim().toLowerCase()] ||
  TEMPLATE_PROTOCOL_TYPES.find(
    (type) => type.toLowerCase() === value.trim().toLowerCase(),
  );
const types = (value = "") =>
  value
    .split("|")
    .map((v) => v.trim())
    .filter(Boolean);
const protocolFilter = z
  .string()
  .max(300)
  .refine(
    (value) => types(value).every((type) => templateProtocolType(type)),
    "协议筛选包含未知类型，请用 | 分隔 Mihomo 协议名称",
  );
const name = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((v) => !/[\r\n,]/.test(v), "名称不能包含逗号或换行");
export const TemplateGroup = z
  .object({
    name,
    type: z.enum(["select", "url-test", "fallback", "load-balance", "relay"]),
    proxies: z.array(name).max(1000).optional(),
    use: z.array(name).max(100).optional(),
    "include-all": z.boolean().optional(),
    "include-all-proxies": z.boolean().optional(),
    "include-all-providers": z.boolean().optional(),
    filter: z.string().max(1000).optional(),
    "exclude-filter": z.string().max(1000).optional(),
    "exclude-type": protocolFilter.optional(),
    "include-type": protocolFilter.optional(),
    "dialer-proxy-group": name.optional(),
    url: z
      .url()
      .refine((v) => /^https?:\/\//.test(v), "探测地址须为 HTTP(S)")
      .optional(),
    interval: z.number().int().min(0).max(86400).optional(),
    tolerance: z.number().int().min(0).max(60000).optional(),
    hidden: z.boolean().optional(),
    icon: z.string().max(2048).optional(),
  })
  .passthrough()
  .superRefine((group, ctx) => {
    if (
      [
        "DIRECT",
        "REJECT",
        "REJECT-DROP",
        "PASS",
        "COMPATIBLE",
        "GLOBAL",
      ].includes(group.name)
    )
      ctx.addIssue({
        code: "custom",
        path: ["name"],
        message: "名称与系统策略冲突",
      });
    if (!["select", "relay"].includes(group.type) && !group.url)
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: "自动代理组需要探测 URL",
      });
    if (group.type === "relay" && !group["dialer-proxy-group"])
      ctx.addIssue({
        code: "custom",
        message: "中转组需要选择 dialer-proxy-group",
      });
    if (group["dialer-proxy"] !== undefined)
      ctx.addIssue({
        code: "custom",
        message: "代理组请使用 dialer-proxy-group，中转参数不能直接写在组上",
      });
  });

export const SubscriptionTemplateDocument = z
  .object({
    mihomo: z
      .object({
        "proxy-groups": z.array(TemplateGroup).max(100).optional(),
        "proxy-providers": z.record(z.string(), object).optional(),
        "rule-providers": z.record(z.string(), object).optional(),
        rules: z.array(z.string().max(4000)).max(10000).optional(),
        dns: object.optional(),
      })
      .passthrough()
      .default({}),
    singbox: z
      .object({
        dns: object.optional(),
        route: z
          .object({
            rules: z.array(object).max(10000).optional(),
            rule_set: z.array(object).max(1000).optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .default({}),
  })
  .superRefine((document, ctx) => {
    const problem = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    let size = 0;
    try {
      size = new TextEncoder().encode(JSON.stringify(document)).length;
    } catch {
      problem("模板必须是不含循环引用的 JSON");
      return;
    }
    if (size > 1024 * 1024) problem("模板不能超过 1 MiB");
    for (const key of ["proxies"])
      if (document.mihomo[key] !== undefined)
        problem(`Mihomo ${key} 由用户权益生成，请通过外部来源导入节点`);
    for (const key of ["outbounds", "inbounds"])
      if (document.singbox[key] !== undefined)
        problem(`sing-box ${key} 由订阅生成，不在模板中覆盖`);
    const groups = document.mihomo["proxy-groups"] || [];
    const names = groups.map((group) => group.name);
    if (new Set(names).size !== names.length) problem("代理组名称不能重复");
    const providers = Object.keys(document.mihomo["proxy-providers"] || {});
    if (providers.some((provider) => names.includes(provider)))
      problem("代理集合名称不能与代理组重名");
    const graph = new Map<string, string[]>();
    for (const group of groups) {
      graph.set(
        group.name,
        (group.proxies || []).filter((value) => names.includes(value)),
      );
      const dialer = group["dialer-proxy-group"];
      if (dialer) {
        if (!names.includes(dialer))
          problem(`${group.name} 引用了不存在的中转组 ${dialer}`);
        graph.get(group.name)!.push(dialer);
        if (
          (group.proxies || []).some(
            (value) =>
              names.includes(value) ||
              ["DIRECT", "PASS", "COMPATIBLE", "REJECT-DROP"].includes(value),
          )
        )
          problem(
            `${group.name} 的中转目标只能是节点或代理集合，不能包含代理组或直连策略`,
          );
      }
      for (const value of group.use || [])
        if (value !== "__PROXY_PROVIDERS__" && !providers.includes(value))
          problem(`${group.name} 引用了不存在的代理集合 ${value}`);
      if (group.proxies?.includes("__PROXY_PROVIDERS__"))
        problem("__PROXY_PROVIDERS__ 应放在 use 中");
      if (!dialer) {
        const used =
          group["include-all"] || group["include-all-providers"]
            ? providers
            : (group.use || []).flatMap((value) =>
                value === "__PROXY_PROVIDERS__" ? providers : [value],
              );
        for (const key of used) {
          const provider = document.mihomo["proxy-providers"]?.[key] as
            Record<string, any> | undefined;
          if (!provider) continue;
          const refs = [
            provider["dialer-proxy"],
            provider.override?.["dialer-proxy"],
            ...(Array.isArray(provider.payload)
              ? provider.payload.map((node: any) => node?.["dialer-proxy"])
              : []),
          ];
          graph
            .get(group.name)!
            .push(...refs.filter((ref) => names.includes(ref)));
        }
      }
    }
    const visited = new Set<string>(),
      visiting = new Set<string>();
    const visit = (id: string): boolean => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      if ((graph.get(id) || []).some(visit)) return true;
      visiting.delete(id);
      visited.add(id);
      return false;
    };
    if (names.some(visit)) problem("代理组引用存在循环");
  });
export const SubscriptionTemplateInput = RuleSetSelection.extend({
  name: z.string().trim().min(1).max(80),
  document: SubscriptionTemplateDocument,
});
export const SubscriptionTemplateUpdate = SubscriptionTemplateInput.extend({
  version: z.number().int().positive(),
});
export const TemplateSelectionInput = z.object({
  templateId: z.uuid().nullable(),
  version: z.number().int().nonnegative(),
});

export function expandTemplateGroups(
  custom: Record<string, any>,
  nodes: ({ name: string; type?: string } & Record<string, any>)[],
) {
  const warnings: string[] = [];
  const configured = custom["proxy-groups"] || [
    { name: "Nodify", type: "select", proxies: ["$NODES"] },
  ];
  const names = new Set([
    "Nodify",
    "DIRECT",
    "REJECT",
    "REJECT-DROP",
    "PASS",
    "COMPATIBLE",
    ...nodes.map((n) => n.name),
    ...configured.map((g: any) => g.name),
  ]);
  const providers = Object.keys(custom["proxy-providers"] || {});
  const proxyProviders: Record<string, any> = { ...custom["proxy-providers"] };
  const occupied = new Set([...names, ...providers]);
  const uniqueProvider = (base: string) => {
    let value = base,
      suffix = 1;
    while (occupied.has(value)) value = `${base}-${suffix++}`;
    occupied.add(value);
    return value;
  };
  const nodeMap = new Map(nodes.map((node) => [node.name, node]));
  const groups = configured.map((group: any, index: number) => {
    const include = types(group["include-type"]).map((type) =>
      templateProtocolType(type),
    );
    const exclude = types(group["exclude-type"]).map((type) =>
      templateProtocolType(type),
    );
    const dialer = group["dialer-proxy-group"];
    const convert = include.length > 0 || !!dialer;
    const dynamic =
      group["include-all"] ||
      group["include-all-proxies"] ||
      group["include-all-providers"] ||
      group.use?.length;
    let proxies = (group.proxies || (dynamic ? [] : ["$NODES"])).flatMap(
      (value: string) => {
        if (["$NODES", "__PROXY_NODES__"].includes(value))
          return nodes.map((n) => n.name);
        if (names.has(value)) return [value];
        warnings.push(
          `${group.name}：节点或代理组 ${value} 不在本次订阅中，已跳过`,
        );
        return [];
      },
    );
    let use = group.use?.flatMap((value: string) =>
      value === "__PROXY_PROVIDERS__" ? providers : [value],
    );
    const result = { ...group };
    delete result["include-type"];
    delete result["dialer-proxy-group"];
    if (group.type === "relay") result.type = "select";
    if (include.length || exclude.length)
      result["exclude-type"] = [
        ...new Set([
          ...exclude,
          ...(include.length
            ? [
                ...TEMPLATE_PROTOCOL_TYPES.filter(
                  (type) => !include.includes(type),
                ),
                "Unknown",
                "Direct",
                "Compatible",
                "Pass",
                "PassRule",
                "Rematch",
                "Dns",
              ]
            : []),
        ]),
      ].join("|");
    // Freeze the user's provider selection before adding private relay providers.
    // Otherwise include-all-providers could pull a group's own relay back into itself.
    {
      if (group["include-all"] || group["include-all-providers"])
        use = [...providers];
      if (group["include-all"]) result["include-all-proxies"] = true;
      delete result["include-all"];
      delete result["include-all-providers"];
    }
    if (convert) {
      if (group["include-all"] || group["include-all-proxies"])
        proxies.push(...nodes.map((node) => node.name));
      delete result["include-all-proxies"];
      const payload = [...new Set<string>(proxies)]
        .filter((value) => nodeMap.has(value))
        .map((value) => nodeMap.get(value)!)
        .filter((node) => {
          const type = node.type && templateProtocolType(node.type);
          if (include.length && !type)
            warnings.push(
              `${group.name}：${node.name} 缺少可识别的协议类型，已跳过`,
            );
          return (
            (!include.length || include.includes(type || undefined)) &&
            !exclude.includes(type || undefined)
          );
        })
        .map((node) => ({
          ...node,
          ...(dialer ? { "dialer-proxy": dialer } : {}),
        }));
      proxies = proxies.filter((value: string) => !nodeMap.has(value));
      use = [...(use || [])];
      if (dialer) {
        use = use.map((provider: string, providerIndex: number) => {
          const original = proxyProviders[provider];
          const id = uniqueProvider(`__nodify_relay_${index}_${providerIndex}`);
          proxyProviders[id] = {
            ...original,
            // HTTP providers must not race another instance for the same cache file.
            ...(original.type === "http"
              ? { path: `./providers/${id}.yaml` }
              : {}),
            override: { ...original.override, "dialer-proxy": dialer },
            "dialer-proxy": dialer,
          };
          return id;
        });
      }
      if (payload.length) {
        const id = uniqueProvider(`__nodify_nodes_${index}`);
        proxyProviders[id] = { type: "inline", payload };
        use.push(id);
      }
    }
    if (!proxies.length && !use?.length && !result["include-all-proxies"]) {
      proxies.push("REJECT");
      warnings.push(`${group.name}：没有可用节点，使用 REJECT`);
    }
    return {
      ...result,
      "empty-fallback": dialer ? "REJECT" : group["empty-fallback"] || "REJECT",
      proxies: [...new Set(proxies)],
      ...(use ? { use: [...new Set(use)] } : {}),
    };
  });
  if (!groups.some((group: any) => group.name === "Nodify"))
    groups.push({
      name: "Nodify",
      type: "select",
      proxies: nodes.length ? nodes.map((n) => n.name) : ["REJECT"],
    });
  const rules = (custom.rules || ["MATCH,Nodify"]).map((rule: string) => {
    const parts = rule.split(",");
    if (parts[0] === "SUB-RULE") return rule;
    const position = parts.length - (parts.at(-1) === "no-resolve" ? 2 : 1);
    const policy = parts[position];
    if (names.has(policy)) return rule;
    warnings.push(`规则策略 ${policy} 不在本次订阅中，已替换为 REJECT`);
    parts[position] = "REJECT";
    return parts.join(",");
  });
  return { groups, rules, warnings, proxyProviders };
}
