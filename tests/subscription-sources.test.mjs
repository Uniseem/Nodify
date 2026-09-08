import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:https";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ruleFixture } from "./rule-fixture.mjs";
const require = createRequire(import.meta.url);
const { SourceInput } = require("../packages/nodify-contract/index.ts");
const {
  NodifyResourcesService,
  parseSource,
  fetchSubscription,
} = require("../apps/backend/src/modules/nodify/resources.service.ts");
const { load } = require("../apps/backend/node_modules/js-yaml");
const sourceText =
  "proxies:\n- {name: upstream, type: anytls, server: source.example, port: 443, password: upstream-test-secret}\n";
const waitForTask = async (db, id) => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const op = await db.nodifyOperation.findUniqueOrThrow({ where: { id } });
    if (!["queued", "running"].includes(op.state)) return op;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Source task did not finish");
};
test("source contracts and node identity survive YAML key order and upstream renaming", () => {
  assert.equal(
    SourceInput.parse({
      name: "manual",
      url: "https://example.org/sub",
      intervalMinutes: 0,
    }).intervalMinutes,
    0,
  );
  for (const url of [
    "http://example.org",
    "https://user:password@example.org",
    "https://example.org/#secret",
  ])
    assert.throws(() => SourceInput.parse({ name: "invalid", url }));
  const sourceId = randomUUID(),
    first = parseSource(sourceText, sourceId)[0];
  const next = parseSource(
    "proxies:\n- {password: upstream-test-secret, port: 443, server: source.example, type: anytls, name: renamed}",
    sourceId,
  )[0];
  assert.equal(first.id, next.id);
  assert.equal(
    parseSource(
      sourceText.replace("upstream-test-secret", "new-credential"),
      sourceId,
    )[0].id === first.id,
    false,
  );
  assert.equal(
    parseSource(
      `proxies:\n- &n {name: a, type: anytls, server: source.example, port: 443, password: test}\n- *n`,
      sourceId,
    ).length,
    1,
  );
  assert.throws(() =>
    parseSource(
      "proxies:\n- &a {type: anytls, server: source.example, port: 443, password: test, extra: *a}",
      sourceId,
    ),
  );
  assert.throws(() =>
    parseSource(
      "proxies: [{type: anytls, server: example.org, port: 443}]",
      sourceId,
    ),
  );
  const vmess = parseSource(
    `vmess://${Buffer.from(JSON.stringify({ ps: "grpc", add: "node.example", port: 443, id: randomUUID(), tls: "tls", sni: "tls.example", net: "grpc", path: "tunnel" })).toString("base64")}`,
    sourceId,
  )[0].proxy;
  assert.equal(vmess.servername, "tls.example");
  assert.equal(vmess["grpc-opts"]["grpc-service-name"], "tunnel");
  const xhttp = parseSource(
    `vless://${randomUUID()}@node.example:443?type=xhttp&path=%2Fsplit&mode=packet-up#xhttp`,
    sourceId,
  )[0].proxy;
  assert.equal(xhttp["xhttp-opts"].path, "/split");
  assert.equal(xhttp["xhttp-opts"].mode, "packet-up");
  assert.equal(xhttp.mode, undefined);
  for (const uri of [
    "ss://aes-128-gcm:test-password@source.example:8388#ss",
    `ss://${Buffer.from("aes-128-gcm:test-password").toString("base64")}@source.example:8388#ss`,
    `ss://${Buffer.from("aes-128-gcm:test-password@source.example:8388").toString("base64")}#ss`,
  ])
    assert.equal(parseSource(uri, sourceId)[0].proxy.password, "test-password");
  assert.equal(
    parseSource("hy2://test@[2001:db8::1]:443#ipv6", sourceId)[0].proxy.server,
    "2001:db8::1",
  );
});
test("SQLite source tasks preserve valid nodes, overrides and authorization, reject late results", async () => {
  const { db, service, render, entitlement } = await ruleFixture();
  const resources = new NodifyResourcesService(service);
  let release;
  resources.fetchSource = () => new Promise((resolve) => (release = resolve));
  try {
    const created = await resources.createSource({
      name: "external",
      url: "https://provider.example/sub?secret=private-test-url",
      intervalMinutes: 0,
      tags: ["external-allowed"],
    });
    let row = (await resources.listSources())[0];
    assert.equal(row.operation.state, "running");
    await assert.rejects(() => resources.syncSource(row.id));
    await assert.rejects(() =>
      resources.updateSource(row.id, { ...row, name: "busy" }),
    );
    release(sourceText);
    assert.equal(
      (await waitForTask(db, created.operationId)).state,
      "succeeded",
    );
    row = (await resources.listSources())[0];
    assert.ok(!JSON.stringify(row).includes("upstream-test-secret"));
    assert.ok(!JSON.stringify(row).includes("private-test-url"));
    const nodeId = row.nodes[0].id;
    await db.nodifyEntitlement.update({
      where: { id: entitlement.id },
      data: {
        snapshot: { ...entitlement.snapshot, tags: ["external-allowed"] },
      },
    });
    assert.ok(
      load((await render("mihomo")).content).proxies.some(
        (node) => node.name === "upstream",
      ),
    );
    await resources.updateSourceNode(row.id, nodeId, {
      version: row.version,
      name: "my node",
      enabled: false,
      tags: ["special"],
    });
    assert.ok(
      !load((await render("mihomo")).content).proxies.some(
        (node) => node.name === "my node",
      ),
    );
    await assert.rejects(() =>
      resources.updateSourceNode(row.id, nodeId, {
        version: row.version,
        name: "stale",
      }),
    );
    row = (await resources.listSources())[0];
    await resources.updateSourceNode(row.id, nodeId, {
      version: row.version,
      name: "my node",
      enabled: true,
      tags: ["special"],
    });
    resources.fetchSource = async () =>
      "proxies:\n- {port: 443, password: upstream-test-secret, type: anytls, name: upstream-new, server: source.example}";
    const synced = await resources.syncSource(row.id);
    assert.equal((await waitForTask(db, synced.id)).state, "succeeded");
    row = (await resources.listSources())[0];
    assert.equal(row.nodes[0].id, nodeId);
    assert.equal(row.nodes[0].name, "my node");
    assert.equal(row.nodes[0].upstreamName, "upstream-new");
    assert.deepEqual(row.nodes[0].tags, ["external-allowed", "special"]);
    assert.ok(
      load((await render("mihomo")).content).proxies.some(
        (node) => node.name === "my node",
      ),
    );
    const lastSyncedAt = row.lastSyncedAt;
    resources.fetchSource = async () => {
      throw new Error("private-test-url");
    };
    const failed = await resources.syncSource(row.id);
    assert.equal((await waitForTask(db, failed.id)).state, "failed");
    row = (await resources.listSources())[0];
    assert.equal(row.lastSyncedAt.getTime(), lastSyncedAt.getTime());
    assert.equal(row.nodes[0].name, "my node");
    assert.ok(!JSON.stringify(row).includes("private-test-url"));
    resources.fetchSource = () => new Promise((resolve) => (release = resolve));
    const expired = await resources.syncSource(row.id);
    await db.nodifyOperation.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(0) },
    });
    await resources.updateSource(row.id, {
      ...row,
      enabled: false,
      url: "https://replacement.example/sub",
    });
    release(sourceText.replace("upstream-test-secret", "new-credential"));
    assert.equal((await waitForTask(db, expired.id)).state, "failed");
    row = (await resources.listSources())[0];
    assert.equal(row.enabled, false);
    assert.equal(row.endpointHost, "replacement.example");
    assert.equal(row.nodes[0].id, nodeId);
    assert.ok(
      !load((await render("mihomo")).content).proxies.some(
        (node) => node.name === "my node",
      ),
    );
    const count = await db.nodifyOperation.count({
      where: { kind: "subscription-sync" },
    });
    await resources.tick();
    assert.equal(
      await db.nodifyOperation.count({ where: { kind: "subscription-sync" } }),
      count,
    );
    await resources.updateSource(row.id, { ...row, enabled: true });
    await resources.tick();
    assert.equal(
      await db.nodifyOperation.count({ where: { kind: "subscription-sync" } }),
      count,
      "Manual interval must not schedule automatically",
    );
    row = (await resources.listSources())[0];
    await resources.updateSource(row.id, { ...row, intervalMinutes: 60 });
    await db.nodifySubscriptionSource.update({
      where: { id: row.id },
      data: { lastAttemptAt: new Date(0) },
    });
    resources.fetchSource = async () => sourceText;
    await resources.tick();
    row = (await resources.listSources())[0];
    assert.equal((await waitForTask(db, row.operation.id)).state, "succeeded");
    row = (await resources.listSources())[0];
    await resources.deleteSource(row.id, row.version);
    assert.equal((await resources.listSources()).length, 0);
  } finally {
    resources.onModuleDestroy();
    await db.$disconnect();
  }
});
test(
  "real HTTPS source import enforces certificate, redirect and size boundaries",
  { skip: !process.env.NODIFY_TEST_SOURCE_URL, timeout: 60000 },
  async () => {
    const directory = process.env.NODIFY_TEST_SOURCE_CERT_DIR;
    const { db, service } = await ruleFixture();
    const resources = new NodifyResourcesService(service);
    const server = createServer(
      {
        cert: await readFile(join(directory, "fullchain.pem")),
        key: await readFile(join(directory, "privkey.pem")),
      },
      (req, res) => {
        const path = new URL(req.url, "https://source.example").pathname;
        if (path !== "/no-traffic")
          res.setHeader(
            "subscription-userinfo",
            path === "/bad-traffic"
              ? "upload=0;download=-1"
              : "upload=9007199254740993; download=42; total=0",
          );
        if (path === "/redirect") {
          res.writeHead(302, { Location: "https://127.0.0.1/private" });
          res.end();
        } else if (path === "/large") res.end("x".repeat(6 * 1024 * 1024));
        else if (path === "/slow") {
          const timer = setTimeout(() => res.end(sourceText), 20000);
          res.on("close", () => clearTimeout(timer));
        } else if (path === "/invalid")
          res.end("proxies: [{type: unsupported}]");
        else res.end(sourceText);
      },
    );
    await new Promise((resolve) =>
      server.listen(
        Number(process.env.NODIFY_TEST_SOURCE_PORT),
        "0.0.0.0",
        resolve,
      ),
    );
    const base = process.env.NODIFY_TEST_SOURCE_URL;
    try {
      assert.match(await fetchSubscription(`${base}/valid`), /upstream/);
      await assert.rejects(() => fetchSubscription(`${base}/redirect`));
      await assert.rejects(() => fetchSubscription(`${base}/large`));
      const created = await resources.createSource({
        name: "TLS source",
        url: `${base}/valid`,
        intervalMinutes: 0,
      });
      assert.equal(
        (await waitForTask(db, created.operationId)).state,
        "succeeded",
      );
      let row = (await resources.listSources())[0];
      assert.equal(row.traffic.upload, "9007199254740993");
      assert.equal(row.trafficStale, false);
      await assert.rejects(() => fetchSubscription(`${base}/bad-traffic`));
      await resources.updateSource(row.id, { ...row, url: `${base}/invalid` });
      const invalid = await resources.syncSource(row.id);
      assert.equal((await waitForTask(db, invalid.id)).state, "failed");
      row = (await resources.listSources())[0];
      assert.equal(row.nodes.length, 1);
      assert.equal(row.traffic.download, "42");
      assert.equal(row.trafficStale, true);
      await resources.updateSource(row.id, {
        ...row,
        url: `${base}/no-traffic`,
      });
      const noTraffic = await resources.syncSource(row.id);
      assert.equal((await waitForTask(db, noTraffic.id)).state, "succeeded");
      row = (await resources.listSources())[0];
      assert.equal(row.traffic, null);
      assert.equal(row.trafficStale, false);
      const started = Date.now();
      await assert.rejects(() => fetchSubscription(`${base}/slow`));
      assert.ok(Date.now() - started >= 14000);
      server.closeAllConnections();
      server.setSecureContext({
        cert: await readFile(join(directory, "untrusted.pem")),
        key: await readFile(join(directory, "privkey.pem")),
      });
      server.setTicketKeys(randomBytes(48));
      await assert.rejects(
        () => fetchSubscription(`${base}/valid`),
        /certificate|self-signed|verify/i,
      );
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await db.$disconnect();
    }
  },
);
