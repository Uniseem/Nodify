import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { ruleFixture } from "./rule-fixture.mjs";
const require = createRequire(import.meta.url);
const {
  SubscriptionTemplateInput,
  expandTemplateGroups,
} = require("../packages/nodify-contract/index.ts");
const {
  SubscriptionTemplates,
} = require("../apps/backend/src/modules/nodify/subscription-templates.ts");
const { load } = require("../apps/backend/node_modules/js-yaml");
const document = () => ({
  mihomo: {
    "proxy-groups": [
      {
        name: "Automatic",
        type: "url-test",
        proxies: ["__PROXY_NODES__"],
        url: "https://cp.cloudflare.com/generate_204",
        interval: 300,
        tolerance: 50,
        lazy: true,
      },
      { name: "Nodify", type: "select", proxies: ["Automatic", "DIRECT"] },
    ],
    rules: ["MATCH,Nodify"],
    dns: { enable: true, nameserver: ["https://1.1.1.1/dns-query"] },
    profile: { "store-selected": true },
  },
  singbox: {
    log: { level: "warn" },
    route: { rules: [{ domain: ["template.example"], action: "reject" }] },
  },
});

test("template contracts retain advanced fields and reject malformed or cyclic groups", () => {
  const parsed = SubscriptionTemplateInput.parse({
    name: "Named",
    document: document(),
  });
  assert.equal(parsed.document.mihomo.profile["store-selected"], true);
  assert.equal(parsed.document.mihomo["proxy-groups"][0].lazy, true);
  assert.equal(parsed.document.singbox.log.level, "warn");
  for (const groups of [
    [{ name: "DIRECT", type: "select" }],
    [
      { name: "a", type: "select" },
      { name: "a", type: "select" },
    ],
    [{ name: "a", type: "url-test" }],
    [
      { name: "a", type: "select", proxies: ["b"] },
      { name: "b", type: "select", proxies: ["a"] },
    ],
    [{ name: "a", type: "select", use: ["missing"] }],
    [{ name: "a", type: "select", "dialer-proxy-group": "b" }],
  ])
    assert.throws(() =>
      SubscriptionTemplateInput.parse({
        name: "bad",
        document: { mihomo: { "proxy-groups": groups } },
      }),
    );
  assert.throws(() =>
    SubscriptionTemplateInput.parse({
      name: "bad",
      document: { singbox: { outbounds: [] } },
    }),
  );
  assert.throws(() =>
    SubscriptionTemplateInput.parse({
      name: "bad",
      document: { mihomo: { proxies: [] } },
    }),
  );
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() =>
    SubscriptionTemplateInput.parse({
      name: "bad",
      document: { mihomo: { custom: cyclic } },
    }),
  );
  const groups = expandTemplateGroups(
    {
      "proxy-providers": { upstream: { type: "http" } },
      "proxy-groups": [
        {
          name: "All",
          type: "select",
          proxies: ["$NODES", "missing"],
          use: ["__PROXY_PROVIDERS__"],
        },
      ],
    },
    [{ name: "node" }],
  );
  assert.deepEqual(groups.groups[0].proxies, ["node"]);
  assert.deepEqual(groups.groups[0].use, ["upstream"]);
  assert.match(groups.warnings[0], /missing/);
  const missingTarget = expandTemplateGroups(
    {
      rules: [
        "DOMAIN,example.com,missing",
        "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
      ],
    },
    [],
  );
  assert.deepEqual(missingTarget.rules, [
    "DOMAIN,example.com,REJECT",
    "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
  ]);
  assert.match(missingTarget.warnings.join(" "), /missing/);
  assert.deepEqual(expandTemplateGroups({}, []).groups[0].proxies, ["REJECT"]);
  const dynamic = expandTemplateGroups(
    {
      "proxy-groups": [
        {
          name: "Filtered",
          type: "select",
          "include-all-proxies": true,
          filter: "HK",
          proxies: [],
        },
      ],
    },
    [{ name: "US" }],
  );
  assert.deepEqual(dynamic.groups[0].proxies, []);
  assert.equal(dynamic.groups[0].filter, "HK");
});

test("SQLite templates: versioned edits and selection, default deletion guard, actual subscription and expiry", async () => {
  const { db, service, render, user } = await ruleFixture();
  const templates = new SubscriptionTemplates(service);
  try {
    const initial = await templates.list();
    assert.deepEqual(initial.selection, { templateId: null, version: 0 });
    const first = await templates.save({
      name: "Default",
      document: document(),
    });
    const copy = await templates.save({
      name: "Copy",
      document: first.document,
    });
    await templates.select({ templateId: first.id, version: 0 });
    await assert.rejects(() =>
      templates.select({ templateId: copy.id, version: 0 }),
    );
    await assert.rejects(() => templates.remove(first.id, first.version));
    const rendered = load((await render("mihomo")).content);
    assert.equal(rendered.profile["store-selected"], true);
    assert.deepEqual(rendered["proxy-groups"][0].proxies, [
      rendered.proxies[0].name,
    ]);
    assert.equal((await render("singbox")).content.log.level, "warn");
    assert.equal(
      (await render("singbox")).content.route.rules[0].domain[0],
      "template.example",
    );
    const edited = document();
    edited.mihomo["proxy-groups"][0].tolerance = 90;
    const updated = await templates.save(
      { name: "Renamed", document: edited, version: 1 },
      first.id,
    );
    await assert.rejects(() =>
      templates.save(
        { name: "Stale", document: document(), version: 1 },
        first.id,
      ),
    );
    assert.equal(
      load((await render("mihomo")).content)["proxy-groups"][0].tolerance,
      90,
    );
    await db.users.update({
      where: { id: user.id },
      data: { expireAt: new Date(0) },
    });
    const expired = load((await render("mihomo")).content);
    assert.equal(expired.proxies.length, 0);
    assert.deepEqual(expired["proxy-groups"][0].proxies, ["REJECT"]);
    assert.equal(expired.profile, undefined);
    assert.deepEqual((await render("singbox")).content.route.rules, [
      { action: "reject" },
    ]);
    const selection = (await templates.list()).selection;
    await templates.select({ templateId: null, version: selection.version });
    await templates.remove(first.id, updated.version);
    await templates.remove(copy.id, copy.version);
    assert.equal((await templates.list()).items.length, 0);
  } finally {
    await db.$disconnect();
  }
});

test("V3 type filters and relay conversion isolate providers, preserve inputs and reject cycles", () => {
  const input = {
    mihomo: {
      "proxy-providers": {
        remote: {
          type: "http",
          url: "https://example.com/sub",
          path: "./cache.yaml",
          override: { udp: true },
        },
      },
      "proxy-groups": [
        { name: "Entry", type: "select", "include-all-providers": true },
        {
          name: "Landing",
          type: "relay",
          proxies: ["$NODES"],
          use: ["remote"],
          "dialer-proxy-group": "Entry",
          "include-type": "SS|vLeSs",
          "exclude-type": "vless",
          filter: "(?i)hk",
          "empty-fallback": "DIRECT",
        },
        { name: "Raw", type: "select", "include-all-proxies": true },
      ],
    },
  };
  const parsed = SubscriptionTemplateInput.parse({
    name: "V3",
    document: input,
  }).document;
  const nodes = [
    { name: "HK SS", type: "ss", password: "fixture" },
    { name: "HK VLESS", type: "vless" },
    { name: "Unknown" },
  ];
  const before = JSON.stringify({ parsed, nodes });
  const result = expandTemplateGroups(parsed.mihomo, nodes);
  assert.equal(JSON.stringify({ parsed, nodes }), before);
  const landing = result.groups.find((group) => group.name === "Landing");
  assert.equal(landing.type, "select");
  assert.equal(landing["include-type"], undefined);
  assert.equal(landing["dialer-proxy-group"], undefined);
  assert.equal(landing["empty-fallback"], "REJECT");
  assert.equal(landing.filter, "(?i)hk");
  const inline = Object.values(result.proxyProviders).find(
    (provider) => provider.type === "inline",
  );
  assert.deepEqual(inline.payload, [{ ...nodes[0], "dialer-proxy": "Entry" }]);
  assert.deepEqual(result.groups[0].use, ["remote"]);
  assert.equal(result.groups[0]["include-all-providers"], undefined);
  assert.deepEqual(result.groups[2].proxies, []);
  assert.equal(result.groups[2]["include-all-proxies"], true);
  const cloned = result.proxyProviders[landing.use[0]];
  assert.notEqual(cloned.path, "./cache.yaml");
  assert.equal(cloned.override.udp, true);
  assert.equal(cloned.override["dialer-proxy"], "Entry");
  assert.equal(
    result.proxyProviders.remote.override["dialer-proxy"],
    undefined,
  );
  assert.match(result.warnings.join(" "), /Unknown/);
  const empty = expandTemplateGroups(
    {
      "proxy-groups": [
        { name: "Empty", type: "select", "include-all-providers": true },
      ],
    },
    [],
  );
  assert.deepEqual(empty.groups[0].proxies, ["REJECT"]);
  for (const group of [
    { name: "Bad", type: "select", "include-type": "typo" },
    { name: "Bad", type: "relay" },
    { name: "Bad", type: "select", "dialer-proxy": "Entry" },
    {
      name: "Bad",
      type: "relay",
      "dialer-proxy-group": "Entry",
      proxies: ["DIRECT"],
    },
    {
      name: "Bad",
      type: "relay",
      "dialer-proxy-group": "Entry",
      proxies: ["Entry"],
    },
  ])
    assert.throws(() =>
      SubscriptionTemplateInput.parse({
        name: "Bad",
        document: {
          mihomo: { "proxy-groups": [input.mihomo["proxy-groups"][0], group] },
        },
      }),
    );
  const cyclic = structuredClone(input);
  cyclic.mihomo["proxy-groups"][0].proxies = ["Landing"];
  assert.throws(
    () => SubscriptionTemplateInput.parse({ name: "Cyclic", document: cyclic }),
    /循环/,
  );
  const providerCycle = structuredClone(input);
  providerCycle.mihomo["proxy-providers"].remote.override["dialer-proxy"] =
    "Landing";
  assert.throws(
    () =>
      SubscriptionTemplateInput.parse({
        name: "Cyclic",
        document: providerCycle,
      }),
    /循环/,
  );
});
