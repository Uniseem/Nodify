import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { ruleFixture } from "./rule-fixture.mjs";
const require = createRequire(import.meta.url);
const {
  parseTrafficHeader,
  directionBytes,
} = require("../packages/nodify-contract/index.ts");
const {
  SubscriptionFiles,
} = require("../apps/backend/src/modules/nodify/subscription-files.ts");
const {
  NodifyController,
} = require("../apps/backend/src/modules/nodify/nodify.controller.ts");
const {
  NodifyResourcesService,
} = require("../apps/backend/src/modules/nodify/resources.service.ts");
test("upstream traffic headers preserve decimal precision and reject ambiguous data", () => {
  assert.equal(parseTrafficHeader(undefined), null);
  assert.deepEqual(
    parseTrafficHeader(
      "upload=00012; download=9007199254740993; total=0; expire=0",
    ),
    { upload: "12", download: "9007199254740993", total: "0", expire: "0" },
  );
  assert.equal(parseTrafficHeader("upload=1; download=2").total, null);
  for (const value of [
    "",
    "upload=1;download=-1",
    "upload=1;download=1.5",
    "upload=1;upload=2;download=0",
    "download=1",
    "upload=1;download=0;total=1e8",
    "upload=1\ndownload=2",
    "upload=" + "9".repeat(40) + ";download=0",
  ])
    assert.throws(() => parseTrafficHeader(value));
  assert.equal(directionBytes("12", "30", "max"), "30");
  assert.equal(directionBytes("12", "30", "upload"), "12");
  assert.equal(directionBytes("12", "30", "download"), "30");
});
test("server receipt counters deduplicate, remain separate from quota resets and filter administrator file totals", async () => {
  const { db, service, entitlement, user, render } = await ruleFixture();
  const files = new SubscriptionFiles(service),
    controller = new NodifyController(
      service,
      new NodifyResourcesService(service),
    );
  try {
    const first = await db.nodifyServer.findFirstOrThrow();
    const second = await service.createServer({
      name: "second",
      address: "second.example",
    });
    const policy = await db.nodifyOperation.findFirstOrThrow({
      where: { serverId: first.id, kind: "apply-config" },
      orderBy: { createdAt: "desc" },
    });
    const batch = {
      session: randomUUID(),
      sequence: 0,
      policyId: policy.id,
      users: [{ userId: String(user.id), upload: "12", download: "34" }],
    };
    await service.traffic(first.id, batch);
    await service.traffic(first.id, batch);
    let server = await db.nodifyServer.findUniqueOrThrow({
      where: { id: first.id },
    });
    assert.equal(server.protocolTraffic.upload, "12");
    assert.equal(server.protocolTraffic.download, "34");
    await service.resetEntitlement(String(user.id));
    await service.traffic(first.id, { ...batch, sequence: 1 });
    assert.equal(
      (
        await db.nodifyEntitlement.findUniqueOrThrow({
          where: { id: entitlement.id },
        })
      ).usedBytes,
      0n,
    );
    server = await db.nodifyServer.findUniqueOrThrow({
      where: { id: first.id },
    });
    assert.equal(
      server.protocolTraffic.upload,
      "24",
      "server raw receipts still include previous generation traffic",
    );
    await controller.trafficSettings(first.id, {
      version: 1,
      direction: "max",
      limitBytes: "1000",
    });
    await assert.rejects(() =>
      controller.trafficSettings(first.id, {
        version: 1,
        direction: "both",
        limitBytes: "0",
      }),
    );
    const source = await db.nodifySubscriptionSource.create({
      data: {
        name: "upstream",
        encryptedUrl: service.box.seal("https://upstream.example/sub"),
        tags: ["selected"],
        traffic: {
          upload: "9007199254740993",
          download: "50",
          total: "0",
          expire: null,
        },
        trafficDirection: "download",
        lastSyncedAt: new Date(),
        trafficStale: false,
      },
    });
    const file = await files.save({
      name: "statistics",
      entitlementId: entitlement.id,
      statisticServerIds: [first.id],
      tags: ["selected"],
    });
    let row = JSON.parse(JSON.stringify((await files.list())[0]));
    assert.equal(row.trafficSummary.usedBytes, "118");
    assert.equal(row.trafficSummary.finiteLimitBytes, "1000");
    assert.equal(row.trafficSummary.unlimitedCount, 1);
    assert.equal(row.trafficSummary.unknownUsageCount, 0);
    const token = row.subscriptionUrl.split("/").at(-1);
    assert.equal(
      (await render("info", token)).content.usedBytes,
      "0",
      "private user page never includes administrator or upstream traffic",
    );
    await files.save({ ...row, statisticServerIds: [second.id] }, file.id);
    row = JSON.parse(JSON.stringify((await files.list())[0]));
    assert.equal(row.trafficSummary.usedBytes, "50");
    assert.equal(row.trafficSummary.unknownUsageCount, 1);
    await assert.rejects(() =>
      files.save({ ...row, statisticServerIds: [randomUUID()] }, file.id),
    );
    await db.nodifySubscriptionSource.update({
      where: { id: source.id },
      data: { trafficStale: true },
    });
    assert.equal((await files.list())[0].trafficSummary.staleSourceCount, 1);
    await files.save({ ...row, statisticServerIds: [], tags: [] }, file.id);
    row = (await files.list())[0];
    assert.equal(row.trafficSummary.usedBytes, "68");
    assert.equal(row.trafficSummary.externalSources.length, 0);
    assert.equal(row.trafficSummary.servers.length, 2);
    assert.equal(row.trafficSummary.unknownLimitCount, 1);
    await service.traffic(first.id, {
      ...batch,
      sequence: 2,
      users: [
        { userId: String(user.id), upload: "9007199254740993", download: "0" },
      ],
    });
    assert.equal(
      (await db.nodifyServer.findUniqueOrThrow({ where: { id: first.id } }))
        .protocolTraffic.upload,
      "9007199254741017",
    );
  } finally {
    await db.$disconnect();
  }
});
