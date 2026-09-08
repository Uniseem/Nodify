import { z } from "zod";
import type { XrayRecord } from "./xray";
export const dnsValues = (value: unknown): string[] =>
  typeof value === "string"
    ? value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
    : Array.isArray(value)
      ? value
      : [];
export function updateDnsServer(
  dns: XrayRecord,
  index: number,
  changes: XrayRecord,
): XrayRecord {
  const servers = [...(dns.servers || [])],
    previous = servers[index];
  if (index < 0 || index >= servers.length) throw new Error("DNS 服务器不存在");
  const entry = {
    ...(typeof previous === "string" ? { address: previous } : previous),
    ...changes,
  };
  for (const key of Object.keys(entry))
    if (entry[key] === undefined) delete entry[key];
  servers[index] = entry;
  return { ...dns, servers };
}
export function saveDnsHost(
  dns: XrayRecord,
  previous: string | null,
  key: string,
  value: string | string[],
): XrayRecord {
  if (!key.trim() || /[\r\n]/.test(key))
    throw new Error("请填写有效的 Hosts 匹配域名");
  if (previous !== key && Object.hasOwn(dns.hosts || {}, key))
    throw new Error("此 Hosts 匹配域名已存在");
  if (previous !== null && !Object.hasOwn(dns.hosts || {}, previous))
    throw new Error("原 Hosts 映射已不存在");
  const entries = Object.entries(dns.hosts || {}).filter(
    ([name]) => name !== previous,
  );
  return { ...dns, hosts: Object.fromEntries([...entries, [key, value]]) };
}
export function xrayDnsErrors(dns: XrayRecord | undefined): string[] {
  if (!dns) return [];
  const errors: string[] = [];
  const integer = (v: unknown, path: string, max: number) => {
    if (
      v !== undefined &&
      (!Number.isSafeInteger(v) || Number(v) < 0 || Number(v) > max)
    )
      errors.push(`${path} 需要 0 至 ${max} 的整数`);
  };
  const bool = (v: unknown, path: string) => {
    if (v !== undefined && typeof v !== "boolean")
      errors.push(`${path} 必须是布尔值`);
  };
  const text = (v: unknown, path: string, required = false) => {
    if (
      (required || v !== undefined) &&
      (typeof v !== "string" ||
        (required && !v.trim()) ||
        /[\r\n]/.test(String(v)))
    )
      errors.push(`${path} 需要有效字符串`);
  };
  const common = (v: XrayRecord, path: string) => {
    for (const key of ["disableCache", "serveStale"])
      bool(v[key], `${path}.${key}`);
    integer(v.serveExpiredTTL, `${path}.serveExpiredTTL`, 4294967295);
    text(v.tag, `${path}.tag`);
    if (v.clientIp !== undefined && v.clientIP !== undefined)
      errors.push(`${path} 的 clientIp 与 clientIP 不能同时设置`);
    const ip = v.clientIp ?? v.clientIP;
    if (
      ip !== undefined &&
      !z.union([z.ipv4(), z.ipv6()]).safeParse(ip).success
    )
      errors.push(`${path} 的客户端 IP 需要 IPv4 或 IPv6 地址`);
    if (
      v.queryStrategy !== undefined &&
      !["", "UseIP", "UseIPv4", "UseIPv6", "UseSystem"].includes(
        v.queryStrategy,
      )
    )
      errors.push(`${path} 的查询策略无效`);
  };
  common(dns, "DNS");
  for (const key of [
    "disableFallback",
    "disableFallbackIfMatch",
    "enableParallelQuery",
    "useSystemHosts",
  ])
    bool(dns[key], `DNS.${key}`);
  for (const [index, source] of (dns.servers || []).entries()) {
    const path = `DNS 服务器 ${index + 1}`,
      server = typeof source === "string" ? { address: source } : source;
    text(server.address, `${path} 地址`, true);
    if (typeof server.address === "string" && /\s/.test(server.address))
      errors.push(`${path} 地址不能包含空白`);
    if (typeof server.address === "string" && server.address.includes("://")) {
      try {
        const url = new URL(server.address);
        if (!url.hostname || url.username || url.password || url.hash)
          throw new Error();
      } catch {
        errors.push(`${path} URL 无效或包含凭据/片段`);
      }
    }
    integer(server.port, `${path} 端口`, 65535);
    integer(server.timeoutMs, `${path} 超时毫秒`, Number.MAX_SAFE_INTEGER);
    common(server, path);
    bool(server.skipFallback, `${path}.skipFallback`);
    bool(server.finalQuery, `${path}.finalQuery`);
    for (const field of [
      "domains",
      "expectedIPs",
      "expectIPs",
      "unexpectedIPs",
    ])
      if (
        server[field] !== undefined &&
        dnsValues(server[field]).some((s) => typeof s !== "string" || !s.trim())
      )
        errors.push(`${path}.${field} 不能包含空项`);
    // Legacy expectIPs is used by Xray only when expectedIPs is empty. Preserve both until explicitly edited.
  }
  for (const [key, value] of Object.entries(dns.hosts || {})) {
    text(key, "Hosts 匹配域名", true);
    for (const address of Array.isArray(value) ? value : [value])
      text(address, `Hosts ${key} 目标`, true);
  }
  return errors;
}
