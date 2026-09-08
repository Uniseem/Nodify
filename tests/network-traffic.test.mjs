import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import dgram from "node:dgram";
import { networkDelta, readNetwork } from "../apps/node/agent/network.mjs";
import { ruleFixture } from "./rule-fixture.mjs";
const require = createRequire(import.meta.url);
const {
  NetworkBatch,
  ServerTrafficSettings,
  serverTrafficRaw,
} = require("../packages/nodify-contract/index.ts");
const {
  TrafficHistory,
} = require("../apps/backend/src/modules/nodify/traffic-history.ts");
const {
  networkMetrics,
} = require("../apps/backend/src/modules/nodify/network-traffic.ts");
const {
  fileTraffic,
} = require("../apps/backend/src/modules/nodify/traffic-display.ts");
const day = (offset) =>
  new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
const batch = (sequence = 1) => ({
  session: randomUUID(),
  sequence,
  bootId: randomUUID(),
  collectedAt: day(0) + "T01:00:00.000Z",
  interfaces: [
    {
      name: "eth0",
      index: 2,
      upload: "100",
      download: "200",
      discontinuity: false,
      intervalStart: day(0) + "T00:59:00.000Z",
    },
  ],
});

test("network baselines distinguish restarts, interface identity, large counters and clock changes", () => {
  const before = {
    bootId: randomUUID(),
    collectedAt: "2026-09-01T12:00:00.000Z",
    interfaces: { eth0: { index: 2, rx: "9007199254740999", tx: "1000" } },
  };
  const after = structuredClone(before);
  after.collectedAt = "2026-09-01T12:00:02.000Z";
  after.interfaces.eth0.rx = "9007199254741999";
  after.interfaces.eth0.tx = "1500";
  assert.deepEqual(networkDelta(before).interfaces[0], {
    name: "eth0",
    index: 2,
    upload: "0",
    download: "0",
    discontinuity: true,
    intervalStart: null,
  });
  assert.deepEqual(networkDelta(after, before).interfaces[0], {
    name: "eth0",
    index: 2,
    upload: "500",
    download: "1000",
    discontinuity: false,
    intervalStart: before.collectedAt,
  });
  for (const change of [
    (s) => (s.bootId = randomUUID()),
    (s) => (s.interfaces.eth0.index = 3),
    (s) => (s.interfaces.eth0.rx = "0"),
    (s) => (s.collectedAt = before.collectedAt),
  ]) {
    const current = structuredClone(after);
    change(current);
    const result = networkDelta(current, before).interfaces[0];
    assert.equal(result.discontinuity, true);
    assert.equal(result.upload, "0");
    assert.equal(result.download, "0");
  }
  const previous = {
    metrics: {
      interfaces: before.interfaces,
      networkCollectedAt: before.collectedAt,
      networkBootId: before.bootId,
    },
    trafficSettings: { source: "network", interfaces: ["eth0"] },
  };
  const metrics = networkMetrics(
    {
      interfaces: after.interfaces,
      networkCollectedAt: after.collectedAt,
      networkBootId: after.bootId,
    },
    previous,
  );
  assert.equal(metrics.networkRxRate, 500);
  assert.equal(metrics.networkTxRate, 250);
  assert.equal(
    networkMetrics({ ...metrics, networkBootId: randomUUID() }, previous)
      .networkRateAvailable,
    false,
  );
  assert.equal(
    ServerTrafficSettings.safeParse({ source: "network", interfaces: [] })
      .success,
    false,
  );
  assert.equal(
    NetworkBatch.safeParse({
      ...batch(),
      interfaces: [{ ...batch().interfaces[0], intervalStart: null }],
    }).success,
    false,
  );
  assert.equal(
    NetworkBatch.safeParse({
      ...batch(),
      interfaces: [...batch().interfaces, ...batch().interfaces],
    }).success,
    false,
  );
});

test("network ledger is deduplicated, selects interfaces and never charges protocol user quotas", async () => {
  const f = await ruleFixture();
  f.server = await f.db.nodifyServer.findFirstOrThrow();
  try {
    await f.db.nodifyServer.update({
      where: { id: f.server.id },
      data: { createdAt: new Date(day(3)) },
    });
    const first = batch();
    first.collectedAt = day(1) + "T00:01:00.000Z";
    first.interfaces[0].intervalStart = day(2) + "T23:59:00.000Z";
    first.interfaces.push({
      name: "br-test",
      index: 3,
      upload: "999",
      download: "888",
      discontinuity: true,
      intervalStart: null,
    });
    const quota = (await f.db.nodifyEntitlement.findFirst()).usedBytes;
    assert.deepEqual(await f.service.network(f.server.id, first), {
      acknowledged: 1,
    });
    await f.service.network(f.server.id, first);
    assert.equal(await f.db.nodifyNetworkBatch.count(), 1);
    assert.equal((await f.db.nodifyEntitlement.findFirst()).usedBytes, quota);
    assert.deepEqual(
      (await f.db.nodifyServer.findUnique({ where: { id: f.server.id } }))
        .protocolTraffic,
      {},
    );
    await f.db.nodifyServer.update({
      where: { id: f.server.id },
      data: {
        trafficSettings: {
          source: "network",
          interfaces: ["eth0"],
          direction: "max",
          limitBytes: "10000",
        },
      },
    });
    const service = new TrafficHistory(f.service);
    let history = await service.read({ from: day(2), to: day(0) });
    assert.equal(history.totals.upload, "100");
    assert.equal(history.totals.download, "200");
    assert.equal(history.totals.displayBytes, "200");
    assert.equal(history.totals.crossDateReports, 1);
    assert.equal(history.totals.discontinuities, 0);
    assert.equal(history.days[0].hasData, false);
    const server = await f.db.nodifyServer.findUnique({
      where: { id: f.server.id },
    });
    assert.equal(serverTrafficRaw(server).upload, "100");
    const fileStats = fileTraffic(
      {
        statisticServerIds: [server.id],
        tags: [],
        displayTrafficLimitBytes: null,
      },
      [{ ...server, node: { name: "network-test" } }],
      [],
    );
    assert.equal(fileStats.usedBytes, "200");
    assert.equal(fileStats.servers[0].source, "network");
    assert.equal(fileStats.unknownUsageCount, 0);
    history = await service.read({ from: day(2), to: day(0), userId: "1" });
    assert.equal(
      history.totals.upload,
      null,
      "User views never include NIC traffic",
    );
    await f.db.nodifyServer.update({
      where: { id: f.server.id },
      data: {
        trafficSettings: {
          source: "network",
          interfaces: ["br-test", "missing0"],
        },
      },
    });
    history = await service.read({ from: day(2), to: day(0) });
    assert.equal(history.totals.upload, "999");
    assert.equal(history.totals.discontinuities, 1);
    assert.deepEqual(history.servers[0].missingInterfaces, ["missing0"]);
    const missingServer = await f.db.nodifyServer.findUnique({
      where: { id: f.server.id },
    });
    const partial = fileTraffic(
      { statisticServerIds: [], tags: [], displayTrafficLimitBytes: null },
      [{ ...missingServer, node: { name: "missing-test" } }],
      [],
    );
    assert.equal(partial.unknownUsageCount, 1);
    const second = batch(2);
    await f.db.nodifyNetworkDaily.updateMany({ data: { upload: "corrupt" } });
    second.collectedAt = first.collectedAt;
    second.interfaces[0].intervalStart = first.interfaces[0].intervalStart;
    await assert.rejects(
      () => f.service.network(f.server.id, second),
      /BigInt/,
    );
    assert.equal(await f.db.nodifyNetworkBatch.count(), 1);
    assert.equal(
      (await f.db.nodifyServer.findUnique({ where: { id: f.server.id } }))
        .networkTraffic.interfaces.eth0.upload,
      "100",
    );
    await f.db.nodifyNetworkDaily.updateMany({
      where: { interface: "eth0" },
      data: { upload: "100" },
    });
    await f.service.network(f.server.id, second);
    assert.equal(await f.db.nodifyNetworkBatch.count(), 2);
    assert.equal(
      (await f.db.nodifyServer.findUnique({ where: { id: f.server.id } }))
        .networkTraffic.interfaces.eth0.upload,
      "200",
    );
  } finally {
    await f.db.$disconnect();
  }
});

test(
  "Agent persists network batches until a matching acknowledgement, including after process restart",
  { timeout: 20000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "nodify-network-agent-"));
    const original = batch(31);
    await writeFile(
      join(directory, "state.json"),
      JSON.stringify({
        credential: "network-test",
        journal: {},
        outbox: [],
        networkOutbox: [original],
        session: randomUUID(),
        sequence: 0,
        counters: {},
        usage: {},
      }),
    );
    const seen = [];
    const server = createServer(async (req, res) => {
      res.setHeader("Content-Type", "application/json");
      let body = "";
      for await (const chunk of req) body += chunk;
      if (req.url === "/api/agent/network") {
        const value = JSON.parse(body);
        if (value.session === original.session) seen.push(value);
        const mismatch =
          value.session === original.session && seen.length === 1;
        res.end(
          JSON.stringify({ acknowledged: mismatch ? 999 : value.sequence }),
        );
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
      const end = Date.now() + 12000;
      while (Date.now() < end) {
        const state = JSON.parse(
          await readFile(join(directory, "state.json"), "utf8"),
        );
        if (
          seen.length >= 2 &&
          !state.networkOutbox.some((row) => row.session === original.session)
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.deepEqual(seen, [original, original]);
      assert.equal(
        JSON.parse(
          await readFile(join(directory, "state.json"), "utf8"),
        ).networkOutbox.some((row) => row.session === original.session),
        false,
      );
    } finally {
      const end = once(child, "exit");
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 4000);
      await end;
      clearTimeout(timer);
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);

test(
  "Linux kernel NIC counters record controlled traffic to the isolated Docker gateway",
  { skip: process.platform !== "linux", timeout: 10000 },
  async () => {
    const before = await readNetwork();
    const routes = (await readFile("/proc/net/route", "utf8"))
      .split("\n")
      .map((line) => line.trim().split(/\s+/));
    const route = routes.find(
      (row) => row[1] === "00000000" && row[2] !== "00000000",
    );
    assert.ok(
      route,
      "A default gateway is required in the isolated test container",
    );
    assert.ok(
      process.env.NODIFY_TEST_SOURCE_URL,
      "This test must run in the authorized isolated VPS test container",
    );
    const gateway = route[2]
      .match(/../g)
      .reverse()
      .map((hex) => parseInt(hex, 16))
      .join(".");
    const socket = dgram.createSocket("udp4");
    try {
      for (let i = 0; i < 32; i++)
        await new Promise((resolve, reject) =>
          socket.send(Buffer.alloc(1024), 9, gateway, (error) =>
            error ? reject(error) : resolve(),
          ),
        );
    } finally {
      socket.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    const after = await readNetwork();
    const row = networkDelta(after, before).interfaces.find(
      (item) => item.name === route[0],
    );
    assert.ok(row && !row.discontinuity);
    assert.ok(
      BigInt(row.upload) >= 32768n,
      "Actual kernel TX counters must include the controlled datagrams",
    );
  },
);
