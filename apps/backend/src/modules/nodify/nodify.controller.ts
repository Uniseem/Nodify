import { WebsiteFiles } from "./website-files";
import { operationView } from "./operation-view";
import {
  NODIFY_VERSION,
  AgentHello,
  OperationResult,
  AssignPackage,
  Id,
} from "@nodify/contract";
import {
  Inbound,
  PackageInput,
  RuleSetInput,
  compileSubscriptionRules,
  SubscriptionTemplateDocument,
  expandTemplateGroups,
  RuleSetSelection,
  selectSubscriptionRuleSets,
} from "@nodify/contract";
import { load as loadYaml } from "js-yaml";
import { Request, Response } from "express";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { interval, from, switchMap, map, takeWhile } from "rxjs";
import { z } from "zod";

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  Sse,
  UseGuards,
  BadRequestException,
} from "@nestjs/common";

import { Roles } from "@common/decorators/roles/roles";
import { JwtDefaultGuard } from "@common/guards/jwt-guards/def-jwt-guard";
import { RolesGuard } from "@common/guards/roles";
import { ROLE } from "@libs/contracts/constants";

import { allowed } from "./configuration";
import { NodifyService } from "./nodify.service";
import { NodifyResourcesService } from "./resources.service";
import { proxyFor, uriFor } from "./subscription.controller";
import { SubscriptionTemplates } from "./subscription-templates";
import { SubscriptionFiles } from "./subscription-files";
import { TrafficHistory } from "./traffic-history";
import { TrafficAccounting } from "./traffic-accounting";
import { TrafficOverview } from "./overview-traffic";
import { TerminalSessions } from './terminal-sessions';
import { AgentConnections } from './agent-connection';
import { PublicationSettings } from './publication';

@Controller()
@Roles(ROLE.ADMIN)
@UseGuards(JwtDefaultGuard, RolesGuard)
export class NodifyController {
  @Get('settings/publication') async publication() {
    return {response: await new PublicationSettings(this.service).view()};
  }
  @Put('settings/publication') async savePublication(@Body() body: unknown) {
    await new PublicationSettings(this.service).save(body);
    return {response: await new PublicationSettings(this.service).view()};
  }
  @Get('servers/:id/connection') async agentConnection(@Param('id') id: string) {
    return { response: await new AgentConnections(this.service).read(Id.parse(id)) };
  }
  @Put('servers/:id/connection') async saveAgentConnection(@Param('id') id: string, @Body() body: unknown) {
    return { response: await new AgentConnections(this.service).save(Id.parse(id), body) };
  }
  @Post('servers/:id/terminal-sessions') async openTerminal(@Param('id') id: string, @Body() body: unknown) {
    return { response: await new TerminalSessions(this.service).open(Id.parse(id), body) };
  }
  @Get('servers/:id/terminal-sessions/:sessionId') async readTerminal(@Param('id') id: string, @Param('sessionId') sessionId: string, @Query('after') after = '0') {
    return { response: await new TerminalSessions(this.service).read(Id.parse(id), Id.parse(sessionId), Number(after)) };
  }
  @Post('servers/:id/terminal-sessions/:sessionId/input') async inputTerminal(@Param('id') id: string, @Param('sessionId') sessionId: string, @Body() body: unknown) {
    return { response: await new TerminalSessions(this.service).input(Id.parse(id), Id.parse(sessionId), body) };
  }
  @Delete('servers/:id/terminal-sessions/:sessionId') async closeTerminal(@Param('id') id: string, @Param('sessionId') sessionId: string) {
    return { response: await new TerminalSessions(this.service).close(Id.parse(id), Id.parse(sessionId)) };
  }
  @Get("overview/traffic") async trafficOverview() {
    return { response: await new TrafficOverview(this.service).read() };
  }
  @Put("overview/traffic-settings") async overviewTrafficSettings(
    @Body() body: unknown,
  ) {
    return { response: await new TrafficOverview(this.service).save(body) };
  }
  @Get("traffic/history/options") async trafficHistoryOptions() {
    return { response: await new TrafficHistory(this.service).options() };
  }
  @Get("traffic/history") async trafficHistory(@Query() query: unknown) {
    return { response: await new TrafficHistory(this.service).read(query) };
  }
  @Put("servers/:id/traffic-settings") async trafficSettings(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return {
      response: await new TrafficAccounting(this.service).saveSettings(
        Id.parse(id),
        body,
      ),
    };
  }
  @Get("servers/:id/traffic-accounting") async accounting(
    @Param("id") id: string,
    @Query("cursor") cursor?: string,
  ) {
    return {
      response: await new TrafficAccounting(this.service).read(
        Id.parse(id),
        cursor ? Id.parse(cursor) : undefined,
      ),
    };
  }
  @Post("servers/:id/traffic-accounting") async changeAccounting(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return {
      response: await new TrafficAccounting(this.service).change(
        Id.parse(id),
        body,
      ),
    };
  }
  constructor(
    private readonly service: NodifyService,
    private readonly resources: NodifyResourcesService,
  ) {}
  @Get("subscription-files") async subscriptionFiles() {
    return { response: await new SubscriptionFiles(this.service).list() };
  }
  @Get("subscription-files/options") async subscriptionFileOptions(
    @Query("entitlementId") entitlementId?: string,
  ) {
    return {
      response: await new SubscriptionFiles(this.service).options(
        entitlementId ? Id.parse(entitlementId) : undefined,
      ),
    };
  }
  @Post("subscription-files") async createSubscriptionFile(
    @Body() body: unknown,
  ) {
    return { response: await new SubscriptionFiles(this.service).save(body) };
  }
  @Put("subscription-files/:id") async updateSubscriptionFile(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return {
      response: await new SubscriptionFiles(this.service).save(
        body,
        Id.parse(id),
      ),
    };
  }
  @Post("subscription-files/:id/rotate") async rotateSubscriptionFile(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const { version } = z
      .object({ version: z.number().int().positive() })
      .parse(body);
    return {
      response: await new SubscriptionFiles(this.service).rotate(
        Id.parse(id),
        version,
      ),
    };
  }
  @Delete("subscription-files/:id") async deleteSubscriptionFile(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const { version } = z
      .object({ version: z.number().int().positive() })
      .parse(body);
    return {
      response: await new SubscriptionFiles(this.service).remove(
        Id.parse(id),
        version,
      ),
    };
  }
  @Get("subscription-templates") async subscriptionTemplates() {
    return { response: await new SubscriptionTemplates(this.service).list() };
  }
  @Post("subscription-templates") async createSubscriptionTemplate(
    @Body() body: unknown,
  ) {
    return {
      response: await new SubscriptionTemplates(this.service).save(body),
    };
  }
  @Put("subscription-templates/default") async selectSubscriptionTemplate(
    @Body() body: unknown,
  ) {
    return {
      response: await new SubscriptionTemplates(this.service).select(body),
    };
  }
  @Post("subscription-templates/parse") async parseSubscriptionTemplate(
    @Body() body: unknown,
  ) {
    const input = z
      .object({
        format: z.enum(["mihomo", "singbox", "document"]),
        text: z.string().max(1024 * 1024),
      })
      .parse(body);
    let parsed: unknown;
    try {
      parsed =
        input.format === "mihomo"
          ? loadYaml(input.text)
          : JSON.parse(input.text);
    } catch {
      throw new BadRequestException("模板格式错误，请检查 YAML / JSON");
    }
    return {
      response: SubscriptionTemplateDocument.parse(
        input.format === "document" ? parsed : { [input.format]: parsed },
      ),
    };
  }
  @Post("subscription-templates/preview") async previewSubscriptionTemplate(
    @Body() body: unknown,
  ) {
    const input = RuleSetSelection.extend({
      document: SubscriptionTemplateDocument,
      nodes: z
        .array(
          z.object({
            name: z.string().min(1).max(120),
            type: z.string().max(40).optional(),
          }),
        )
        .max(1000)
        .default([]),
    }).parse(body);
    const sets = await this.service.listRuleSets();
    if (
      input.ruleMode === "selected" &&
      input.ruleSetIds.some((id) => !sets.some((set) => set.id === id))
    )
      throw new BadRequestException("选中的规则集已删除，请刷新规则列表");
    const selected = selectSubscriptionRuleSets(sets, input);
    const customRules = compileSubscriptionRules(
      selected.map((set) => RuleSetInput.parse(set)),
    );
    const expanded = expandTemplateGroups(input.document.mihomo, input.nodes);
    return {
      response: {
        ...expanded,
        rules: [...customRules.mihomo, ...expanded.rules],
        customRules,
        selectedRuleSets: selected.map((set) => ({
          id: set.id,
          name: set.name,
          version: set.version,
        })),
        singboxRules: [
          ...customRules.singbox,
          ...(input.document.singbox.route?.rules || []),
        ],
      },
    };
  }
  @Put("subscription-templates/:id") async updateSubscriptionTemplate(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return {
      response: await new SubscriptionTemplates(this.service).save(
        body,
        Id.parse(id),
      ),
    };
  }
  @Delete("subscription-templates/:id") async deleteSubscriptionTemplate(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const { version } = z
      .object({ version: z.number().int().positive() })
      .parse(body);
    return {
      response: await new SubscriptionTemplates(this.service).remove(
        Id.parse(id),
        version,
      ),
    };
  }
  @Get("rule-sets") async ruleSets() {
    return { response: await this.service.listRuleSets() };
  }
  @Post("rule-sets") async createRuleSet(@Body() body: unknown) {
    return { response: await this.service.saveRuleSet(body) };
  }
  @Post("rule-sets/preview") async previewRuleSet(@Body() body: unknown) {
    return { response: compileSubscriptionRules([RuleSetInput.parse(body)]) };
  }
  @Post("rule-sets/reorder") async reorderRuleSets(@Body() body: unknown) {
    const { items } = z
      .object({
        items: z
          .array(z.object({ id: Id, version: z.number().int().positive() }))
          .max(100),
      })
      .parse(body);
    return { response: await this.service.reorderRuleSets(items) };
  }
  @Put("rule-sets/:id") async updateRuleSet(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const { version } = z
      .object({ version: z.number().int().positive() })
      .parse(body);
    return {
      response: await this.service.saveRuleSet(body, Id.parse(id), version),
    };
  }
  @Delete("rule-sets/:id") async deleteRuleSet(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const { version } = z
      .object({ version: z.number().int().positive() })
      .parse(body);
    return {
      response: await this.service.deleteRuleSet(Id.parse(id), version),
    };
  }
  @Put("servers/:id/multiplier") async serverMultiplier(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const { multiplier } = z
      .object({ multiplier: z.number().min(0.001).max(1000) })
      .parse(body);
    const server = await this.service.db.nodifyServer.findUniqueOrThrow({
      where: { id: Id.parse(id) },
    });
    await this.service.db.nodes.updateMany({
      where: { uuid: server.nodeUuid },
      data: { consumptionMultiplier: BigInt(Math.round(multiplier * 1e9)) },
    });
    await this.service.reconcile();
    return { response: { updated: true } };
  }
  @Get("servers") async servers() {
    return { response: await this.service.listServers() };
  }
  @Get("server-profiles") async sharedProfiles() {
    return { response: await this.service.sharedProfiles() };
  }
  @Post("server-profiles") async createProfile(@Body() body: unknown) {
    const input = z
      .object({ name: z.string().min(1).max(80), config: z.unknown() })
      .parse(body);
    return {
      response: await this.service.saveSharedProfile(input.name, input.config),
    };
  }
  @Put("server-profiles/:id") async updateProfile(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = z
      .object({ name: z.string().min(1).max(80), config: z.unknown() })
      .parse(body);
    return {
      response: await this.service.saveSharedProfile(
        input.name,
        input.config,
        Id.parse(id),
      ),
    };
  }
  @Post("server-profiles/:id/publish") async publishProfile(
    @Param("id") id: string,
  ) {
    return { response: await this.service.publishProfile(Id.parse(id)) };
  }
  @Put("servers/:id/profile") async bindProfile(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const { profileId } = z.object({ profileId: Id.nullable() }).parse(body);
    return {
      response: await this.service.bindProfile(Id.parse(id), profileId),
    };
  }
  @Post("servers") async create(@Body() body: unknown) {
    return { response: await this.service.createServer(body) };
  }
  @Post("servers/:id/revoke") async revoke(@Param("id") id: string) {
    return { response: await this.service.revoke(Id.parse(id)) };
  }
  @Post("servers/:id/rotate-credential") async rotate(@Param("id") id: string) {
    return { response: await this.service.rotateCredential(Id.parse(id)) };
  }
  @Post("servers/:id/terminal") async terminal(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = z
      .object({
        command: z.string().min(1).max(4000),
        timeoutSeconds: z.number().int().min(1).max(60).default(30),
      })
      .parse(body);
    return {
      response: await this.service.operation(Id.parse(id), "terminal", input),
    };
  }
  @Post("servers/:id/enrollment") async enrollment(@Param("id") id: string) {
    return { response: await this.service.issueEnrollment(Id.parse(id)) };
  }
  @Get("servers/:id/configurations") async configurations(
    @Param("id") id: string,
  ) {
    return { response: await this.service.revisions(Id.parse(id)) };
  }
  @Post("servers/:id/configurations") async save(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return { response: await this.service.saveDraft(Id.parse(id), body) };
  }
  @Post("servers/:id/configurations/:version/apply") async apply(
    @Param("id") id: string,
    @Param("version") version: string,
  ) {
    return {
      response: await this.service.apply(
        Id.parse(id),
        z.coerce.number().int().positive().parse(version),
      ),
    };
  }
  @Get("servers/:id/websites") async websites(@Param("id") id: string) {
    return {
      response: await this.service.listWebsites(Id.parse(id)),
    };
  }
  @Post("servers/:id/websites") async website(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return { response: await this.service.saveWebsite(Id.parse(id), body) };
  }
  @Post("servers/:id/websites/drafts") async websiteDraft(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return {
      response: await this.service.saveWebsiteDraft(Id.parse(id), body),
    };
  }
  @Put("servers/:id/websites/:siteId") async updateWebsite(
    @Param("id") id: string,
    @Param("siteId") siteId: string,
    @Body() body: unknown,
  ) {
    return {
      response: await this.service.saveWebsiteDraft(
        Id.parse(id),
        body,
        Id.parse(siteId),
      ),
    };
  }
  @Post("servers/:id/websites/:siteId/apply") async applyWebsite(
    @Param("id") id: string,
    @Param("siteId") siteId: string,
    @Body() body: unknown,
  ) {
    const input = z
      .object({ version: z.number().int().positive().optional() })
      .parse(body);
    return {
      response: await this.service.publishWebsite(
        Id.parse(id),
        Id.parse(siteId),
        input.version,
      ),
    };
  }
  @Delete("servers/:id/websites/:siteId") async deleteWebsite(
    @Param("id") id: string,
    @Param("siteId") siteId: string,
  ) {
    return {
      response: await this.service.deleteWebsite(
        Id.parse(id),
        Id.parse(siteId),
      ),
    };
  }
  @Post("servers/:id/websites/:siteId/files") async websiteFiles(
    @Param("id") id: string,
    @Param("siteId") siteId: string,
    @Body() body: unknown,
  ) {
    return {
      response: await new WebsiteFiles(this.service).queue(
        Id.parse(id),
        Id.parse(siteId),
        body,
      ),
    };
  }
  @Post("servers/:id/actions") async action(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = z
      .object({
        action: z.enum(["logs", "restart", "latency"]),
        service: z.enum(["xray", "sing-box", "nginx"]).default("xray"),
        websiteId: Id.optional(),
        logType: z.enum(["access", "error"]).default("access"),
        host: z.string().max(253).optional(),
        port: z.number().int().min(1).max(65535).optional(),
      })
      .parse(body);
    return {
      response: await this.service.operation(Id.parse(id), input.action, input),
    };
  }
  @Post("servers/upgrade") async upgrade(@Body() body: unknown) {
    const input = z
      .object({
        serverIds: z.array(Id).min(1).max(100),
        version: z.string().regex(/^\d+\.\d+\.\d+$/),
        url: z.url().refine((url) => new URL(url).protocol === "https:"),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .parse(body);
    const tasks = [];
    for (const id of input.serverIds) {
      if (
        await this.service.db.nodifyOperation.count({
          where: {
            serverId: id,
            kind: "upgrade",
            state: { in: ["queued", "running"] },
          },
        })
      )
        throw new BadRequestException(
          "An upgrade is already pending for this server",
        );
    }
    for (const id of input.serverIds)
      tasks.push(
        await this.service.operation(
          id,
          "upgrade",
          { version: input.version, url: input.url, sha256: input.sha256 },
          15,
        ),
      );
    return { response: tasks };
  }
  @Get("operations") async operations(@Query("serverId") id?: string) {
    return {
      response: await this.service.operations(id ? Id.parse(id) : undefined),
    };
  }
  @Get("operations/:id") async operation(@Param("id") id: string) {
    return {
      response: operationView(
        await this.service.db.nodifyOperation.findUniqueOrThrow({
          where: { id: Id.parse(id) },
          omit: { payload: true, leaseOwner: true, localKey: true },
        }),
      ),
    };
  }
  @Get("operations/:id/file-result") async fileResult(@Param("id") id: string) {
    const op = await this.service.db.nodifyOperation.findUniqueOrThrow({
      where: { id: Id.parse(id) },
    });
    if (op.kind !== "website-files" || op.state !== "succeeded")
      throw new BadRequestException("File operation has not succeeded");
    const result = (op.result || {}) as Record<string, unknown>;
    const content = result.contentAvailable
      ? JSON.parse(this.service.box.open(op.payload)).returnedData
      : undefined;
    return {
      response: {
        ...result,
        ...(typeof content === "string" ? { data: content } : {}),
      },
    };
  }
  @Post("operations/:id/retry") async retryOperation(@Param("id") id: string) {
    return { response: await this.resources.retryOperation(Id.parse(id)) };
  }
  @Sse("operations/:id/events") events(@Param("id") id: string) {
    Id.parse(id);
    return interval(1000).pipe(
      switchMap(() =>
        from(
          this.service.db.nodifyOperation.findUniqueOrThrow({
            where: { id },
            omit: { payload: true, leaseOwner: true, localKey: true },
          }),
        ),
      ),
      map((op) => ({ data: operationView(op), type: "operation", id: op.id })),
      takeWhile(
        (event) => !["failed", "succeeded"].includes(event.data.state),
        true,
      ),
    );
  }
  @Get("packages") async packages() {
    return { response: await this.service.listPackages() };
  }
  @Post("packages") async createPackage(@Body() body: unknown) {
    return { response: await this.service.savePackage(body) };
  }
  @Put("packages/:id") async updatePackage(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return { response: await this.service.savePackage(body, Id.parse(id)) };
  }
  @Delete("packages/:id") async deletePackage(@Param("id") id: string) {
    await this.service.db.nodifyPackage.delete({ where: { id: Id.parse(id) } });
    return { response: { deleted: true } };
  }
  @Post("packages/assign") async assign(@Body() body: unknown) {
    const data = AssignPackage.parse(body);
    return {
      response: await this.service.assignPackage(data.userId, data.packageId),
    };
  }
  @Post("packages/:id/sync") async syncPackage(@Param("id") id: string) {
    return { response: await this.service.syncPackage(Id.parse(id)) };
  }
  @Get("entitlements") async entitlements() {
    return { response: await this.service.entitlements() };
  }
  @Post("entitlements") async member(@Body() body: unknown) {
    return { response: await this.service.createMember(body) };
  }
  @Post("entitlements/:id/actions") async memberAction(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return {
      response: await this.service.memberAction(
        z.string().regex(/^\d+$/).parse(id),
        body,
      ),
    };
  }
  @Get("entitlements/:id/devices") async devices(@Param("id") id: string) {
    return {
      response: await this.service.db.hwidUserDevices.findMany({
        where: { userId: BigInt(z.string().regex(/^\d+$/).parse(id)) },
      }),
    };
  }
  @Delete("entitlements/:id/devices") async deleteDevice(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = z.object({ hwid: z.string().min(1).max(256) }).parse(body);
    await this.service.db.hwidUserDevices.deleteMany({
      where: {
        userId: BigInt(z.string().regex(/^\d+$/).parse(id)),
        hwid: input.hwid,
      },
    });
    return { response: { deleted: true } };
  }
  @Post("entitlements/:id/reset") async reset(@Param("id") id: string) {
    return {
      response: await this.service.resetEntitlement(
        z.string().regex(/^\d+$/).parse(id),
      ),
    };
  }
  @Post("entitlements/:id/revoke") async revokeSubscription(
    @Param("id") id: string,
  ) {
    return {
      response: await this.service.revokeSubscription(
        z.string().regex(/^\d+$/).parse(id),
      ),
    };
  }
  @Get("certificates") async certificates() {
    return { response: await this.service.certificates() };
  }
  @Post("certificates/upload") async certificate(@Body() body: unknown) {
    return { response: await this.service.uploadCertificate(body) };
  }
  @Post("certificates/request") async requestCertificate(
    @Body() body: unknown,
  ) {
    return { response: await this.resources.requestCertificate(body) };
  }
  @Post("certificates/:id/renew") async renew(@Param("id") id: string) {
    return { response: await this.resources.queueRenew(Id.parse(id)) };
  }
  @Get("subscription-sources") async sources() {
    return { response: await this.resources.listSources() };
  }
  @Post("subscription-sources") async createSource(@Body() body: unknown) {
    return { response: await this.resources.createSource(body) };
  }
  @Post("subscription-sources/:id/sync") async sync(@Param("id") id: string) {
    return { response: await this.resources.syncSource(Id.parse(id)) };
  }
  @Put("subscription-sources/:id") async updateSource(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return { response: await this.resources.updateSource(Id.parse(id), body) };
  }
  @Put("subscription-sources/:id/nodes/:nodeId") async updateSourceNode(
    @Param("id") id: string,
    @Param("nodeId") nodeId: string,
    @Body() body: unknown,
  ) {
    return {
      response: await this.resources.updateSourceNode(
        Id.parse(id),
        Id.parse(nodeId),
        body,
      ),
    };
  }
  @Delete("subscription-sources/:id") async deleteSource(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const { version } = z
      .object({ version: z.number().int().positive() })
      .parse(body);
    return {
      response: await this.resources.deleteSource(Id.parse(id), version),
    };
  }
  @Get("managed-nodes") async nodes() {
    return {
      response: await this.service.db.nodifyInbound.findMany({
        include: {
          host: true,
          server: { select: { node: { select: { name: true } } } },
        },
      }),
    };
  }
  @Get("subscription-settings") async subscriptionSettings() {
    const row = await this.service.db.nodifySetting.findUnique({
      where: { key: "subscription.settings" },
    });
    return {
      response: row ? JSON.parse(row.value) : { mihomo: {}, singbox: {} },
    };
  }
  @Put("subscription-settings") async saveSubscriptionSettings(
    @Body() body: unknown,
  ) {
    const input = z
      .object({
        mihomo: z.object({
          dns: z.record(z.string(), z.unknown()).optional(),
          rules: z.array(z.string()).max(10000).optional(),
          "rule-providers": z.record(z.string(), z.unknown()).optional(),
          "proxy-groups": z
            .array(z.record(z.string(), z.unknown()))
            .max(100)
            .optional(),
        }),
        singbox: z.object({
          dns: z.record(z.string(), z.unknown()).optional(),
          route: z.record(z.string(), z.unknown()).optional(),
        }),
      })
      .parse(body);
    const value = JSON.stringify(input);
    if (value.length > 1024 * 1024)
      throw new BadRequestException("Template exceeds 1 MiB");
    await this.service.db.nodifySetting.upsert({
      where: { key: "subscription.settings" },
      create: { key: "subscription.settings", value },
      update: { value },
    });
    return { response: input };
  }
  @Delete("certificates/:id") async deleteCertificate(@Param("id") id: string) {
    Id.parse(id);
    const servers = await this.service.db.nodifyServer.findMany();
    for (const server of servers) {
      const revisions = await this.service.revisions(server.id);
      if (
        revisions.some(
          (r) =>
            (r.version === server.appliedVersion ||
              r.version === server.desiredVersion ||
              r.state === "draft") &&
            JSON.stringify(r.config).includes(id),
        )
      )
        throw new BadRequestException(
          "Certificate is referenced by an active configuration or draft",
        );
    }
    if (
      (await this.service.db.nodifyWebsite.findMany()).some((s) =>
        JSON.stringify([s.config, s.appliedConfig]).includes(id),
      )
    )
      throw new BadRequestException("Certificate is referenced by a website");
    await this.service.db.nodifyCertificate.delete({ where: { id } });
    return { response: { deleted: true } };
  }
  @Put("managed-nodes/:id") async updateNode(
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = z
      .object({
        name: z.string().min(1).max(80),
        enabled: z.boolean(),
        tags: z.array(z.string().max(40)).max(30),
        position: z.number().int().min(0).max(100000),
      })
      .parse(body);
    const node = await this.service.db.nodifyInbound.findUniqueOrThrow({
      where: { id: Id.parse(id) },
      include: { server: true },
    });
    const revisions = await this.service.revisions(node.serverId),
      current = revisions.find((r) => r.version === node.server.appliedVersion);
    if (!current) throw new BadRequestException("No applied configuration");
    const config = current.config as any;
    const draft = await this.service.saveDraft(node.serverId, {
      ...config,
      inbounds: config.inbounds.map((i: any) =>
        i.id === id
          ? { ...i, name: input.name, enabled: input.enabled, tags: input.tags }
          : i,
      ),
    });
    const operation = await this.service.apply(node.serverId, draft.version);
    await this.service.db.hosts.updateMany({
      where: { uuid: node.hostUuid },
      data: { viewPosition: input.position },
    });
    return { response: operation };
  }
  @Get("managed-nodes/:id/share") async shareNode(
    @Param("id") id: string,
    @Query("userId") userId: string,
  ) {
    const row = await this.service.db.nodifyInbound.findUniqueOrThrow({
      where: { id: Id.parse(id) },
      include: { host: true },
    });
    const e = await this.service.db.nodifyEntitlement.findUniqueOrThrow({
      where: { userId: BigInt(z.string().regex(/^\d+$/).parse(userId)) },
      include: { user: true },
    });
    const config = Inbound.parse(row.config),
      rights = PackageInput.parse(e.snapshot);
    if (
      !config.enabled ||
      row.host.isDisabled ||
      !allowed(config, rights) ||
      e.user.status !== "ACTIVE" ||
      e.user.expireAt.getTime() <= Date.now() ||
      (BigInt(rights.trafficLimitBytes) > 0n &&
        e.usedBytes >= BigInt(rights.trafficLimitBytes))
    )
      throw new BadRequestException("Member has no active access to this node");
    return {
      response: {
        uri: uriFor(
          proxyFor(
            { ...config, name: row.host.remark },
            row.host.address,
            e.user,
            this.service.box.open(e.anytlsPassword),
          ),
        ),
      },
    };
  }
  @Get("backups") async backups() {
    return {
      response: await this.service.db.nodifyBackup.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    };
  }
  @Get("backup-settings") async backupSettings() {
    return { response: await this.resources.backupSettings() };
  }
  @Put("backup-settings") async saveBackupSettings(@Body() body: unknown) {
    return { response: await this.resources.saveBackupSettings(body) };
  }
  @Post("backups") async backup(@Body() body: unknown) {
    const { password } = z
      .object({ password: z.string().min(12).max(256) })
      .parse(body);
    return { response: await this.resources.queueBackup(password) };
  }
  @Get("backups/:id/download") async download(
    @Param("id") id: string,
    @Res() response: Response,
  ) {
    response.download(await this.resources.backupFile(Id.parse(id)));
  }
}

@Controller("agent")
export class NodifyAgentController {
  constructor(private readonly service: NodifyService) {}
  @Get("version") version() {
    return {
      application: "Nodify",
      version: process.env.NODIFY_VERSION || NODIFY_VERSION,
    };
  }
  private token(req: Request) {
    return req.headers.authorization?.replace(/^Bearer /, "") ?? "";
  }
  @Get("install.sh") async install(@Res() res: Response) {
    return res
      .type("text/plain")
      .send(
        await readFile(
          resolve(process.env.NODIFY_INSTALL_SCRIPT || "deploy/install.sh"),
          "utf8",
        ),
      );
  }
  @Post("enroll") async enroll(@Body() body: unknown) {
    const input = AgentHello.parse(body);
    return this.service.enroll(input.token, input.version, input.hostname);
  }
  @Post("poll") async poll(@Req() req: Request, @Body() body: unknown) {
    const metrics = z.record(z.string(), z.unknown()).parse(body);
    if (JSON.stringify(metrics).length > 20000)
      throw new BadRequestException("Metrics too large");
    const server = await this.service.authenticate(this.token(req));
    const initial = await this.service.heartbeat(server.id, { ...metrics, connectionTransport: 'pull' });
    if (initial.length || metrics.terminalActive === true) return { operations: initial };
    for (let i = 0; i < 20 && !req.socket.destroyed; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await this.service.authenticate(this.token(req));
      const ops = await this.service.pendingOperations(server.id);
      if (ops.length) return { operations: ops };
    }
    return { operations: [] };
  }
  @Post("results") async result(@Req() req: Request, @Body() body: unknown) {
    const server = await this.service.authenticate(this.token(req));
    const input = OperationResult.parse(body);
    return this.service.complete(
      server.id,
      input.id,
      input.state,
      input.message,
      input.result,
    );
  }
  @Post("traffic") async traffic(@Req() req: Request, @Body() body: unknown) {
    const server = await this.service.authenticate(this.token(req));
    return this.service.traffic(server.id, body);
  }
  @Post("network") async network(@Req() req: Request, @Body() body: unknown) {
    const server = await this.service.authenticate(this.token(req));
    return this.service.network(server.id, body);
  }
  @Post('terminal-exchange') async terminalExchange(@Req() req: Request, @Body() body: unknown) {
    const server = await this.service.authenticate(this.token(req));
    return new TerminalSessions(this.service).exchange(server.id, body);
  }
}
