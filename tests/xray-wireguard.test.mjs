import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { createServer as tcpServer, connect } from "node:net";
import { createSocket } from "node:dgram";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ruleFixture } from "./rule-fixture.mjs";
import { queryStats } from "../apps/node/agent/statistics.mjs";
const require = createRequire(import.meta.url);
require("./loader.cjs");
const {
  ConfigInput,
  updateWireguardPeer,
  renameOutbound,
  xrayShapeErrors,
} = require("../packages/nodify-contract/index.ts");
const {
  compileConfiguration,
} = require("../apps/backend/src/modules/nodify/configuration.ts");
const exec = promisify(execFile);
const pair = () => {
  const keys = generateKeyPairSync("x25519");
  return {
    secret: keys.privateKey
      .export({ format: "der", type: "pkcs8" })
      .subarray(-32)
      .toString("base64"),
    public: keys.publicKey
      .export({ format: "der", type: "spki" })
      .subarray(-32)
      .toString("base64"),
  };
};
const wg = () => ({
  tag: "wireguard-egress",
  protocol: "wireguard",
  settings: {
    secretKey: pair().secret,
    noKernelTun: true,
    address: ["10.66.0.2/32", "fd00:66::2/128"],
    mtu: 1280,
    domainStrategy: "ForceIP",
    peers: [
      {
        publicKey: pair().public,
        endpoint: "vpn.example:51820",
        allowedIPs: ["0.0.0.0/0", "::/0"],
      },
    ],
  },
});
const parse = (outbound) =>
  ConfigInput.parse({ inbounds: [], xray: { outbounds: [outbound] } });

test("WireGuard contract rejects malformed fields and unsupported transports while preserving advanced peer settings", () => {
  const original = wg();
  original.settings.peers.push({
    publicKey: pair().public,
    endpoint: "[::1]:51821",
    keepAlive: 25,
    allowedIPs: [],
    custom: { keep: true },
  });
  original.settings.custom = { keep: true };
  original.settings.peers[0].preSharedKey = randomBytes(32).toString("hex");
  assert.deepEqual(parse(original).xray.outbounds[0], original);
  const updated = updateWireguardPeer(original.settings, 1, {
    endpoint: "[2001:db8::1]:1234",
  });
  assert.deepEqual(updated.peers[1].custom, { keep: true });
  assert.deepEqual(updated.peers[0], original.settings.peers[0]);
  assert.equal(original.settings.peers[1].endpoint, "[::1]:51821");
  assert.deepEqual(updated.custom, { keep: true });
  const errors = [
    { secretKey: "do-not-log-this-secret" },
    { address: [] },
    { address: ["bad"] },
    { address: ["10.0.0.1/33"] },
    { mtu: 1 },
    { mtu: 65536 },
    { mtu: 1280.5 },
    { reserved: [1, 2] },
    { reserved: [0, -1, 256] },
    { noKernelTun: "false" },
    { domainStrategy: "UseIP" },
    { domainStrategy: {} },
    { peers: [] },
    {
      peers: [
        { ...original.settings.peers[0], endpoint: "https://vpn.example:443" },
      ],
    },
    { peers: [{ ...original.settings.peers[0], endpoint: "::1:51820" }] },
    {
      peers: [{ ...original.settings.peers[0], endpoint: "vpn.example:65536" }],
    },
    { peers: [{ ...original.settings.peers[0], publicKey: "bad" }] },
    { peers: [{ ...original.settings.peers[0], keepAlive: 65536 }] },
    { peers: [{ ...original.settings.peers[0], allowedIPs: ["127.0.0.1"] }] },
    { peers: [{ ...original.settings.peers[0], preSharedKey: "bad" }] },
  ];
  for (const invalid of errors)
    assert.throws(
      () =>
        parse({ ...original, settings: { ...original.settings, ...invalid } }),
      { name: "ZodError" },
    );
  assert.throws(
    () => parse({ ...original, streamSettings: {} }),
    /streamSettings/,
  );
  assert.throws(
    () =>
      parse({
        ...original,
        settings: {
          ...original.settings,
          peers: [
            original.settings.peers[0],
            {
              ...original.settings.peers[1],
              publicKey: Buffer.from(
                original.settings.peers[0].publicKey,
                "base64",
              ).toString("hex"),
            },
          ],
        },
      }),
    /公钥重复/,
  );
  for (const settings of [
    { peers: {} },
    { peers: [null] },
    { address: "invalid" },
    { peers: [{ allowedIPs: "bad" }] },
  ])
    assert.ok(
      xrayShapeErrors({ outbounds: [{ protocol: "wireguard", settings }] })
        .length,
    );
  const renamed = renameOutbound(
    {
      outbounds: [original],
      routing: { rules: [{ outboundTag: original.tag, network: "tcp" }] },
    },
    0,
    { ...original, tag: "vpn-new" },
  );
  assert.equal(renamed.routing.rules[0].outboundTag, "vpn-new");
});

test("WireGuard stays in versioned drafts until acknowledgement and failed publication preserves the applied revision", async () => {
  const f = await ruleFixture();
  try {
    const server = await f.db.nodifyServer.findFirstOrThrow(),
      previous = (await f.service.revisions(server.id))[0];
    const outbound = wg();
    const revision = await f.service.saveDraft(server.id, {
      ...previous.config,
      xray: { outbounds: [outbound] },
    });
    assert.equal(
      (await f.service.listServers())[0].appliedVersion,
      previous.version,
    );
    const operation = await f.service.apply(server.id, revision.version);
    const stored = await f.db.nodifyOperation.findUniqueOrThrow({
      where: { id: operation.id },
    });
    assert.equal(stored.payload.includes(outbound.settings.secretKey), false);
    assert.deepEqual(
      JSON.parse(f.service.box.open(stored.payload)).xray.outbounds[0],
      outbound,
    );
    await f.service.complete(server.id, operation.id, "succeeded", "", {});
    assert.equal(
      (await f.service.listServers())[0].appliedVersion,
      revision.version,
    );
    const next = await f.service.saveDraft(server.id, {
      ...revision.config,
      xray: {
        outbounds: [
          { ...outbound, settings: { ...outbound.settings, mtu: 1400 } },
        ],
      },
    });
    const failed = await f.service.apply(server.id, next.version);
    await f.service.complete(
      server.id,
      failed.id,
      "failed",
      "Unreachable peer",
      {},
    );
    assert.equal(
      (await f.service.listServers())[0].appliedVersion,
      revision.version,
    );
  } finally {
    await f.db.$disconnect();
  }
});

test(
  "real Xray WireGuard egress carries managed VLESS TCP and UDP traffic through a userspace peer with user accounting",
  { skip: !process.env.NODIFY_TEST_XRAY, timeout: 45000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "nodify-wireguard-")),
      children = [],
      servers = [],
      udpSockets = [],
      logs = [];
    const listen = async (server) => {
      servers.push(server);
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      return server.address().port;
    };
    const tcpPort = async () => {
      const s = tcpServer();
      const port = await listen(s);
      await new Promise((r) => s.close(r));
      return port;
    };
    const udpPort = async () => {
      const s = createSocket("udp4");
      await new Promise((r) => s.bind(0, "127.0.0.1", r));
      const port = s.address().port;
      await new Promise((r) => s.close(r));
      return port;
    };
    const ready = async (port) => {
      const until = Date.now() + 6000;
      while (Date.now() < until) {
        if (
          await new Promise((resolve) => {
            const s = connect(port, "127.0.0.1");
            s.once("connect", () => {
              s.destroy();
              resolve(true);
            });
            s.once("error", () => resolve(false));
          })
        )
          return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw Error(`Core failed to start: ${logs.join("").slice(-1500)}`);
    };
    const start = async (name, config) => {
      const path = join(directory, `${name}.json`);
      await writeFile(path, JSON.stringify(config));
      await exec(
        process.env.NODIFY_TEST_XRAY,
        ["run", "-test", "-config", path],
        { timeout: 10000, windowsHide: true },
      );
      const child = spawn(
        process.env.NODIFY_TEST_XRAY,
        ["run", "-config", path],
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
      );
      children.push(child);
      child.stdout.on("data", (b) => logs.push(b.toString()));
      child.stderr.on("data", (b) => logs.push(b.toString()));
    };
    try {
      const clientKeys = pair(),
        serverKeys = pair(),
        shared = randomBytes(32).toString("base64"),
        body = "wireguard-real-payload".repeat(16384);
      const destination = await listen(
        createServer((_req, res) => res.end(body)),
      );
      const echo = createSocket("udp4");
      udpSockets.push(echo);
      echo.on("message", (message, remote) =>
        echo.send(message, remote.port, remote.address),
      );
      await new Promise((r) => echo.bind(0, "127.0.0.1", r));
      const wgPort = await udpPort(),
        inboundPort = await tcpPort(),
        apiPort = await tcpPort(),
        socksPort = await tcpPort(),
        udpClientPort = await udpPort();
      const peerReady = await tcpPort();
      await start("wireguard-peer", {
        log: { loglevel: "warning" },
        inbounds: [
          {
            listen: "127.0.0.1",
            port: wgPort,
            protocol: "wireguard",
            settings: {
              secretKey: serverKeys.secret,
              mtu: 1280,
              peers: [
                {
                  publicKey: clientKeys.public,
                  preSharedKey: shared,
                  allowedIPs: ["10.66.0.2/32"],
                },
              ],
            },
          },
          {
            listen: "127.0.0.1",
            port: peerReady,
            protocol: "socks",
            settings: {},
          },
        ],
        outbounds: [
          {
            protocol: "freedom",
            settings: {
              redirect: "127.0.0.1:0",
              finalRules: [{ action: "allow", ip: ["127.0.0.1/32"] }],
            },
          },
        ],
      });
      await ready(peerReady);
      const inboundId = randomUUID(),
        uuid = randomUUID();
      const config = ConfigInput.parse({
        inbounds: [
          {
            id: inboundId,
            name: "WG egress",
            protocol: "vless",
            port: inboundPort,
            network: "tcp",
            security: "none",
          },
        ],
        xray: {
          outbounds: [
            {
              tag: "vpn",
              protocol: "wireguard",
              settings: {
                secretKey: clientKeys.secret,
                address: ["10.66.0.2/32"],
                noKernelTun: true,
                mtu: 1280,
                domainStrategy: "ForceIPv4",
                peers: [
                  {
                    publicKey: serverKeys.public,
                    preSharedKey: shared,
                    endpoint: `127.0.0.1:${wgPort}`,
                    allowedIPs: ["0.0.0.0/0"],
                    keepAlive: 1,
                  },
                ],
              },
            },
          ],
        },
      });
      const runtime = compileConfiguration(config, [
        {
          id: "wireguard-user",
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
      await start("managed", runtime);
      await ready(inboundPort);
      await start("vless-client", {
        log: { loglevel: "warning" },
        inbounds: [
          {
            listen: "127.0.0.1",
            port: socksPort,
            protocol: "socks",
            settings: {},
          },
          {
            listen: "127.0.0.1",
            port: udpClientPort,
            protocol: "dokodemo-door",
            settings: {
              address: "10.66.0.1",
              port: echo.address().port,
              network: "udp",
            },
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
                  users: [{ id: uuid, encryption: "none" }],
                },
              ],
            },
          },
        ],
      });
      await ready(socksPort);
      const response = await exec(
        process.platform === "win32" ? "curl.exe" : "curl",
        [
          "--silent",
          "--show-error",
          "--fail",
          "--max-time",
          "10",
          "--noproxy",
          "",
          "--proxy",
          `socks5h://127.0.0.1:${socksPort}`,
          `http://10.66.0.1:${destination}/payload`,
        ],
        { timeout: 15000, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
      );
      assert.equal(response.stdout, body);
      const sender = createSocket("udp4");
      udpSockets.push(sender);
      const message = randomBytes(1024);
      const echoed = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("WireGuard UDP echo timed out")),
          5000,
        );
        sender.once("message", (received) => {
          clearTimeout(timer);
          resolve(received);
        });
        sender.once("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
        sender.send(message, udpClientPort, "127.0.0.1");
      });
      assert.deepEqual(echoed, message);
      const stats = await queryStats(apiPort);
      assert.ok(
        BigInt(stats["user>>>wireguard-user>>>traffic>>>downlink"] || "0") >=
          BigInt(body.length),
      );
      assert.ok(
        BigInt(stats["user>>>wireguard-user>>>traffic>>>uplink"] || "0") >=
          1024n,
      );
    } catch (error) {
      throw new Error(`${error.message}\n${logs.join("").slice(-2200)}`);
    } finally {
      for (const child of children.reverse())
        if (child.exitCode === null && child.signalCode === null) {
          const done = new Promise((r) => child.once("exit", r));
          child.kill("SIGKILL");
          await done;
        }
      for (const server of servers)
        if (server.listening) {
          server.closeAllConnections?.();
          await new Promise((r) => server.close(r));
        }
      for (const socket of udpSockets) {
        try {
          socket.close();
        } catch {}
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
);
