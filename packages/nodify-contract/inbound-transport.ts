import { z } from "zod";

export const XHTTP_MODES = [
  "auto",
  "packet-up",
  "stream-up",
  "stream-one",
] as const;
const object = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
const host = z
  .string()
  .max(253)
  .refine((value) => {
    if (!value) return true;
    if (!/^[a-zA-Z0-9._-]+$/.test(value)) return false;
    try {
      return !!new URL(`http://${value}`).hostname;
    } catch {
      return false;
    }
  }, "传输 Host 请输入 ASCII 域名或 IPv4，不包含协议、端口或路径");
const alpn = z
  .array(
    z
      .string()
      .min(1)
      .max(255)
      .regex(/^[\x21-\x2b\x2d-\x7e]+$/, "ALPN 不能包含空白或逗号"),
  )
  .max(16)
  .refine((items) => new Set(items).size === items.length, "ALPN 不能重复");
const headers = z.record(z.string(), z.string());
const tls = z.object({ alpn: alpn.optional() }).passthrough();
export const InboundTransportExtra = z
  .object({
    tls: tls.optional(),
    streamSettings: z
      .object({
        tlsSettings: tls.optional(),
        wsSettings: z
          .object({
            host: host.optional(),
            headers: headers.optional(),
            heartbeatPeriod: z.number().int().min(0).max(86400).optional(),
          })
          .passthrough()
          .optional(),
        xhttpSettings: z
          .object({
            host: host.optional(),
            mode: z.enum(["", ...XHTTP_MODES]).optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

type TransportInbound = {
  protocol: string;
  network: string;
  security: string;
  extra: Record<string, unknown>;
};
export function readInboundTransport(inbound: TransportInbound) {
  const stream = object(inbound.extra.streamSettings);
  const ws = object(stream.wsSettings),
    xhttp = object(stream.xhttpSettings);
  const legacyHost = Object.entries(object(ws.headers)).find(
    ([key]) => key.toLowerCase() === "host",
  )?.[1];
  const security =
    inbound.protocol === "anytls"
      ? object(inbound.extra.tls)
      : object(stream.tlsSettings);
  return {
    host: (inbound.network === "ws" ? ws.host || legacyHost : xhttp.host) || "",
    heartbeat: ws.heartbeatPeriod as number | undefined,
    mode: (xhttp.mode || "auto") as (typeof XHTTP_MODES)[number],
    alpn: security.alpn as string[] | undefined,
  };
}

/** Update only the edited field; advanced JSON and other transports survive. */
export function patchInboundTransport(
  inbound: TransportInbound,
  field: "host" | "heartbeat" | "mode" | "alpn",
  value: unknown,
) {
  const extra = { ...inbound.extra },
    stream = { ...object(extra.streamSettings) };
  const key =
    field === "alpn"
      ? "tlsSettings"
      : field === "heartbeat" || inbound.network === "ws"
        ? "wsSettings"
        : "xhttpSettings";
  const settings = {
    ...object(
      field === "alpn" && inbound.protocol === "anytls"
        ? extra.tls
        : stream[key],
    ),
  };
  const property = field === "heartbeat" ? "heartbeatPeriod" : field;
  if (value === undefined || value === "") delete settings[property];
  else settings[property] = value;
  if (field === "host" && inbound.network === "ws" && settings.headers) {
    settings.headers = Object.fromEntries(
      Object.entries(object(settings.headers)).filter(
        ([name]) => name.toLowerCase() !== "host",
      ),
    );
  }
  if (field === "alpn" && inbound.protocol === "anytls") extra.tls = settings;
  else {
    stream[key] = settings;
    extra.streamSettings = stream;
  }
  return extra;
}

export function inboundTransportErrors(inbound: TransportInbound) {
  const result = InboundTransportExtra.safeParse(inbound.extra);
  if (!result.success)
    return result.error.issues.map(
      (issue) => `extra.${issue.path.join(".")}: ${issue.message}`,
    );
  const options = readInboundTransport(inbound),
    errors: string[] = [];
  if (!host.safeParse(options.host).success)
    errors.push("WebSocket headers.Host 格式错误");
  if (inbound.security === "tls" && options.alpn?.length) {
    if (
      inbound.network === "ws" &&
      options.alpn.some((value) => value !== "http/1.1")
    )
      errors.push("WebSocket 的 ALPN 只能使用 http/1.1，或留空使用内核默认值");
    if (inbound.network === "grpc" && !options.alpn.includes("h2"))
      errors.push("gRPC 的 ALPN 必须包含 h2，或留空使用内核默认值");
  }
  return errors;
}

export function subscriptionTransportExclusion(
  proxy: { type: string; network?: string },
  format: string,
): string | undefined {
  if (format === "singbox" && proxy.network === "xhttp")
    return "sing-box 不支持此 XHTTP 传输";
  if (
    ["mihomo", "clash"].includes(format) &&
    proxy.network === "xhttp" &&
    proxy.type !== "vless"
  )
    return "Mihomo 1.19.30 的 XHTTP 仅支持 VLESS";
  if (
    format === "clash" &&
    ["vless", "hysteria2", "anytls"].includes(proxy.type)
  )
    return "旧版 Clash 不支持此协议；请选择 Mihomo";
}
