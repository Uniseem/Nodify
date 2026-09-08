import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ruleFixture } from "./rule-fixture.mjs";
import { restoreBackup } from "../deploy/restore.mjs";
const require = createRequire(import.meta.url);
const {
  SubscriptionTemplates,
} = require("../apps/backend/src/modules/nodify/subscription-templates.ts");
const {
  SubscriptionFiles,
} = require("../apps/backend/src/modules/nodify/subscription-files.ts");
const {
  NodifyController,
} = require("../apps/backend/src/modules/nodify/nodify.controller.ts");
const {
  NodifySubscriptionController,
} = require("../apps/backend/src/modules/nodify/subscription.controller.ts");
const {
  NodifyResourcesService,
} = require("../apps/backend/src/modules/nodify/resources.service.ts");
const {
  NodifyService,
} = require("../apps/backend/src/modules/nodify/nodify.service.ts");
const { PrismaClient } = require("../apps/backend/node_modules/@prisma/client");
const {
  SubscriptionTemplateInput,
} = require("../packages/nodify-contract/index.ts");
const { load } = require("../apps/backend/node_modules/js-yaml");
const document = {
  mihomo: { rules: ["DOMAIN,template.example,REJECT", "MATCH,Nodify"] },
  singbox: {
    route: { rules: [{ domain: ["template.example"], action: "reject" }] },
  },
};
const rule = (name, policy = "DIRECT", enabled = true) => ({
  name,
  enabled,
  rules: [{ type: "DOMAIN", value: `${name}.example`, policy }],
});

test("template rule bindings preserve global order, file overrides, live edits and encrypted restore", async () => {
  const { db, service, render, entitlement, directory, user } =
    await ruleFixture();
  const templates = new SubscriptionTemplates(service),
    files = new SubscriptionFiles(service);
  const resources = new NodifyResourcesService(service);
  const controller = new NodifyController(service, resources);
  let recovered;
  const secrets = process.env.NODIFY_DATA_DIR;
  try {
    const a = await service.saveRuleSet(rule("a"));
    const b = await service.saveRuleSet(rule("b", "REJECT"));
    const disabled = await service.saveRuleSet(
      rule("disabled", "DIRECT", false),
    );
    const omitted = await service.saveRuleSet(rule("omitted"));
    const value = {
      name: "Selected",
      document,
      ruleMode: "selected",
      ruleSetIds: [b.id, disabled.id, a.id],
    };
    assert.throws(() =>
      SubscriptionTemplateInput.parse({ ...value, ruleSetIds: [a.id, a.id] }),
    );
    assert.throws(() =>
      SubscriptionTemplateInput.parse({ ...value, ruleMode: "template" }),
    );
    for (const route of [
      { rules: {} },
      { rules: ["invalid"] },
      { rule_set: "invalid" },
    ])
      assert.throws(() =>
        SubscriptionTemplateInput.parse({
          ...value,
          document: { singbox: { route } },
        }),
      );
    await assert.rejects(
      templates.save({ ...value, ruleSetIds: [randomUUID()] }),
      /规则集/,
    );
    assert.equal(await db.nodifySubscriptionTemplate.count(), 0);
    const template = await templates.save(value);
    await templates.select({ templateId: template.id, version: 0 });
    const expected = [
      "DOMAIN,a.example,DIRECT",
      "DOMAIN,b.example,REJECT",
      ...document.mihomo.rules,
    ];
    assert.deepEqual(load((await render("mihomo")).content).rules, expected);
    assert.deepEqual(
      (await render("singbox")).content.route.rules.map((r) => r.domain?.[0]),
      ["a.example", "b.example", "template.example"],
    );
    assert.equal((await render("uris")).headers["X-Nodify-Rules-Applied"], "0");
    const preview = (
      await controller.previewSubscriptionTemplate({
        ...value,
        nodes: [{ name: "node", type: "vless" }],
      })
    ).response;
    assert.deepEqual(preview.rules, expected);
    assert.deepEqual(
      preview.selectedRuleSets.map((set) => set.id),
      [a.id, b.id],
    );
    assert.deepEqual(
      preview.singboxRules,
      (await render("singbox")).content.route.rules,
    );
    await assert.rejects(
      controller.previewSubscriptionTemplate({
        ...value,
        ruleSetIds: [randomUUID()],
      }),
      /规则集/,
    );
    for (const set of [a, disabled]) {
      await assert.rejects(
        service.deleteRuleSet(set.id, set.version),
        /模板引用/,
      );
      // The database also protects relations from callers outside the service.
      await assert.rejects(
        db.nodifyRuleSet.delete({ where: { id: set.id } }),
        (e) => e.code === "P2003",
      );
    }
    await assert.rejects(
      templates.save({ ...value, version: 999, ruleSetIds: [] }, template.id),
      /模板已更新/,
    );
    await assert.rejects(
      templates.save(
        { ...value, version: 1, ruleSetIds: [randomUUID()] },
        template.id,
      ),
      /规则集/,
    );
    assert.equal((await templates.list()).items[0].version, 1);
    assert.equal(await db.nodifySubscriptionTemplateRule.count(), 3);
    const tokens = {};
    for (const mode of ["template", "all", "selected", "none"]) {
      const file = await files.save({
        name: mode,
        entitlementId: entitlement.id,
        templateId: template.id,
        ruleMode: mode,
        ruleSetIds: [omitted.id],
      });
      tokens[mode] = (await files.list())
        .find((row) => row.id === file.id)
        .subscriptionUrl.split("/")
        .at(-1);
    }
    const read = async (mode) =>
      load((await render("mihomo", tokens[mode])).content).rules;
    assert.deepEqual(await read("template"), expected);
    assert.deepEqual(await read("all"), [
      ...expected.slice(0, 2),
      "DOMAIN,omitted.example,DIRECT",
      ...document.mihomo.rules,
    ]);
    assert.deepEqual(await read("selected"), [
      "DOMAIN,omitted.example,DIRECT",
      ...document.mihomo.rules,
    ]);
    assert.deepEqual(await read("none"), document.mihomo.rules);
    const follows = await files.save({
      name: "System default",
      entitlementId: entitlement.id,
      ruleMode: "template",
    });
    const followToken = (await files.list())
      .find((row) => row.id === follows.id)
      .subscriptionUrl.split("/")
      .at(-1);
    const none = await templates.save({
      name: "None",
      document,
      ruleMode: "none",
      ruleSetIds: [omitted.id],
    });
    assert.deepEqual(none.ruleSetIds, []);
    await templates.select({ templateId: none.id, version: 1 });
    assert.deepEqual(
      load((await render("mihomo", followToken)).content).rules,
      document.mihomo.rules,
    );
    assert.deepEqual(
      await read("template"),
      expected,
      "bound template is independent of system default",
    );
    await templates.select({ templateId: template.id, version: 2 });
    const sorted = await service.reorderRuleSets(
      [b, a, disabled, omitted].map(({ id, version }) => ({ id, version })),
    );
    const reordered = [expected[1], expected[0], ...document.mihomo.rules];
    assert.deepEqual(await read("template"), reordered);
    await service.saveRuleSet(
      rule("b", "REJECT", false),
      b.id,
      sorted[0].version,
    );
    assert.deepEqual(await read("template"), [
      expected[0],
      ...document.mihomo.rules,
    ]);
    assert.deepEqual(await read("selected"), [
      "DOMAIN,omitted.example,DIRECT",
      ...document.mihomo.rules,
    ]);

    const password = "template-binding-restore-password";
    const backup = await resources.backup(password);
    const restoredFile = join(directory, "restored.sqlite"),
      restoredSecrets = join(directory, "restored-secrets");
    restoreBackup(
      join(secrets, "backups", `${backup.id}.nodify`),
      password,
      restoredFile,
      restoredSecrets,
    );
    process.env.NODIFY_DATA_DIR = restoredSecrets;
    recovered = new PrismaClient({
      datasources: {
        db: { url: `file:${restoredFile.replaceAll("\\", "/")}` },
      },
    });
    const restoredService = new NodifyService(recovered),
      restoredController = new NodifySubscriptionController(restoredService);
    assert.equal(await recovered.nodifySubscriptionTemplateRule.count(), 3);
    const result = {
      content: null,
      setHeader() {},
      type() {
        return this;
      },
      send(content) {
        this.content = content;
      },
    };
    await restoredController.subscription(
      tokens.template,
      "mihomo",
      { headers: {} },
      result,
    );
    assert.deepEqual(load(result.content).rules, [
      expected[0],
      ...document.mihomo.rules,
    ]);
    await assert.rejects(
      new NodifyService(recovered).deleteRuleSet(a.id, sorted[1].version),
      /模板引用/,
    );
    process.env.NODIFY_DATA_DIR = secrets;

    await templates.save(
      { ...value, version: 1, ruleMode: "none" },
      template.id,
    );
    assert.equal(await db.nodifySubscriptionTemplateRule.count(), 0);
    assert.deepEqual(await read("template"), document.mihomo.rules);
    assert.deepEqual(await read("selected"), [
      "DOMAIN,omitted.example,DIRECT",
      ...document.mihomo.rules,
    ]);
    await service.deleteRuleSet(a.id, sorted[1].version);
    const copy = await templates.save({
      ...value,
      name: "Copy",
      ruleSetIds: [disabled.id],
    });
    await templates.remove(copy.id, copy.version);
    assert.equal(await db.nodifySubscriptionTemplateRule.count(), 0);
    await db.users.update({
      where: { id: user.id },
      data: { expireAt: new Date(0) },
    });
    assert.deepEqual(
      (await render("singbox", tokens.all)).content.route.rules,
      [{ action: "reject" }],
    );
    assert.equal(
      (await render("mihomo", tokens.all)).headers["X-Nodify-Rules-Applied"],
      "0",
    );
  } finally {
    process.env.NODIFY_DATA_DIR = secrets;
    await recovered?.$disconnect();
    await db.$disconnect();
  }
});
