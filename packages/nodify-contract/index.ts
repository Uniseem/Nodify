import { z } from "zod";
export * from './agent-connection';
import { xrayReferenceErrors } from "./xray";
import { inboundTransportErrors } from "./inbound-transport";
export * from "./inbound-transport";
export * from "./xray";
export * from "./xray-dns";
export * from "./subscription-rules";
export * from "./subscription-templates";
export * from "./subscription-files";
export * from "./traffic-display";
export * from "./traffic-history";
export * from "./network-traffic";
export * from "./traffic-accounting";
export * from "./overview-traffic";
export * from "./backups";
export * from "./xray-wireguard";
export const PROTOCOL_CAPABILITIES: Record<
  string,
  { engine: string; networks: string[]; security: string[] }
> = {
  vless: {
    engine: "xray",
    networks: ["tcp", "ws", "grpc", "xhttp"],
    security: ["tls", "reality", "none"],
  },
  vmess: {
    engine: "xray",
    networks: ["tcp", "ws", "grpc", "xhttp"],
    security: ["tls", "none"],
  },
  trojan: {
    engine: "xray",
    networks: ["tcp", "ws", "grpc", "xhttp"],
    security: ["tls", "reality"],
  },
  shadowsocks: { engine: "xray", networks: ["tcp"], security: ["none"] },
  hysteria2: { engine: "xray", networks: ["udp"], security: ["tls"] },
  anytls: { engine: "sing-box", networks: ["tcp"], security: ["tls"] },
  tunnel: { engine: "xray", networks: ["tcp"], security: ["none"] },
};

export const Bytes = z
  .string()
  .regex(/^\d+$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
export const Id = z.string().uuid();
export const Protocol = z.enum([
  "vless",
  "vmess",
  "trojan",
  "shadowsocks",
  "hysteria2",
  "anytls",
  "tunnel",
]);
export const ServerInput = z.object({
  name: z.string().trim().min(1).max(80),
  address: z.string().trim().min(1).max(253),
  tags: z.array(z.string().max(40)).max(30).default([]),
});
export const Inbound = z
  .object({
    id: Id,
    name: z.string().min(1).max(80),
    protocol: Protocol,
    port: z.number().int().min(1).max(65535),
    enabled: z.boolean().default(true),
    network: z.enum(["tcp", "ws", "grpc", "xhttp", "udp"]).default("tcp"),
    security: z.enum(["none", "tls", "reality"]).default("tls"),
    serverName: z.string().max(253).default(""),
    certificateId: Id.optional(),
    path: z.string().max(255).default("/"),
    flow: z.enum(["", "xtls-rprx-vision"]).default(""),
    realityPrivateKey: z.string().max(100).optional(),
    realityPublicKey: z.string().max(100).optional(),
    realityTarget: z.string().max(255).optional(),
    shortId: z
      .string()
      .regex(/^[a-f0-9]{0,16}$/)
      .refine(
        (v) => v.length % 2 === 0,
        "REALITY shortId 必须包含偶数个十六进制字符",
      )
      .default(""),
    method: z
      .enum(["aes-256-gcm", "chacha20-ietf-poly1305"])
      .default("aes-256-gcm"),
    target: z.string().max(253).optional(),
    targetPort: z.number().int().min(1).max(65535).optional(),
    udp: z.boolean().default(false),
    tags: z.array(z.string().max(40)).default([]),
    extra: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((v, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    const capability = PROTOCOL_CAPABILITIES[v.protocol];
    if (
      !capability.networks.includes(v.network) ||
      !capability.security.includes(v.security)
    )
      issue("不支持此协议、传输和安全层组合");
    if ([61001, 61002].includes(v.port)) issue("此端口保留给本地统计接口");
    if (
      v.protocol === "anytls" &&
      (v.security !== "tls" || v.network !== "tcp")
    )
      issue("AnyTLS 必须使用 TCP + TLS");
    if (
      v.protocol === "hysteria2" &&
      (v.security !== "tls" || v.network !== "udp")
    )
      issue("Hysteria2 必须使用 UDP + TLS");
    if (
      ["shadowsocks", "tunnel"].includes(v.protocol) &&
      (v.security !== "none" || v.network !== "tcp")
    )
      issue("此协议必须使用 TCP，且不启用安全层");
    if (v.security === "tls" && !v.certificateId) issue("TLS 入站必须绑定证书");
    if (
      v.security === "reality" &&
      (!["vless", "trojan"].includes(v.protocol) ||
        !["tcp", "grpc", "xhttp"].includes(v.network) ||
        !v.realityPrivateKey ||
        !v.realityPublicKey ||
        !v.realityTarget ||
        !v.serverName.trim())
    )
      issue("请填写有效的 REALITY 密钥、目标和服务域名，并选择支持的传输");
    if (
      v.security === "reality" &&
      [v.realityPrivateKey, v.realityPublicKey].some(
        (key) => !key || !/^[A-Za-z0-9_-]{43}$/.test(key),
      )
    )
      issue("REALITY 密钥必须是 32 字节的 Base64URL 编码密钥");
    if (
      v.flow &&
      (v.protocol !== "vless" || v.network !== "tcp" || v.security === "none")
    )
      issue("Vision 仅支持 VLESS + TCP + TLS/REALITY");
    if (v.protocol === "tunnel" && (!v.target || !v.targetPort))
      issue("请填写转发目标地址和端口");
    if (v.network === "udp" && v.protocol !== "hysteria2")
      issue("UDP 传输仅用于 Hysteria2");
    for (const message of inboundTransportErrors(v)) issue(message);
  });
export const ConfigInput = z
  .object({
    inbounds: z.array(Inbound).max(200),
    xray: z.record(z.string(), z.unknown()).default({}),
    singbox: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((v, ctx) => {
    for (const engine of ["xray", "singbox"] as const) {
      if ("inbounds" in v[engine])
        ctx.addIssue({
          code: "custom",
          path: [engine, "inbounds"],
          message:
            "Edit managed inbounds in the top-level inbounds array; engine inbounds cannot bypass user policies",
        });
      if (
        v[engine].outbounds !== undefined &&
        !Array.isArray(v[engine].outbounds)
      )
        ctx.addIssue({
          code: "custom",
          path: [engine, "outbounds"],
          message: "Outbounds must be an array",
        });
    }
    for (const message of xrayReferenceErrors(v.xray))
      ctx.addIssue({ code: "custom", path: ["xray"], message });
    const xrayIds = new Set(
      v.inbounds.filter((i) => i.protocol !== "anytls").map((i) => i.id),
    );
    const xrayRules = (v.xray.routing as { rules?: unknown[] } | undefined)
      ?.rules;
    if (Array.isArray(xrayRules))
      for (const rule of xrayRules) {
        const tags = (rule as { inboundTag?: unknown } | null)?.inboundTag;
        if (Array.isArray(tags) && tags.some((tag) => !xrayIds.has(tag)))
          ctx.addIssue({
            code: "custom",
            path: ["xray", "routing"],
            message: "Xray 路由引用了不存在的入站或独立的 AnyTLS 入站",
          });
      }
    const routing = v.xray.routing as { rules?: unknown } | undefined;
    if (routing?.rules !== undefined && !Array.isArray(routing.rules))
      ctx.addIssue({
        code: "custom",
        path: ["xray", "routing", "rules"],
        message: "Routing rules must be an array",
      });
    const singIds = new Set(
      v.inbounds.filter((i) => i.protocol === "anytls").map((i) => i.id),
    );
    const checkSingRules = (rules: unknown) => {
      if (rules === undefined) return;
      if (!Array.isArray(rules)) {
        ctx.addIssue({
          code: "custom",
          message: "sing-box route.rules 必须是数组",
        });
        return;
      }
      for (const rule of rules) {
        if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
          ctx.addIssue({
            code: "custom",
            message: "sing-box 路由规则必须是对象",
          });
          continue;
        }
        const r = rule as Record<string, unknown>;
        if (r.inbound !== undefined) {
          const tags = Array.isArray(r.inbound) ? r.inbound : [r.inbound];
          if (tags.some((tag) => typeof tag !== "string" || !singIds.has(tag)))
            ctx.addIssue({
              code: "custom",
              message: "sing-box 路由引用了不存在的入站或 Xray 入站",
            });
        }
        checkSingRules(r.rules);
      }
    };
    checkSingRules(
      (v.singbox.route as Record<string, unknown> | undefined)?.rules,
    );
    const ids = new Set<string>();
    const ports = new Set<string>();
    for (const i of v.inbounds) {
      if (ids.has(i.id))
        ctx.addIssue({ code: "custom", message: "入站标识重复" });
      ids.add(i.id);
      const transports =
        i.protocol === "hysteria2"
          ? ["udp"]
          : i.protocol === "tunnel" && i.udp
            ? ["tcp", "udp"]
            : ["tcp"];
      for (const transport of transports) {
        const key = `${transport}:${i.port}`;
        if (i.enabled && ports.has(key))
          ctx.addIssue({ code: "custom", message: `监听端口冲突：${key}` });
        if (i.enabled) ports.add(key);
      }
    }
  });
export const PackageInput = z.object({
  name: z.string().trim().min(1).max(80),
  trafficLimitBytes: Bytes,
  validDays: z.number().int().min(1).max(36500),
  resetDays: z.number().int().min(0).max(365).default(30),
  nodeIds: z.array(Id).max(500),
  tags: z.array(z.string().max(40)).default([]),
  direction: z.enum(["both", "upload", "download"]).default("both"),
  multiplier: z.number().min(0.001).max(1000).default(1),
  deviceLimit: z.number().int().min(0).max(100).default(0),
});
export const AssignPackage = z.object({ userId: Bytes, packageId: Id });
export const MemberInput = z.object({
  username: z.string().regex(/^[A-Za-z0-9_]{3,36}$/),
  packageId: Id,
});
export const MemberAction = z.object({
  action: z.enum(["enable", "disable", "renew"]),
  days: z.number().int().min(1).max(36500).default(30),
});
const WebsiteDomain = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);
export const WebsiteInput = z
  .object({
    name: z.string().min(1).max(80),
    domain: WebsiteDomain,
    aliases: z.array(WebsiteDomain).max(19).default([]),
    type: z.enum(["static", "proxy"]),
    target: z.string().min(1).max(1024),
    certificateId: Id.optional(),
    enabled: z.boolean().default(true),
    httpPort: z.number().int().min(1).max(65535).default(80),
    httpsPort: z.number().int().min(1).max(65535).default(443),
    redirectHttps: z.boolean().default(false),
    websocket: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (new Set([v.domain, ...v.aliases]).size !== v.aliases.length + 1)
      issue("网站域名和别名不能重复");
    if (/[\r\n;{}"'$\\\x00-\x1f]/.test(v.target))
      issue("目标包含 Nginx 配置不允许的字符");
    if (v.type === "proxy") {
      try {
        const url = new URL(v.target);
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.hash ||
          /\s/.test(v.target)
        )
          issue("上游必须是无认证信息的 HTTP/HTTPS URL");
      } catch {
        issue("请输入完整的上游 URL，例如 http://127.0.0.1:8080");
      }
    } else if (!v.target.startsWith("/") || v.target.split("/").includes(".."))
      issue("静态网站必须使用不含 .. 跳转的绝对目录");
    if (v.certificateId && v.httpPort === v.httpsPort)
      issue("HTTP 与 HTTPS 监听端口不能相同");
    if (v.redirectHttps && !v.certificateId) issue("HTTPS 跳转需要绑定证书");
    if (
      [v.httpPort, ...(v.certificateId ? [v.httpsPort] : [])].some((p) =>
        [61001, 61002].includes(p),
      )
    )
      issue("监听端口保留给 Agent 统计接口");
  });
export const CertificateUpload = z.object({
  name: z.string().min(1).max(80),
  certPem: z.string().min(50).max(100000),
  keyPem: z.string().min(50).max(100000),
});
export const CertificateRequest = z.object({
  name: z.string().min(1).max(80),
  domains: z
    .array(z.string().regex(/^(\*\.)?[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/))
    .min(1)
    .max(20),
  provider: z.enum(["cloudflare", "alidns", "tencentcloud"]),
  email: z.email(),
  credentials: z.record(z.string(), z.string().max(4000)),
  staging: z.boolean().default(true),
});
const SourceUrl = z
  .url()
  .max(2048)
  .refine((v) => {
    const url = new URL(v);
    return (
      url.protocol === "https:" && !url.username && !url.password && !url.hash
    );
  }, "订阅地址必须是 HTTPS，不能包含用户认证信息或片段");
const SourceFields = {
  trafficDirection: z.enum(["upload", "download", "both"]).default("both"),
  name: z.string().trim().min(1, "请输入来源名称").max(80),
  enabled: z.boolean().default(true),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  intervalMinutes: z
    .number()
    .int()
    .min(0)
    .max(10080)
    .refine(
      (v) => v === 0 || v >= 15,
      "自动更新间隔至少为 15 分钟，0 表示仅手动",
    )
    .default(360),
};
export const SourceInput = z.object({ ...SourceFields, url: SourceUrl });
export const SourceUpdateInput = z.object({
  ...SourceFields,
  url: SourceUrl.optional(),
  version: z.number().int().positive(),
});
export const SourceNodeInput = z.object({
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(80).nullable().default(null),
  enabled: z.boolean().default(true),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
});
export const AgentHello = z.object({
  token: z.string().min(20).max(500),
  version: z.string().max(80),
  hostname: z.string().max(253),
});
export const OperationResult = z.object({
  id: Id,
  state: z.enum(["succeeded", "failed"]),
  message: z.string().max(8000).default(""),
  result: z.record(z.string(), z.unknown()).default({}),
});
export const TRAFFIC_POLICY_RECEIPT_LIMIT = 1000000;
export const TrafficBatch = z.object({
  collectedAt: z.iso.datetime().optional(),
  session: Id,
  policyId: Id,
  policyReceipt: z
    .string()
    .min(40)
    .max(TRAFFIC_POLICY_RECEIPT_LIMIT)
    .optional(),
  sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  users: z
    .array(z.object({ userId: Bytes, upload: Bytes, download: Bytes }))
    .max(10000),
});
export type TConfig = z.infer<typeof ConfigInput>;
export type TInbound = z.infer<typeof Inbound>;
export type TPackage = z.infer<typeof PackageInput>;
export const CONTROL_VERSION = 1;
export { NODIFY_VERSION } from "./version";
export * from './publication';
export {
  WebsiteFileAction,
  WebsiteFileRequest,
  WEBSITE_FILE_LIMIT,
} from "./website-files";
export * from "./xray-system";
export * from './terminal';
