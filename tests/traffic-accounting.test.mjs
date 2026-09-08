import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { ruleFixture } from "./rule-fixture.mjs";
const require = createRequire(import.meta.url);
const { trafficPeriod } = require("../packages/nodify-contract/index.ts");
const {
  TrafficAccounting,
} = require("../apps/backend/src/modules/nodify/traffic-accounting.ts");
const {
  fileTraffic,
} = require("../apps/backend/src/modules/nodify/traffic-display.ts");
test("UTC monthly periods clamp short months and remain deterministic across year and leap boundaries", () => {
  assert.deepEqual(trafficPeriod(null, new Date("2026-01-01Z")), {
    start: "lifetime",
    end: null,
    timezone: "UTC",
  });
  assert.deepEqual(trafficPeriod(31, new Date("2024-03-30T23:59:59Z")), {
    start: "2024-02-29",
    end: "2024-03-31",
    timezone: "UTC",
  });
  assert.equal(trafficPeriod(31, new Date("2026-03-01Z")).start, "2026-02-28");
  assert.equal(trafficPeriod(31, new Date("2026-01-01Z")).start, "2025-12-31");
  assert.equal(
    trafficPeriod(15, new Date("2026-04-15T00:00:00Z")).start,
    "2026-04-15",
  );
  assert.equal(
    trafficPeriod(15, new Date("2026-04-14T23:59:59Z")).start,
    "2026-03-15",
  );
});

test("server periods exclude old backfill and preserve nonlinear reset baselines, audit and idempotency", async () => {
  const f = await ruleFixture();
  try {
    const server = await f.db.nodifyServer.findFirstOrThrow(),
      accounting = new TrafficAccounting(f.service);
    const now = new Date(),
      year = now.getUTCFullYear(),
      month = now.getUTCMonth();
    const currentDate = new Date(Date.UTC(year, month, 1)).toISOString();
    const oldDate = new Date(Date.UTC(year, month - 1, 1)).toISOString();
    const policy = await f.service.apply(server.id, 1);
    await f.db.nodifyOperation.update({
      where: { id: policy.id },
      data: { createdAt: new Date(oldDate) },
    });
    let sequence = 0;
    const session = randomUUID();
    const meter = (upload, download, collectedAt = currentDate) =>
      f.service.traffic(server.id, {
        session,
        sequence: sequence++,
        policyId: policy.id,
        collectedAt,
        users: [{ userId: String(f.user.id), upload, download }],
      });
    await meter("1000", "2000", oldDate);
    await meter("100", "200");
    await accounting.saveSettings(server.id, {
      version: 1,
      resetDay: 1,
      direction: "max",
      limitBytes: "1000",
    });
    const read = () => accounting.read(server.id, undefined, now);
    let current = (await read()).current;
    assert.equal(current.usedBytes, "200");
    assert.equal(current.rawUpload, "100");
    assert.equal(current.epoch, 2);
    const action = (view, kind, targetBytes) => ({
      requestId: randomUUID(),
      settingsVersion: view.settingsVersion,
      periodKey: view.periodKey,
      version: view.version,
      action: kind,
      ...(targetBytes == null ? {} : { targetBytes }),
      reason: "controlled accounting test",
    });
    const calibration = action(current, "calibrate", "500");
    const quota = (await f.db.nodifyEntitlement.findFirstOrThrow()).usedBytes;
    await accounting.change(server.id, calibration, now);
    assert.equal((await read()).current.usedBytes, "500");
    assert.equal(
      (await accounting.change(server.id, calibration, now)).replayed,
      true,
    );
    assert.equal(await f.db.nodifyTrafficAdjustment.count(), 1);
    await assert.rejects(
      () =>
        accounting.change(
          server.id,
          { ...calibration, targetBytes: "501" },
          now,
        ),
      /请求标识/,
    );
    assert.equal(
      (await f.db.nodifyEntitlement.findFirstOrThrow()).usedBytes,
      quota,
    );
    await meter("50", "300");
    current = (await read()).current;
    assert.equal(current.usedBytes, "800");
    await accounting.saveSettings(server.id, {
      version: 2,
      resetDay: 1,
      direction: "max",
      limitBytes: "2000",
    });
    current = (await read()).current;
    assert.equal(current.epoch, 2);
    assert.equal(current.usedBytes, "800");
    await accounting.change(server.id, action(current, "reset"), now);
    assert.equal((await read()).current.usedBytes, "0");
    await meter("400", "10");
    current = (await read()).current;
    assert.equal(
      current.usedBytes,
      "400",
      "max must apply after subtracting both raw baselines",
    );
    assert.equal(
      BigInt(current.measuredBytes) + BigInt(current.totalAdjustment),
      400n,
    );
    await meter("999", "999", oldDate);
    assert.equal(
      (await read()).current.usedBytes,
      "400",
      "Past cycle late reports cannot leak into current usage",
    );
    const listed = (await f.service.listServers())[0];
    assert.equal(listed.billing.usedBytes, "400");
    const summary = fileTraffic(
      { statisticServerIds: [], tags: [], displayTrafficLimitBytes: null },
      [listed],
      [],
    );
    assert.equal(summary.usedBytes, "400");
    const oldAction = action(current, "clear");
    const next = new Date(Date.UTC(year, month + 1, 1));
    const rolled = (await accounting.read(server.id, undefined, next)).current;
    assert.equal(rolled.usedBytes, null);
    assert.equal(rolled.version, 0);
    assert.equal(rolled.manualAdjustment, "0");
    await assert.rejects(
      () => accounting.change(server.id, oldAction, next),
      /周期/,
    );
    await accounting.change(server.id, oldAction, now);
    assert.equal((await read()).current.usedBytes, "550");
    await accounting.saveSettings(server.id, {
      version: 3,
      resetDay: 1,
      direction: "upload",
      limitBytes: "2000",
    });
    const revised = await read();
    assert.equal(revised.current.epoch, 3);
    assert.equal(revised.current.usedBytes, "550");
    assert.equal(revised.events.length, 3);
    assert.equal(revised.events[0].accounting.epoch, 2);
    await assert.rejects(
      () => accounting.saveSettings(server.id, { version: 3 }),
      /设置已变化/,
    );
    await assert.rejects(
      () => accounting.read(server.id, randomUUID()),
      /游标无效/,
    );
    const seed = await f.db.nodifyTrafficAdjustment.findFirstOrThrow();
    await f.db.nodifyTrafficAdjustment.createMany({
      data: Array.from({ length: 51 }, (_, index) => {
        const id = randomUUID();
        return {
          id,
          accountingId: seed.accountingId,
          request: { ...seed.request, requestId: id },
          before: seed.before,
          after: seed.after,
          createdAt: new Date(Date.parse(oldDate) + index * 1000),
        };
      }),
    });
    const page = await accounting.read(server.id);
    assert.equal(page.events.length, 50);
    assert.ok(page.nextCursor);
    const rest = await accounting.read(server.id, page.nextCursor);
    assert.equal(rest.events.length, 4);
    assert.equal(rest.nextCursor, null);
    assert.equal(
      new Set([...page.events, ...rest.events].map((event) => event.id)).size,
      54,
    );
  } finally {
    await f.db.$disconnect();
  }
});

test("manual calibration without samples is explicit, clears back to unknown and persists transactionally", async () => {
  const f = await ruleFixture();
  try {
    const server = await f.db.nodifyServer.findFirstOrThrow(),
      accounting = new TrafficAccounting(f.service);
    await accounting.saveSettings(server.id, {
      version: 1,
      source: "network",
      interfaces: ["eth0"],
      resetDay: 1,
    });
    let current = (await accounting.read(server.id)).current;
    const input = (view) => ({
      requestId: randomUUID(),
      settingsVersion: view.settingsVersion,
      periodKey: view.periodKey,
      version: view.version,
      action: "calibrate",
      targetBytes: "0",
      reason: "zero from provider",
    });
    assert.equal(current.usedBytes, null);
    await accounting.change(server.id, input(current));
    current = (await accounting.read(server.id)).current;
    assert.equal(current.usedBytes, "0");
    assert.equal(current.hasData, false);
    assert.equal(current.calibrated, true);
    await accounting.change(server.id, {
      ...input(current),
      action: "clear",
      targetBytes: undefined,
    });
    assert.equal((await accounting.read(server.id)).current.usedBytes, null);
    const other = await f.service.createServer({
      name: "other",
      address: "other.example",
    });
    const first = await f.db.nodifyTrafficAdjustment.findFirstOrThrow();
    await assert.rejects(() => accounting.read(other.id, first.id), /游标无效/);
    await assert.rejects(
      () => accounting.change(other.id, first.request),
      /请求标识/,
    );
    // Fail the audit insert, after the accounting row would otherwise change.
    await f.db.$executeRawUnsafe(
      "CREATE TRIGGER fail_accounting_event BEFORE INSERT ON NodifyTrafficAdjustment BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END",
    );
    current = (await accounting.read(server.id)).current;
    await assert.rejects(() =>
      accounting.change(server.id, { ...input(current), targetBytes: "100" }),
    );
    assert.equal(
      (await accounting.read(server.id)).current.version,
      current.version,
    );
    assert.equal((await accounting.read(server.id)).current.usedBytes, null);
    assert.equal(await f.db.nodifyTrafficAdjustment.count(), 2);
  } finally {
    await f.db.$disconnect();
  }
});
