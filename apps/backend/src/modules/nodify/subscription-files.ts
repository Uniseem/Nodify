import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import {
  Inbound,
  PackageInput,
  SubscriptionFileCreate,
  SubscriptionFileUpdate,
} from "@nodify/contract";
import { Prisma } from "@prisma/client";
import { NodifyService } from "./nodify.service";
import { TrafficAccounting } from "./traffic-accounting";
import { hashToken, newToken } from "./crypto";
import { sourceNodes } from "./source-nodes";
import { allowed } from "./configuration";
import { fileTraffic } from "./traffic-display";

type DB = Prisma.TransactionClient;
async function nodesFor(db: DB, snapshot: unknown) {
  const entitlement = PackageInput.parse(snapshot);
  const managed = await db.nodifyInbound.findMany({
    include: { host: true },
    orderBy: { host: { viewPosition: "asc" } },
  });
  const nodes: {
    id: string;
    name: string;
    tags: string[];
    external: boolean;
  }[] = [];
  for (const row of managed) {
    const inbound = Inbound.parse(row.config);
    if (
      inbound.enabled &&
      !row.host.isDisabled &&
      allowed(inbound, entitlement)
    )
      nodes.push({
        id: inbound.id,
        name: row.host.remark,
        tags: inbound.tags,
        external: false,
      });
  }
  for (const source of await db.nodifySubscriptionSource.findMany({
    where: { enabled: true },
  }))
    for (const node of sourceNodes(source))
      if (
        node.enabled &&
        (entitlement.nodeIds.includes(node.id) ||
          node.tags.some((tag: string) => entitlement.tags.includes(tag)))
      )
        nodes.push({
          id: node.id,
          name: node.name,
          tags: node.tags,
          external: true,
        });
  return nodes;
}
export class SubscriptionFiles {
  constructor(private readonly service: NodifyService) {}
  async options(entitlementId?: string) {
    return this.service.db.$transaction(async (tx) => {
      const entitlement = entitlementId
        ? await tx.nodifyEntitlement.findUnique({
            where: { id: entitlementId },
          })
        : null;
      if (entitlementId && !entitlement)
        throw new NotFoundException("用户权益不存在");
      return {
        servers: await tx.nodifyServer.findMany({
          select: { id: true, node: { select: { name: true } } },
          orderBy: { createdAt: "asc" },
        }),
        entitlements: (
          await tx.nodifyEntitlement.findMany({
            include: { user: { select: { username: true } } },
          })
        ).map((row) => ({ id: row.id, name: row.user.username })),
        templates: await tx.nodifySubscriptionTemplate.findMany({
          select: { id: true, name: true, version: true },
          orderBy: { name: "asc" },
        }),
        ruleSets: await tx.nodifyRuleSet.findMany({
          select: { id: true, name: true, enabled: true },
          orderBy: { position: "asc" },
        }),
        nodes: entitlement ? await nodesFor(tx, entitlement.snapshot) : [],
      };
    });
  }
  async list() {
    return this.service.db.$transaction(async (tx) => {
      const rawServers = await tx.nodifyServer.findMany({
        include: { node: { select: { name: true } } },
      });
      const servers = await new TrafficAccounting(this.service).augment(
        tx,
        rawServers,
      );
      const sources = await tx.nodifySubscriptionSource.findMany();
      const rows = await tx.nodifySubscriptionFile.findMany({
        include: {
          alias: true,
          ruleSets: true,
          template: { select: { name: true } },
          entitlement: {
            include: {
              user: {
                select: { username: true, status: true, expireAt: true },
              },
            },
          },
        },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
      const subscriptionUrl = await this.service.publishedUrl('subscription');
      return rows.map(
        ({
          tokenHash,
          encryptedToken,
          entitlementTokenHash,
          entitlement,
          ruleSets,
          alias,
          ...file
        }) => ({
          ...file,
          trafficSummary: fileTraffic(file, servers, sources),
          alias: alias?.encryptedAlias
            ? this.service.box.open(alias.encryptedAlias)
            : null,
          username: entitlement.user.username,
          ruleSetIds: ruleSets.map((rule) => rule.ruleSetId),
          revoked: entitlementTokenHash !== entitlement.tokenHash,
          userStatus: entitlement.user.status,
          userExpiresAt: entitlement.user.expireAt,
          usedBytes: entitlement.usedBytes.toString(),
          trafficLimitBytes: PackageInput.parse(entitlement.snapshot)
            .trafficLimitBytes,
          pageUrl: `${subscriptionUrl}/subscription/${alias?.encryptedAlias ? "~" + this.service.box.open(alias.encryptedAlias) : this.service.box.open(encryptedToken)}`,
          subscriptionUrl: `${subscriptionUrl}/api/sub/${alias?.encryptedAlias ? "~" + this.service.box.open(alias.encryptedAlias) : this.service.box.open(encryptedToken)}`,
        }),
      );
    });
  }
  async save(body: unknown, id?: string) {
    const input = id
      ? SubscriptionFileUpdate.parse(body)
      : SubscriptionFileCreate.parse(body);
    return this.service.db.$transaction(async (tx) => {
      const existing = id
        ? await tx.nodifySubscriptionFile.findUnique({ where: { id } })
        : null;
      if (
        id &&
        (!existing ||
          existing.version !== SubscriptionFileUpdate.parse(body).version)
      )
        throw new ConflictException(
          "订阅文件已更新或删除，请刷新后重试；编辑内容已保留",
        );
      const entitlementId =
        existing?.entitlementId ||
        SubscriptionFileCreate.parse(body).entitlementId;
      const entitlement = await tx.nodifyEntitlement.findUnique({
        where: { id: entitlementId },
      });
      if (!entitlement) throw new NotFoundException("用户权益不存在");
      if (
        !id &&
        (await tx.nodifySubscriptionFile.count({ where: { entitlementId } })) >=
          50
      )
        throw new BadRequestException("每位用户最多 50 个订阅文件");
      if (
        input.templateId &&
        !(await tx.nodifySubscriptionTemplate.findUnique({
          where: { id: input.templateId },
        }))
      )
        throw new BadRequestException("模板不存在");
      const ruleSetIds = input.ruleMode === "selected" ? input.ruleSetIds : [];
      if (
        (await tx.nodifyRuleSet.count({
          where: { id: { in: ruleSetIds } },
        })) !== ruleSetIds.length
      )
        throw new BadRequestException("选中的规则集已删除");
      const available = new Set(
        (await nodesFor(tx, entitlement.snapshot)).map((node) => node.id),
      );
      if (
        input.nodeMode === "selected" &&
        input.nodeIds.some((node) => !available.has(node))
      )
        throw new BadRequestException(
          "选择的节点不属于该用户当前套餐或已停用，请移除后重试",
        );
      const data = {
        statisticServerIds: input.statisticServerIds,
        name: input.name,
        displayTrafficLimitBytes: input.displayTrafficLimitBytes,
        enabled: input.enabled,
        templateId: input.templateId,
        nodeMode: input.nodeMode,
        nodeIds: input.nodeIds,
        tags: input.tags,
        ruleMode: input.ruleMode,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      };
      let row;
      if (
        (await tx.nodifyServer.count({
          where: { id: { in: input.statisticServerIds } },
        })) !== input.statisticServerIds.length
      )
        throw new BadRequestException("统计服务器已删除，请移除无效选择后保存");
      if (existing) {
        row = await tx.nodifySubscriptionFile.update({
          where: { id: existing.id, version: existing.version },
          data: { ...data, version: { increment: 1 } },
        });
        await tx.nodifySubscriptionFileRule.deleteMany({
          where: { fileId: row.id },
        });
      } else {
        const token = newToken();
        row = await tx.nodifySubscriptionFile.create({
          data: {
            ...data,
            entitlementId,
            entitlementTokenHash: entitlement.tokenHash,
            tokenHash: hashToken(token),
            encryptedToken: this.service.box.seal(token),
          },
        });
      }
      if (ruleSetIds.length)
        await tx.nodifySubscriptionFileRule.createMany({
          data: ruleSetIds.map((ruleSetId) => ({ fileId: row.id, ruleSetId })),
        });
      const currentAlias = await tx.nodifySubscriptionAlias.findUnique({
        where: { fileId: row.id },
      });
      const aliasHash = input.alias ? hashToken(input.alias) : null;
      if (aliasHash !== currentAlias?.hash) {
        if (
          aliasHash &&
          (await tx.nodifySubscriptionAlias.findUnique({
            where: { hash: aliasHash },
          }))
        )
          throw new ConflictException("此短链别名已被使用或撤销，请选择新别名");
        if (currentAlias)
          await tx.nodifySubscriptionAlias.update({
            where: { hash: currentAlias.hash },
            data: { fileId: null, encryptedAlias: null },
          });
        if (aliasHash)
          await tx.nodifySubscriptionAlias.create({
            data: {
              hash: aliasHash,
              fileId: row.id,
              encryptedAlias: this.service.box.seal(input.alias!),
            },
          });
      }
      return { id: row.id, version: row.version };
    });
  }
  async rotate(id: string, version: number) {
    return this.service.db.$transaction(async (tx) => {
      const file = await tx.nodifySubscriptionFile.findUnique({
        where: { id },
        include: { entitlement: true },
      });
      if (!file || file.version !== version)
        throw new ConflictException("订阅文件已改变，请刷新后重试");
      const token = newToken();
      await tx.nodifySubscriptionAlias.updateMany({
        where: { fileId: id },
        data: { fileId: null, encryptedAlias: null },
      });
      await tx.nodifySubscriptionFile.update({
        where: { id, version },
        data: {
          tokenHash: hashToken(token),
          encryptedToken: this.service.box.seal(token),
          entitlementTokenHash: file.entitlement.tokenHash,
          version: { increment: 1 },
        },
      });
      return { rotated: true };
    });
  }
  async remove(id: string, version: number) {
    return this.service.db.$transaction(async (tx) => {
      await tx.nodifySubscriptionAlias.updateMany({
        where: { fileId: id },
        data: { fileId: null, encryptedAlias: null },
      });
      const result = await tx.nodifySubscriptionFile.deleteMany({
        where: { id, version },
      });
      if (!result.count)
        throw new ConflictException("订阅文件已改变，请刷新后重试");
      return { deleted: true };
    });
  }
}
