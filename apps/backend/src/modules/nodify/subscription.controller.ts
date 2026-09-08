import {
  PackageInput,
  Inbound,
  type TInbound,
  compileSubscriptionRules,
  RuleSetInput,
  expandTemplateGroups,
  fileAllowsNode,
  SubscriptionFileInput,
  SubscriptionAlias,
  readInboundTransport,
  subscriptionTransportExclusion,
} from "@nodify/contract";
import { Request, Response } from "express";
import { dump } from "js-yaml";

import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";

import { allowed } from "./configuration";
import { hashToken } from "./crypto";
import { NodifyService } from "./nodify.service";
import { sourceNodes } from "./source-nodes";
import { resolveSubscriptionTemplate } from "./subscription-templates";
import { selectSubscriptionRuleSets } from "@nodify/contract";

export function proxyFor(
  i: TInbound,
  address: string,
  u: { vlessUuid: string; trojanPassword: string; ssPassword: string },
  anytlsPassword: string,
): Record<string, any> {
  const transport = readInboundTransport(i);
  const proxy: Record<string, any> = {
    name: i.name,
    type: i.protocol === "shadowsocks" ? "ss" : i.protocol,
    server: address,
    port: i.port,
    udp: true,
  };
  if (["vless", "vmess"].includes(i.protocol)) proxy.uuid = u.vlessUuid;
  else
    proxy.password =
      i.protocol === "anytls"
        ? anytlsPassword
        : i.protocol === "hysteria2"
          ? u.vlessUuid
          : i.protocol === "shadowsocks"
            ? u.ssPassword
            : u.trojanPassword;
  if (i.protocol === "shadowsocks") proxy.cipher = i.method;
  if (i.protocol === "vmess") {
    proxy.alterId = 0;
    proxy.cipher = "aes-128-gcm";
  }
  if (i.security !== "none") {
    proxy.tls = true;
    proxy.servername = i.serverName || address;
    if (["trojan", "hysteria2", "anytls"].includes(i.protocol))
      proxy.sni = proxy.servername;
    proxy["client-fingerprint"] = "chrome";
    if (i.security === "tls" && transport.alpn?.length)
      proxy.alpn = transport.alpn;
  }
  if (i.security === "reality")
    proxy["reality-opts"] = {
      "public-key": i.realityPublicKey,
      "short-id": i.shortId,
    };
  if (i.flow) proxy.flow = i.flow;
  if (["ws", "grpc", "xhttp"].includes(i.network)) proxy.network = i.network;
  if (i.network === "ws")
    proxy["ws-opts"] = {
      path: i.path,
      headers: { Host: transport.host || i.serverName || address },
    };
  if (i.network === "grpc")
    proxy["grpc-opts"] = { "grpc-service-name": i.path.replace(/^\//, "") };
  if (i.network === "xhttp") {
    proxy["xhttp-opts"] = {
      path: i.path,
      host: transport.host || i.serverName || address,
      mode: transport.mode,
      headers: {},
    };
  }
  return proxy;
}
export function uriFor(p: Record<string, any>): string {
  if (p.type === "vmess")
    return `vmess://${Buffer.from(
      JSON.stringify({
        v: "2",
        ps: p.name,
        add: p.server,
        port: String(p.port),
        id: p.uuid,
        aid: "0",
        scy: "aes-128-gcm",
        net: p.network || "tcp",
        type: "none",
        host: p["ws-opts"]?.headers?.Host || p["xhttp-opts"]?.host || "",
        path:
          p["grpc-opts"]?.["grpc-service-name"] ||
          p["xhttp-opts"]?.path ||
          p["ws-opts"]?.path ||
          "/",
        tls: p.tls ? "tls" : "",
        sni: p.servername || "",
        ...(p.alpn?.length ? { alpn: p.alpn.join(",") } : {}),
        ...(p["xhttp-opts"]
          ? { mode: p["xhttp-opts"].mode || p.mode || "auto" }
          : {}),
      }),
    ).toString("base64")}`;
  const authority = p.server.includes(":") ? `[${p.server}]` : p.server;
  if (p.type === "ss")
    return `ss://${Buffer.from(`${p.cipher}:${p.password}`).toString("base64url")}@${authority}:${p.port}#${encodeURIComponent(p.name)}`;
  const q = new URLSearchParams({
    security: p["reality-opts"] ? "reality" : p.tls ? "tls" : "none",
    type: p.network || "tcp",
    sni: p.servername || p.sni || p.server,
  });
  if (p.type === "vless") q.set("encryption", "none");
  if (p.flow) q.set("flow", p.flow);
  if (p.alpn?.length) q.set("alpn", p.alpn.join(","));
  if (p["ws-opts"]) {
    q.set("path", p["ws-opts"].path);
    q.set("host", p["ws-opts"].headers?.Host || "");
  }
  if (p["grpc-opts"]) q.set("serviceName", p["grpc-opts"]["grpc-service-name"]);
  if (p["xhttp-opts"]) {
    q.set("path", p["xhttp-opts"].path);
    q.set("mode", p["xhttp-opts"].mode || p.mode || "auto");
    if (p["xhttp-opts"].host) q.set("host", p["xhttp-opts"].host);
  }
  if (p["reality-opts"]) {
    q.set("pbk", p["reality-opts"]["public-key"]);
    q.set("sid", p["reality-opts"]["short-id"]);
    q.set("fp", "chrome");
  }
  return `${p.type}://${encodeURIComponent(p.uuid || p.password)}@${authority}:${p.port}?${q}#${encodeURIComponent(p.name)}`;
}
export function singboxFor(p: Record<string, any>) {
  const out: Record<string, any> = {
    type: p.type === "ss" ? "shadowsocks" : p.type,
    tag: p.name,
    server: p.server,
    server_port: p.port,
  };
  if (p.uuid) out.uuid = p.uuid;
  if (p.password) out.password = p.password;
  if (p.flow) out.flow = p.flow;
  if (p.type === "ss") out.method = p.cipher;
  if (p.type === "vmess") {
    out.security = "aes-128-gcm";
    out.alter_id = 0;
  }
  if (p.tls || ["anytls", "hysteria2"].includes(p.type))
    out.tls = {
      enabled: true,
      server_name: p.servername || p.sni || p.server,
      ...(p.alpn?.length ? { alpn: p.alpn } : {}),
      ...(p["reality-opts"]
        ? {
            reality: {
              enabled: true,
              public_key: p["reality-opts"]["public-key"],
              short_id: p["reality-opts"]["short-id"],
            },
            utls: { enabled: true, fingerprint: "chrome" },
          }
        : {}),
    };
  if (p.network === "ws")
    out.transport = {
      type: "ws",
      path: p["ws-opts"]?.path || "/",
      headers: p["ws-opts"]?.headers || {},
    };
  if (p.network === "grpc")
    out.transport = {
      type: "grpc",
      service_name: p["grpc-opts"]?.["grpc-service-name"] || "",
    };
  return out;
}
@Controller("sub")
export class NodifySubscriptionController {
  constructor(private readonly service: NodifyService) {}
  @Get(":token") async subscription(
    @Param("token") token: string,
    @Query("format") format = "mihomo",
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (token.length > 256) throw new UnauthorizedException();
    if (
      ![
        "mihomo",
        "clash",
        "singbox",
        "v2ray",
        "shadowrocket",
        "info",
        "uris",
      ].includes(format)
    )
      throw new BadRequestException("Unsupported subscription format");
    const alias = token.startsWith("~")
      ? SubscriptionAlias.safeParse(token.slice(1))
      : null;
    if (alias && (!alias.success || alias.data !== token.slice(1)))
      throw new UnauthorizedException("Subscription revoked or unknown");
    let e = alias
      ? null
      : await this.service.db.nodifyEntitlement.findUnique({
          where: { tokenHash: hashToken(token) },
          include: { user: true, package: true },
        });
    const file = e
      ? null
      : await this.service.db.nodifySubscriptionFile.findFirst({
          where: alias?.success
            ? { alias: { is: { hash: hashToken(alias.data) } } }
            : { tokenHash: hashToken(token) },
          include: { ruleSets: true },
        });
    if (file)
      e = await this.service.db.nodifyEntitlement.findUnique({
        where: { id: file.entitlementId },
        include: { user: true, package: true },
      });
    if (!e || (file && file.entitlementTokenHash !== e.tokenHash))
      throw new UnauthorizedException("Subscription revoked or unknown");
    const fileConfig = file
      ? SubscriptionFileInput.parse({
          ...file,
          expiresAt: file.expiresAt?.toISOString() || null,
          ruleSetIds: file.ruleSets.map((rule) => rule.ruleSetId),
        })
      : null;
    const expiresAt = new Date(
      Math.min(
        e.user.expireAt.getTime(),
        file?.expiresAt?.getTime() ?? Infinity,
      ),
    );
    const p = PackageInput.parse(e.snapshot);
    const displayLimit = file?.displayTrafficLimitBytes ?? p.trafficLimitBytes;
    const active =
      e.user.status === "ACTIVE" &&
      (!file || file.enabled) &&
      expiresAt.getTime() > Date.now() &&
      (BigInt(p.trafficLimitBytes) === 0n ||
        e.usedBytes < BigInt(p.trafficLimitBytes));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "subscription-userinfo",
      `upload=${e.uploadBytes}; download=${e.downloadBytes}; total=${displayLimit}; expire=${Math.floor(expiresAt.getTime() / 1000)}`,
    );
    const rows = await this.service.db.nodifyInbound.findMany({
      include: { host: true },
      orderBy: { host: { viewPosition: "asc" } },
    });
    const proxies: Record<string, any>[] = [];
    if (active)
      for (const row of rows) {
        const i = Inbound.parse(row.config);
        if (
          i.enabled &&
          !row.host.isDisabled &&
          allowed(i, p) &&
          (!fileConfig || fileAllowsNode(fileConfig, i))
        )
          proxies.push(
            proxyFor(
              { ...i, name: row.host.remark },
              row.host.address,
              e.user,
              this.service.box.open(e.anytlsPassword),
            ),
          );
      }
    if (active) {
      const sources = await this.service.db.nodifySubscriptionSource.findMany({
        where: { enabled: true },
      });
      for (const source of sources)
        for (const node of sourceNodes(source))
          if (
            node.enabled &&
            (!fileConfig || fileAllowsNode(fileConfig, node)) &&
            (p.nodeIds.includes(node.id) ||
              node.tags.some((tag: string) => p.tags.includes(tag)))
          )
            proxies.push({ ...node.proxy, name: node.name });
    }
    const template = await resolveSubscriptionTemplate(
      this.service.db,
      file?.templateId,
    );
    const names = new Set<string>([
      "Nodify",
      "DIRECT",
      "REJECT",
      "direct",
      ...(template.mihomo?.["proxy-groups"] || []).map(
        (group: any) => group.name,
      ),
    ]);
    for (const proxy of proxies) {
      const original = proxy.name;
      let n = 2;
      while (names.has(proxy.name)) proxy.name = `${original} (${n++})`;
      names.add(proxy.name);
    }
    if (format === "info")
      return res.json({
        username: e.user.username,
        subscriptionName: file?.name || null,
        package: p.name,
        usedBytes: e.usedBytes.toString(),
        uploadBytes: e.uploadBytes.toString(),
        downloadBytes: e.downloadBytes.toString(),
        trafficLimitBytes: p.trafficLimitBytes,
        displayTrafficLimitBytes: displayLimit,
        hasDisplayOverride: file?.displayTrafficLimitBytes != null,
        expiresAt,
        active,
        deviceLimit: p.deviceLimit,
        nodes: proxies.map((v) => ({
          name: v.name,
          protocol: v.type,
          exclusions: [
            ...new Set(
              ["singbox", "mihomo", "clash"]
                .map((format) =>
                  subscriptionTransportExclusion(
                    v as { type: string; network?: string },
                    format,
                  ),
                )
                .filter(Boolean),
            ),
          ],
        })),
        subscriptionUrl: `${await this.service.publishedUrl('subscription')}/api/sub/${token}`,
      });
    if (active && p.deviceLimit > 0) {
      const hwid = req.headers["x-hwid"];
      if (typeof hwid !== "string" || !hwid || hwid.length > 256)
        throw new ForbiddenException(
          "This subscription requires an HWID-capable client",
        );
      await this.service.db.$transaction(async (tx) => {
        const exists = await tx.hwidUserDevices.findUnique({
          where: { hwid_userId: { hwid, userId: e.userId } },
        });
        if (!exists) {
          if (
            (await tx.hwidUserDevices.count({ where: { userId: e.userId } })) >=
            p.deviceLimit
          )
            throw new ForbiddenException("Device limit reached");
          await tx.hwidUserDevices.create({
            data: {
              hwid,
              userId: e.userId,
              userAgent: req.headers["user-agent"]?.slice(0, 500),
            },
          });
        }
      });
    }
    const excluded: string[] = [];
    const usable = proxies.filter((proxy) => {
      if (
        subscriptionTransportExclusion(
          proxy as { type: string; network?: string },
          format,
        )
      ) {
        excluded.push(proxy.name);
        return false;
      }
      return true;
    });
    res.setHeader("X-Nodify-Excluded-Count", excluded.length.toString());
    const customRules = compileSubscriptionRules(
      active
        ? selectSubscriptionRuleSets(
            await this.service.listRuleSets(),
            !fileConfig || fileConfig.ruleMode === "template"
              ? template.ruleSelection
              : {
                  ruleMode: fileConfig.ruleMode,
                  ruleSetIds: fileConfig.ruleSetIds,
                },
          ).map((set) => RuleSetInput.parse(set))
        : [],
    );
    res.setHeader(
      "X-Nodify-Rules-Applied",
      ["mihomo", "clash"].includes(format) ||
        (format === "singbox" && usable.length > 0)
        ? String(customRules.mihomo.length)
        : "0",
    );
    if (format === "mihomo" || format === "clash") {
      const custom = active ? template.mihomo : {};
      const { groups, rules, warnings, proxyProviders } = expandTemplateGroups(
        custom,
        usable as { name: string }[],
      );
      res.setHeader("X-Nodify-Template-Warnings", String(warnings.length));
      return res.type("text/yaml").send(
        dump({
          "mixed-port": 7890,
          mode: "rule",
          ...custom,
          proxies: usable,
          "proxy-providers": proxyProviders,
          "proxy-groups": groups,
          rules: [...customRules.mihomo, ...rules],
        }),
      );
    }
    if (format === "singbox")
      return res.json({
        ...(active ? template.singbox : {}),
        inbounds: [
          {
            type: "mixed",
            tag: "mixed-in",
            listen: "127.0.0.1",
            listen_port: 7890,
          },
        ],
        outbounds: usable.length
          ? [
              {
                type: "selector",
                tag: "Nodify",
                outbounds: usable.map((p) => p.name),
              },
              ...usable.map(singboxFor),
              { type: "direct", tag: "direct" },
            ]
          : [{ type: "direct", tag: "direct" }],
        route: usable.length
          ? {
              final: "Nodify",
              ...template.singbox.route,
              rules: [
                ...customRules.singbox,
                ...(template.singbox.route?.rules || []),
              ],
              rule_set: [
                ...(template.singbox.route?.rule_set || []).filter(
                  (set: any) =>
                    !customRules.ruleSets.some((rule) => rule.tag === set.tag),
                ),
                ...customRules.ruleSets,
              ],
            }
          : { rules: [{ action: "reject" }] },
      });
    const uris = usable.map(uriFor).join("\n");
    return res
      .type("text/plain")
      .send(format === "uris" ? uris : Buffer.from(uris).toString("base64"));
  }
}
