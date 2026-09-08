import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { ruleFixture } from "./rule-fixture.mjs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
const require = createRequire(import.meta.url);
const {
  accountingTime,
} = require("../apps/backend/src/modules/nodify/daily-traffic.ts");
const {
  TrafficHistory,
} = require("../apps/backend/src/modules/nodify/traffic-history.ts");
const { TrafficHistoryQuery } = require("../packages/nodify-contract/index.ts");
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) =>
  new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
test(
  "restarted Agent retries the original persisted collection date and session until acknowledgement",
  { timeout: 20000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "nodify-daily-agent-"));
    const batch = {
      session: randomUUID(),
      sequence: 31,
      policyId: randomUUID(),
      policyReceipt: Buffer.from(
        "master-authenticated-billing-receipt-retained-with-the-batch",
      ).toString("base64"),
      collectedAt: daysAgo(1) + "T23:59:00.000Z",
      users: [{ userId: "1", upload: "12", download: "34" }],
    };
    await writeFile(
      join(directory, "state.json"),
      JSON.stringify({
        credential: "isolated-agent-credential",
        journal: {},
        outbox: [batch],
        session: randomUUID(),
        sequence: 99,
        counters: {},
        usage: {},
      }),
    );
    const received = [];
    const server = createServer(async (req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/agent/traffic") {
        let body = "";
        for await (const chunk of req) body += chunk;
        received.push(JSON.parse(body));
        res.statusCode = received.length === 1 ? 503 : 200;
        res.end(JSON.stringify({ acknowledged: 31 }));
      } else res.end(JSON.stringify({ operations: [] }));
    });
    server.on("upgrade", (_req, socket) => socket.destroy());
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("../apps/node/agent/main.mjs", import.meta.url))],
      {
        env: {
          ...process.env,
          NODIFY_AGENT_DATA: directory,
          NODIFY_PANEL: `http://127.0.0.1:${server.address().port}`,
          NODIFY_ALLOW_HTTP: "1",
        },
        stdio: "ignore",
      },
    );
    try {
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        const state = JSON.parse(
          await readFile(join(directory, "state.json"), "utf8"),
        );
        if (received.length >= 2 && !state.outbox.length) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(received.length, 2);
      assert.deepEqual(received[0], batch);
      assert.deepEqual(received[1], batch);
      assert.deepEqual(
        JSON.parse(await readFile(join(directory, "state.json"), "utf8"))
          .outbox,
        [],
      );
    } finally {
      const ended = once(child, "exit");
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 4000);
      await ended;
      clearTimeout(timer);
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
test("accounting dates mark clock fallback and bounded history queries reject invalid input", () => {
  const received = new Date("2026-09-08T12:00:00Z"),
    policy = new Date("2026-09-01T00:00:00Z");
  assert.equal(
    accountingTime("2026-09-07T23:59:59Z", policy, received).accountingDay,
    "2026-09-07",
  );
  assert.equal(
    accountingTime(undefined, policy, received).timeSource,
    "received",
  );
  for (const value of ["2026-09-09T00:00:00Z", "2026-08-01T00:00:00Z"]) {
    const result = accountingTime(value, policy, received);
    assert.equal(result.timeSource, "clock-skew");
    assert.equal(result.accountingDay, "2026-09-08");
  }
  for (const query of [
    { from: "2026-02-30", to: today() },
    { from: today(), to: daysAgo(1) },
    { from: daysAgo(90), to: today() },
    { from: today(), to: today(), userId: "wrong" },
    { from: today(), to: today(), userId: "9999999999999999999" },
  ])
    assert.equal(TrafficHistoryQuery.safeParse(query).success, false);
});
test("daily ledger preserves tariff history, offline dates, resets, raw ownership and missing days", async () => {
  const { db, service, entitlement, user } = await ruleFixture();
  try {
    const server = await db.nodifyServer.findFirstOrThrow();
    await db.nodifyEntitlement.update({
      where: { id: entitlement.id },
      data: { snapshot: { ...entitlement.snapshot, multiplier: 2 } },
    });
    const policy = await service.apply(server.id, 1);
    await db.nodifyOperation.update({
      where: { id: policy.id },
      data: { createdAt: new Date(daysAgo(3) + "T00:00:00Z") },
    });
    const batch = {
      session: randomUUID(),
      sequence: 0,
      policyId: policy.id,
      collectedAt: daysAgo(1) + "T12:00:00Z",
      users: [{ userId: String(user.id), upload: "3", download: "7" }],
    };
    await service.traffic(server.id, batch);
    await service.traffic(server.id, batch);
    assert.equal(await db.nodifyDailyTraffic.count(), 2);
    await db.nodifyEntitlement.update({
      where: { id: entitlement.id },
      data: { snapshot: { ...entitlement.snapshot, multiplier: 9 } },
    });
    await service.traffic(server.id, {
      ...batch,
      sequence: 1,
      collectedAt: new Date().toISOString(),
    });
    assert.equal(
      (
        await db.nodifyEntitlement.findUniqueOrThrow({
          where: { id: entitlement.id },
        })
      ).usedBytes,
      40n,
    );
    await service.resetEntitlement(String(user.id));
    await service.traffic(server.id, {
      ...batch,
      sequence: 2,
      users: [{ userId: String(user.id), upload: "1", download: "1" }],
    });
    await service.traffic(server.id, {
      ...batch,
      sequence: 3,
      collectedAt: undefined,
      users: [{ userId: "99999", upload: "100", download: "200" }],
    });
    const history = new TrafficHistory(service);
    const result = await history.read({
      from: daysAgo(2),
      to: today(),
      serverId: server.id,
    });
    assert.equal(result.days[0].upload, null);
    assert.equal(result.days[0].hasData, false);
    assert.equal(result.days[1].upload, "4");
    assert.equal(result.days[1].download, "8");
    assert.equal(result.days[1].charged, "20");
    assert.equal(result.totals.upload, "107");
    assert.equal(result.totals.download, "215");
    assert.equal(result.totals.charged, "40");
    assert.equal(result.totals.unchargedRaw, "302");
    assert.equal(result.totals.reports, 4);
    assert.equal(result.totals.receivedDateReports, 1);
    const personal = await history.read({
      from: daysAgo(2),
      to: today(),
      userId: String(user.id),
    });
    assert.equal(personal.totals.displayBytes, "44");
    assert.equal(personal.totals.charged, "40");
    assert.equal(result.totals.unratedRaw, "300");
    assert.equal(personal.totals.upload, "7");
    assert.equal(
      (
        await db.nodifyEntitlement.findUniqueOrThrow({
          where: { id: entitlement.id },
        })
      ).usedBytes,
      0n,
    );
    await db.nodifyServer.update({
      where: { id: server.id },
      data: { trafficSettings: { direction: "max", limitBytes: null } },
    });
    assert.equal(
      (await history.read({ from: daysAgo(2), to: today() })).totals
        .displayBytes,
      "215",
    );
    assert.equal(
      (
        await history.read({
          from: daysAgo(2),
          to: today(),
          userId: String(user.id),
        })
      ).totals.displayBytes,
      "44",
    );
    const unknown = await history.read({
      from: today(),
      to: today(),
      userId: "99999",
    });
    assert.equal(unknown.userName, null);
    assert.equal(unknown.totals.upload, "100");
    assert.equal(unknown.totals.charged, "0");
    await assert.rejects(() =>
      history.read({ from: today(), to: today(), serverId: randomUUID() }),
    );
  } finally {
    await db.$disconnect();
  }
});
test("daily persistence failure rolls back batch acknowledgement, raw counters and quota together", async () => {
  const { db, service, user, entitlement } = await ruleFixture();
  try {
    const server = await db.nodifyServer.findFirstOrThrow(),
      policy = await service.apply(server.id, 1);
    const key = { serverId: server.id, day: today(), userId: String(user.id) };
    await db.nodifyDailyTraffic.create({ data: { ...key, upload: "corrupt" } });
    const batch = {
      session: randomUUID(),
      sequence: 0,
      policyId: policy.id,
      collectedAt: new Date().toISOString(),
      users: [{ userId: String(user.id), upload: "3", download: "7" }],
    };
    await assert.rejects(() => service.traffic(server.id, batch));
    assert.equal(await db.nodifyTrafficBatch.count(), 0);
    assert.equal(
      (
        await db.nodifyEntitlement.findUniqueOrThrow({
          where: { id: entitlement.id },
        })
      ).usedBytes,
      0n,
    );
    assert.deepEqual(
      (await db.nodifyServer.findUniqueOrThrow({ where: { id: server.id } }))
        .protocolTraffic,
      {},
    );
    await db.nodifyDailyTraffic.update({
      where: { serverId_day_userId: key },
      data: { upload: "0" },
    });
    await service.traffic(server.id, batch);
    assert.equal(await db.nodifyTrafficBatch.count(), 1);
    assert.equal(
      (
        await db.nodifyEntitlement.findUniqueOrThrow({
          where: { id: entitlement.id },
        })
      ).usedBytes,
      10n,
    );
  } finally {
    await db.$disconnect();
  }
});
