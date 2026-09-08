import {
  ConfigInput,
  PackageInput,
  MemberInput,
  MemberAction,
  type TConfig,
  type TInbound,
  type TPackage,
  ServerInput,
  TrafficBatch,
  WebsiteInput,
  CertificateUpload,
  remapInboundReferences,
  RuleSetInput,
} from "@nodify/contract";
import { Prisma } from "@prisma/client";
import { randomUUID, X509Certificate, createPrivateKey } from "node:crypto";
import { isIP } from "node:net";

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from "@nestjs/common";

import { PrismaService } from "@common/database/prisma.service";

import {
  allowed,
  compileConfiguration,
  measuredBytes,
  type RuntimeUser,
} from "./configuration";
import { SecretBox, hashToken, newToken } from "./crypto";
import { operationView } from "./operation-view";
import { accountingTime, addDaily, zeroIncrement } from "./daily-traffic";
import { NetworkAccounting, networkMetrics } from "./network-traffic";
import { TrafficAccounting } from "./traffic-accounting";
import { issueTrafficPolicy, readTrafficPolicy } from "./traffic-policy";
import { PublicationSettings } from './publication';

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
@Injectable()
export class NodifyService implements OnModuleInit, OnModuleDestroy {
  readonly box = new SecretBox();
  private timer?: ReturnType<typeof setInterval>;
  private reconciling = false;
  private readonly logger = new Logger(NodifyService.name);
  constructor(readonly db: PrismaService) {}
  listRuleSets() {
    return this.db.nodifyRuleSet.findMany({
      orderBy: [{ position: "asc" }, { id: "asc" }],
    });
  }
  async saveRuleSet(body: unknown, id?: string, version?: number) {
    const input = RuleSetInput.parse(body);
    if (id && (!Number.isSafeInteger(version) || Number(version) < 1))
      throw new BadRequestException("修改规则集需要当前版本号");
    return this.db.$transaction(async (tx) => {
      const rows = await tx.nodifyRuleSet.findMany();
      if (!id && rows.length >= 100)
        throw new BadRequestException("最多保存 100 个规则集");
      const others = rows.filter((row) => row.id !== id);
      if (
        others.reduce(
          (sum, row) => sum + (row.rules as unknown[]).length,
          input.rules.length,
        ) > 10000
      )
        throw new BadRequestException("全部规则集合计不能超过 10,000 条规则");
      if (id) {
        const result = await tx.nodifyRuleSet.updateMany({
          where: { id, version },
          data: {
            ...input,
            rules: json(input.rules),
            version: { increment: 1 },
          },
        });
        if (result.count !== 1)
          throw new ConflictException(
            "规则集已被其他操作修改或删除，请刷新后重试",
          );
        return tx.nodifyRuleSet.findUniqueOrThrow({ where: { id } });
      }
      return tx.nodifyRuleSet.create({
        data: {
          ...input,
          rules: json(input.rules),
          position: Math.max(-1, ...rows.map((row) => row.position)) + 1,
        },
      });
    });
  }
  async reorderRuleSets(items: { id: string; version: number }[]) {
    return this.db.$transaction(async (tx) => {
      const rows = await tx.nodifyRuleSet.findMany();
      if (
        items.length !== rows.length ||
        new Set(items.map((item) => item.id)).size !== rows.length ||
        items.some(
          (item) =>
            !rows.some(
              (row) => row.id === item.id && row.version === item.version,
            ),
        )
      )
        throw new ConflictException("规则列表已变化，请刷新后重新排序");
      for (const [position, item] of items.entries())
        await tx.nodifyRuleSet.update({
          where: { id: item.id },
          data: { position, version: { increment: 1 } },
        });
      return tx.nodifyRuleSet.findMany({
        orderBy: [{ position: "asc" }, { id: "asc" }],
      });
    });
  }
  async deleteRuleSet(id: string, version: number) {
    return this.db.$transaction(async (tx) => {
      if (
        await tx.nodifySubscriptionTemplateRule.count({
          where: { ruleSetId: id },
        })
      )
        throw new ConflictException(
          "规则集仍被订阅模板引用，请先调整模板的规则选择",
        );
      if (
        await tx.nodifySubscriptionFileRule.count({ where: { ruleSetId: id } })
      )
        throw new ConflictException(
          "规则集仍被订阅文件引用，请先调整文件的规则选择",
        );
      const result = await tx.nodifyRuleSet.deleteMany({
        where: { id, version },
      });
      if (result.count !== 1)
        throw new ConflictException(
          "规则集已被其他操作修改或删除，请刷新后重试",
        );
      return { deleted: true };
    });
  }
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.reconcile().catch((e) => this.logger.error(e.message));
    }, 15000);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  publicUrl() {
    const value = process.env.NODIFY_PUBLIC_URL;
    if (!value)
      throw new BadRequestException(
        "Set NODIFY_PUBLIC_URL to the externally reachable HTTPS URL",
      );
    const url = new URL(value);
    if (url.protocol !== "https:" && process.env.NODE_ENV === "production")
      throw new BadRequestException("HTTPS is required");
    return value.replace(/\/$/, "");
  }
  async publishedUrl(kind: 'panel' | 'subscription') {
    const {config} = await new PublicationSettings(this).read();
    return config ? (kind === 'panel' ? config.panelUrl : config.subscriptionUrl) : this.publicUrl();
  }
  async listServers() {
    return this.db.$transaction(async (tx) => {
      const raw = await tx.nodifyServer.findMany({
        include: { node: true },
        orderBy: { createdAt: "desc" },
      });
      const rows = await new TrafficAccounting(this).augment(tx, raw);
      return rows.map(
        ({ tokenHash, nextTokenHash, enrollmentHash, policyHash, ...row }) => ({
          ...row,
          status: !tokenHash
            ? "pending"
            : row.lastSeenAt && Date.now() - row.lastSeenAt.getTime() < 45000
              ? "connected"
              : "disconnected",
        }),
      );
    });
  }
  async createServer(body: unknown) {
    const publicUrl = await this.publishedUrl('panel');
    const input = ServerInput.parse(body);
    const token = newToken();
    const id = randomUUID();
    await this.db.nodifyServer.create({
      data: {
        id,
        enrollmentHash: hashToken(token),
        enrollmentExpiresAt: new Date(Date.now() + 30 * 60000),
        node: {
          create: {
            name: input.name,
            address: input.address,
            tags: input.tags,
            isDisabled: true,
          },
        },
      },
    });
    return {
      id,
      token,
      expiresAt: new Date(Date.now() + 30 * 60000),
      command: `curl -fsSL '${publicUrl.replace(/'/g, "")}/api/agent/install.sh' -o /tmp/nodify-install.sh && NODIFY_PANEL='${publicUrl.replace(/'/g, "")}' NODIFY_ENROLLMENT='${token}' NODIFY_RELEASE_URL='${(process.env.NODIFY_RELEASE_URL || "").replace(/'/g, "")}' bash /tmp/nodify-install.sh agent`,
    };
  }
  async authenticate(token: string) {
    if (!token) throw new UnauthorizedException();
    const server = await this.db.nodifyServer.findFirst({
      where: {
        OR: [
          { tokenHash: hashToken(token) },
          { nextTokenHash: hashToken(token) },
        ],
      },
      include: { node: true },
    });
    if (!server) throw new UnauthorizedException();
    return server;
  }
  async enroll(token: string, version: string, hostname: string) {
    const credential = newToken();
    const result = await this.db.$transaction(async (tx) => {
      const row = await tx.nodifyServer.findUnique({
        where: { enrollmentHash: hashToken(token) },
      });
      if (
        !row ||
        !row.enrollmentExpiresAt ||
        row.enrollmentExpiresAt.getTime() < Date.now()
      )
        throw new UnauthorizedException(
          "Enrollment expired or already consumed",
        );
      const changed = await tx.nodifyServer.updateMany({
        where: { id: row.id, enrollmentHash: hashToken(token) },
        data: {
          tokenHash: hashToken(credential),
          enrollmentHash: null,
          enrollmentExpiresAt: null,
          version,
          hostname,
          lastSeenAt: new Date(),
        },
      });
      if (!changed.count) throw new UnauthorizedException();
      return row.id;
    });
    return { serverId: result, credential, protocolVersion: 1 };
  }
  async revoke(id: string) {
    await this.db.$transaction(async tx => {
      await tx.nodifyServer.update({
        where: { id },
        data: {
          tokenHash: null,
          nextTokenHash: null,
          enrollmentHash: null,
          lastSeenAt: null,
        },
      });
      await tx.nodifyAgentConnection.updateMany({
        where: { serverId: id },
        data: { enabled: false, version: { increment: 1 }, lastContactAt: null, lastError: '', leaseOwner: null, leaseUntil: null },
      });
    });
    return { revoked: true };
  }
  async issueEnrollment(id: string) {
    const token = newToken();
    await this.db.nodifyServer.update({
      where: { id },
      data: {
        tokenHash: null,
        nextTokenHash: null,
        enrollmentHash: hashToken(token),
        enrollmentExpiresAt: new Date(Date.now() + 1800000),
      },
    });
    return { token, expiresAt: new Date(Date.now() + 1800000) };
  }
  async rotateCredential(id: string) {
    const credential = newToken();
    return this.db.$transaction(async (tx) => {
      const server = await tx.nodifyServer.findUniqueOrThrow({ where: { id } });
      if (!server.tokenHash || server.nextTokenHash)
        throw new ConflictException(
          "Server is not enrolled or rotation is already pending",
        );
      await tx.nodifyServer.update({
        where: { id },
        data: { nextTokenHash: hashToken(credential) },
      });
      const op = await tx.nodifyOperation.create({
        data: {
          serverId: id,
          kind: "rotate-credential",
          payload: this.box.seal(JSON.stringify({ credential })),
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
      return { id: op.id, state: op.state };
    });
  }
  async heartbeat(id: string, metrics: Record<string, unknown>) {
    if (
      typeof metrics.session === "string" &&
      /^[a-f0-9-]{36}$/.test(metrics.session)
    ) {
      const existing = await this.db.nodifyAgentSession.findUnique({
        where: { id: metrics.session },
      });
      if (existing && existing.serverId !== id)
        throw new UnauthorizedException("Session belongs to another server");
      await this.db.nodifyAgentSession.upsert({
        where: { id: metrics.session },
        create: {
          id: metrics.session,
          serverId: id,
          version: String(metrics.version || "unknown").slice(0, 80),
        },
        update: { lastSeenAt: new Date() },
      });
    }
    const previous = await this.db.nodifyServer.findUniqueOrThrow({
      where: { id },
    });
    metrics = networkMetrics(metrics, previous);
    const observedPolicy =
      typeof metrics.appliedPolicyId === "string"
        ? await this.db.nodifyOperation.findFirst({
            where: {
              id: metrics.appliedPolicyId,
              serverId: id,
              kind: "apply-config",
              state: "succeeded",
            },
            select: { payload: true },
          })
        : null;
    const needsResync =
      "appliedPolicyId" in metrics &&
      previous.appliedVersion > 0 &&
      (!observedPolicy ||
        metrics.appliedConfigVersion !== previous.appliedVersion ||
        this.policyHash(
          JSON.parse(this.box.open(observedPolicy.payload)).users || [],
        ) !== previous.policyHash);
    await this.db.nodifyServer.update({
      where: { id },
      data: {
        lastSeenAt: new Date(),
        metrics: json(metrics),
        ...(needsResync ? { policyHash: "" } : {}),
        ...(typeof metrics.version === "string"
          ? { version: metrics.version.slice(0, 80) }
          : {}),
      },
    });
    return this.pendingOperations(id);
  }
  async pendingOperations(id: string) {
    await this.db.nodifyOperation.updateMany({
      where: {
        serverId: id,
        state: { in: ["queued", "running"] },
        expiresAt: { lt: new Date() },
      },
      data: {
        state: "failed",
        message: "Operation timed out; inspect the server before retrying",
        finishedAt: new Date(),
      },
    });
    const operations = await this.db.nodifyOperation.findMany({
      where: {
        serverId: id,
        state: { in: ["queued", "running"] },
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "asc" },
      take: 10,
    });
    await this.db.nodifyOperation.updateMany({
      where: { id: { in: operations.map((o) => o.id) }, state: "queued" },
      data: { state: "running" },
    });
    return operations.map(({ payload, ...operation }) => ({
      ...operation,
      payload: JSON.parse(this.box.open(payload)),
    }));
  }
  async operation(
    serverId: string,
    kind: string,
    payload: unknown,
    minutes = 10,
  ) {
    if (!(await this.db.nodifyServer.findUnique({ where: { id: serverId } })))
      throw new NotFoundException("Server not found");
    const id = randomUUID();
    const createdAt = new Date();
    const value =
      kind === "apply-config"
        ? {
            ...(payload as object),
            policyId: id,
            policyReceipt: issueTrafficPolicy(
              this.box,
              serverId,
              id,
              createdAt,
              (payload as { users?: RuntimeUser[] }).users || [],
            ),
          }
        : payload;
    const op = await this.db.nodifyOperation.create({
      data: {
        id,
        serverId,
        kind,
        createdAt,
        payload: this.box.seal(JSON.stringify(value)),
        expiresAt: new Date(Date.now() + minutes * 60000),
      },
    });
    return { id: op.id, state: op.state };
  }
  async operations(serverId?: string) {
    return (
      await this.db.nodifyOperation.findMany({
        where: serverId ? { serverId } : {},
        omit: { payload: true, leaseOwner: true, localKey: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      })
    ).map(operationView);
  }
  async complete(
    serverId: string,
    id: string,
    state: "succeeded" | "failed",
    message: string,
    result: unknown,
  ) {
    await this.db.$transaction(async (tx) => {
      const op = await tx.nodifyOperation.findFirst({
        where: { id, serverId },
      });
      if (!op) throw new NotFoundException();
      if (["succeeded", "failed"].includes(op.state)) return;
      const payload = JSON.parse(this.box.open(op.payload));
      let storedPayload: string | undefined;
      if (
        op.kind === "website-files" &&
        result &&
        typeof result === "object" &&
        "data" in result
      ) {
        const { data, ...metadata } = result as Record<string, unknown>;
        if (typeof data !== "string" || data.length > 1400000)
          throw new BadRequestException("Invalid file result");
        if (payload.action !== "read")
          throw new BadRequestException("Unexpected file content");
        storedPayload = this.box.seal(
          JSON.stringify({ ...payload, returnedData: data }),
        );
        result = { ...metadata, contentAvailable: true };
      }
      if (op.kind === "rotate-credential" && state === "succeeded")
        await tx.nodifyServer.update({
          where: { id: serverId },
          data: {
            tokenHash: hashToken(payload.credential),
            nextTokenHash: null,
          },
        });
      await tx.nodifyOperation.update({
        where: { id },
        data: {
          state,
          message: message.slice(0, 8000),
          result: json(result),
          ...(storedPayload ? { payload: storedPayload } : {}),
          finishedAt: new Date(),
        },
      });
      if (op.kind === "apply-config") {
        await tx.nodifyConfigRevision.updateMany({
          where: { serverId, version: payload.version },
          data: {
            state: state === "succeeded" ? "applied" : "failed",
            message,
          },
        });
        if (state === "succeeded") {
          await tx.nodifyServer.update({
            where: { id: serverId },
            data: {
              appliedVersion: payload.version,
              policyHash: this.policyHash(payload.users || []),
            },
          });
          const config = ConfigInput.parse(payload.config);
          const kept = config.inbounds.filter((i) => i.protocol !== "tunnel");
          const stale = await tx.nodifyInbound.findMany({
            where: { serverId, id: { notIn: kept.map((i) => i.id) } },
          });
          await tx.hosts.deleteMany({
            where: { uuid: { in: stale.map((i) => i.hostUuid) } },
          });
          const server = await tx.nodifyServer.findUniqueOrThrow({
            where: { id: serverId },
            include: { node: true },
          });
          for (const inbound of kept) {
            const existing = await tx.nodifyInbound.findUnique({
              where: { id: inbound.id },
            });
            if (existing && existing.serverId !== serverId)
              throw new ConflictException("Inbound belongs to another server");
            const host = {
              remark: inbound.name,
              address: server.node.address,
              port: inbound.port,
              isDisabled: !inbound.enabled,
              tags: inbound.tags,
              sni: inbound.serverName,
            };
            if (existing) {
              await tx.hosts.updateMany({
                where: { uuid: existing.hostUuid },
                data: host,
              });
              await tx.nodifyInbound.update({
                where: { id: inbound.id },
                data: { config: json(inbound) },
              });
            } else
              await tx.nodifyInbound.create({
                data: {
                  id: inbound.id,
                  server: { connect: { id: serverId } },
                  config: json(inbound),
                  host: { create: host },
                },
              });
          }
        }
      }
      if (op.kind === "website") {
        const site = await tx.nodifyWebsite.findFirst({
          where: { id: payload.id, serverId, operationId: op.id },
        });
        if (site) {
          if (state === "succeeded" && payload.remove)
            await tx.nodifyWebsite.delete({ where: { id: site.id } });
          else
            await tx.nodifyWebsite.update({
              where: { id: site.id },
              data:
                state === "succeeded"
                  ? {
                      state:
                        site.version === payload.version ? "applied" : "draft",
                      appliedVersion: payload.version,
                      appliedDeployment: payload.deployment,
                      appliedConfig: json({
                        ...WebsiteInput.parse(payload),
                        certificateFingerprint: payload.certificate
                          ? hashToken(payload.certificate.certPem)
                          : "",
                      }),
                    }
                  : { state: "failed" },
            });
        }
      }
    });
    return { acknowledged: true };
  }
  async revisions(serverId: string) {
    return this.db.nodifyConfigRevision.findMany({
      where: { serverId },
      orderBy: { version: "desc" },
    });
  }
  async sharedProfiles() {
    const definitions = await this.db.nodifySetting.findMany({
      where: { key: { startsWith: "config.profile." } },
    });
    const servers = await this.db.nodifyServer.findMany({
      include: { node: true },
    });
    return definitions.map((row) => {
      const id = row.key.slice("config.profile.".length);
      return {
        id,
        ...JSON.parse(this.box.open(row.value)),
        servers: servers
          .filter((s) => s.node.activeConfigProfileUuid === id)
          .map((s) => ({ id: s.id, name: s.node.name })),
      };
    });
  }
  async saveSharedProfile(
    name: string,
    body: unknown,
    id: string = randomUUID(),
  ) {
    const config = ConfigInput.parse(body),
      value = this.box.seal(JSON.stringify({ name, config }));
    await this.db.$transaction(async (tx) => {
      const native = json(compileConfiguration(config, []).xray);
      await tx.configProfiles.upsert({
        where: { uuid: id },
        create: { uuid: id, name, config: native },
        update: { name, config: native },
        select: { uuid: true },
      });
      await tx.nodifySetting.upsert({
        where: { key: `config.profile.${id}` },
        create: { key: `config.profile.${id}`, value },
        update: { value },
      });
    });
    return { id };
  }
  async bindProfile(serverId: string, profileId: string | null) {
    if (
      profileId &&
      !(await this.db.nodifySetting.findUnique({
        where: { key: `config.profile.${profileId}` },
      }))
    )
      throw new NotFoundException("Shared profile not found");
    const server = await this.db.nodifyServer.findUniqueOrThrow({
      where: { id: serverId },
    });
    await this.db.nodes.updateMany({
      where: { uuid: server.nodeUuid },
      data: { activeConfigProfileUuid: profileId },
    });
    return { bound: profileId };
  }
  async publishProfile(id: string) {
    const profile = (await this.sharedProfiles()).find((p) => p.id === id);
    if (!profile) throw new NotFoundException();
    const results = [];
    for (const server of profile.servers) {
      try {
        const config = ConfigInput.parse(profile.config);
        const inboundIds: Record<string, string> = {};
        config.inbounds = config.inbounds.map((inbound) => {
          const hex = hashToken(`${server.id}:${inbound.id}`).split("");
          hex[12] = "4";
          hex[16] = "8";
          const value = hex.join("");
          const id = `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
          inboundIds[inbound.id] = id;
          return {
            ...inbound,
            id,
          };
        });
        if (config.xray.routing)
          config.xray.routing = remapInboundReferences(
            config.xray.routing,
            inboundIds,
          );
        if (config.singbox.route)
          config.singbox.route = remapInboundReferences(
            config.singbox.route,
            inboundIds,
          );
        const draft = await this.saveDraft(server.id, config);
        results.push({
          serverId: server.id,
          ...(await this.apply(server.id, draft.version)),
        });
      } catch (error) {
        results.push({
          serverId: server.id,
          error: error instanceof Error ? error.message : "Publish failed",
        });
      }
    }
    return results;
  }
  async saveDraft(serverId: string, body: unknown) {
    const config = ConfigInput.parse(body);
    const conflicts = await this.db.nodifyInbound.count({
      where: {
        id: { in: config.inbounds.map((i) => i.id) },
        serverId: { not: serverId },
      },
    });
    if (conflicts)
      throw new ConflictException("Inbound id belongs to another server");
    return this.db.$transaction(async (tx) => {
      const server = await tx.nodifyServer.findUnique({
        where: { id: serverId },
      });
      if (!server) throw new NotFoundException();
      const last = await tx.nodifyConfigRevision.aggregate({
        where: { serverId },
        _max: { version: true },
      });
      return tx.nodifyConfigRevision.create({
        data: {
          serverId,
          version: (last._max.version ?? 0) + 1,
          config: json(config),
        },
      });
    });
  }
  async runtimeUsers(config: TConfig, serverMultiplier = 1) {
    const entitlements = await this.db.nodifyEntitlement.findMany({
      include: { user: true },
    });
    const users: RuntimeUser[] = [];
    for (const e of entitlements) {
      const p = PackageInput.parse(e.snapshot);
      if (
        e.user.status !== "ACTIVE" ||
        e.user.expireAt.getTime() <= Date.now() ||
        (BigInt(p.trafficLimitBytes) > 0n &&
          e.usedBytes >= BigInt(p.trafficLimitBytes))
      )
        continue;
      if (!config.inbounds.some((i) => allowed(i, p))) continue;
      users.push({
        id: e.userId.toString(),
        uuid: e.user.vlessUuid,
        password: e.user.trojanPassword,
        ssPassword: e.user.ssPassword,
        anytlsPassword: this.box.open(e.anytlsPassword),
        expiresAt: e.user.expireAt.toISOString(),
        generation: e.generation,
        direction: p.direction,
        multiplier: p.multiplier * serverMultiplier,
        remainingBytes:
          BigInt(p.trafficLimitBytes) === 0n
            ? "-1"
            : (BigInt(p.trafficLimitBytes) - e.usedBytes).toString(),
        nodeIds: p.nodeIds,
        tags: p.tags,
      });
    }
    return users;
  }
  async apply(
    serverId: string,
    version: number,
    commit?: <T>(
      work: (tx: Prisma.TransactionClient) => Promise<T>,
    ) => Promise<T>,
  ) {
    const row = await this.db.nodifyConfigRevision.findUnique({
      where: { serverId_version: { serverId, version } },
    });
    if (!row) throw new NotFoundException();
    if (
      await this.db.nodifyOperation.count({
        where: {
          serverId,
          kind: "apply-config",
          state: { in: ["queued", "running"] },
        },
      })
    )
      throw new ConflictException("Configuration is already being applied");
    const config = ConfigInput.parse(row.config);
    const server = await this.db.nodifyServer.findUniqueOrThrow({
      where: { id: serverId },
      include: { node: true },
    });
    const users = await this.runtimeUsers(
      config,
      Number(server.node.consumptionMultiplier) / 1e9,
    );
    const ids = [
      ...new Set(
        config.inbounds
          .filter((i) => i.enabled && i.security === "tls")
          .flatMap((i) => (i.certificateId ? [i.certificateId] : [])),
      ),
    ];
    const certificates = await this.db.nodifyCertificate.findMany({
      where: { id: { in: ids } },
    });
    if (certificates.length !== ids.length)
      throw new BadRequestException("Certificate not found");
    if (certificates.some((c) => c.expiresAt.getTime() <= Date.now()))
      throw new BadRequestException("Certificate expired");
    for (const inbound of config.inbounds.filter(
      (i) => i.enabled && i.security === "tls",
    )) {
      const certificate = new X509Certificate(
          certificates.find((c) => c.id === inbound.certificateId)!.certPem,
        ),
        name = inbound.serverName || server.node.address;
      if (
        !(isIP(name) ? certificate.checkIP(name) : certificate.checkHost(name))
      )
        throw new BadRequestException(`Certificate does not cover ${name}`);
    }
    const payload = {
      version,
      ...compileConfiguration(config, users),
      certificates: certificates.map((c) => ({
        id: c.id,
        certPem: c.certPem,
        keyPem: this.box.open(c.encryptedKey),
      })),
    };
    const write =
      commit ||
      (<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
        this.db.$transaction(work));
    return write(async (tx) => {
      if (
        await tx.nodifyOperation.count({
          where: {
            serverId,
            kind: "apply-config",
            state: { in: ["queued", "running"] },
          },
        })
      )
        throw new ConflictException("Configuration is already being applied");
      const id = randomUUID();
      const createdAt = new Date();
      const result = await tx.nodifyOperation.create({
        data: {
          id,
          serverId,
          kind: "apply-config",
          createdAt,
          payload: this.box.seal(
            JSON.stringify({
              ...payload,
              policyId: id,
              policyReceipt: issueTrafficPolicy(
                this.box,
                serverId,
                id,
                createdAt,
                users,
              ),
            }),
          ),
          expiresAt: new Date(Date.now() + 600000),
        },
      });
      await tx.nodifyServer.update({
        where: { id: serverId },
        data: { desiredVersion: version },
      });
      await tx.nodifyConfigRevision.update({
        where: { id: row.id },
        data: { state: "pending" },
      });
      return { id: result.id, state: result.state };
    });
  }
  private policyHash(users: RuntimeUser[]) {
    return hashToken(
      JSON.stringify(users.map(({ remainingBytes, ...user }) => user)),
    );
  }
  async listPackages() {
    return this.db.nodifyPackage.findMany({
      include: { _count: { select: { entitlements: true } } },
    });
  }
  async savePackage(body: unknown, id?: string) {
    const config = PackageInput.parse(body);
    const data = { name: config.name, config: json(config) };
    return id
      ? this.db.nodifyPackage.update({ where: { id }, data })
      : this.db.nodifyPackage.create({ data });
  }
  async assignPackage(userId: string, packageId: string) {
    const pkg = await this.db.nodifyPackage.findUniqueOrThrow({
      where: { id: packageId },
    });
    const p = PackageInput.parse(pkg.config);
    const token = newToken();
    await this.db.$transaction(async (tx) => {
      await tx.users.update({
        where: { id: BigInt(userId) },
        data: {
          expireAt: new Date(Date.now() + p.validDays * 86400000),
          status: "ACTIVE",
          trafficLimitBytes: BigInt(p.trafficLimitBytes),
          hwidDeviceLimit: p.deviceLimit || null,
        },
      });
      const data = {
        packageId,
        snapshot: json(p),
        tokenHash: hashToken(token),
        encryptedToken: this.box.seal(token),
        anytlsPassword: this.box.seal(newToken()),
        usedBytes: 0n,
        uploadBytes: 0n,
        downloadBytes: 0n,
        nextResetAt: p.resetDays
          ? new Date(Date.now() + p.resetDays * 86400000)
          : null,
      };
      await tx.nodifyEntitlement.upsert({
        where: { userId: BigInt(userId) },
        create: { userId: BigInt(userId), ...data },
        update: { ...data, generation: { increment: 1 } },
      });
    });
    await this.reconcile();
    return {
      subscriptionUrl: `${await this.publishedUrl('subscription')}/api/sub/${token}`,
      pageUrl: `${await this.publishedUrl('subscription')}/subscription/${token}`,
    };
  }
  async createMember(body: unknown) {
    const input = MemberInput.parse(body),
      publicUrl = await this.publishedUrl('subscription'),
      token = newToken();
    await this.db.$transaction(async (tx) => {
      const pkg = await tx.nodifyPackage.findUniqueOrThrow({
          where: { id: input.packageId },
        }),
        p = PackageInput.parse(pkg.config);
      const user = await tx.users.create({
        data: {
          username: input.username,
          shortUuid: newToken().slice(0, 16),
          vlessUuid: randomUUID(),
          trojanPassword: newToken(),
          ssPassword: newToken(),
          traffic: { create: {} },
          expireAt: new Date(Date.now() + p.validDays * 86400000),
          trafficLimitBytes: BigInt(p.trafficLimitBytes),
          hwidDeviceLimit: p.deviceLimit || null,
        },
      });
      await tx.nodifyEntitlement.create({
        data: {
          userId: user.id,
          packageId: pkg.id,
          snapshot: json(p),
          tokenHash: hashToken(token),
          encryptedToken: this.box.seal(token),
          anytlsPassword: this.box.seal(newToken()),
          nextResetAt: p.resetDays
            ? new Date(Date.now() + p.resetDays * 86400000)
            : null,
        },
      });
    });
    await this.reconcile();
    return { pageUrl: `${publicUrl}/subscription/${token}` };
  }
  async memberAction(userId: string, body: unknown) {
    const input = MemberAction.parse(body);
    const e = await this.db.nodifyEntitlement.findUniqueOrThrow({
      where: { userId: BigInt(userId) },
      include: { user: true },
    });
    await this.db.users.update({
      where: { id: e.userId },
      data: {
        status: input.action === "disable" ? "DISABLED" : "ACTIVE",
        ...(input.action === "renew"
          ? {
              expireAt: new Date(
                Math.max(Date.now(), e.user.expireAt.getTime()) +
                  input.days * 86400000,
              ),
            }
          : {}),
      },
    });
    await this.reconcile();
    return { updated: true };
  }
  async entitlements() {
    const servers = await this.db.nodifyServer.findMany({
      include: {
        node: true,
        inbounds: true,
        operations: {
          where: { kind: "apply-config" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
    const rows = await this.db.nodifyEntitlement.findMany({
      include: {
        user: { select: { username: true, status: true, expireAt: true } },
        package: true,
      },
    });
    const subscriptionUrl = await this.publishedUrl('subscription');
    return rows.map(({ tokenHash, encryptedToken, anytlsPassword, ...e }) => ({
      ...e,
      pendingServers: servers
        .filter(
          (s) =>
            s.inbounds.some((i) =>
              allowed(i.config as TInbound, PackageInput.parse(e.snapshot)),
            ) &&
            (!s.lastSeenAt ||
              Date.now() - s.lastSeenAt.getTime() > 45000 ||
              s.desiredVersion !== s.appliedVersion ||
              s.operations[0]?.state !== "succeeded"),
        )
        .map((s) => s.node.name),
      pageUrl: `${subscriptionUrl}/subscription/${this.box.open(encryptedToken)}`,
    }));
  }
  async resetEntitlement(userId: string) {
    await this.db.nodifyEntitlement.update({
      where: { userId: BigInt(userId) },
      data: {
        usedBytes: 0n,
        uploadBytes: 0n,
        downloadBytes: 0n,
        generation: { increment: 1 },
      },
    });
    await this.reconcile();
    return { reset: true };
  }
  async syncPackage(packageId: string) {
    const pkg = await this.db.nodifyPackage.findUniqueOrThrow({
      where: { id: packageId },
    });
    const p = PackageInput.parse(pkg.config);
    const count = await this.db.$transaction(async (tx) => {
      const members = await tx.nodifyEntitlement.findMany({
        where: { packageId },
      });
      for (const member of members) {
        const previous = PackageInput.parse(member.snapshot);
        await tx.nodifyEntitlement.update({
          where: { id: member.id },
          data: {
            snapshot: json(p),
            ...(previous.resetDays !== p.resetDays
              ? {
                  nextResetAt: p.resetDays
                    ? new Date(Date.now() + p.resetDays * 86400000)
                    : null,
                }
              : {}),
          },
        });
        await tx.users.updateMany({
          where: { id: member.userId },
          data: {
            trafficLimitBytes: BigInt(p.trafficLimitBytes),
            hwidDeviceLimit: p.deviceLimit || null,
          },
        });
      }
      return members.length;
    });
    await this.reconcile();
    return { updated: count };
  }
  async deleteWebsite(serverId: string, id: string) {
    return this.queueWebsite(serverId, id, undefined, true);
  }
  async revokeSubscription(userId: string) {
    const token = newToken();
    await this.db.$transaction(async (tx) => {
      await tx.nodifyEntitlement.update({
        where: { userId: BigInt(userId) },
        data: {
          tokenHash: hashToken(token),
          encryptedToken: this.box.seal(token),
          anytlsPassword: this.box.seal(newToken()),
        },
      });
      await tx.users.update({
        where: { id: BigInt(userId) },
        data: {
          vlessUuid: randomUUID(),
          trojanPassword: newToken(),
          ssPassword: newToken(),
          subRevokedAt: new Date(),
        },
      });
      await tx.hwidUserDevices.deleteMany({
        where: { userId: BigInt(userId) },
      });
    });
    await this.reconcile();
    return { pageUrl: `${await this.publishedUrl('subscription')}/subscription/${token}` };
  }
  async traffic(serverId: string, body: unknown) {
    const batch = TrafficBatch.parse(body);
    try {
      await this.db.$transaction(
        async (tx) => {
          const operation = await tx.nodifyOperation.findFirst({
            where: { id: batch.policyId, serverId, kind: "apply-config" },
          });
          let policy: {
            users: Pick<
              RuntimeUser,
              "id" | "generation" | "direction" | "multiplier"
            >[];
          };
          let policyCreatedAt: Date;
          if (operation) {
            policy = JSON.parse(this.box.open(operation.payload));
            policyCreatedAt = operation.createdAt;
          } else {
            // An offline restore can remove operations issued after the snapshot.
            // The Agent retains a master-authenticated, server-bound billing receipt.
            const key = `traffic.policy.${serverId}.${batch.policyId}`;
            const archived = await tx.nodifySetting.findUnique({
              where: { key },
            });
            const receipt = archived?.value || batch.policyReceipt;
            if (!receipt)
              throw new BadRequestException("Unknown traffic policy");
            const recovered = readTrafficPolicy(
              this.box,
              receipt,
              serverId,
              batch.policyId,
            );
            policy = recovered;
            policyCreatedAt = recovered.issuedAt;
            if (!archived)
              await tx.nodifySetting.upsert({
                where: { key },
                create: { key, value: receipt },
                update: {},
              });
          }
          const timestamp = accountingTime(batch.collectedAt, policyCreatedAt);
          await tx.nodifyTrafficBatch.create({
            data: {
              serverId,
              session: batch.session,
              sequence: BigInt(batch.sequence),
              ...timestamp,
            },
          });
          const server = await tx.nodifyServer.findUniqueOrThrow({
            where: { id: serverId },
          });
          const previous = server.protocolTraffic as Record<string, string>;
          const now = new Date().toISOString();
          const rawUpload = batch.users.reduce(
            (sum, user) => sum + BigInt(user.upload),
            0n,
          );
          const rawDownload = batch.users.reduce(
            (sum, user) => sum + BigInt(user.download),
            0n,
          );
          await tx.nodifyServer.update({
            where: { id: serverId },
            data: {
              protocolTraffic: {
                upload: (BigInt(previous.upload || "0") + rawUpload).toString(),
                download: (
                  BigInt(previous.download || "0") + rawDownload
                ).toString(),
                startedAt: previous.startedAt || now,
                updatedAt: now,
              },
              ledgerStartedAt: server.ledgerStartedAt ?? new Date(now),
            },
          });
          const ledger = new Map<string, ReturnType<typeof zeroIncrement>>();
          for (const u of batch.users) {
            const increment = ledger.get(u.userId) ?? zeroIncrement();
            ledger.set(u.userId, increment);
            const upload = BigInt(u.upload),
              download = BigInt(u.download);
            increment.upload += upload;
            increment.download += download;
            const tariff = policy.users?.find((user) => user.id === u.userId);
            const rated = tariff
              ? measuredBytes(upload, download, {
                  direction: tariff.direction || "both",
                  multiplier: tariff.multiplier || 1,
                })
              : 0n;
            increment.rated += rated;
            if (!tariff) increment.unratedRaw += upload + download;
            const row = await tx.nodifyEntitlement.findUnique({
              where: { userId: BigInt(u.userId) },
            });
            if (!row) {
              increment.unchargedRaw += upload + download;
              continue;
            }
            if (!tariff || (tariff.generation || 0) !== row.generation) {
              increment.unchargedRaw += upload + download;
              continue;
            }
            const charged = rated;
            increment.charged += charged;
            await tx.nodifyEntitlement.update({
              where: { id: row.id },
              data: {
                usedBytes: { increment: charged },
                uploadBytes: { increment: upload },
                downloadBytes: { increment: download },
              },
            });
          }
          const total = zeroIncrement();
          for (const [userId, increment] of ledger) {
            await addDaily(
              tx,
              serverId,
              timestamp.accountingDay,
              userId,
              increment,
              timestamp.timeSource !== "collected",
            );
            for (const key of [
              "upload",
              "download",
              "charged",
              "rated",
              "unratedRaw",
              "unchargedRaw",
            ] as const)
              total[key] += increment[key];
          }
          await addDaily(
            tx,
            serverId,
            timestamp.accountingDay,
            "",
            total,
            timestamp.timeSource !== "collected",
          );
        },
        { maxWait: 5000, timeout: 25000 },
      );
    } catch (e) {
      if (!(
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002" &&
        (await this.db.nodifyTrafficBatch.findUnique({
          where: {
            serverId_session_sequence: {
              serverId,
              session: batch.session,
              sequence: BigInt(batch.sequence),
            },
          },
        }))
      ))
        throw e;
    }
    return { acknowledged: batch.sequence };
  }
  async network(serverId: string, body: unknown) {
    return new NetworkAccounting(this).ingest(serverId, body);
  }
  certificateData(body: unknown) {
    const input = CertificateUpload.parse(body);
    let cert: X509Certificate;
    try {
      cert = new X509Certificate(input.certPem);
      if (!cert.checkPrivateKey(createPrivateKey(input.keyPem)))
        throw new Error();
    } catch {
      throw new BadRequestException("Certificate and private key do not match");
    }
    if (Date.parse(cert.validTo) <= Date.now())
      throw new BadRequestException("Certificate expired");
    const domains = (cert.subjectAltName ?? "")
      .split(", ")
      .filter((v) => v.startsWith("DNS:"))
      .map((v) => v.slice(4));
    return {
      name: input.name,
      domains,
      certPem: input.certPem,
      encryptedKey: this.box.seal(input.keyPem),
      expiresAt: new Date(cert.validTo),
    };
  }
  async uploadCertificate(body: unknown) {
    const row = await this.db.nodifyCertificate.create({
      data: this.certificateData(body),
    });
    return {
      id: row.id,
      name: row.name,
      domains: row.domains,
      expiresAt: row.expiresAt,
    };
  }
  async certificates() {
    return this.db.nodifyCertificate.findMany({
      omit: { encryptedKey: true, encryptedAccount: true, certPem: true },
    });
  }
  async listWebsites(serverId: string) {
    const sites = await this.db.nodifyWebsite.findMany({
      where: { serverId },
      include: { revisions: { orderBy: { version: "desc" } } },
      orderBy: { domain: "asc" },
    });
    return Promise.all(
      sites.map(async (site) => {
        const operation = site.operationId
          ? await this.db.nodifyOperation.findUnique({
              where: { id: site.operationId },
              omit: { payload: true },
            })
          : null;
        const state =
          ["pending", "deleting"].includes(site.state) &&
          operation &&
          (operation.state === "failed" ||
            (["queued", "running"].includes(operation.state) &&
              operation.expiresAt <= new Date()))
            ? "failed"
            : site.state;
        return {
          ...site,
          state,
          operation: operation ? operationView(operation) : null,
        };
      }),
    );
  }
  private async websiteBusy(
    tx: Prisma.TransactionClient,
    operationId: string | null,
  ) {
    if (!operationId) return;
    const operation = await tx.nodifyOperation.findUnique({
      where: { id: operationId },
    });
    if (
      operation &&
      ["queued", "running"].includes(operation.state) &&
      operation.expiresAt > new Date()
    )
      throw new ConflictException("网站任务正在执行，请等待确认或超时后重试");
  }
  private async websiteConflicts(
    tx: Prisma.TransactionClient,
    serverId: string,
    id: string,
    input: ReturnType<typeof WebsiteInput.parse>,
  ) {
    const sites = await tx.nodifyWebsite.findMany({
      where: { serverId, id: { not: id } },
    });
    for (const site of sites)
      for (const value of [site.config, site.appliedConfig]) {
        if (!value) continue;
        const other = WebsiteInput.parse(value);
        if (
          [other.domain, ...other.aliases].some((name) =>
            [input.domain, ...input.aliases].includes(name),
          )
        )
          throw new ConflictException(
            "域名仍被另一个网站的草稿或已生效配置使用",
          );
        if (
          other.enabled &&
          input.enabled &&
          ((input.certificateId && input.httpsPort === other.httpPort) ||
            (other.certificateId && other.httpsPort === input.httpPort))
        )
          throw new ConflictException("HTTP 与 HTTPS 服务不能共用同一监听端口");
      }
  }
  async saveWebsiteDraft(serverId: string, body: unknown, id?: string) {
    const input = WebsiteInput.parse(body);
    input.domain = input.domain.toLowerCase();
    return this.db.$transaction(async (tx) => {
      await tx.nodifyServer.findUniqueOrThrow({ where: { id: serverId } });
      const existing = id
        ? await tx.nodifyWebsite.findFirstOrThrow({ where: { id, serverId } })
        : null;
      await this.websiteBusy(tx, existing?.operationId ?? null);
      const websiteId = existing?.id ?? randomUUID(),
        version = (existing?.version ?? 0) + 1;
      await this.websiteConflicts(tx, serverId, websiteId, input);
      if (input.certificateId) {
        const certificate = await tx.nodifyCertificate.findUniqueOrThrow({
          where: { id: input.certificateId },
        });
        if (
          [input.domain, ...input.aliases].some(
            (name) => !new X509Certificate(certificate.certPem).checkHost(name),
          )
        )
          throw new BadRequestException("证书未覆盖网站域名");
      }
      const site = existing
        ? await tx.nodifyWebsite.update({
            where: { id: websiteId },
            data: {
              domain: input.domain,
              config: json(input),
              version,
              state: "draft",
            },
          })
        : await tx.nodifyWebsite.create({
            data: {
              id: websiteId,
              serverId,
              domain: input.domain,
              config: json(input),
              version,
              state: "draft",
            },
          });
      await tx.nodifyWebsiteRevision.create({
        data: { websiteId, version, config: json(input) },
      });
      return site;
    });
  }
  async publishWebsite(
    serverId: string,
    id: string,
    version?: number,
    commit?: <T>(
      work: (tx: Prisma.TransactionClient) => Promise<T>,
    ) => Promise<T>,
  ) {
    return this.queueWebsite(serverId, id, version, false, commit);
  }
  private async queueWebsite(
    serverId: string,
    id: string,
    version: number | undefined,
    remove: boolean,
    commit?: <T>(
      work: (tx: Prisma.TransactionClient) => Promise<T>,
    ) => Promise<T>,
  ) {
    const write =
      commit ||
      (<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
        this.db.$transaction(work));
    return write(async (tx) => {
      const site = await tx.nodifyWebsite.findFirstOrThrow({
        where: { id, serverId },
      });
      await this.websiteBusy(tx, site.operationId);
      const revision = await tx.nodifyWebsiteRevision.findUniqueOrThrow({
        where: {
          websiteId_version: {
            websiteId: id,
            version: version ?? site.version,
          },
        },
      });
      const input = WebsiteInput.parse(revision.config);
      if (!remove) await this.websiteConflicts(tx, serverId, id, input);
      let certificate;
      if (!remove && input.certificateId) {
        const c = await tx.nodifyCertificate.findUniqueOrThrow({
          where: { id: input.certificateId },
        });
        if (
          [input.domain, ...input.aliases].some(
            (name) => !new X509Certificate(c.certPem).checkHost(name),
          )
        )
          throw new BadRequestException("证书未覆盖网站域名");
        certificate = {
          id: c.id,
          certPem: c.certPem,
          keyPem: this.box.open(c.encryptedKey),
        };
      }
      const operationId = randomUUID(),
        deployment = site.deployment + 1;
      const payload = {
        ...input,
        id,
        version: revision.version,
        deployment,
        remove,
        certificate,
      };
      const operation = await tx.nodifyOperation.create({
        data: {
          id: operationId,
          serverId,
          kind: "website",
          payload: this.box.seal(JSON.stringify(payload)),
          expiresAt: new Date(Date.now() + 600000),
        },
      });
      await tx.nodifyWebsite.update({
        where: { id },
        data: {
          operationId,
          deployment,
          state: remove ? "deleting" : "pending",
        },
      });
      return { id: operation.id, state: operation.state, websiteId: id };
    });
  }
  async saveWebsite(serverId: string, body: unknown) {
    const input = WebsiteInput.parse(body);
    const existing = await this.db.nodifyWebsite.findUnique({
      where: {
        serverId_domain: { serverId, domain: input.domain.toLowerCase() },
      },
    });
    const site = await this.saveWebsiteDraft(serverId, input, existing?.id);
    return this.publishWebsite(serverId, site.id, site.version);
  }
  async reconcile() {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      await this.db.nodifyOperation.updateMany({
        where: {
          executor: { not: "local" },
          state: { in: ["queued", "running"] },
          expiresAt: { lt: new Date() },
        },
        data: {
          state: "failed",
          message: "Operation timed out; inspect the server before retrying",
          finishedAt: new Date(),
        },
      });
      const due = await this.db.nodifyEntitlement.findMany({
        where: { nextResetAt: { lte: new Date() } },
      });
      for (const e of due) {
        const p = PackageInput.parse(e.snapshot);
        const period = p.resetDays * 86400000;
        const next = period
          ? new Date(
              e.nextResetAt!.getTime() +
                (Math.floor((Date.now() - e.nextResetAt!.getTime()) / period) +
                  1) *
                  period,
            )
          : null;
        await this.db.nodifyEntitlement.updateMany({
          where: { id: e.id, nextResetAt: e.nextResetAt },
          data: {
            usedBytes: 0n,
            uploadBytes: 0n,
            downloadBytes: 0n,
            nextResetAt: next,
            generation: { increment: 1 },
          },
        });
      }
      const servers = await this.db.nodifyServer.findMany({
        include: { node: true },
        where: { appliedVersion: { gt: 0 }, tokenHash: { not: null } },
      });
      for (const server of servers) {
        const revision = await this.db.nodifyConfigRevision.findUnique({
          where: {
            serverId_version: {
              serverId: server.id,
              version: server.appliedVersion,
            },
          },
        });
        if (!revision) continue;
        const users = await this.runtimeUsers(
          ConfigInput.parse(revision.config),
          Number(server.node.consumptionMultiplier) / 1e9,
        );
        const fingerprint = this.policyHash(users);
        if (fingerprint !== server.policyHash) {
          if (
            await this.db.nodifyOperation.count({
              where: {
                serverId: server.id,
                kind: "apply-config",
                state: { in: ["queued", "running"] },
              },
            })
          )
            continue;
          const recentFailure = await this.db.nodifyOperation.findFirst({
            where: {
              serverId: server.id,
              kind: "apply-config",
              state: "failed",
              finishedAt: { gt: new Date(Date.now() - 60000) },
            },
            orderBy: { createdAt: "desc" },
          });
          if (recentFailure) {
            const failed = JSON.parse(this.box.open(recentFailure.payload));
            // A failed draft or an older user policy must not delay revocation.
            if (
              failed.version === server.appliedVersion &&
              this.policyHash(failed.users || []) === fingerprint
            )
              continue;
          }
          try {
            await this.apply(server.id, server.appliedVersion);
          } catch (error) {
            this.logger.warn(
              `Policy sync pending for ${server.id}: ${error instanceof Error ? error.message : "unknown failure"}`,
            );
          }
        }
      }
      await this.reconcileWebsites();
    } finally {
      this.reconciling = false;
    }
  }
  private async reconcileWebsites() {
    const sites = await this.db.nodifyWebsite.findMany({
      where: {
        appliedVersion: { gt: 0 },
        server: {
          tokenHash: { not: null },
          lastSeenAt: { gt: new Date(Date.now() - 90000) },
        },
      },
      include: { server: true },
    });
    for (const site of sites) {
      const metrics = site.server.metrics as Record<string, any>;
      const applied = site.appliedConfig as Record<string, any> | null;
      if (!applied) continue;
      const certificate = applied.certificateId
        ? await this.db.nodifyCertificate.findUnique({
            where: { id: applied.certificateId },
            select: { certPem: true },
          })
        : null;
      const changedCertificate =
        certificate &&
        hashToken(certificate.certPem) !== applied.certificateFingerprint;
      const missingDeployment =
        metrics?.websiteDeployments &&
        metrics.websiteDeployments[site.id] !== site.appliedDeployment;
      if (!changedCertificate && !missingDeployment) continue;
      const operation = site.operationId
        ? await this.db.nodifyOperation.findUnique({
            where: { id: site.operationId },
          })
        : null;
      if (
        operation &&
        ["queued", "running"].includes(operation.state) &&
        operation.expiresAt > new Date()
      )
        continue;
      if (
        operation?.state === "failed" &&
        operation.finishedAt &&
        operation.finishedAt.getTime() > Date.now() - 60000
      )
        continue;
      try {
        await this.publishWebsite(site.serverId, site.id, site.appliedVersion);
      } catch (error) {
        this.logger.warn(
          `Website sync pending for ${site.id}: ${error instanceof Error ? error.message : "unknown failure"}`,
        );
      }
    }
  }
}
