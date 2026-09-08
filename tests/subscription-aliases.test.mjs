import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { ruleFixture } from "./rule-fixture.mjs";
const require = createRequire(import.meta.url);
const {
  SubscriptionFiles,
} = require("../apps/backend/src/modules/nodify/subscription-files.ts");
const { hashToken } = require("../apps/backend/src/modules/nodify/crypto.ts");
const {
  SubscriptionFileCreate,
} = require("../packages/nodify-contract/index.ts");
const read = async (files, id) =>
  JSON.parse(JSON.stringify((await files.list()).find((row) => row.id === id)));

test("subscription aliases persist encrypted, preserve authorization, and cannot be reassigned after revocation", async () => {
  const { db, service, entitlement, render, user } = await ruleFixture();
  const files = new SubscriptionFiles(service);
  const alias = "personal-secret-a";
  try {
    const created = await files.save({
      name: "alias",
      entitlementId: entitlement.id,
      alias,
    });
    let row = await read(files, created.id);
    assert.equal(row.alias, alias);
    assert.ok(row.subscriptionUrl.endsWith("/~" + alias));
    const record = await db.nodifySubscriptionAlias.findUniqueOrThrow({
      where: { hash: hashToken(alias) },
    });
    assert.notEqual(record.encryptedAlias, alias);
    assert.equal(service.box.open(record.encryptedAlias), alias);
    assert.equal((await render("info", "~" + alias)).content.active, true);
    await assert.rejects(() => render("info", "~" + alias.toUpperCase()));
    await assert.rejects(() =>
      files.save({
        name: "collision",
        entitlementId: entitlement.id,
        alias: alias.toUpperCase(),
      }),
    );
    assert.equal(
      await db.nodifySubscriptionFile.count(),
      1,
      "collision rolls back file creation",
    );
    await files.save({ ...row, name: "renamed" }, row.id);
    await assert.rejects(() => files.rotate(row.id, row.version));
    assert.equal(
      (await render("info", "~" + alias)).content.active,
      true,
      "stale rotation must preserve alias",
    );
    row = await read(files, row.id);
    await files.save(
      { ...row, alias: "personal-secret-b", enabled: false },
      row.id,
    );
    await assert.rejects(() => render("info", "~" + alias));
    assert.equal(
      (await render("info", "~personal-secret-b")).content.active,
      false,
    );
    row = await read(files, row.id);
    await assert.rejects(() => files.save({ ...row, alias }, row.id));
    assert.equal((await read(files, row.id)).alias, "personal-secret-b");
    await service.revokeSubscription(String(user.id));
    await assert.rejects(() => render("info", "~personal-secret-b"));
    await files.save({ ...row, enabled: true }, row.id);
    await assert.rejects(
      () => render("info", "~personal-secret-b"),
      "editing does not restore revoked credentials",
    );
    row = await read(files, row.id);
    await files.rotate(row.id, row.version);
    row = await read(files, row.id);
    assert.equal(row.alias, null);
    assert.equal(
      (await render("info", row.subscriptionUrl.split("/").at(-1))).content
        .active,
      true,
    );
    await assert.rejects(() => render("info", "~personal-secret-b"));
    await files.save({ ...row, alias: "personal-secret-c" }, row.id);
    row = await read(files, row.id);
    await assert.rejects(() => files.remove(row.id, row.version - 1));
    assert.equal(
      (await render("info", "~personal-secret-c")).content.active,
      true,
    );
    await files.remove(row.id, row.version);
    await assert.rejects(() => render("info", "~personal-secret-c"));
    await assert.rejects(() =>
      files.save({
        name: "reuse",
        entitlementId: entitlement.id,
        alias: "personal-secret-c",
      }),
    );
    assert.equal(await db.nodifySubscriptionFile.count(), 0);
    assert.equal(
      await db.nodifySubscriptionAlias.count({
        where: { fileId: null, encryptedAlias: null },
      }),
      3,
    );
  } finally {
    await db.$disconnect();
  }
});

test("file display quota changes headers without altering real quota, node grants or shared HWID limits", async () => {
  const { db, service, entitlement, render } = await ruleFixture();
  const files = new SubscriptionFiles(service);
  try {
    for (const invalid of [
      "-1",
      "1.5",
      "1e9",
      "01",
      "100000000000000000000",
      "10; upload=0",
    ])
      assert.throws(() =>
        SubscriptionFileCreate.parse({
          name: "invalid",
          entitlementId: entitlement.id,
          displayTrafficLimitBytes: invalid,
        }),
      );
    const created = await files.save({
      name: "display",
      entitlementId: entitlement.id,
      alias: "display-secret-a",
      displayTrafficLimitBytes: "9007199254740993",
    });
    const token = "~display-secret-a";
    const result = await render("info", token);
    assert.equal(result.content.displayTrafficLimitBytes, "9007199254740993");
    assert.equal(result.content.trafficLimitBytes, "1000000");
    assert.match(
      result.headers["subscription-userinfo"],
      /total=9007199254740993;/,
    );
    await db.nodifyEntitlement.update({
      where: { id: entitlement.id },
      data: { usedBytes: 1000000n },
    });
    assert.equal((await render("info", token)).content.active, false);
    assert.deepEqual((await render("info", token)).content.nodes, []);
    let row = await read(files, created.id);
    await files.save({ ...row, displayTrafficLimitBytes: "0" }, row.id);
    assert.equal(
      (await render("info", token)).content.active,
      false,
      "display unlimited does not bypass quota",
    );
    await db.nodifyEntitlement.update({
      where: { id: entitlement.id },
      data: {
        usedBytes: 0n,
        snapshot: { ...entitlement.snapshot, deviceLimit: 1 },
      },
    });
    await assert.rejects(() => render("mihomo", token));
    await render("mihomo", token, { "x-hwid": "one" });
    await assert.rejects(() => render("mihomo", token, { "x-hwid": "two" }));
    row = await read(files, created.id);
    await files.save(
      { ...row, displayTrafficLimitBytes: null, nodeMode: "selected" },
      row.id,
    );
    const fallback = await render("info", token);
    assert.equal(fallback.content.hasDisplayOverride, false);
    assert.equal(fallback.content.displayTrafficLimitBytes, "1000000");
    assert.deepEqual(fallback.content.nodes, []);
    assert.equal(await db.hwidUserDevices.count(), 1);
  } finally {
    await db.$disconnect();
  }
});
