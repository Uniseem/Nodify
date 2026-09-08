import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { createServer } from "node:net";
import { createServer as httpServer, request as httpRequest } from "node:http";
import { DirectChannel } from "../apps/node/agent/direct-channel.mjs";
import { ruleFixture } from "./rule-fixture.mjs";
const require = createRequire(import.meta.url);
const {
  AgentConnections,
  NodifyDirectGateway,
  exchangeDirect,
} = require("../apps/backend/src/modules/nodify/agent-connection.ts");
const {
  AgentConnectionInput,
} = require("../packages/nodify-contract/index.ts");
const {
  TerminalSessions,
} = require("../apps/backend/src/modules/nodify/terminal-sessions.ts");
let directory, cert, key;
const originalCAs = getCACertificates();
const token = randomBytes(32).toString("hex");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = async () => {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
};
async function wait(check, message = "Direct condition timed out", ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return;
    await delay(80);
  }
  throw Error(message);
}
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "nodify-direct-tls-"));
  cert = join(directory, "cert.pem");
  key = join(directory, "key.pem");
  const gitSSL = "C:/Program Files/Git/usr/bin/openssl.exe";
  await promisify(execFile)(
    process.env.NODIFY_TEST_OPENSSL ||
      (process.platform === "win32" && existsSync(gitSSL) ? gitSSL : "openssl"),
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
      "-keyout",
      key,
      "-out",
      cert,
    ],
    { windowsHide: true },
  );
  setDefaultCACertificates([...originalCAs, await readFile(cert, "utf8")]);
});
after(() => setDefaultCACertificates(originalCAs));

test("direct connection validates HTTPS, encrypts credentials and preserves edits on version conflict", async () => {
  const f = await ruleFixture();
  try {
    const server = await f.db.nodifyServer.findFirstOrThrow(),
      connections = new AgentConnections(f.service);
    assert.equal((await connections.read(server.id)).version, 0);
    for (const endpoint of [
      "http://127.0.0.1",
      "https://a:b@host",
      "https://host/?token=secret",
      "https://host/#secret",
    ])
      assert.equal(
        AgentConnectionInput.safeParse({
          version: 0,
          enabled: true,
          endpoint,
          token,
        }).success,
        false,
      );
    await assert.rejects(
      () =>
        connections.save(server.id, {
          version: 0,
          enabled: true,
          endpoint: "https://127.0.0.1:23889",
        }),
      /凭据/,
    );
    const saved = await connections.save(server.id, {
      version: 0,
      enabled: true,
      endpoint: "https://127.0.0.1:23889/",
      token,
    });
    assert.equal(saved.version, 1);
    assert.equal(saved.endpoint, "https://127.0.0.1:23889");
    assert.equal(JSON.stringify(saved).includes(token), false);
    assert.equal(
      JSON.stringify(await f.service.listServers(), (_, v) =>
        typeof v === "bigint" ? v.toString() : v,
      ).includes(token),
      false,
    );
    const stored = await f.db.nodifyAgentConnection.findUniqueOrThrow({
      where: { serverId: server.id },
    });
    assert.equal(stored.encryptedData.includes(token), false);
    await assert.rejects(
      () =>
        connections.save(server.id, {
          version: 0,
          enabled: false,
          endpoint: saved.endpoint,
          token,
        }),
      /已变化/,
    );
    await connections.save(server.id, {
      version: 1,
      enabled: false,
      endpoint: saved.endpoint,
    });
    assert.equal(
      JSON.parse(
        f.service.box.open(
          (
            await f.db.nodifyAgentConnection.findUniqueOrThrow({
              where: { serverId: server.id },
            })
          ).encryptedData,
        ),
      ).token,
      token,
    );
  } finally {
    await f.db.$disconnect();
  }
});

test("real HTTPS direct exchange authenticates, retains request IDs and rejects untrusted TLS", async () => {
  assert.throws(
    () =>
      new DirectChannel({ token, credential: () => token, host: "0.0.0.0" }),
    /TLS/,
  );
  const channel = new DirectChannel({
    token,
    credential: () => token,
    cert,
    key,
    port: 0,
  });
  const { port } = await channel.listen(),
    endpoint = `https://127.0.0.1:${port}`;
  try {
    await assert.rejects(
      () => exchangeDirect(endpoint, "wrong", null, AbortSignal.timeout(2000)),
      /401/,
    );
    const result = channel.request("heartbeat", { text: "中文" });
    const a = await exchangeDirect(
      endpoint,
      token,
      null,
      AbortSignal.timeout(2000),
    );
    const b = await exchangeDirect(
      endpoint,
      token,
      null,
      AbortSignal.timeout(2000),
    );
    assert.deepEqual(a, b);
    assert.equal(a.frame.data.text, "中文");
    const last = exchangeDirect(
      endpoint,
      token,
      { id: a.frame.id, result: { received: "中文" } },
      AbortSignal.timeout(3000),
    );
    assert.deepEqual(await result, { received: "中文" });
    await channel.close();
    await last;
    const untrusted = new DirectChannel({
      token,
      credential: () => token,
      cert,
      key,
      port: 0,
    });
    await untrusted.listen();
    setDefaultCACertificates(originalCAs);
    try {
      await assert.rejects(
        () =>
          exchangeDirect(
            `https://127.0.0.1:${untrusted.server.address().port}`,
            token,
            null,
            AbortSignal.timeout(3000),
          ),
        /TLS/,
      );
    } finally {
      setDefaultCACertificates([...originalCAs, await readFile(cert, "utf8")]);
      await untrusted.close();
    }
  } finally {
    await channel.close();
  }
});

test("panel direct gateway leases one dispatcher and rejects cross-server Agent identities", async () => {
  const f = await ruleFixture(),
    connections = new AgentConnections(f.service),
    gateway = new NodifyDirectGateway(f.service),
    otherGateway = new NodifyDirectGateway(f.service);
  const server = await f.service.createServer({
      name: "direct-scope",
      address: "127.0.0.3",
    }),
    credentials = await f.service.enroll(server.token, "0.3.0", "direct-test");
  let credential = credentials.credential;
  const channel = new DirectChannel({
    token,
    credential: () => credential,
    cert,
    key,
    port: 0,
  });
  await channel.listen();
  try {
    await connections.save(server.id, {
      version: 0,
      enabled: true,
      endpoint: `https://127.0.0.1:${channel.server.address().port}`,
      token,
    });
    await Promise.all([gateway.tick(), otherGateway.tick()]);
    const row = await f.db.nodifyAgentConnection.findUniqueOrThrow({
      where: { serverId: server.id },
    });
    assert.ok([gateway.owner, otherGateway.owner].includes(row.leaseOwner));
    const reply = await channel.request("heartbeat", {
      session: credentials.serverId,
      version: "0.3.0",
      connectionTransport: "fake",
    });
    assert.ok(Array.isArray(reply.operations));
    assert.equal(
      (await f.db.nodifyServer.findUniqueOrThrow({ where: { id: server.id } }))
        .metrics.connectionTransport,
      "direct",
    );
    const stranger = await f.service.createServer({
      name: "direct-stranger",
      address: "127.0.0.4",
    });
    credential = (await f.service.enroll(stranger.token, "0.3.0", "stranger"))
      .credential;
    const strangerSeen = (
      await f.db.nodifyServer.findUniqueOrThrow({ where: { id: stranger.id } })
    ).lastSeenAt;
    const rejected = channel
      .request("heartbeat", { version: "SHOULD_NOT_APPLY" })
      .catch(() => null);
    await wait(async () => !!(await connections.read(server.id)).lastError);
    assert.equal(
      (await f.db.nodifyServer.findUniqueOrThrow({ where: { id: server.id } }))
        .version,
      "0.3.0",
    );
    assert.deepEqual(
      (
        await f.db.nodifyServer.findUniqueOrThrow({
          where: { id: stranger.id },
        })
      ).lastSeenAt,
      strangerSeen,
    );
    await channel.close();
    await rejected;
  } finally {
    await Promise.all([
      gateway.onModuleDestroy(),
      otherGateway.onModuleDestroy(),
    ]);
    await channel.close();
    await f.db.$disconnect();
  }
});

test("direct fallback deadline discards late acknowledgements without resolving the next request", async () => {
  const channel = new DirectChannel({
    token,
    credential: () => token,
    cert,
    key,
    port: 0,
  });
  const { port } = await channel.listen();
  const endpoint = `https://127.0.0.1:${port}`;
  try {
    await assert.rejects(
      channel.request("heartbeat", {}, { timeoutMs: 0 }),
      /timeout/i,
    );
    const expired = assert.rejects(
      channel.request("heartbeat", { attempt: 1 }, { timeoutMs: 1000 }),
      /timed out/i,
    );
    const first = await exchangeDirect(
      endpoint,
      token,
      null,
      AbortSignal.timeout(2000),
    );
    await expired;
    let resolved = false;
    const result = channel
      .request("heartbeat", { attempt: 2 })
      .then((value) => {
        resolved = true;
        return value;
      });
    const second = await exchangeDirect(
      endpoint,
      token,
      { id: first.frame.id, result: { stale: true } },
      AbortSignal.timeout(2000),
    );
    assert.notEqual(first.frame.id, second.frame.id);
    assert.equal(second.frame.data.attempt, 2);
    assert.equal(resolved, false);
    const poll = exchangeDirect(
      endpoint,
      token,
      { id: second.frame.id, result: { fresh: true } },
      AbortSignal.timeout(2000),
    );
    assert.deepEqual(await result, { fresh: true });
    await channel.close();
    await poll;
  } finally {
    await channel.close();
  }
});

for (const mode of ["direct", "auto"])
  test(
    `real Linux Agent ${mode}: task replay, measured download, traffic replay and PTY survive transport recovery`,
    {
      skip:
        process.platform !== "linux" ||
        !process.env.NODIFY_TEST_PTY ||
        !process.env.NODIFY_TEST_XRAY ||
        !process.env.NODIFY_TEST_SINGBOX,
      timeout: 240000,
    },
    async () => {
      const { Module } = require("../apps/backend/node_modules/@nestjs/common");
      const {
        NestFactory,
      } = require("../apps/backend/node_modules/@nestjs/core");
      const {
        NodifyService,
      } = require("../apps/backend/src/modules/nodify/nodify.service.ts");
      const {
        NodifyAgentController,
      } = require("../apps/backend/src/modules/nodify/nodify.controller.ts");
      const {
        NodifyAgentGateway,
      } = require("../apps/backend/src/modules/nodify/agent.gateway.ts");
      const f = await ruleFixture(),
        connections = new AgentConnections(f.service);
      const server = await f.service.createServer({
        name: "actual-direct",
        address: "127.0.0.3",
      });
      let app,
        agent,
        client,
        downloadServer,
        gateway = new NodifyDirectGateway(f.service),
        requests = [],
        log = "";
      let blockWS = false;
      const sockets = new Set();
      const port = await freePort(),
        data = join(f.directory, "direct-agent");
      try {
        class TestModule {}
        Module({
          controllers: [NodifyAgentController],
          providers: [
            { provide: NodifyService, useValue: f.service },
            NodifyAgentGateway,
          ],
        })(TestModule);
        app = await NestFactory.create(TestModule, {
          logger: false,
          httpsOptions: {
            cert: await readFile(cert),
            key: await readFile(key),
          },
        });
        app.use((req, res, next) => {
          requests.push(req.url);
          next();
        });
        app.setGlobalPrefix("api");
        await app.listen(0, "127.0.0.1");
        app.getHttpServer().prependListener("upgrade", (req, socket) => {
          if (blockWS) {
            req.url = "/qa-denied";
            socket.destroy();
            return;
          }
          sockets.add(socket);
          socket.once("close", () => sockets.delete(socket));
        });
        await connections.save(server.id, {
          version: 0,
          enabled: true,
          endpoint: `https://127.0.0.1:${port}`,
          token,
        });
        gateway.onModuleInit();
        await gateway.tick();
        agent = spawn(
          process.execPath,
          [
            fileURLToPath(
              new URL("../apps/node/agent/main.mjs", import.meta.url),
            ),
          ],
          {
            env: {
              ...process.env,
              NODIFY_PANEL: await app.getUrl(),
              NODIFY_ALLOW_HTTP: "1",
              NODIFY_ENROLLMENT: server.token,
              NODIFY_AGENT_DATA: data,
              NODIFY_CONNECTION_MODE: mode,
              NODE_EXTRA_CA_CERTS: cert,
              NODIFY_DIRECT_TOKEN: token,
              NODIFY_DIRECT_PORT: String(port),
              NODIFY_DIRECT_CERT: cert,
              NODIFY_DIRECT_KEY: key,
              NODIFY_PTY_BINARY: process.env.NODIFY_TEST_PTY,
              NODIFY_XRAY_BINARY: process.env.NODIFY_TEST_XRAY,
              NODIFY_SING_BOX_BINARY: process.env.NODIFY_TEST_SINGBOX,
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        agent.stdout.on("data", (d) => {
          log += d;
        });
        agent.stderr.on("data", (d) => {
          log += d;
        });
        await wait(
          async () =>
            (
              await f.db.nodifyServer.findUniqueOrThrow({
                where: { id: server.id },
              })
            ).metrics.connectionTransport ===
            (mode === "auto" ? "ws" : "direct"),
          "Agent failed: " + log,
        );
        const marker = join(data, "once.txt");
        const op = await f.service.operation(server.id, "terminal", {
          command: `printf x >> '${marker}'`,
          timeoutSeconds: 5,
        });
        await wait(
          async () =>
            (
              await f.db.nodifyOperation.findUniqueOrThrow({
                where: { id: op.id },
              })
            ).state === "succeeded",
        );
        await f.db.nodifyOperation.update({
          where: { id: op.id },
          data: { state: "queued" },
        });
        await wait(
          async () =>
            (
              await f.db.nodifyOperation.findUniqueOrThrow({
                where: { id: op.id },
              })
            ).state === "succeeded",
        );
        assert.equal(await readFile(marker, "utf8"), "x");
        const rotation = await f.service.rotateCredential(server.id);
        await wait(
          async () =>
            (
              await f.db.nodifyOperation.findUniqueOrThrow({
                where: { id: rotation.id },
              })
            ).state === "succeeded",
        );
        const inboundPort = await freePort(),
          inboundId = crypto.randomUUID();
        const draft = await f.service.saveDraft(server.id, {
          inbounds: [
            {
              id: inboundId,
              name: "Direct managed VLESS",
              protocol: "vless",
              port: inboundPort,
              network: "tcp",
              security: "none",
            },
          ],
          xray: {
            outbounds: [
              {
                tag: "direct",
                protocol: "freedom",
                settings: {
                  finalRules: [{ action: "allow", ip: ["127.0.0.1/32"] }],
                },
              },
            ],
          },
        });
        const pkg = await f.service.savePackage({
          name: "direct package",
          trafficLimitBytes: "10000000",
          validDays: 1,
          nodeIds: [inboundId],
        });
        await f.service.assignPackage(String(f.user.id), pkg.id);
        let lastBatch,
          lostAck = false,
          replayedAfterLostAck = false;
        const chargedBatches = new Map();
        const traffic = f.service.traffic.bind(f.service);
        f.service.traffic = async (id, batch) => {
          if (id === server.id) lastBatch = JSON.parse(JSON.stringify(batch));
          const batchKey = `${id}/${batch.session}/${batch.sequence}`;
          const before = (
            await f.db.nodifyEntitlement.findUniqueOrThrow({
              where: { userId: f.user.id },
            })
          ).usedBytes;
          const ack = await traffic(id, batch);
          const after = (
            await f.db.nodifyEntitlement.findUniqueOrThrow({
              where: { userId: f.user.id },
            })
          ).usedBytes;
          if (chargedBatches.has(batchKey)) {
            assert.equal(after, before);
            replayedAfterLostAck = true;
          }
          chargedBatches.set(batchKey, true);
          if (mode === "auto" && !lostAck && after > before) {
            lostAck = true;
            blockWS = true;
            for (const socket of sockets) socket.destroy();
            throw Error("QA drops response after durable traffic commit");
          }
          return ack;
        };
        const publish = await f.service.apply(server.id, draft.version);
        await wait(async () => {
          const row = await f.db.nodifyOperation.findUniqueOrThrow({
            where: { id: publish.id },
          });
          if (row.state === "failed") throw Error(row.message);
          return row.state === "succeeded";
        });
        const payload = Buffer.alloc(65536, 0x39);
        downloadServer = httpServer((req, res) => {
          res.end(payload);
        });
        await new Promise((r) => downloadServer.listen(0, "127.0.0.1", r));
        const proxyPort = await freePort(),
          config = join(data, "client.json");
        await writeFile(
          config,
          JSON.stringify({
            log: { loglevel: "none" },
            inbounds: [
              {
                listen: "127.0.0.1",
                port: proxyPort,
                protocol: "http",
                settings: {},
              },
            ],
            outbounds: [
              {
                protocol: "vless",
                settings: {
                  vnext: [
                    {
                      address: "127.0.0.1",
                      port: inboundPort,
                      users: [{ id: f.user.vlessUuid, encryption: "none" }],
                    },
                  ],
                },
              },
            ],
          }),
        );
        client = spawn(
          process.env.NODIFY_TEST_XRAY,
          ["run", "-config", config],
          {
            stdio: "ignore",
          },
        );
        let downloaded;
        await wait(async () => {
          try {
            downloaded = await new Promise((resolve, reject) => {
              const req = httpRequest(
                {
                  host: "127.0.0.1",
                  port: proxyPort,
                  path: `http://127.0.0.1:${downloadServer.address().port}/download`,
                  timeout: 1500,
                },
                (res) => {
                  const parts = [];
                  res.on("data", (c) => parts.push(c));
                  res.on("end", () => resolve(Buffer.concat(parts)));
                  res.on("error", reject);
                },
              );
              req.on("error", reject);
              req.on("timeout", () => req.destroy(Error("timeout")));
              req.end();
            });
            return true;
          } catch {
            return false;
          }
        });
        assert.deepEqual(downloaded, payload);
        await wait(
          async () =>
            lastBatch &&
            (
              await f.db.nodifyEntitlement.findUniqueOrThrow({
                where: { userId: f.user.id },
              })
            ).usedBytes > 65536n,
        );
        if (mode === "auto")
          await wait(
            () => replayedAfterLostAck,
            "Missing cross-transport traffic retry",
          );
        const stop = async (child) => {
          if (child && child.exitCode === null && child.signalCode === null) {
            const exited = new Promise((r) => child.once("exit", r));
            child.kill("SIGTERM");
            await exited;
          }
        };
        await stop(client);
        client = null;
        await stop(agent);
        const beforeReplay = (
          await f.db.nodifyEntitlement.findUniqueOrThrow({
            where: { userId: f.user.id },
          })
        ).usedBytes;
        const statePath = join(data, "state.json"),
          persisted = JSON.parse(await readFile(statePath, "utf8"));
        persisted.outbox.push(lastBatch);
        await writeFile(statePath, JSON.stringify(persisted), { mode: 0o600 });
        agent = spawn(
          process.execPath,
          [
            fileURLToPath(
              new URL("../apps/node/agent/main.mjs", import.meta.url),
            ),
          ],
          {
            env: {
              ...process.env,
              NODIFY_PANEL: await app.getUrl(),
              NODIFY_ALLOW_HTTP: "1",
              NODIFY_AGENT_DATA: data,
              NODIFY_CONNECTION_MODE: mode,
              NODE_EXTRA_CA_CERTS: cert,
              NODIFY_DIRECT_TOKEN: token,
              NODIFY_DIRECT_PORT: String(port),
              NODIFY_DIRECT_CERT: cert,
              NODIFY_DIRECT_KEY: key,
              NODIFY_PTY_BINARY: process.env.NODIFY_TEST_PTY,
              NODIFY_XRAY_BINARY: process.env.NODIFY_TEST_XRAY,
              NODIFY_SING_BOX_BINARY: process.env.NODIFY_TEST_SINGBOX,
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        agent.stdout.on("data", (d) => {
          log += d;
        });
        agent.stderr.on("data", (d) => {
          log += d;
        });
        await wait(
          async () =>
            JSON.parse(await readFile(statePath, "utf8")).outbox.length === 0,
        );
        assert.equal(
          (
            await f.db.nodifyEntitlement.findUniqueOrThrow({
              where: { userId: f.user.id },
            })
          ).usedBytes,
          beforeReplay,
        );
        assert.ok(
          await f.db.nodifyTrafficBatch.count({
            where: { serverId: server.id },
          }),
        );
        const terminals = new TerminalSessions(f.service),
          session = await terminals.open(server.id, {
            requestId: crypto.randomUUID(),
            cols: 80,
            rows: 24,
            minutes: 5,
          });
        await wait(
          async () =>
            (await terminals.read(server.id, session.id, 0)).state ===
            "running",
        );
        await terminals.input(server.id, session.id, {
          type: "input",
          sequence: 1,
          data: "printf 'DIRECT_PTY_OK\\n'\r",
        });
        await wait(async () =>
          Buffer.concat(
            (await terminals.read(server.id, session.id, 0)).output.map((f) =>
              Buffer.from(f.data, "base64"),
            ),
          )
            .toString()
            .includes("DIRECT_PTY_OK"),
        );
        if (mode === "auto") {
          let sequence = 1;
          const checkPTY = async (expected, command) => {
            await terminals.input(server.id, session.id, {
              type: "input",
              sequence: ++sequence,
              data: command + "\r",
            });
            await wait(async () => {
              const row = await terminals.read(server.id, session.id, 0);
              assert.equal(row.state, "running");
              return Buffer.concat(
                row.output.map((frame) => Buffer.from(frame.data, "base64")),
              )
                .toString()
                .includes(expected);
            }, "PTY state lost across transport change");
          };
          await checkPTY(
            "AUTO_STATE_READY",
            "export AUTO_STATE=kept; printf 'AUTO_STATE_%s\\n' READY",
          );
          const waitTransport = async (transport) =>
            wait(
              async () => {
                await terminals.read(server.id, session.id, 0);
                const row = await f.db.nodifyServer.findUniqueOrThrow({
                  where: { id: server.id },
                });
                assert.equal(row.metrics.connectionMode, "auto");
                return row.metrics.connectionTransport === transport;
              },
              `Agent did not switch to ${transport}`,
              90000,
            );
          await waitTransport("direct");
          for (const [enabled, transport] of [
            [false, "pull"],
            [true, "direct"],
          ]) {
            const saved = await connections.read(server.id);
            await connections.save(server.id, {
              version: saved.version,
              enabled,
              endpoint: saved.endpoint,
            });
            await waitTransport(transport);
            await checkPTY(
              `AUTO_${transport}_kept`,
              `printf 'AUTO_${transport}_%s\\n' "$AUTO_STATE"`,
            );
            await f.db.nodifyOperation.update({
              where: { id: op.id },
              data: { state: "queued" },
            });
            await wait(
              async () =>
                (
                  await f.db.nodifyOperation.findUniqueOrThrow({
                    where: { id: op.id },
                  })
                ).state === "succeeded",
            );
            assert.equal(await readFile(marker, "utf8"), "x");
          }
          blockWS = false;
          await waitTransport("ws");
          await checkPTY(
            "AUTO_ws_kept",
            "printf 'AUTO_ws_%s\\n' \"$AUTO_STATE\"",
          );
          assert.ok(requests.includes("/api/agent/poll"));
          assert.equal(lostAck, true);
          assert.equal(replayedAfterLostAck, true);
        }
        await terminals.close(server.id, session.id);
        await wait(
          async () =>
            (await terminals.read(server.id, session.id, 0)).state === "closed",
        );
        if (mode === "direct")
          assert.deepEqual(requests, ["/api/agent/enroll"]);
        assert.equal(log.includes(token), false);
        assert.equal(log.includes("DIRECT_PTY_OK"), false);
        assert.ok((await connections.read(server.id)).lastContactAt);
        await f.service.revoke(server.id);
        await wait(async () => !(await connections.read(server.id)).enabled);
        assert.equal(
          (
            await f.db.nodifyServer.findUniqueOrThrow({
              where: { id: server.id },
            })
          ).tokenHash,
          null,
        );
      } finally {
        if (agent && agent.exitCode === null && agent.signalCode === null) {
          const exit = new Promise((r) => agent.once("exit", r));
          agent.kill("SIGTERM");
          await exit;
        }
        if (client && client.exitCode === null && client.signalCode === null) {
          const exited = new Promise((r) => client.once("exit", r));
          client.kill("SIGTERM");
          await exited;
        }
        if (downloadServer) {
          downloadServer.closeAllConnections();
          await new Promise((r) => downloadServer.close(r));
        }
        await gateway.onModuleDestroy();
        await app?.close();
        await f.db.$disconnect();
      }
    },
  );
