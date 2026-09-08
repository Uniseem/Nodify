import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import net from "node:net";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ruleFixture } from "./rule-fixture.mjs";
const require = createRequire(import.meta.url);
const {
  RuleSetInput,
  parseSubscriptionRules,
  compileSubscriptionRules,
} = require("../packages/nodify-contract/index.ts");
const { load, dump } = require("../apps/backend/node_modules/js-yaml");
const exec = promisify(execFile);
const {
  SubscriptionFiles,
} = require("../apps/backend/src/modules/nodify/subscription-files.ts");
const {
  SubscriptionTemplates,
} = require("../apps/backend/src/modules/nodify/subscription-templates.ts");
test("subscription rules validate input and preserve precedence and GeoIP providers", () => {
  const rules = parseSubscriptionRules(
    "# comment\nDOMAIN,example.com,PROXY\nIP-CIDR,10.0.0.0/8,DIRECT\nGEOIP,cn,REJECT\nGEOIP,CN,DIRECT",
  );
  for (const text of [
    "IP-CIDR,300.0.0.1/24,DIRECT",
    "IP-CIDR,10.0.0.0/33,DIRECT",
    "DOMAIN,https://example.com,PROXY",
    "DOMAIN,foo..com,DIRECT",
    "DOMAIN,test.com,DIRECT,extra",
    "GEOIP,CHINA,DIRECT",
  ])
    assert.throws(() => parseSubscriptionRules(text));
  const compiled = compileSubscriptionRules([
    { name: "enabled", rules, enabled: true },
    { name: "disabled", rules, enabled: false },
  ]);
  assert.deepEqual(compiled.mihomo, [
    "DOMAIN,example.com,Nodify",
    "IP-CIDR,10.0.0.0/8,DIRECT",
    "GEOIP,CN,REJECT",
    "GEOIP,CN,DIRECT",
  ]);
  assert.equal(compiled.ruleSets.length, 1);
  assert.equal(compiled.singbox[2].action, "reject");
});
test("SQLite rule sets: CRUD, stale writes, ordering, subscription priority and expiry", async () => {
  const { db, service, render, user } = await ruleFixture();
  try {
    const a = await service.saveRuleSet({
      name: "first",
      rules: parseSubscriptionRules("DOMAIN,blocked.example,REJECT"),
    });
    const b = await service.saveRuleSet({
      name: "second",
      rules: parseSubscriptionRules("IP-CIDR,127.0.0.0/8,DIRECT"),
    });
    await assert.rejects(() => service.saveRuleSet(a, a.id));
    await assert.rejects(() =>
      service.reorderRuleSets([
        { id: a.id, version: 1 },
        { id: a.id, version: 1 },
      ]),
    );
    const sorted = await service.reorderRuleSets([
      { id: b.id, version: b.version },
      { id: a.id, version: a.version },
    ]);
    assert.equal(sorted[0].id, b.id);
    await assert.rejects(() => service.saveRuleSet(a, a.id, a.version));
    await assert.rejects(() => service.deleteRuleSet(a.id, a.version));
    await db.nodifySetting.create({
      data: {
        key: "subscription.settings",
        value: JSON.stringify({
          mihomo: {
            rules: ["MATCH,DIRECT"],
            "proxy-groups": [
              { name: "Custom", type: "select", proxies: ["$NODES"] },
            ],
          },
          singbox: {
            route: {
              rules: [{ domain: ["template.example"], action: "reject" }],
            },
          },
        }),
      },
    });
    const mihomo = load((await render("mihomo")).content);
    assert.deepEqual(mihomo.rules, [
      "IP-CIDR,127.0.0.0/8,DIRECT",
      "DOMAIN,blocked.example,REJECT",
      "MATCH,DIRECT",
    ]);
    assert.ok(mihomo["proxy-groups"].some((group) => group.name === "Nodify"));
    assert.notEqual(
      mihomo.proxies[0].name,
      "Nodify",
      "Node names must not collide with the group target",
    );
    const sing = (await render("singbox")).content;
    assert.deepEqual(
      sing.route.rules.map((rule) => rule.action),
      ["route", "reject", "reject"],
    );
    assert.ok(sing.outbounds.some((out) => out.tag === "direct"));
    await service.saveRuleSet(
      { ...sorted[0], enabled: false },
      b.id,
      sorted[0].version,
    );
    assert.equal(load((await render("mihomo")).content).rules.length, 2);
    await service.deleteRuleSet(a.id, sorted[1].version);
    assert.deepEqual(load((await render("mihomo")).content).rules, [
      "MATCH,DIRECT",
    ]);
    await service.saveRuleSet({
      name: "direct all",
      rules: parseSubscriptionRules("IP-CIDR,0.0.0.0/0,DIRECT"),
    });
    await db.hosts.updateMany({ data: { isDisabled: true } });
    const noNodes = await render("singbox");
    assert.equal(noNodes.headers["X-Nodify-Rules-Applied"], "0");
    assert.deepEqual(noNodes.content.route.rules, [{ action: "reject" }]);
    await db.users.update({
      where: { id: user.id },
      data: { expireAt: new Date(0) },
    });
    assert.deepEqual((await render("singbox")).content.route.rules, [
      { action: "reject" },
    ]);
    assert.deepEqual(load((await render("mihomo")).content).rules, [
      "MATCH,Nodify",
    ]);
    assert.equal((await render("uris")).content, "");
  } finally {
    await db.$disconnect();
  }
});
async function port() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
for (const ruleMode of ["all", "template"])
  test(
    `real subscription rules (${ruleMode}) route DIRECT and PROXY separately and enforce REJECT${process.env.NODIFY_TEST_GEOIP ? " with real GeoIP resources" : ""}`,
    { skip: !process.env.NODIFY_TEST_SINGBOX, timeout: 120000 },
    async () => {
      const serverPort = await port(),
        clientPort = await port();
      const fixture = await ruleFixture(serverPort);
      const { db, directory, service, render, user } = fixture;
      const children = new Set();
      const start = async (binary, args, readyPort) => {
        const child = spawn(binary, args, {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let logs = "";
        child.stdout.on(
          "data",
          (chunk) => (logs = (logs + chunk).slice(-4000)),
        );
        child.stderr.on(
          "data",
          (chunk) => (logs = (logs + chunk).slice(-4000)),
        );
        children.add(child);
        const deadline = Date.now() + 40000;
        while (Date.now() < deadline) {
          assert.equal(child.exitCode, null, logs);
          const ready = await new Promise((resolve) => {
            const socket = net.connect({ host: "127.0.0.1", port: readyPort });
            socket.on("connect", () => {
              socket.destroy();
              resolve(true);
            });
            socket.on("error", () => resolve(false));
          });
          if (ready) return child;
          await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error(`Client readiness timed out: ${logs}`);
      };
      const stop = async (child) => {
        if (child.exitCode === null) {
          child.kill();
          await new Promise((r) => child.once("exit", r));
        }
        children.delete(child);
      };
      const destination = createServer((req, res) => res.end("rule-route-ok"));
      await new Promise((r) => destination.listen(0, "0.0.0.0", r));
      const request = (host) =>
        exec("curl", [
          "--silent",
          "--show-error",
          "--fail",
          "--max-time",
          "4",
          "--noproxy",
          "",
          "--proxy",
          `http://127.0.0.1:${clientPort}`,
          `http://${host}:${destination.address().port}/`,
        ]);
      try {
        const templates = new SubscriptionTemplates(service);
        const template = await templates.save({
          name: "Real client template",
          document: {
            mihomo: {
              "proxy-groups": [
                {
                  name: "Managed nodes",
                  type: "select",
                  proxies: ["__PROXY_NODES__"],
                },
                { name: "Nodify", type: "select", proxies: ["Managed nodes"] },
                ...["url-test", "fallback", "load-balance"].map((type) => ({
                  name: type,
                  type,
                  "include-all-proxies": true,
                  filter: "Nodify",
                  url: `http://127.0.0.1:${destination.address().port}/`,
                  interval: 300,
                })),
              ],
              rules: ["MATCH,Nodify"],
            },
            singbox: { log: { level: "warn" } },
          },
        });
        await templates.select({ templateId: template.id, version: 0 });
        const files = new SubscriptionFiles(service);
        await files.save({
          entitlementId: fixture.entitlement.id,
          name: "Real client file",
          alias: "client-rules-secret",
          templateId: template.id,
          ruleMode,
        });
        const fileToken = (await files.list())[0].subscriptionUrl
          .split("/")
          .at(-1);
        const routes = await service.saveRuleSet({
          name: "routes",
          rules: parseSubscriptionRules(
            "DOMAIN,blocked.example,REJECT\nIP-CIDR,127.0.0.1/32,DIRECT\nIP-CIDR,127.0.0.2/32,PROXY\nIP-CIDR,127.0.0.3/32,REJECT" +
              (process.env.NODIFY_TEST_GEOIP ? "\nGEOIP,CN,DIRECT" : ""),
          ),
        });
        if (ruleMode === "template") {
          const blocked = await service.saveRuleSet({
            name: "Excluded catch-all",
            rules: parseSubscriptionRules("IP-CIDR,127.0.0.0/8,REJECT"),
          });
          await service.reorderRuleSets(
            [blocked, routes].map(({ id, version }) => ({ id, version })),
          );
          await templates.save(
            { ...template, ruleMode: "selected", ruleSetIds: [routes.id] },
            template.id,
          );
        }
        const serverFile = join(directory, "server.json");
        await writeFile(
          serverFile,
          JSON.stringify({
            inbounds: [
              {
                type: "vless",
                listen: "127.0.0.1",
                listen_port: serverPort,
                users: [{ uuid: user.vlessUuid }],
              },
            ],
            outbounds: [{ type: "direct" }],
          }),
        );
        for (const format of [
          "singbox",
          ...(process.env.NODIFY_TEST_MIHOMO ? ["mihomo"] : []),
        ]) {
          const server = await start(
            process.env.NODIFY_TEST_SINGBOX,
            ["run", "-c", serverFile],
            serverPort,
          );
          const config = (await render(format, fileToken)).content;
          const file = join(
            directory,
            `client-${format}.${format === "mihomo" ? "yaml" : "json"}`,
          );
          let client;
          if (format === "singbox") {
            config.inbounds[0].listen_port = clientPort;
            await writeFile(file, JSON.stringify(config));
            await exec(process.env.NODIFY_TEST_SINGBOX, ["check", "-c", file]);
            client = await start(
              process.env.NODIFY_TEST_SINGBOX,
              ["run", "-c", file],
              clientPort,
            );
          } else {
            const parsed = load(config);
            parsed["mixed-port"] = clientPort;
            parsed["allow-lan"] = false;
            await writeFile(file, dump(parsed));
            await exec(
              process.env.NODIFY_TEST_MIHOMO,
              ["-t", "-d", directory, "-f", file],
              { timeout: 45000 },
            );
            client = await start(
              process.env.NODIFY_TEST_MIHOMO,
              ["-d", directory, "-f", file],
              clientPort,
            );
          }
          assert.equal((await request("127.0.0.1")).stdout, "rule-route-ok");
          assert.equal((await request("127.0.0.2")).stdout, "rule-route-ok");
          await assert.rejects(() => request("127.0.0.3"));
          await assert.rejects(() => request("blocked.example"));
          await stop(server);
          assert.equal((await request("127.0.0.1")).stdout, "rule-route-ok");
          await assert.rejects(
            () => request("127.0.0.2"),
            `${format} PROXY rule must use the managed proxy, not DIRECT`,
          );
          await stop(client);
        }
      } finally {
        for (const child of children) await stop(child);
        await new Promise((r) => destination.close(r));
        await db.$disconnect();
      }
    },
  );
