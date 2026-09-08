import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { ruleFixture } from "./rule-fixture.mjs";
const require = createRequire(import.meta.url);
const {
  TrafficOverview,
} = require("../apps/backend/src/modules/nodify/overview-traffic.ts");
const {
  TrafficAccounting,
} = require("../apps/backend/src/modules/nodify/traffic-accounting.ts");
const day = (offset) =>
  new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
const item = (name, upload, download) => ({
  name,
  index: name === "eth0" ? 2 : 3,
  upload,
  download,
  discontinuity: false,
  intervalStart: day(1) + "T11:59:00Z",
});
const batch = (interfaces) => ({
  session: randomUUID(),
  sequence: 0,
  bootId: randomUUID(),
  collectedAt: day(1) + "T12:00:00Z",
  interfaces,
});
async function source(f, name, traffic, enabled = true) {
  return f.db.nodifySubscriptionSource.create({
    data: {
      name,
      encryptedUrl: f.service.box.seal(
        "https://example.com/overview-secret-DO-NOT-RETURN",
      ),
      enabled,
      traffic,
      trafficDirection: "upload",
      lastSyncedAt: new Date(),
      intervalMinutes: 60,
      trafficStale: false,
    },
  });
}

test("overview separates finite, unlimited and unknown quotas; calibration and external snapshots stay out of trend", async () => {
  const f = await ruleFixture();
  try {
    const overview = new TrafficOverview(f.service),
      accounting = new TrafficAccounting(f.service);
    const primary = await f.db.nodifyServer.findFirstOrThrow();
    const policy = await f.service.apply(primary.id, 1);
    await f.db.nodifyOperation.update({
      where: { id: policy.id },
      data: { createdAt: new Date(day(60)) },
    });
    await f.service.traffic(primary.id, {
      session: randomUUID(),
      sequence: 0,
      policyId: policy.id,
      collectedAt: day(1) + "T12:00:00Z",
      users: [{ userId: String(f.user.id), upload: "80", download: "70" }],
    });
    await accounting.saveSettings(primary.id, {
      version: 1,
      limitBytes: "100",
    });
    for (const [name, limitBytes, used, includeInOverview] of [
      ["finite", "200", "10", true],
      ["unlimited", "0", "20", true],
      ["unknown", null, "30", true],
      ["excluded", "900", "999", false],
    ]) {
      const server = await f.service.createServer({
        name,
        address: `${name}.example`,
      });
      await f.db.nodifyServer.update({
        where: { id: server.id },
        data: { createdAt: new Date(day(60)), lastSeenAt: new Date() },
      });
      await f.service.network(server.id, batch([item("eth0", used, "0")]));
      await accounting.saveSettings(server.id, {
        version: 1,
        source: "network",
        interfaces: ["eth0"],
        limitBytes,
        includeInOverview,
      });
    }
    await source(f, "upstream", {
      upload: "40",
      download: "60",
      total: "1000",
      expire: null,
    });
    await source(f, "unknown-upstream", undefined);
    await source(f, "expired-unlimited", {
      upload: "70",
      download: "7",
      total: "0",
      expire: String(Math.floor(Date.now() / 1000) - 60),
    });
    await source(
      f,
      "disabled-upstream",
      { upload: "99999", download: "0", total: "99999", expire: null },
      false,
    );
    let view = await overview.read();
    assert.equal(view.selectedServers, 4);
    assert.equal(view.excludedServers, 1);
    assert.equal(view.enabledExternalSources, 3);
    assert.equal(view.items.length, 4);
    assert.equal(view.finite.limitBytes, "300");
    assert.equal(view.finite.usedBytes, "160");
    assert.equal(view.finite.remainingBytes, "190");
    assert.equal(view.finite.overageBytes, "50");
    assert.equal(view.unlimited.usedBytes, "20");
    assert.equal(view.unknownCapacity.usedBytes, "30");
    assert.equal(view.days.find((row) => row.day === day(1)).usedBytes, "210");
    assert.equal(view.days[0].usedBytes, null);
    const before = (await accounting.read(primary.id)).current;
    await accounting.change(primary.id, {
      requestId: randomUUID(),
      version: before.version,
      settingsVersion: before.settingsVersion,
      periodKey: before.periodKey,
      action: "calibrate",
      targetBytes: "500",
      reason: "KPI only adjustment",
    });
    await overview.save({ version: 0, includeExternal: true });
    await assert.rejects(
      () => overview.save({ version: 0, includeExternal: false }),
      /设置已变化/,
    );
    view = await overview.read();
    assert.equal(view.finite.limitBytes, "1300");
    assert.equal(view.finite.usedBytes, "610");
    assert.equal(view.finite.remainingBytes, "1090");
    assert.equal(view.finite.overageBytes, "400");
    assert.equal(view.unlimited.count, 2);
    assert.equal(view.unlimited.usedBytes, "97");
    assert.equal(view.unlimited.expiredCount, 1);
    assert.equal(view.unknownCapacity.count, 2);
    assert.equal(view.unknownCapacity.unknownUsageCount, 1);
    assert.equal(
      view.items.find((row) => row.name === "upstream").usedBytes,
      "100",
      "Homepage always uses both directions for external sources",
    );
    assert.equal(view.days.find((row) => row.day === day(1)).usedBytes, "210");
    assert.equal(JSON.stringify(view).includes("overview-secret"), false);
  } finally {
    await f.db.$disconnect();
  }
});

test("overview combines selected interfaces before daily max, preserves huge sums and shows empty selection as unknown", async () => {
  const f = await ruleFixture();
  try {
    const server = await f.db.nodifyServer.findFirstOrThrow(),
      accounting = new TrafficAccounting(f.service),
      overview = new TrafficOverview(f.service);
    await f.db.nodifyServer.update({
      where: { id: server.id },
      data: { createdAt: new Date(day(60)), lastSeenAt: new Date() },
    });
    await f.service.network(
      server.id,
      batch([item("eth0", "100", "0"), item("eth1", "0", "100")]),
    );
    const zero = batch([item("eth0", "0", "0")]);
    zero.collectedAt = new Date().toISOString();
    await f.service.network(server.id, zero);
    const settings = {
      source: "network",
      interfaces: ["eth0", "eth1"],
      direction: "max",
      limitBytes: "1000",
    };
    await accounting.saveSettings(server.id, { ...settings, version: 1 });
    let view = await overview.read();
    assert.equal(view.days.find((row) => row.day === day(1)).usedBytes, "100");
    assert.equal(view.days.at(-1).usedBytes, "0");
    assert.equal(view.days.at(-1).missingInterfaces, 1);
    assert.equal(view.days[0].usedBytes, null);
    const before = (await accounting.read(server.id)).current;
    await accounting.change(server.id, {
      requestId: randomUUID(),
      version: before.version,
      settingsVersion: before.settingsVersion,
      periodKey: before.periodKey,
      action: "calibrate",
      targetBytes: "7",
      reason: "inclusion does not reset accounting",
    });
    await accounting.saveSettings(server.id, {
      ...settings,
      version: 2,
      includeInOverview: false,
    });
    assert.equal((await accounting.read(server.id)).current.usedBytes, "7");
    view = await overview.read();
    assert.equal(view.selectedServers, 0);
    assert.equal(view.finite.limitBytes, null);
    assert.equal(view.finite.usedBytes, null);
    assert.ok(view.days.every((row) => row.usedBytes === null));
    await accounting.saveSettings(server.id, {
      ...settings,
      version: 3,
      includeInOverview: true,
    });
    const huge = "9".repeat(39);
    await source(f, "huge", {
      upload: huge,
      download: huge,
      total: huge,
      expire: null,
    });
    await overview.save({ version: 0, includeExternal: true });
    view = await overview.read();
    assert.equal(view.finite.usedBytes, (BigInt(huge) * 2n + 7n).toString());
    assert.equal(view.finite.limitBytes, (BigInt(huge) + 1000n).toString());
    assert.equal(view.days.find((row) => row.day === day(1)).usedBytes, "100");
  } finally {
    await f.db.$disconnect();
  }
});
