import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { createServer as httpServer } from "node:http";
import { createServer as tcpServer, connect } from "node:net";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queryStats } from "../apps/node/agent/statistics.mjs";
import { ruleFixture } from "./rule-fixture.mjs";
const require = createRequire(import.meta.url);
require("./loader.cjs");
const {
  ConfigInput,
  updatePolicyLevel,
  xrayDurationSeconds,
  renameOutbound,
  withBalancingObservers,
} = require("../packages/nodify-contract/index.ts");
const {
  compileConfiguration,
} = require("../apps/backend/src/modules/nodify/configuration.ts");
const exec = promisify(execFile),
  wait = (ms) => new Promise((r) => setTimeout(r, ms));
const parse = (xray) => ConfigInput.parse({ inbounds: [], xray });
const background = {
  subjectSelector: ["direct"],
  probeURL: "http://127.0.0.1:8000/health",
  probeInterval: "1m",
  enableConcurrency: false,
};
test("system policy validation preserves unknown fields and rejects unsafe numeric or observer configurations", () => {
  const original = {
    policy: {
      levels: {
        0: { handshake: 5, custom: { preserved: true } },
        7: { connIdle: 11 },
      },
      system: { statsOutboundUplink: true },
    },
    dns: { servers: [{ address: "9.9.9.9", skipFallback: true }] },
  };
  const updated = updatePolicyLevel(original, "0", {
    handshake: undefined,
    connIdle: 0,
    bufferSize: -1,
  });
  assert.equal(updated.policy.levels["0"].handshake, undefined);
  assert.equal(original.policy.levels["0"].handshake, 5);
  assert.deepEqual(updated.policy.levels["0"].custom, { preserved: true });
  assert.deepEqual(updated.policy.levels["7"], { connIdle: 11 });
  assert.deepEqual(parse(updated).xray, updated);
  assert.equal(xrayDurationSeconds("2h45m0.5s"), 9900.5);
  assert.equal(xrayDurationSeconds("1ms"), 0.001);
  for (const duration of ["-1s", "1", "Infinitys", "1d", "1s trailing"])
    assert.equal(xrayDurationSeconds(duration), null);
  for (const policy of [
    { levels: [] },
    { levels: { 0: null } },
    { levels: { 0: { handshake: -1 } } },
    { levels: { 0: { connIdle: 1.5 } } },
    { levels: { 0: { bufferSize: 2097152 } } },
    { levels: { 4294967296: {} } },
    { levels: { "00": {} } },
    { system: { statsOutboundUplink: "false" } },
  ])
    assert.throws(() => parse({ policy }), { name: "ZodError" });
  for (const observatory of [
    { ...background, subjectSelector: ["missing"] },
    { ...background, probeInterval: "0s" },
    { ...background, probeURL: "file:///tmp/test" },
    { ...background, probeURL: "https://user:password@example.com" },
    { ...background, probeURL: 123 },
    { ...background, probeUrl: background.probeURL },
    { ...background, enableConcurrency: 1 },
  ])
    assert.throws(() => parse({ observatory }), { name: "ZodError" });
  assert.throws(() =>
    parse({ burstObservatory: { subjectSelector: ["direct"] } }),
  );
  assert.throws(() =>
    parse({
      burstObservatory: {
        subjectSelector: ["direct"],
        pingConfig: { sampling: 0 },
      },
    }),
  );
  assert.throws(() =>
    parse({
      observatory: background,
      burstObservatory: { subjectSelector: ["direct"], pingConfig: {} },
    }),
  );
  assert.throws(() =>
    parse({
      burstObservatory: {
        subjectSelector: ["direct"],
        pingConfig: { httpMethod: "GET\r\nX-Test: value" },
      },
    }),
  );
  assert.equal(
    parse({
      burstObservatory: {
        subjectSelector: ["direct"],
        pingConfig: { httpMethod: "OPTIONS" },
      },
    }).xray.burstObservatory.pingConfig.httpMethod,
    "OPTIONS",
  );
  const renamed = renameOutbound(
    {
      outbounds: [{ tag: "direct", protocol: "freedom" }],
      observatory: background,
    },
    0,
    { tag: "next", protocol: "freedom" },
  );
  assert.deepEqual(renamed.observatory.subjectSelector, ["next"]);
  assert.deepEqual(background.subjectSelector, ["direct"]);
  assert.throws(
    () =>
      renameOutbound(
        {
          outbounds: [
            { tag: "direct", protocol: "freedom" },
            { tag: "direct-2", protocol: "freedom" },
          ],
          observatory: background,
        },
        0,
        { tag: "next", protocol: "freedom" },
      ),
    /观测前缀/,
  );
});

test(
  "installed Xray accepts policy levels and both observer modes without losing managed statistics",
  { skip: !process.env.NODIFY_TEST_XRAY },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "nodify-system-check-"));
    for (const kind of ["observatory", "burstObservatory"]) {
      const config = parse({
        policy: {
          levels: {
            0: {
              handshake: 8,
              connIdle: 30,
              uplinkOnly: 0,
              downlinkOnly: 0,
              bufferSize: 64,
              statsUserUplink: false,
              statsUserDownlink: false,
            },
            7: { bufferSize: -1, statsUserOnline: true },
          },
          system: {
            statsInboundUplink: false,
            statsOutboundUplink: true,
            statsOutboundDownlink: true,
          },
        },
        api: { listen: "0.0.0.0:10000", services: ["HandlerService"] },
        stats: {},
        [kind]:
          kind === "observatory"
            ? background
            : {
                subjectSelector: ["direct"],
                pingConfig: {
                  destination: "http://127.0.0.1:8000/health",
                  interval: "10s",
                  timeout: "1s",
                  sampling: 2,
                  httpMethod: "GET",
                },
              },
      });
      const compiled = compileConfiguration(config, []).xray;
      assert.deepEqual(compiled.api, {
        tag: "nodify-api",
        services: ["StatsService"],
      });
      assert.equal(compiled.inbounds.at(-1).listen, "127.0.0.1");
      assert.equal(compiled.policy.levels["0"].statsUserUplink, true);
      assert.equal(compiled.policy.levels["0"].statsUserDownlink, true);
      assert.equal(compiled.policy.levels["0"].connIdle, 30);
      assert.equal(compiled.policy.levels["7"].bufferSize, -1);
      assert.equal(compiled.policy.system.statsInboundUplink, true);
      assert.equal(compiled.policy.system.statsOutboundUplink, true);
      const file = join(dir, `${kind}.json`);
      writeFileSync(file, JSON.stringify(compiled));
      const out = await exec(
        process.env.NODIFY_TEST_XRAY,
        ["run", "-test", "-config", file],
        { timeout: 15000 },
      );
      assert.match(out.stdout, /Configuration OK/);
    }
  },
);

test("system settings remain in versioned drafts until Agent acknowledgement and failed publication retains the previous version", async () => {
  const f = await ruleFixture();
  try {
    const server = await f.db.nodifyServer.findFirstOrThrow(),
      previous = (await f.service.revisions(server.id))[0];
    const revision = await f.service.saveDraft(server.id, {
      ...previous.config,
      xray: {
        ...previous.config.xray,
        policy: {
          levels: {
            0: { connIdle: 77, bufferSize: 32, custom: "preserved" },
            8: { handshake: 12 },
          },
          system: { statsOutboundDownlink: true },
        },
        observatory: background,
      },
    });
    assert.equal(
      (await f.service.revisions(server.id))[0].config.xray.policy.levels["0"]
        .custom,
      "preserved",
    );
    await assert.rejects(() =>
      f.service.saveDraft(server.id, {
        ...revision.config,
        xray: { policy: { levels: { 0: { handshake: -1 } } } },
      }),
    );
    assert.equal((await f.service.revisions(server.id)).length, 2);
    const queued = await f.service.apply(server.id, revision.version);
    assert.equal(
      (await f.service.listServers())[0].appliedVersion,
      previous.version,
    );
    const payload = JSON.parse(
      f.service.box.open(
        (
          await f.db.nodifyOperation.findUniqueOrThrow({
            where: { id: queued.id },
          })
        ).payload,
      ),
    );
    assert.equal(payload.xray.policy.levels["0"].connIdle, 77);
    await f.service.complete(server.id, queued.id, "succeeded", "", {});
    assert.equal(
      (await f.service.listServers())[0].appliedVersion,
      revision.version,
    );
    const next = await f.service.saveDraft(server.id, {
      ...revision.config,
      xray: updatePolicyLevel(revision.config.xray, "0", { connIdle: 88 }),
    });
    const failed = await f.service.apply(server.id, next.version);
    await f.service.complete(
      server.id,
      failed.id,
      "failed",
      "core check failed",
      {},
    );
    assert.equal(
      (await f.service.listServers())[0].appliedVersion,
      revision.version,
    );
    assert.equal(
      (await f.service.revisions(server.id))[0].config.xray.policy.levels["0"]
        .connIdle,
      88,
    );
  } finally {
    await f.db.$disconnect();
  }
});

test(
  "real Xray background observation selects the faster egress, fails over, falls back and recovers with user accounting",
  { skip: !process.env.NODIFY_TEST_XRAY, timeout: 60000 },
  async () => {
    const children = [],
      sockets = new Set(),
      listeners = [],
      logs = [];
    const dir = mkdtempSync(join(tmpdir(), "nodify-observer-"));
    const listen = async (server) => {
      listeners.push(server);
      await new Promise((r) => server.listen(0, "127.0.0.1", r));
      return server.address().port;
    };
    const free = async () => {
      const s = tcpServer();
      const port = await listen(s);
      await new Promise((r) => s.close(r));
      return port;
    };
    const destination = (name, delay) =>
      httpServer((req, res) => {
        if (req.url === "/health") {
          setTimeout(() => {
            res.writeHead(204);
            res.end();
          }, delay);
        } else res.end(name.repeat(1024));
      });
    const track = (s) => {
      sockets.add(s);
      s.on("close", () => sockets.delete(s));
      s.on("error", () => {});
      return s;
    };
    const proxy = (port) => {
      const s = httpServer();
      s.on("connect", (_req, client, head) => {
        track(client);
        const target = track(
          connect(port, "127.0.0.1", () => {
            client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
            if (head.length) target.write(head);
            client.pipe(target);
            target.pipe(client);
          }),
        );
        target.on("error", () => client.destroy());
        client.on("close", () => target.destroy());
      });
      return s;
    };
    const start = async (name, value) => {
      const file = join(dir, `${name}.json`);
      writeFileSync(file, JSON.stringify(value));
      await exec(process.env.NODIFY_TEST_XRAY, [
        "run",
        "-test",
        "-config",
        file,
      ]);
      const child = spawn(
        process.env.NODIFY_TEST_XRAY,
        ["run", "-config", file],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      children.push(child);
      child.stdout.on("data", (b) => logs.push(b.toString()));
      child.stderr.on("data", (b) => logs.push(b.toString()));
      return child;
    };
    try {
      const fallback = await listen(destination("F", 0)),
        a = await listen(destination("A", 0)),
        b = await listen(destination("B", 150));
      const pa = proxy(a),
        pb = proxy(b),
        portA = await listen(pa),
        portB = await listen(pb),
        inPort = await free(),
        apiPort = await free(),
        clientPort = await free();
      const inboundId = randomUUID(),
        uuid = randomUUID();
      const config = ConfigInput.parse({
        inbounds: [
          {
            id: inboundId,
            name: "observed",
            protocol: "vless",
            port: inPort,
            network: "tcp",
            security: "none",
          },
        ],
        xray: withBalancingObservers({
          policy: {
            levels: { 0: { handshake: 5, connIdle: 20, bufferSize: 32 } },
            system: { statsOutboundUplink: true, statsOutboundDownlink: true },
          },
          outbounds: [
            {
              tag: "direct",
              protocol: "freedom",
              settings: {
                finalRules: [{ action: "allow", ip: ["127.0.0.1/32"] }],
              },
            },
            ...[
              [portA, "proxy-a"],
              [portB, "proxy-b"],
            ].map(([port, tag]) => ({
              tag,
              protocol: "http",
              settings: { servers: [{ address: "127.0.0.1", port }] },
            })),
          ],
          routing: {
            rules: [
              {
                type: "field",
                inboundTag: [inboundId],
                network: "tcp",
                balancerTag: "pool",
              },
            ],
            balancers: [
              {
                tag: "pool",
                selector: ["proxy-"],
                fallbackTag: "direct",
                strategy: { type: "leastPing" },
              },
            ],
          },
          observatory: {
            subjectSelector: ["proxy-"],
            probeURL: `http://127.0.0.1:${fallback}/health`,
            probeInterval: "200ms",
            enableConcurrency: true,
          },
        }),
      });
      const runtime = compileConfiguration(config, [
        {
          id: "observer-user",
          uuid,
          password: "unused",
          ssPassword: "unused",
          anytlsPassword: "unused",
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          remainingBytes: "10000000",
          nodeIds: [inboundId],
          tags: [],
        },
      ]).xray;
      runtime.inbounds.at(-1).port = apiPort;
      await start("server", runtime);
      await start("client", {
        log: { loglevel: "warning" },
        inbounds: [
          {
            listen: "127.0.0.1",
            port: clientPort,
            protocol: "socks",
            settings: { auth: "noauth" },
          },
        ],
        outbounds: [
          {
            protocol: "vless",
            settings: {
              vnext: [
                {
                  address: "127.0.0.1",
                  port: inPort,
                  users: [{ id: uuid, encryption: "none" }],
                },
              ],
            },
          },
        ],
      });
      const download = async () =>
        (
          await exec(
            process.platform === "win32" ? "curl.exe" : "curl",
            [
              "--silent",
              "--show-error",
              "--fail",
              "--max-time",
              "2",
              "--noproxy",
              "",
              "--proxy",
              `socks5h://127.0.0.1:${clientPort}`,
              `http://127.0.0.1:${fallback}/payload`,
            ],
            { timeout: 3500 },
          )
        ).stdout;
      const expectPath = async (name) => {
        const until = Date.now() + 10000;
        let last = "";
        while (Date.now() < until) {
          try {
            last = await download();
            if (last === name.repeat(1024)) return;
          } catch (e) {
            last = e.message;
          }
          await wait(250);
        }
        assert.fail(
          `Expected egress ${name}, got ${last.slice(0, 150)}\n${logs.join("").slice(-2500)}`,
        );
      };
      await expectPath("A");
      // Close the proxy listener and existing CONNECT tunnels, not just its HTTP keep-alive pool.
      await new Promise((r) => pa.close(r));
      for (const socket of [...sockets]) socket.destroy();
      await expectPath("B");
      await new Promise((r) => pb.close(r));
      for (const socket of [...sockets]) socket.destroy();
      await expectPath("F");
      await new Promise((r) => pa.listen(portA, "127.0.0.1", r));
      await expectPath("A");
      const stats = await queryStats(apiPort);
      assert.ok(
        BigInt(stats["user>>>observer-user>>>traffic>>>downlink"] || "0") >=
          4096n,
      );
      const queried = await exec(process.env.NODIFY_TEST_XRAY, [
        "api",
        "statsquery",
        `--server=127.0.0.1:${apiPort}`,
        "-pattern",
        "outbound>>>",
      ]);
      const counters = JSON.parse(queried.stdout).stat;
      assert.ok(
        BigInt(
          counters.find(
            (row) => row.name === "outbound>>>proxy-a>>>traffic>>>downlink",
          )?.value || "0",
        ) > 0n,
      );
    } finally {
      for (const s of sockets) s.destroy();
      for (const s of listeners) {
        s.closeAllConnections?.();
        s.close();
      }
      for (const c of children) {
        if (c.exitCode === null) c.kill();
      }
      await Promise.all(
        children.map((c) =>
          c.exitCode !== null
            ? Promise.resolve()
            : new Promise((r) => c.once("exit", r)),
        ),
      );
    }
  },
);
