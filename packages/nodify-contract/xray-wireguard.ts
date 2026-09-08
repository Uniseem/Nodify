import { z } from "zod";
import type { XrayRecord } from "./xray";

export const WIREGUARD_STRATEGIES = [
  "ForceIP",
  "ForceIPv4",
  "ForceIPv6",
  "ForceIPv4v6",
  "ForceIPv6v4",
] as const;
const key = (value: unknown) =>
  typeof value === "string" &&
  /^(?:[a-fA-F0-9]{64}|[A-Za-z0-9+/]{43}=?|[A-Za-z0-9_-]{43}=?)$/.test(value);
const keyIdentity = (value: string) =>
  /^[a-fA-F0-9]{64}$/.test(value)
    ? value.toLowerCase()
    : Array.from(
        atob(value.replaceAll("-", "+").replaceAll("_", "/")),
        (char) => char.charCodeAt(0).toString(16).padStart(2, "0"),
      ).join("");
function address(value: unknown, cidr: boolean) {
  if (typeof value !== "string") return false;
  const parts = value.split("/"),
    ip = parts[0];
  const family = z.ipv4().safeParse(ip).success
    ? 4
    : z.ipv6().safeParse(ip).success
      ? 6
      : 0;
  if (!family || parts.length > 2 || (cidr && parts.length !== 2)) return false;
  return (
    parts.length === 1 ||
    (/^(0|[1-9]\d*)$/.test(parts[1]) &&
      Number(parts[1]) <= (family === 4 ? 32 : 128))
  );
}
function endpoint(value: unknown) {
  if (typeof value !== "string") return false;
  const match = /^(?:\[([^\]]+)\]|([^:\s/]+)):(\d+)$/.exec(value);
  if (!match || Number(match[3]) < 1 || Number(match[3]) > 65535) return false;
  if (match[1]) return z.ipv6().safeParse(match[1]).success;
  const host = match[2];
  return (
    z.ipv4().safeParse(host).success ||
    (host.length <= 253 &&
      !/^[\d.]+$/.test(host) &&
      host
        .split(".")
        .every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part)))
  );
}
export function wireguardShapeErrors(
  settings: XrayRecord | undefined,
): string[] {
  if (!settings) return [];
  const errors: string[] = [];
  if (
    settings.domainStrategy !== undefined &&
    typeof settings.domainStrategy !== "string"
  )
    errors.push("WireGuard domainStrategy 必须是字符串");
  for (const name of ["address", "reserved", "peers"])
    if (settings[name] !== undefined && !Array.isArray(settings[name]))
      errors.push(`WireGuard ${name} 必须是数组`);
  if (Array.isArray(settings.peers))
    for (const peer of settings.peers) {
      if (!peer || typeof peer !== "object" || Array.isArray(peer))
        errors.push("WireGuard peer 必须是对象");
      else if (peer.allowedIPs !== undefined && !Array.isArray(peer.allowedIPs))
        errors.push("WireGuard allowedIPs 必须是数组");
    }
  return errors;
}
export function wireguardErrors(outbound: XrayRecord): string[] {
  if (outbound.protocol !== "wireguard") return [];
  const settings = outbound.settings || {},
    errors = wireguardShapeErrors(settings);
  if (errors.length) return errors;
  if (!key(settings.secretKey))
    errors.push("WireGuard 私钥必须是 32 字节的 Base64 或 64 位十六进制密钥");
  if (outbound.streamSettings !== undefined)
    errors.push("WireGuard 出站不支持 streamSettings，请在高级 JSON 中移除");
  if (
    settings.address !== undefined &&
    (!settings.address.length ||
      settings.address.some((value: unknown) => !address(value, false)))
  )
    errors.push("WireGuard 本地地址需为 IP 或 CIDR，至少一条");
  if (
    settings.noKernelTun !== undefined &&
    typeof settings.noKernelTun !== "boolean"
  )
    errors.push("WireGuard noKernelTun 必须是布尔值");
  if (
    settings.mtu !== undefined &&
    (!Number.isInteger(settings.mtu) ||
      (settings.mtu !== 0 && (settings.mtu < 576 || settings.mtu > 65535)))
  )
    errors.push("WireGuard MTU 需为 576–65535 的整数，0 使用内核默认值");
  if (
    settings.domainStrategy !== undefined &&
    (typeof settings.domainStrategy !== "string" ||
      !WIREGUARD_STRATEGIES.some(
        (value) =>
          value.toLowerCase() === settings.domainStrategy.toLowerCase(),
      ))
  )
    errors.push("WireGuard 域名解析策略必须使用 ForceIP 系列");
  if (
    settings.reserved !== undefined &&
    ((settings.reserved.length !== 0 && settings.reserved.length !== 3) ||
      settings.reserved.some(
        (n: unknown) =>
          !Number.isInteger(n) || Number(n) < 0 || Number(n) > 255,
      ))
  )
    errors.push("WireGuard 保留字节应为空或 3 个 0–255 的整数");
  if (!Array.isArray(settings.peers) || !settings.peers.length)
    errors.push("WireGuard 至少需要一个 peer");
  const publicKeys = new Set<string>();
  for (const [index, peer] of (settings.peers || []).entries()) {
    const prefix = `WireGuard peer ${index + 1}`;
    if (!key(peer.publicKey)) errors.push(`${prefix} 公钥格式不正确`);
    else {
      const identity = keyIdentity(peer.publicKey);
      if (publicKeys.has(identity))
        errors.push(`${prefix} 公钥重复：同一 peer 请合并 allowedIPs`);
      publicKeys.add(identity);
    }
    if (
      peer.preSharedKey !== undefined &&
      peer.preSharedKey !== "" &&
      !key(peer.preSharedKey)
    )
      errors.push(`${prefix} 预共享密钥格式不正确`);
    if (!endpoint(peer.endpoint))
      errors.push(`${prefix} 端点需为 主机:端口 或 [IPv6]:端口`);
    if (
      peer.keepAlive !== undefined &&
      (!Number.isInteger(peer.keepAlive) ||
        peer.keepAlive < 0 ||
        peer.keepAlive > 65535)
    )
      errors.push(`${prefix} 心跳间隔需为 0–65535 秒的整数`);
    if (
      peer.allowedIPs !== undefined &&
      peer.allowedIPs.some((value: unknown) => !address(value, true))
    )
      errors.push(`${prefix} allowedIPs 需为有效 CIDR`);
  }
  return errors;
}
export function updateWireguardPeer(
  settings: XrayRecord,
  index: number,
  patch: XrayRecord,
): XrayRecord {
  const peers = settings.peers || [];
  if (!Number.isInteger(index) || index < 0 || index >= peers.length)
    throw new Error("WireGuard peer 不存在");
  return {
    ...settings,
    peers: peers.map((peer: XrayRecord, i: number) =>
      i === index ? { ...peer, ...patch } : peer,
    ),
  };
}
