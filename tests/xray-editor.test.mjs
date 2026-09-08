import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
const require = createRequire(import.meta.url);
require("./loader.cjs");
const {
  ConfigInput,
  renameOutbound,
  replaceSimpleDns,
  moveItem,
  routeWarnings,
  remapInboundReferences,
  withBalancingObservers,
} = require("../packages/nodify-contract/index.ts");
test("routing validation prevents broken targets, proxy cycles and wrong core inbound references", () => {
  const parse = (xray) => ConfigInput.parse({ inbounds: [], xray });
  assert.throws(() =>
    parse({
      outbounds: [
        { tag: "same", protocol: "freedom" },
        { tag: "same", protocol: "freedom" },
      ],
    }),
  );
  assert.throws(() =>
    parse({ routing: { rules: [{ outboundTag: "missing", network: "tcp" }] } }),
  );
  assert.throws(() =>
    parse({
      routing: {
        rules: [{ outboundTag: "direct", balancerTag: "pool", network: "tcp" }],
      },
    }),
  );
  assert.throws(() =>
    parse({
      routing: {
        rules: [{ outboundTag: "direct", inboundTag: ["not-managed"] }],
      },
    }),
  );
  assert.throws(() =>
    parse({ routing: { balancers: [{ tag: "pool", selector: ["missing"] }] } }),
  );
  assert.throws(() =>
    parse({
      outbounds: [
        { tag: "a", protocol: "freedom", proxySettings: { tag: "b" } },
        { tag: "b", protocol: "freedom", proxySettings: { tag: "a" } },
      ],
    }),
  );
  assert.throws(() =>
    parse({ outbounds: [null], routing: { balancers: [null], rules: [null] } }),
  );
  assert.throws(() =>
    parse({
      outbounds: [{ tag: 123, protocol: "freedom" }],
      routing: { balancers: [{ tag: "pool", selector: ["x"] }] },
    }),
  );
  for (const xray of [
    { dns: { servers: "invalid" } },
    { routing: [] },
    { routing: { rules: [{ domain: "invalid", outboundTag: "direct" }] } },
    {
      outbounds: [
        { tag: "proxy", protocol: "socks", settings: { servers: {} } },
      ],
    },
    { routing: { balancers: [{ tag: "pool", selector: "direct" }] } },
  ]) {
    assert.throws(() => parse(xray), { name: "ZodError" });
  }
});
test("renaming preserves advanced configuration and rewrites route and proxy references", () => {
  const x = {
    outbounds: [
      {
        tag: "direct",
        protocol: "freedom",
        settings: { fragment: { packets: "tlshello" } },
      },
      { tag: "proxy", protocol: "socks", proxySettings: { tag: "direct" } },
    ],
    routing: {
      domainStrategy: "IPIfNonMatch",
      rules: [
        {
          outboundTag: "direct",
          domain: ["example.com"],
          attrs: { ":method": "GET" },
        },
      ],
    },
  };
  const next = renameOutbound(x, 0, { ...x.outbounds[0], tag: "new-direct" });
  assert.equal(next.routing.rules[0].outboundTag, "new-direct");
  assert.equal(next.outbounds[1].proxySettings.tag, "new-direct");
  assert.deepEqual(next.routing.rules[0].attrs, { ":method": "GET" });
  assert.deepEqual(next.outbounds[0].settings, x.outbounds[0].settings);
  assert.equal(x.routing.rules[0].outboundTag, "direct");
  assert.throws(() =>
    ConfigInput.parse({
      inbounds: [],
      xray: { ...next, outbounds: next.outbounds.slice(1) },
    }),
  );
});
test("DNS editing retains structured servers, fields and relative positions", () => {
  const special = {
    address: "https://dns.example/dns-query",
    domains: ["domain:example.com"],
    skipFallback: true,
  };
  const x = {
    dns: {
      servers: ["1.1.1.1", special, "8.8.8.8"],
      hosts: { internal: "127.0.0.1" },
    },
    policy: { levels: { 0: { bufferSize: 32 } } },
  };
  const next = replaceSimpleDns(x, ["9.9.9.9"]);
  assert.deepEqual(next.dns.servers, ["9.9.9.9", special]);
  assert.deepEqual(next.dns.hosts, x.dns.hosts);
  assert.deepEqual(next.policy, x.policy);
  assert.equal(x.dns.servers.length, 3);
});
test("first-match ordering, catch-all warning and shared inbound remapping preserve rule semantics", () => {
  const rules = [
    { inboundTag: ["a"], outboundTag: "direct" },
    { domain: ["example.com"], outboundTag: "block" },
  ];
  assert.equal(routeWarnings(rules).length, 1);
  assert.equal(routeWarnings(moveItem(rules, 0, 1)).length, 0);
  assert.deepEqual(
    remapInboundReferences(
      { rules, nested: [{ inbound: ["a"], custom: 42 }] },
      { a: "new-a" },
    ),
    {
      rules: [{ inboundTag: ["new-a"], outboundTag: "direct" }, rules[1]],
      nested: [{ inbound: ["new-a"], custom: 42 }],
    },
  );
  assert.equal(rules[0].inboundTag[0], "a");
});

test(
  "installed Xray accepts all four balancing strategies and preserved advanced DNS",
  { skip: !process.env.NODIFY_TEST_XRAY },
  () => {
    const {
      compileConfiguration,
    } = require("../apps/backend/src/modules/nodify/configuration.ts");
    const dir = mkdtempSync(join(tmpdir(), "nodify-routing-"));
    try {
      for (const strategy of [
        "random",
        "roundRobin",
        "leastPing",
        "leastLoad",
      ]) {
        const config = ConfigInput.parse({
          inbounds: [],
          xray: withBalancingObservers({
            outbounds: [
              { tag: "direct", protocol: "freedom" },
              { tag: "block", protocol: "blackhole" },
              {
                tag: "proxy-1",
                protocol: "socks",
                settings: { servers: [{ address: "127.0.0.1", port: 1080 }] },
              },
            ],
            dns: {
              servers: [
                "9.9.9.9",
                {
                  address: "https://dns.example/dns-query",
                  domains: ["domain:example.com"],
                  skipFallback: true,
                },
              ],
            },
            routing: {
              rules: [
                {
                  type: "field",
                  domain: ["domain:example.com"],
                  balancerTag: "pool",
                },
                { type: "field", network: "tcp,udp", outboundTag: "direct" },
              ],
              balancers: [
                {
                  tag: "pool",
                  selector: ["proxy-"],
                  fallbackTag: "direct",
                  strategy: { type: strategy },
                },
              ],
            },
            ...(["leastPing", "leastLoad"].includes(strategy)
              ? {
                  burstObservatory: {
                    subjectSelector: ["proxy-"],
                    pingConfig: {
                      destination:
                        "https://connectivitycheck.gstatic.com/generate_204",
                      interval: "1m",
                      sampling: 3,
                      timeout: "5s",
                    },
                  },
                }
              : {}),
          }),
        });
        const path = join(dir, `${strategy}.json`);
        writeFileSync(
          path,
          JSON.stringify(compileConfiguration(config, []).xray),
        );
        const output = execFileSync(
          resolve(process.env.NODIFY_TEST_XRAY),
          ["run", "-test", "-config", path],
          { encoding: "utf8", timeout: 15000 },
        );
        assert.match(output, /Configuration OK/, strategy);
      }
    } finally {
      assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
      assert.ok(basename(dir).startsWith("nodify-routing-"));
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
