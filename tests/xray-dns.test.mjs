import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer as httpServer } from "node:http";
import { createServer as tcpServer } from "node:net";
import { createSocket } from "node:dgram";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
require("./loader.cjs");
const {
  ConfigInput,
  updateDnsServer,
  saveDnsHost,
  moveItem,
} = require("../packages/nodify-contract/index.ts");
const {
  compileConfiguration,
} = require("../apps/backend/src/modules/nodify/configuration.ts");
const exec = promisify(execFile),
  wait = (ms) => new Promise((r) => setTimeout(r, ms));
test("DNS edits preserve mixed order, unknown settings and legacy fields; invalid shapes and values are rejected", () => {
  const original = {
    hosts: { "static.example": ["127.0.0.1", "::1"] },
    servers: [
      "9.9.9.9",
      {
        address: "1.1.1.1",
        expectIPs: "geoip:cn",
        domains: "domain:example.com",
        unknown: { keep: true },
      },
      "localhost",
    ],
    disableFallbackIfMatch: true,
    custom: "keep",
  };
  const changed = updateDnsServer(original, 1, {
    port: 5353,
    skipFallback: false,
  });
  assert.deepEqual(original.servers[1].port, undefined);
  assert.equal(changed.servers[0], "9.9.9.9");
  assert.equal(changed.servers[2], "localhost");
  assert.equal(changed.servers[1].expectIPs, "geoip:cn");
  assert.deepEqual(changed.servers[1].unknown, { keep: true });
  const edited = updateDnsServer(changed, 1, {
    expectedIPs: ["127.0.0.0/8"],
    expectIPs: undefined,
  });
  assert.equal(Object.hasOwn(edited.servers[1], "expectIPs"), false);
  assert.equal(edited.custom, "keep");
  assert.deepEqual(moveItem(edited.servers, 1, 0)[0], edited.servers[1]);
  assert.equal(
    ConfigInput.parse({ inbounds: [], xray: { dns: edited } }).xray.dns
      .disableFallbackIfMatch,
    true,
  );
  const hosts = saveDnsHost(original, "static.example", "renamed.example", [
    "127.0.0.1",
    "::1",
  ]);
  assert.deepEqual(
    hosts.hosts["renamed.example"],
    original.hosts["static.example"],
  );
  assert.equal(Object.hasOwn(hosts.hosts, "static.example"), false);
  assert.throws(
    () => saveDnsHost(hosts, null, "renamed.example", "127.0.0.2"),
    /已存在/,
  );
  assert.equal(
    Object.hasOwn(
      saveDnsHost(hosts, null, "__proto__", "127.0.0.3").hosts,
      "__proto__",
    ),
    true,
  );
  for (const dns of [
    { servers: [null] },
    { servers: [{}] },
    { servers: [{ address: "127.0.0.1", port: 65536 }] },
    { servers: [{ address: "127.0.0.1", domains: [3] }] },
    { hosts: { a: 2 } },
    { hosts: { a: [""] } },
    { disableFallback: "true" },
    { clientIp: "not-ip" },
    { clientIp: "127.0.0.1", clientIP: "127.0.0.2" },
    { serveExpiredTTL: -1 },
    { servers: [{ address: "https://user:secret@example.com/dns-query" }] },
    { servers: [{ address: "1.1.1.1", timeoutMs: 1.5 }] },
  ])
    assert.throws(() => ConfigInput.parse({ inbounds: [], xray: { dns } }), {
      name: "ZodError",
    });
});
test(
  "real Xray DNS honours hosts, domain priority, expected and excluded addresses, fallback barriers and cache overrides",
  { skip: !process.env.NODIFY_TEST_XRAY, timeout: 60000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "nodify-dns-")),
      queries = [],
      children = [],
      dnsSockets = [],
      logs = [];
    let current;
    const listen = (server) =>
      new Promise((r) =>
        server.listen(0, "127.0.0.1", () => r(server.address().port)),
      );
    const free = async () => {
      const s = tcpServer(),
        port = await listen(s);
      await new Promise((r) => s.close(r));
      return port;
    };
    const dnsServer = async (label) => {
      const socket = createSocket("udp4");
      dnsSockets.push(socket);
      socket.on("message", (packet, remote) => {
        let pos = 12,
          labels = [];
        while (packet[pos]) {
          const length = packet[pos++];
          labels.push(packet.subarray(pos, pos + length).toString());
          pos += length;
        }
        pos++;
        const name = labels.join("."),
          type = packet.readUInt16BE(pos),
          end = pos + 4;
        queries.push(`${label}:${name}`);
        const ip =
          label === "A" && name.startsWith("filter")
            ? "192.0.2.1"
            : "127.0.0.1";
        const header = Buffer.from(packet.subarray(0, 12));
        header.writeUInt16BE(0x8180, 2);
        header.writeUInt16BE(type === 1 ? 1 : 0, 6);
        header.writeUInt16BE(0, 8);
        header.writeUInt16BE(0, 10);
        const answer = Buffer.from([
          0xc0,
          0x0c,
          0,
          1,
          0,
          1,
          0,
          0,
          0,
          60,
          0,
          4,
          ...ip.split(".").map(Number),
        ]);
        socket.send(
          Buffer.concat([
            header,
            packet.subarray(12, end),
            ...(type === 1 ? [answer] : []),
          ]),
          remote.port,
          remote.address,
        );
      });
      await new Promise((r) => socket.bind(0, "127.0.0.1", r));
      return socket.address().port;
    };
    const destination = httpServer((_req, res) => res.end("dns-through-xray"));
    try {
      const target = await listen(destination),
        a = await dnsServer("A"),
        b = await dnsServer("B"),
        port = await free(),
        api = await free();
      const base = {
        queryStrategy: "UseIPv4",
        hosts: { "static.test": "127.0.0.1", "alias.test": "static.test" },
        servers: [
          {
            address: "127.0.0.1",
            port: a,
            domains: [
              "full:priority.test",
              "full:filter.test",
              "full:excluded.test",
            ],
            expectedIPs: ["127.0.0.0/8"],
            skipFallback: true,
            timeoutMs: 500,
          },
          { address: "127.0.0.1", port: b },
        ],
        disableCache: false,
      };
      const start = async (dns) => {
        if (
          current &&
          current.exitCode === null &&
          current.signalCode === null
        ) {
          const exited = new Promise((r) => current.once("exit", r));
          current.kill();
          await exited;
        }
        const config = compileConfiguration(
          ConfigInput.parse({
            inbounds: [],
            xray: {
              dns,
              outbounds: [
                {
                  tag: "direct",
                  protocol: "freedom",
                  settings: {
                    domainStrategy: "UseIP",
                    finalRules: [{ action: "allow", ip: ["127.0.0.0/8"] }],
                  },
                },
              ],
            },
          }),
          [],
        ).xray;
        config.inbounds.at(-1).port = api;
        config.inbounds.unshift({
          tag: "qa-socks",
          listen: "127.0.0.1",
          port,
          protocol: "socks",
          settings: { auth: "noauth" },
        });
        const file = join(dir, `${children.length}.json`);
        writeFileSync(file, JSON.stringify(config));
        await exec(process.env.NODIFY_TEST_XRAY, [
          "run",
          "-test",
          "-config",
          file,
        ]);
        current = spawn(
          process.env.NODIFY_TEST_XRAY,
          ["run", "-config", file],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
        children.push(current);
        current.stdout.on("data", (b) => logs.push(b.toString()));
        current.stderr.on("data", (b) => logs.push(b.toString()));
        await wait(350);
      };
      const get = async (name) =>
        (
          await exec(
            process.platform === "win32" ? "curl.exe" : "curl",
            [
              "--silent",
              "--show-error",
              "--fail",
              "--max-time",
              "3",
              "--noproxy",
              "",
              "--proxy",
              `socks5h://127.0.0.1:${port}`,
              `http://${name}:${target}/payload`,
            ],
            { timeout: 5000 },
          )
        ).stdout;
      const count = (label, name) =>
        queries.filter((v) => v === `${label}:${name}`).length;
      await start(base);
      assert.equal(await get("alias.test"), "dns-through-xray");
      assert.equal(
        queries.length,
        0,
        "Hosts alias must avoid upstream queries",
      );
      assert.equal(await get("priority.test"), "dns-through-xray");
      assert.equal(await get("priority.test"), "dns-through-xray");
      assert.equal(count("A", "priority.test"), 1);
      assert.equal(
        count("B", "priority.test"),
        0,
        "Domain matching resolver precedes fallback",
      );
      assert.equal(await get("filter.test"), "dns-through-xray");
      assert.ok(
        queries.indexOf("A:filter.test") < queries.indexOf("B:filter.test"),
      );
      assert.equal(await get("other.test"), "dns-through-xray");
      assert.equal(
        count("A", "other.test"),
        0,
        "skipFallback excludes unrelated queries",
      );
      await start({ ...base, disableFallbackIfMatch: true });
      const before = count("B", "filter.test");
      await assert.rejects(() => get("filter.test"));
      assert.equal(
        count("B", "filter.test"),
        before,
        "Matched resolver filtering must not fall back when disabled",
      );
      await start({
        ...base,
        servers: [
          {
            ...base.servers[0],
            disableCache: true,
            unexpectedIPs: ["127.0.0.0/8"],
          },
          base.servers[1],
        ],
      });
      assert.equal(await get("excluded.test"), "dns-through-xray");
      assert.ok(
        count("A", "excluded.test") > 0 && count("B", "excluded.test") > 0,
      );
      await start({
        ...base,
        servers: [{ ...base.servers[0], disableCache: true }, base.servers[1]],
      });
      const first = count("A", "priority.test");
      await get("priority.test");
      await get("priority.test");
      assert.equal(
        count("A", "priority.test") - first,
        2,
        "Per-resolver disableCache overrides the global cache",
      );
      await start({
        ...base,
        servers: [{ ...base.servers[0], finalQuery: true }, base.servers[1]],
      });
      const last = count("B", "filter.test");
      await assert.rejects(() => get("filter.test"));
      assert.equal(
        count("B", "filter.test"),
        last,
        "finalQuery truncates subsequent resolvers",
      );
    } catch (e) {
      e.message += `\n${logs.join("").slice(-2000)}`;
      throw e;
    } finally {
      for (const socket of dnsSockets) socket.close();
      destination.closeAllConnections();
      destination.close();
      await Promise.all(
        children.map((c) => {
          if (c.exitCode !== null || c.signalCode !== null)
            return Promise.resolve();
          const exited = new Promise((r) => c.once("exit", r));
          c.kill();
          return exited;
        }),
      );
    }
  },
);
