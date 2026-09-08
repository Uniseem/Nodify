import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { ruleFixture } from "./rule-fixture.mjs";
const require = createRequire(import.meta.url);
const {
  SubscriptionFiles,
} = require("../apps/backend/src/modules/nodify/subscription-files.ts");
const {
  SubscriptionTemplates,
} = require("../apps/backend/src/modules/nodify/subscription-templates.ts");
const {
  SubscriptionFileCreate,
  fileAllowsNode,
} = require("../packages/nodify-contract/index.ts");
const { load } = require("../apps/backend/node_modules/js-yaml");
const tokenOf = (row) => row.subscriptionUrl.split("/").at(-1);

test("external file tags cannot grant nodes outside the parent package", async () => {
  const { db, service, entitlement, render } = await ruleFixture();
  const files = new SubscriptionFiles(service);
  try {
    const {
      parseSource,
    } = require("../apps/backend/src/modules/nodify/resources.service.ts");
    const id = randomUUID();
    const nodes = parseSource(
      "proxies: [{name: external, type: anytls, server: external.example, port: 443, password: test-credential}]",
      id,
    );
    await db.nodifySubscriptionSource.create({
      data: {
        id,
        name: "external",
        encryptedUrl: service.box.seal("https://external.example"),
        tags: ["external"],
        nodes,
      },
    });
    await files.save({
      entitlementId: entitlement.id,
      name: "tags",
      nodeMode: "selected",
      tags: ["external"],
    });
    const token = tokenOf((await files.list())[0]);
    assert.equal(
      load((await render("mihomo", token)).content).proxies.length,
      0,
    );
    await db.nodifyEntitlement.update({
      where: { id: entitlement.id },
      data: { snapshot: { ...entitlement.snapshot, tags: ["external"] } },
    });
    assert.equal(
      load((await render("mihomo", token)).content).proxies[0].name,
      "external",
    );
    await db.nodifySubscriptionSource.update({
      where: { id },
      data: { enabled: false },
    });
    assert.equal(
      load((await render("mihomo", token)).content).proxies.length,
      0,
    );
  } finally {
    await db.$disconnect();
  }
});

test("subscription files reject ambiguous scopes and empty selection means no nodes", () => {
  const id = randomUUID();
  assert.throws(() =>
    SubscriptionFileCreate.parse({
      entitlementId: id,
      name: "file",
      nodeIds: [id, id],
    }),
  );
  assert.throws(() =>
    SubscriptionFileCreate.parse({
      entitlementId: id,
      name: "file",
      ruleMode: "unexpected",
    }),
  );
  assert.equal(
    fileAllowsNode(
      { nodeMode: "selected", nodeIds: [], tags: [] },
      { id, tags: [] },
    ),
    false,
  );
  assert.equal(
    fileAllowsNode(
      { nodeMode: "selected", nodeIds: [], tags: ["HK"] },
      { id, tags: ["HK"] },
    ),
    true,
  );
});

test("SQLite files enforce entitlement intersection, template/rule bindings, versioning and revocation", async () => {
  const { db, service, user, entitlement, render } = await ruleFixture();
  const files = new SubscriptionFiles(service),
    templates = new SubscriptionTemplates(service);
  try {
    const global = await templates.save({
      name: "Global",
      document: { mihomo: { rules: ["MATCH,REJECT"] } },
    });
    const personal = await templates.save({
      name: "Personal",
      document: { mihomo: { rules: ["MATCH,DIRECT"] } },
    });
    await templates.select({ templateId: global.id, version: 0 });
    const a = await service.saveRuleSet({
      name: "A",
      rules: [{ type: "DOMAIN", value: "first.example", policy: "REJECT" }],
    });
    const b = await service.saveRuleSet({
      name: "B",
      rules: [{ type: "DOMAIN", value: "second.example", policy: "DIRECT" }],
    });
    const options = await files.options(entitlement.id);
    assert.equal(options.nodes.length, 1);
    assert.ok(!JSON.stringify(options).includes("encryptedToken"));
    const nodeId = options.nodes[0].id;
    await assert.rejects(() =>
      files.save({
        entitlementId: entitlement.id,
        name: "outside",
        nodeMode: "selected",
        nodeIds: [randomUUID()],
      }),
    );
    const created = await files.save({
      entitlementId: entitlement.id,
      name: "personal file",
      templateId: personal.id,
      nodeMode: "selected",
      nodeIds: [nodeId],
      ruleMode: "selected",
      ruleSetIds: [b.id],
    });
    let row = JSON.parse(JSON.stringify((await files.list())[0])),
      token = tokenOf(row);
    assert.ok(!("encryptedToken" in row) && !("tokenHash" in row));
    const result = load((await render("mihomo", token)).content);
    assert.equal(result.proxies.length, 1);
    assert.deepEqual(result.rules, [
      "DOMAIN,second.example,DIRECT",
      "MATCH,DIRECT",
    ]);
    assert.deepEqual(load((await render("mihomo")).content).rules, [
      "DOMAIN,first.example,REJECT",
      "DOMAIN,second.example,DIRECT",
      "MATCH,REJECT",
    ]);
    await assert.rejects(() => templates.remove(personal.id, personal.version));
    await assert.rejects(() => service.deleteRuleSet(b.id, b.version));
    await files.save(
      { ...row, nodeIds: [], tags: ["unmatched"], ruleMode: "none" },
      row.id,
    );
    assert.equal(
      load((await render("mihomo", token)).content).proxies.length,
      0,
    );
    await assert.rejects(() => files.save(row, row.id));
    await assert.rejects(() => files.rotate(row.id, row.version));
    row = JSON.parse(JSON.stringify((await files.list())[0]));
    await files.save({ ...row, nodeMode: "all", enabled: false }, row.id);
    assert.equal((await render("info", token)).content.active, false);
    assert.deepEqual(
      load((await render("mihomo", token)).content)["proxy-groups"][0].proxies,
      ["REJECT"],
    );
    assert.equal(
      (await db.users.findUniqueOrThrow({ where: { id: user.id } })).status,
      "ACTIVE",
    );
    row = JSON.parse(JSON.stringify((await files.list())[0]));
    await files.save(
      { ...row, enabled: true, expiresAt: new Date(0).toISOString() },
      row.id,
    );
    assert.equal((await render("info", token)).content.active, false);
    row = JSON.parse(JSON.stringify((await files.list())[0]));
    await files.save({ ...row, expiresAt: "2100-01-01T00:00:00.000Z" }, row.id);
    const info = (await render("info", token)).content;
    assert.equal(info.subscriptionName, "personal file");
    assert.equal(
      info.expiresAt.getTime(),
      (
        await db.users.findUniqueOrThrow({ where: { id: user.id } })
      ).expireAt.getTime(),
    );
    await db.nodifyEntitlement.update({
      where: { id: entitlement.id },
      data: { usedBytes: 1000000n },
    });
    assert.equal((await render("info", token)).content.active, false);
    await db.nodifyEntitlement.update({
      where: { id: entitlement.id },
      data: { usedBytes: 0n },
    });
    await service.revokeSubscription(String(user.id));
    await assert.rejects(() => render("info", token));
    row = JSON.parse(JSON.stringify((await files.list())[0]));
    assert.equal(row.revoked, true);
    await files.save({ ...row, name: "renamed" }, row.id);
    await assert.rejects(() => render("info", token));
    row = JSON.parse(JSON.stringify((await files.list())[0]));
    await files.rotate(row.id, row.version);
    await assert.rejects(() => render("info", token));
    row = JSON.parse(JSON.stringify((await files.list())[0]));
    token = tokenOf(row);
    assert.equal(row.revoked, false);
    assert.equal((await render("info", token)).content.active, true);
    await db.nodifyEntitlement.update({
      where: { id: entitlement.id },
      data: {
        snapshot: {
          ...entitlement.snapshot,
          nodeIds: [randomUUID()],
          tags: [],
        },
      },
    });
    assert.equal(
      load((await render("mihomo", token)).content).proxies.length,
      0,
      "A file must not retain nodes removed from the package",
    );
    await files.remove(created.id, row.version);
    await assert.rejects(() => render("info", token));
    await templates.remove(personal.id, personal.version);
    await service.deleteRuleSet(b.id, b.version);
    await service.deleteRuleSet(a.id, a.version);
  } finally {
    await db.$disconnect();
  }
});

test("subscription files share the user's HWID device limit across links", async () => {
  const { db, service, entitlement, render } = await ruleFixture();
  const files = new SubscriptionFiles(service);
  try {
    await db.nodifyEntitlement.update({
      where: { id: entitlement.id },
      data: { snapshot: { ...entitlement.snapshot, deviceLimit: 1 } },
    });
    await files.save({ entitlementId: entitlement.id, name: "one" });
    await files.save({ entitlementId: entitlement.id, name: "two" });
    const [one, two] = await files.list();
    await assert.rejects(() => render("mihomo", tokenOf(one)));
    await render("mihomo", tokenOf(one), { "x-hwid": "device-one" });
    await assert.rejects(() =>
      render("mihomo", tokenOf(two), { "x-hwid": "device-two" }),
    );
    await render("mihomo", tokenOf(two), { "x-hwid": "device-one" });
    assert.equal(await db.hwidUserDevices.count(), 1);
  } finally {
    await db.$disconnect();
  }
});
