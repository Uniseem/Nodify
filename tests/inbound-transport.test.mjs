import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { createServer as tcpServer, connect } from "node:net";
import { createServer } from "node:http";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ruleFixture } from "./rule-fixture.mjs";
import { queryStats } from "../apps/node/agent/statistics.mjs";
const require = createRequire(import.meta.url);
const {
  Inbound,
  ConfigInput,
  patchInboundTransport,
  readInboundTransport,
} = require("../packages/nodify-contract/index.ts");
const {
  compileConfiguration,
} = require("../apps/backend/src/modules/nodify/configuration.ts");
const {
  proxyFor,
  uriFor,
  singboxFor,
} = require("../apps/backend/src/modules/nodify/subscription.controller.ts");
const { dump, load } = require("../apps/backend/node_modules/js-yaml");
const {
  parseSource,
} = require("../apps/backend/src/modules/nodify/resources.service.ts");
const exec = promisify(execFile);
const user = {
  id: "transport-user",
  uuid: randomUUID(),
  password: "transport-password",
  ssPassword: "ss-password",
  anytlsPassword: "anytls-password",
  nodeIds: [],
  tags: [],
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  remainingBytes: "10000000",
};
const credential = {
  vlessUuid: user.uuid,
  trojanPassword: user.password,
  ssPassword: user.ssPassword,
};
const base = (fields = {}) => ({
  id: randomUUID(),
  name: "transport",
  protocol: "vless",
  network: "ws",
  security: "none",
  port: 24567,
  path: "/transport",
  extra: {},
  ...fields,
});

test("inbound transport editing preserves JSON and validates shared Host, mode and ALPN", () => {
  const original = Inbound.parse(
    base({
      extra: {
        custom: { preserve: true },
        streamSettings: {
          sockopt: { tcpFastOpen: true },
          wsSettings: {
            headers: { hOsT: "legacy.example", "X-Keep": "yes" },
            heartbeatPeriod: 20,
            custom: 7,
          },
          xhttpSettings: {
            host: "other.example",
            extra: { noGRPCHeader: true },
          },
        },
      },
    }),
  );
  assert.equal(readInboundTransport(original).host, "legacy.example");
  const edited = {
    ...original,
    extra: patchInboundTransport(original, "host", "front.example"),
  };
  assert.equal(readInboundTransport(edited).host, "front.example");
  assert.deepEqual(edited.extra.streamSettings.wsSettings.headers, {
    "X-Keep": "yes",
  });
  assert.equal(edited.extra.streamSettings.wsSettings.custom, 7);
  assert.deepEqual(
    edited.extra.streamSettings.xhttpSettings,
    original.extra.streamSettings.xhttpSettings,
  );
  assert.equal(
    original.extra.streamSettings.wsSettings.headers.hOsT,
    "legacy.example",
  );
  const cleared = {
    ...edited,
    extra: patchInboundTransport(edited, "host", ""),
  };
  assert.equal(readInboundTransport(cleared).host, "");
  for (const extra of [
    { streamSettings: { wsSettings: { host: "front.example:8443" } } },
    { streamSettings: [] },
    { streamSettings: { wsSettings: { host: "https://bad.example" } } },
    { streamSettings: { wsSettings: { host: "bad\r\nHost: value" } } },
    { streamSettings: { wsSettings: { heartbeatPeriod: -1 } } },
    { streamSettings: { xhttpSettings: { mode: "unknown" } } },
    { streamSettings: { tlsSettings: { alpn: ["h2", "h2"] } } },
  ])
    assert.throws(() => Inbound.parse(base({ extra })));
  assert.throws(() =>
    Inbound.parse(
      base({
        security: "tls",
        certificateId: randomUUID(),
        extra: { streamSettings: { tlsSettings: { alpn: ["h2"] } } },
      }),
    ),
  );
  assert.throws(() =>
    Inbound.parse(
      base({
        network: "grpc",
        security: "tls",
        certificateId: randomUUID(),
        extra: { streamSettings: { tlsSettings: { alpn: ["http/1.1"] } } },
      }),
    ),
  );
  for (const protocol of ["vless", "vmess", "trojan", "anytls"]) {
    const value = Inbound.parse(
      base({
        protocol,
        network: protocol === "anytls" ? "tcp" : "ws",
        security: "tls",
        certificateId: randomUUID(),
        serverName: "tls.example",
      }),
    );
    value.extra = patchInboundTransport(value, "alpn", ["http/1.1"]);
    if (value.network === "ws")
      value.extra = patchInboundTransport(value, "host", "front.example");
    const proxy = proxyFor(
      value,
      "server.example",
      credential,
      user.anytlsPassword,
    );
    assert.deepEqual(proxy.alpn, ["http/1.1"]);
    assert.deepEqual(singboxFor(proxy).tls.alpn, proxy.alpn);
    const uri = uriFor(proxy);
    assert.deepEqual(parseSource(uri, randomUUID())[0].proxy.alpn, proxy.alpn);
    if (protocol === "vmess") {
      const decoded = JSON.parse(
        Buffer.from(uri.slice(8), "base64").toString(),
      );
      assert.equal(decoded.alpn, "http/1.1");
      assert.equal(decoded.host, "front.example");
    } else assert.equal(new URL(uri).searchParams.get("alpn"), "http/1.1");
  }
  const xhttp = Inbound.parse(
    base({
      network: "xhttp",
      extra: {
        streamSettings: {
          xhttpSettings: { host: "front.example", mode: "packet-up" },
        },
      },
    }),
  );
  const proxy = proxyFor(xhttp, "server.example", credential, "");
  assert.equal(proxy.mode, undefined);
  assert.equal(proxy["xhttp-opts"].mode, "packet-up");
  const imported = parseSource(uriFor(proxy), randomUUID())[0].proxy;
  assert.equal(imported["xhttp-opts"].mode, "packet-up");
  assert.equal(imported["xhttp-opts"].host, "front.example");
  assert.equal(imported.mode, undefined);
  assert.throws(
    () =>
      parseSource(dump({ proxies: [{ ...proxy, alpn: "h2" }] }), randomUUID()),
    /ALPN/,
  );
  assert.equal(new URL(uriFor(proxy)).searchParams.get("mode"), "packet-up");
  assert.equal(
    new URL(uriFor(proxy)).searchParams.get("host"),
    "front.example",
  );
  const alias = ConfigInput.parse({
    inbounds: [
      base({
        extra: {
          streamSettings: { method: "grpc", sockopt: { tcpFastOpen: true } },
        },
      }),
    ],
  });
  const actual = compileConfiguration(alias, []).xray.inbounds[0]
    .streamSettings;
  assert.equal(actual.method, "ws");
  assert.equal(actual.network, "ws");
  assert.equal(actual.sockopt.tcpFastOpen, true);
  assert.equal(alias.inbounds[0].extra.streamSettings.method, "grpc");
});

test("published transport changes preserve node identity and filter incompatible XHTTP clients", async () => {
  const f = await ruleFixture();
  try {
    const server = await f.db.nodifyServer.findFirstOrThrow(),
      revision = (await f.service.revisions(server.id))[0];
    const inbound = revision.config.inbounds[0];
    const update = {
      ...inbound,
      network: "xhttp",
      path: "/changed",
      extra: {
        streamSettings: {
          xhttpSettings: {
            host: "front.example",
            mode: "packet-up",
            custom: { kept: true },
          },
        },
      },
    };
    const draft = await f.service.saveDraft(server.id, {
      ...revision.config,
      inbounds: [update],
    });
    assert.equal(
      load((await f.render("mihomo")).content).proxies[0]["xhttp-opts"],
      undefined,
    );
    const operation = await f.service.apply(server.id, draft.version);
    await f.service.complete(server.id, operation.id, "succeeded", "", {});
    assert.equal((await f.db.nodifyInbound.findFirstOrThrow()).id, inbound.id);
    assert.equal(
      load((await f.render("mihomo")).content).proxies[0]["xhttp-opts"].mode,
      "packet-up",
    );
    assert.equal(
      (await f.render("singbox")).headers["X-Nodify-Excluded-Count"],
      "1",
    );
    assert.deepEqual((await f.render("singbox")).content.route.rules, [
      { action: "reject" },
    ]);
    const second = await f.service.saveDraft(server.id, {
      ...draft.config,
      inbounds: [{ ...update, protocol: "vmess" }],
    });
    const pending = await f.service.apply(server.id, second.version);
    await f.service.complete(
      server.id,
      pending.id,
      "failed",
      "Engine refused candidate",
      {},
    );
    assert.equal(load((await f.render("mihomo")).content).proxies.length, 1);
    const retry = await f.service.apply(server.id, second.version);
    await f.service.complete(server.id, retry.id, "succeeded", "", {});
    assert.equal(load((await f.render("mihomo")).content).proxies.length, 0);
    assert.match(
      (await f.render("info")).content.nodes[0].exclusions.join(" "),
      /XHTTP 仅支持 VLESS/,
    );
  } finally {
    await f.db.$disconnect();
  }
});

async function port() {
  const s = tcpServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
test(
  "real TLS WebSocket Host and XHTTP modes connect with verified certificates and user statistics",
  {
    skip:
      !process.env.NODIFY_TEST_XRAY ||
      !process.env.NODIFY_TEST_SINGBOX ||
      !process.env.NODIFY_TEST_CERT_DIR,
    timeout: 180000,
  },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "nodify-transport-")),
      children = new Set();
    const certificateId = randomUUID(),
      certDir = resolve(process.env.NODIFY_TEST_CERT_DIR).replaceAll("\\", "/"),
      certFile = `${certDir}/fullchain.pem`;
    const xray = process.env.NODIFY_TEST_XRAY,
      singbox = process.env.NODIFY_TEST_SINGBOX,
      mihomo = process.env.NODIFY_TEST_MIHOMO;
    const cases = [];
    for (const protocol of ["vless", "vmess", "trojan"])
      cases.push(
        base({
          protocol,
          network: "ws",
          security: "tls",
          port: await port(),
          certificateId,
          serverName: "node.example",
          extra: {
            streamSettings: {
              wsSettings: { host: "front.example", heartbeatPeriod: 1 },
              tlsSettings: { alpn: ["http/1.1"] },
            },
          },
        }),
      );
    for (const mode of ["auto", "packet-up", "stream-up", "stream-one"])
      cases.push(
        base({
          network: "xhttp",
          security: "tls",
          port: await port(),
          certificateId,
          serverName: "node.example",
          extra: {
            streamSettings: {
              xhttpSettings: { host: "front.example", mode },
              tlsSettings: { alpn: ["h2"] },
            },
          },
        }),
      );
    const config = ConfigInput.parse({ inbounds: cases });
    const compiled = compileConfiguration(config, [
      { ...user, nodeIds: cases.map((item) => item.id) },
    ]);
    compiled.xray.log = { loglevel: "info" };
    const apiPort = await port();
    compiled.xray.inbounds.find((item) => item.tag === "nodify-api-in").port =
      apiPort;
    compiled.xray.outbounds[0].settings = {
      finalRules: [{ action: "allow", ip: ["127.0.0.1/32"] }],
    };
    const payload = "transport-verified-".repeat(4096);
    const destination = createServer((_req, res) => res.end(payload));
    await new Promise((r) => destination.listen(0, "127.0.0.1", r));
    const start = async (binary, args, readyPort) => {
      const child = spawn(binary, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, SSL_CERT_FILE: certFile },
      });
      children.add(child);
      let logs = "";
      child.logs = () => logs;
      child.stdout.on("data", (chunk) => (logs = (logs + chunk).slice(-6000)));
      child.stderr.on("data", (chunk) => (logs = (logs + chunk).slice(-6000)));
      child.on("error", (error) => (logs += error.message));
      const until = Date.now() + 10000;
      while (Date.now() < until) {
        assert.equal(child.exitCode, null, logs);
        const ready = await new Promise((r) => {
          const socket = connect(readyPort, "127.0.0.1");
          socket.once("connect", () => {
            socket.destroy();
            r(true);
          });
          socket.once("error", () => r(false));
        });
        if (ready) return child;
        await new Promise((r) => setTimeout(r, 60));
      }
      throw Error(`Readiness timed out: ${logs}`);
    };
    const stop = async (child) => {
      if (child.exitCode === null) {
        const ended = new Promise((r) => child.once("exit", r));
        child.kill();
        await ended;
      }
      children.delete(child);
    };
    let serial = 0;
    const runClient = async (inbound, kind, mutation, shouldFail = false) => {
      const listen = await port(),
        originalProxy = proxyFor(inbound, "127.0.0.1", credential, ""),
        proxy =
          kind === "mihomo"
            ? parseSource(uriFor(originalProxy), randomUUID())[0].proxy
            : originalProxy;
      if (mutation) mutation(proxy);
      const path = join(
        directory,
        `client-${++serial}.${kind === "mihomo" ? "yaml" : "json"}`,
      );
      let binary, args, client;
      if (kind === "mihomo") {
        await writeFile(
          path,
          dump({
            "mixed-port": listen,
            mode: "rule",
            proxies: [proxy],
            "proxy-groups": [
              { name: "Nodify", type: "select", proxies: [proxy.name] },
            ],
            rules: ["MATCH,Nodify"],
          }),
        );
        binary = mihomo;
        args = ["-d", directory, "-f", path];
      } else if (kind === "singbox") {
        const outbound = singboxFor(proxy);
        outbound.tag = "proxy";
        outbound.tls.certificate_path = certFile;
        await writeFile(
          path,
          JSON.stringify({
            inbounds: [
              { type: "mixed", listen: "127.0.0.1", listen_port: listen },
            ],
            outbounds: [outbound],
            route: { final: "proxy" },
          }),
        );
        binary = singbox;
        args = ["run", "-c", path];
      } else {
        const source = compiled.xray.inbounds.find(
          (item) => item.tag === inbound.id,
        );
        const streamSettings = {
          ...source.streamSettings,
          tlsSettings: {
            serverName: proxy.servername,
            alpn: proxy.alpn,
            disableSystemRoot: true,
            certificates: [{ certificateFile: certFile, usage: "verify" }],
          },
          xhttpSettings: {
            path: inbound.path,
            host: proxy["xhttp-opts"].host,
            mode: proxy["xhttp-opts"].mode,
          },
        };
        await writeFile(
          path,
          JSON.stringify({
            inbounds: [
              {
                listen: "127.0.0.1",
                port: listen,
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
                      port: inbound.port,
                      users: [{ id: user.uuid, encryption: "none" }],
                    },
                  ],
                },
                streamSettings,
              },
            ],
          }),
        );
        binary = xray;
        args = ["run", "-config", path];
      }
      try {
        client = await start(binary, args, listen);
        const request = () =>
          exec(
            process.platform === "win32" ? "curl.exe" : "curl",
            [
              "--silent",
              "--show-error",
              "--fail",
              "--max-time",
              "5",
              "--noproxy",
              "",
              "--proxy",
              `socks5h://127.0.0.1:${listen}`,
              `http://127.0.0.1:${destination.address().port}/`,
            ],
            { maxBuffer: 1024 * 1024 },
          );
        if (shouldFail) await assert.rejects(request);
        else
          assert.equal(
            (await request()).stdout,
            payload,
            `${kind} ${inbound.protocol}/${inbound.network}/${proxy["xhttp-opts"]?.mode}`,
          );
      } catch (error) {
        throw new Error(
          `${kind} ${inbound.protocol}/${inbound.network}/${proxy["xhttp-opts"]?.mode}: ${error.message}\n${[...children].map((c) => c.logs()).join("\n")}`,
          { cause: error },
        );
      } finally {
        if (client) await stop(client);
      }
    };
    try {
      const file = join(directory, "server.json");
      await writeFile(
        file,
        JSON.stringify(compiled.xray).replaceAll(
          `/var/lib/nodify-agent/certificates/${certificateId}`,
          certDir,
        ),
      );
      await exec(xray, ["run", "-test", "-config", file]);
      await start(xray, ["run", "-config", file], apiPort);
      let successful = 0;
      for (const inbound of config.inbounds) {
        const clients =
          inbound.network === "ws"
            ? ["singbox", ...(mihomo ? ["mihomo"] : [])]
            : ["xray", ...(mihomo ? ["mihomo"] : [])];
        for (const kind of clients) {
          await runClient(inbound, kind);
          successful++;
        }
      }
      await runClient(
        config.inbounds[0],
        "singbox",
        (p) => {
          p["ws-opts"].headers.Host = "wrong.example";
        },
        true,
      );
      await runClient(
        config.inbounds[0],
        "singbox",
        (p) => {
          p.servername = "wrong-certificate.example";
        },
        true,
      );
      const packet = config.inbounds[4];
      await runClient(
        packet,
        mihomo ? "mihomo" : "xray",
        (p) => {
          p["xhttp-opts"].mode = "stream-one";
        },
        true,
      );
      const stats = await queryStats(apiPort);
      assert.ok(
        BigInt(stats[`user>>>${user.id}>>>traffic>>>downlink`] || 0) >=
          BigInt(payload.length * successful),
      );
      console.log(
        `${successful} verified TLS transport downloads; wrong Host, certificate name and XHTTP mode rejected`,
      );
    } finally {
      for (const child of children) await stop(child);
      await new Promise((r) => destination.close(r));
    }
  },
);
