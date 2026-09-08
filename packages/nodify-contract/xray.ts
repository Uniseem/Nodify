import { xraySystemErrors } from "./xray-system";
import { xrayDnsErrors } from "./xray-dns";
import { wireguardErrors, wireguardShapeErrors } from "./xray-wireguard";
export type XrayRecord = Record<string, any>;
// Check only the shape of fields handled by the visual editor. Unknown fields
// stay intact and are validated by the installed core when publishing.
export function xrayShapeErrors(x: XrayRecord): string[] {
  const errors: string[] = [];
  const object = (v: any, path: string): boolean => {
    if (v === undefined) return false;
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      errors.push(`${path} 必须是对象`);
      return false;
    }
    return true;
  };
  const array = (v: any, path: string, strings = false): any[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) {
      errors.push(`${path} 必须是数组`);
      return [];
    }
    if (strings && v.some((item) => typeof item !== "string"))
      errors.push(`${path} 必须是字符串数组`);
    return v;
  };
  const string = (v: any, path: string) => {
    if (v !== undefined && typeof v !== "string")
      errors.push(`${path} 必须是字符串`);
  };
  for (const key of [
    "log",
    "dns",
    "routing",
    "policy",
    "observatory",
    "burstObservatory",
  ])
    object(x[key], key);
  for (const [index, server] of array(
    x.dns?.servers,
    "dns.servers",
  ).entries()) {
    if (typeof server === "string") continue;
    if (!object(server, `dns.servers[${index}]`)) continue;
    for (const key of ["domains", "expectedIPs", "expectIPs", "unexpectedIPs"])
      if (server[key] !== undefined && typeof server[key] !== "string")
        array(server[key], `dns.servers[${index}].${key}`, true);
  }
  if (object(x.dns?.hosts, "dns.hosts"))
    for (const [key, value] of Object.entries(x.dns.hosts))
      if (typeof value !== "string") array(value, `dns.hosts.${key}`, true);
  if (object(x.policy?.levels, "policy.levels"))
    for (const [level, value] of Object.entries(x.policy.levels))
      object(value, `policy.levels.${level}`);
  object(x.policy?.system, "policy.system");
  object(x.burstObservatory?.pingConfig, "burstObservatory.pingConfig");
  for (const key of ["observatory", "burstObservatory"])
    array(x[key]?.subjectSelector, `${key}.subjectSelector`, true);
  for (const [index, o] of array(x.outbounds, "outbounds").entries()) {
    const path = `outbounds[${index}]`;
    if (!object(o, path)) continue;
    string(o.tag, `${path}.tag`);
    string(o.protocol, `${path}.protocol`);
    object(o.settings, `${path}.settings`);
    object(o.streamSettings, `${path}.streamSettings`);
    if (o.protocol === "wireguard" && o.settings && !Array.isArray(o.settings))
      errors.push(...wireguardShapeErrors(o.settings));
    for (const key of ["servers", "vnext"])
      for (const server of array(
        o.settings?.[key],
        `${path}.settings.${key}`,
      )) {
        if (!object(server, `${path}.settings.${key}[]`)) continue;
        string(server.address, `${path}.server.address`);
        for (const user of array(server.users, `${path}.server.users`))
          object(user, `${path}.server.users[]`);
      }
  }
  for (const [index, rule] of array(
    x.routing?.rules,
    "routing.rules",
  ).entries()) {
    const path = `routing.rules[${index}]`;
    if (!object(rule, path)) continue;
    for (const key of [
      "domain",
      "ip",
      "protocol",
      "sourceIP",
      "source",
      "inboundTag",
      "user",
    ])
      array(rule[key], `${path}.${key}`, true);
    for (const key of ["ruleTag", "outboundTag", "balancerTag", "network"])
      string(rule[key], `${path}.${key}`);
  }
  for (const [index, b] of array(
    x.routing?.balancers,
    "routing.balancers",
  ).entries()) {
    const path = `routing.balancers[${index}]`;
    if (!object(b, path)) continue;
    string(b.tag, `${path}.tag`);
    string(b.fallbackTag, `${path}.fallbackTag`);
    array(b.selector, `${path}.selector`, true);
    object(b.strategy, `${path}.strategy`);
    string(b.strategy?.type, `${path}.strategy.type`);
  }
  return errors;
}
export const defaultOutbounds = () => [
  { tag: "direct", protocol: "freedom" },
  { tag: "block", protocol: "blackhole" },
];
export const xrayOutbounds = (x: XrayRecord): XrayRecord[] =>
  x.outbounds ?? defaultOutbounds();
export const splitValues = (value: string): string[] =>
  value
    .split(/[,\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
export function withBalancingObservers(x: XrayRecord): XrayRecord {
  const selectors = [
    ...new Set(
      (x.routing?.balancers ?? [])
        .filter(
          (b: XrayRecord) =>
            b.fallbackTag ||
            ["leastPing", "leastLoad"].includes(b.strategy?.type),
        )
        .flatMap((b: XrayRecord) => b.selector ?? []),
    ),
  ];
  if (!selectors.length) return x;
  if (x.observatory)
    return {
      ...x,
      observatory: {
        ...x.observatory,
        subjectSelector: [
          ...new Set([...(x.observatory.subjectSelector ?? []), ...selectors]),
        ],
      },
    };
  return {
    ...x,
    burstObservatory: {
      ...x.burstObservatory,
      subjectSelector: [
        ...new Set([
          ...(x.burstObservatory?.subjectSelector ?? []),
          ...selectors,
        ]),
      ],
      pingConfig: {
        destination: "https://connectivitycheck.gstatic.com/generate_204",
        interval: "1m",
        sampling: 3,
        timeout: "5s",
        ...x.burstObservatory?.pingConfig,
      },
    },
  };
}
export function remapInboundReferences(
  value: any,
  ids: Record<string, string>,
): any {
  if (Array.isArray(value))
    return value.map((v) => remapInboundReferences(v, ids));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      ["inboundTag", "inbound"].includes(key)
        ? Array.isArray(item)
          ? item.map((v) => (typeof v === "string" ? (ids[v] ?? v) : v))
          : typeof item === "string"
            ? (ids[item] ?? item)
            : item
        : remapInboundReferences(item, ids),
    ]),
  );
}
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length)
    return items;
  const result = [...items];
  result.splice(to, 0, result.splice(from, 1)[0]);
  return result;
}
export function renameOutbound(
  x: XrayRecord,
  index: number,
  value: XrayRecord,
): XrayRecord {
  const copy = structuredClone(x),
    outbounds = xrayOutbounds(copy);
  const previous = outbounds[index]?.tag;
  if (previous && previous !== value.tag) {
    for (const kind of ["observatory", "burstObservatory"]) {
      const observer = copy[kind];
      if (!observer) continue;
      observer.subjectSelector = observer.subjectSelector?.map(
        (prefix: string) => {
          if (!previous.startsWith(prefix) || value.tag.startsWith(prefix))
            return prefix;
          if (
            prefix === previous &&
            !outbounds.some((o, i) => i !== index && o.tag?.startsWith(prefix))
          )
            return value.tag;
          throw new Error("该出站被观测前缀引用，请先调整观测范围再改名");
        },
      );
    }
    if (
      (copy.routing?.balancers ?? []).some((b: XrayRecord) =>
        b.selector?.some((p: string) => previous.startsWith(p)),
      )
    )
      throw new Error("该出站被负载均衡选择器引用，请先调整选择器再改名");
    for (const rule of copy.routing?.rules ?? [])
      if (rule.outboundTag === previous) rule.outboundTag = value.tag;
    for (const b of copy.routing?.balancers ?? [])
      if (b.fallbackTag === previous) b.fallbackTag = value.tag;
    for (const outbound of outbounds) {
      if (outbound.proxySettings?.tag === previous)
        outbound.proxySettings.tag = value.tag;
      if (outbound.streamSettings?.sockopt?.dialerProxy === previous)
        outbound.streamSettings.sockopt.dialerProxy = value.tag;
    }
  }
  outbounds[index] = value;
  return { ...copy, outbounds };
}
// Keep object-valued DNS entries, their order, and fields outside the edited server list.
export function replaceSimpleDns(
  x: XrayRecord,
  addresses: string[],
): XrayRecord {
  const rest = [...addresses],
    servers: unknown[] = [];
  for (const item of x.dns?.servers ?? []) {
    if (typeof item !== "string") servers.push(item);
    else if (rest.length) servers.push(rest.shift()!);
  }
  return { ...x, dns: { ...x.dns, servers: [...servers, ...rest] } };
}
export function routeWarnings(rules: XrayRecord[]): string[] {
  const warnings: string[] = [];
  const catchAll = (r: XrayRecord) =>
    Object.entries(r).every(
      ([k, value]) =>
        [
          "type",
          "outboundTag",
          "balancerTag",
          "ruleTag",
          "inboundTag",
          "domainMatcher",
        ].includes(k) ||
        (k === "network" && ["tcp,udp", "udp,tcp"].includes(value)) ||
        value === undefined ||
        value === "" ||
        (Array.isArray(value) && value.length === 0),
    );
  rules.forEach((rule, index) => {
    if (!catchAll(rule) || index === rules.length - 1) return;
    const scope: string[] = rule.inboundTag ?? [];
    warnings.push(
      `第 ${index + 1} 条规则覆盖${scope.length ? "所选入站" : "全部入站"}的所有流量；这些流量不会再匹配后续规则。`,
    );
  });
  return warnings;
}
export function xrayReferenceErrors(x: XrayRecord): string[] {
  const shapes = xrayShapeErrors(x);
  if (shapes.length) return shapes;
  const errors: string[] = [...xraySystemErrors(x), ...xrayDnsErrors(x.dns)],
    outbounds = xrayOutbounds(x);
  if (!Array.isArray(outbounds)) return errors; // The outer schema handles the array type.
  const tags = new Set<string>();
  for (const kind of ["observatory", "burstObservatory"])
    for (const prefix of x[kind]?.subjectSelector || [])
      if (
        !outbounds.some(
          (o) => typeof o?.tag === "string" && o.tag.startsWith(prefix),
        )
      )
        errors.push(`观测前缀没有匹配出站：${prefix}`);
  for (const o of outbounds) {
    if (!o || typeof o !== "object" || Array.isArray(o)) {
      errors.push("出站必须是对象");
      continue;
    }
    errors.push(...wireguardErrors(o));
    if (typeof o.protocol !== "string" || !o.protocol.trim())
      errors.push("出站协议不能为空");
    if (o.tag !== undefined) {
      if (typeof o.tag !== "string" || !o.tag.trim())
        errors.push("出站标识不能为空");
      else {
        if (tags.has(o.tag)) errors.push(`出站标识重复：${o.tag}`);
        if (o.tag.startsWith("nodify-"))
          errors.push("nodify- 前缀保留给 Agent 内部服务");
        tags.add(o.tag);
      }
    }
  }
  const balancers = x.routing?.balancers ?? [];
  if (!Array.isArray(balancers)) return [...errors, "负载均衡器必须是数组"];
  const balanced = new Set<string>();
  for (const b of balancers) {
    if (!b || typeof b !== "object" || Array.isArray(b)) {
      errors.push("负载均衡器必须是对象");
      continue;
    }
    if (!b.tag || typeof b.tag !== "string" || balanced.has(b.tag))
      errors.push("负载均衡标识为空或重复");
    balanced.add(b.tag);
    if (
      !Array.isArray(b.selector) ||
      !b.selector.length ||
      b.selector.some((p: unknown) => typeof p !== "string" || !p)
    )
      errors.push(`负载均衡 ${b.tag} 需要非空出站前缀`);
    else if (
      !outbounds.some(
        (o) =>
          typeof o?.tag === "string" &&
          b.selector.some((p: string) => o.tag.startsWith(p)),
      )
    )
      errors.push(`负载均衡 ${b.tag} 没有匹配任何出站`);
    if (b.fallbackTag && !tags.has(b.fallbackTag))
      errors.push(`备用出站不存在：${b.fallbackTag}`);
  }
  if (Array.isArray(x.routing?.rules))
    for (const [index, r] of x.routing.rules.entries()) {
      if (!r || typeof r !== "object" || Array.isArray(r)) {
        errors.push(`第 ${index + 1} 条路由必须是对象`);
        continue;
      }
      if (
        !Object.entries(r).some(
          ([k, v]) =>
            ![
              "type",
              "outboundTag",
              "balancerTag",
              "ruleTag",
              "domainMatcher",
            ].includes(k) &&
            v !== undefined &&
            v !== "" &&
            (!Array.isArray(v) || v.length),
        )
      )
        errors.push(
          `第 ${index + 1} 条路由需要匹配条件；匹配全部流量时设置 network 为 tcp,udp`,
        );
      for (const field of [
        "domain",
        "ip",
        "protocol",
        "sourceIP",
        "source",
        "inboundTag",
        "user",
      ])
        if (
          r[field] !== undefined &&
          (!Array.isArray(r[field]) ||
            r[field].some((v: unknown) => typeof v !== "string"))
        )
          errors.push(`第 ${index + 1} 条路由的 ${field} 必须是字符串数组`);
      if (Boolean(r.outboundTag) === Boolean(r.balancerTag))
        errors.push(`第 ${index + 1} 条路由须选择一个出站或负载均衡器`);
      if (r.outboundTag && !tags.has(r.outboundTag))
        errors.push(
          `第 ${index + 1} 条路由引用了不存在的出站：${r.outboundTag}`,
        );
      if (r.balancerTag && !balanced.has(r.balancerTag))
        errors.push(
          `第 ${index + 1} 条路由引用了不存在的负载均衡器：${r.balancerTag}`,
        );
    }
  for (const o of outbounds) {
    const via =
      o?.streamSettings?.sockopt?.dialerProxy || o?.proxySettings?.tag;
    if (via && (!tags.has(via) || via === o.tag))
      errors.push(`出站 ${o.tag} 的前置代理不存在或指向自身`);
  }
  const hops = new Map(
    outbounds
      .filter((o) => typeof o?.tag === "string")
      .map((o) => [
        o.tag,
        o.streamSettings?.sockopt?.dialerProxy || o.proxySettings?.tag,
      ]),
  );
  for (const start of hops.keys()) {
    const visited = new Set();
    let cursor: unknown = start;
    while (typeof cursor === "string" && hops.has(cursor)) {
      if (visited.has(cursor)) {
        errors.push("出站前置代理形成循环");
        break;
      }
      visited.add(cursor);
      cursor = hops.get(cursor);
    }
  }
  return [...new Set(errors)];
}
