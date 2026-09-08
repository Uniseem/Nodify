import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import {
  SubscriptionTemplateInput,
  SubscriptionTemplateUpdate,
  TemplateSelectionInput,
  SubscriptionTemplateDocument,
  RuleSetSelection,
} from "@nodify/contract";
import { Prisma } from "@prisma/client";
import { NodifyService } from "./nodify.service";

const key = "subscription.default-template";
async function selection(db: Pick<NodifyService["db"], "nodifySetting">) {
  const row = await db.nodifySetting.findUnique({ where: { key } });
  return row
    ? TemplateSelectionInput.parse(JSON.parse(row.value))
    : { templateId: null, version: 0 };
}
export async function resolveSubscriptionTemplate(
  db: NodifyService["db"],
  templateId?: string | null,
) {
  const current = await selection(db);
  if (templateId || current.templateId) {
    const row = await db.nodifySubscriptionTemplate.findUnique({
      where: { id: (templateId || current.templateId)! },
      include: { ruleSets: true },
    });
    if (!row) throw new NotFoundException("默认订阅模板不存在");
    return {
      ...SubscriptionTemplateDocument.parse(row.document),
      ruleSelection: RuleSetSelection.parse({
        ruleMode: row.ruleMode,
        ruleSetIds: row.ruleSets.map((rule) => rule.ruleSetId),
      }),
    };
  }
  const legacy = await db.nodifySetting.findUnique({
    where: { key: "subscription.settings" },
  });
  return {
    ...(legacy ? JSON.parse(legacy.value) : { mihomo: {}, singbox: {} }),
    ruleSelection: RuleSetSelection.parse({}),
  };
}
export class SubscriptionTemplates {
  constructor(private readonly service: NodifyService) {}
  async list() {
    return this.service.db.$transaction(async (tx) => ({
      items: (
        await tx.nodifySubscriptionTemplate.findMany({
          orderBy: [{ name: "asc" }, { id: "asc" }],
          include: {
            ruleSets: true,
            _count: { select: { subscriptionFiles: true } },
          },
        })
      ).map(({ ruleSets, ...row }) => ({
        ...row,
        ruleSetIds: ruleSets.map((rule) => rule.ruleSetId),
      })),
      ruleSets: await tx.nodifyRuleSet.findMany({
        select: { id: true, name: true, enabled: true, version: true },
        orderBy: [{ position: "asc" }, { id: "asc" }],
      }),
      selection: await selection(tx),
    }));
  }
  async save(body: unknown, id?: string) {
    const input = SubscriptionTemplateInput.parse(body);
    const version = id
      ? SubscriptionTemplateUpdate.parse(body).version
      : undefined;
    return this.service.db.$transaction(async (tx) => {
      const ruleSetIds = input.ruleMode === "selected" ? input.ruleSetIds : [];
      if (
        (await tx.nodifyRuleSet.count({
          where: { id: { in: ruleSetIds } },
        })) !== ruleSetIds.length
      )
        throw new BadRequestException(
          "选中的规则集已删除，请刷新规则列表；当前编辑内容已保留",
        );
      const data = {
        name: input.name,
        document: input.document as Prisma.InputJsonValue,
        ruleMode: input.ruleMode,
      };
      let templateId = id;
      if (!id) {
        if ((await tx.nodifySubscriptionTemplate.count()) >= 100)
          throw new BadRequestException("最多保存 100 个模板");
        templateId = (await tx.nodifySubscriptionTemplate.create({ data })).id;
      } else {
        const result = await tx.nodifySubscriptionTemplate.updateMany({
          where: { id, version },
          data: { ...data, version: { increment: 1 } },
        });
        if (!result.count)
          throw new ConflictException(
            "模板已更新或删除，请重新加载；当前编辑内容已保留",
          );
      }
      await tx.nodifySubscriptionTemplateRule.deleteMany({
        where: { templateId: templateId! },
      });
      if (ruleSetIds.length)
        await tx.nodifySubscriptionTemplateRule.createMany({
          data: ruleSetIds.map((ruleSetId) => ({
            templateId: templateId!,
            ruleSetId,
          })),
        });
      return {
        ...(await tx.nodifySubscriptionTemplate.findUniqueOrThrow({
          where: { id: templateId! },
        })),
        ruleSetIds,
      };
    });
  }
  async select(body: unknown) {
    const input = TemplateSelectionInput.parse(body);
    return this.service.db.$transaction(async (tx) => {
      const current = await selection(tx);
      if (current.version !== input.version)
        throw new ConflictException("默认模板已改变，请刷新后重试");
      if (
        input.templateId &&
        !(await tx.nodifySubscriptionTemplate.findUnique({
          where: { id: input.templateId },
        }))
      )
        throw new NotFoundException("模板不存在");
      const result = {
        templateId: input.templateId,
        version: current.version + 1,
      };
      const value = JSON.stringify(result);
      await tx.nodifySetting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
      return result;
    });
  }
  async remove(id: string, version: number) {
    return this.service.db.$transaction(async (tx) => {
      if ((await selection(tx)).templateId === id)
        throw new ConflictException("请先切换默认模板再删除");
      const result = await tx.nodifySubscriptionTemplate.deleteMany({
        where: { id, version },
      });
      if (!result.count)
        throw new ConflictException("模板已更新或删除，请刷新后重试");
      return { deleted: true };
    });
  }
}
