import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  symlinkSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { statsDelta, decodeStats } from "../apps/node/agent/statistics.mjs";
import { Runtime } from "../apps/node/agent/runtime.mjs";
import net from "node:net";
import { hostname } from "node:os";
import { decryptBackup, restoreBackup } from "../deploy/restore.mjs";
const require = createRequire(import.meta.url);
require("./loader.cjs");
const {
  ConfigInput,
  PackageInput,
} = require("../packages/nodify-contract/index.ts");
const {
  compileConfiguration,
  measuredBytes,
} = require("../apps/backend/src/modules/nodify/configuration.ts");
const { SecretBox } = require("../apps/backend/src/modules/nodify/crypto.ts");
const {
  NodifyService,
} = require("../apps/backend/src/modules/nodify/nodify.service.ts");
const {
  NodifyResourcesService,
  parseSource,
  fetchSubscription,
} = require("../apps/backend/src/modules/nodify/resources.service.ts");
const { PrismaClient } = require("../apps/backend/node_modules/@prisma/client");
const {
  proxyFor,
  uriFor,
  singboxFor,
} = require("../apps/backend/src/modules/nodify/subscription.controller.ts");
const temp = mkdtempSync(join(tmpdir(), "nodify-test-"));
process.env.NODIFY_DATA_DIR = join(temp, "secrets");
process.env.NODIFY_PUBLIC_URL = "https://nodify.example";
process.env.APP_SECRET = "isolated-test-application-secret";
const certificateId = randomUUID();
const inbound = () => ({
  id: randomUUID(),
  name: "Test AnyTLS",
  protocol: "anytls",
  port: 8443,
  network: "tcp",
  security: "tls",
  serverName: "node.example",
  certificateId,
});

test("protocol matrix rejects impossible combinations and port collisions", () => {
  assert.throws(() =>
    ConfigInput.parse({ inbounds: [{ ...inbound(), security: "reality" }] }),
  );
  assert.throws(() => ConfigInput.parse({ inbounds: [inbound(), inbound()] }));
  assert.throws(() =>
    ConfigInput.parse({
      inbounds: [{ ...inbound(), certificateId: undefined }],
    }),
  );
  assert.equal(ConfigInput.parse({ inbounds: [inbound()] }).inbounds.length, 1);
  assert.throws(() =>
    ConfigInput.parse({ inbounds: [], xray: { inbounds: [] } }),
  );
  assert.throws(() =>
    ConfigInput.parse({ inbounds: [], singbox: { outbounds: {} } }),
  );
});
test("AnyTLS compiler preserves advanced fields and scopes independent credentials", () => {
  const i = inbound(),
    other = inbound();
  other.port = 9443;
  const c = ConfigInput.parse({
    inbounds: [i, other],
    xray: { dns: { servers: ["1.1.1.1"] } },
    singbox: { route: { final: "direct" } },
  });
  const user = {
    id: "1",
    uuid: randomUUID(),
    password: "trojan-secret",
    ssPassword: "ss-secret",
    anytlsPassword: "independent-secret",
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    remainingBytes: "10000",
    nodeIds: [i.id],
    tags: [],
  };
  const compiled = compileConfiguration(c, [user]);
  assert.equal(
    compiled.singbox.inbounds[0].users[0].password,
    "independent-secret",
  );
  assert.equal(compiled.singbox.inbounds[1].users.length, 0);
  assert.deepEqual(compiled.xray.dns, { servers: ["1.1.1.1"] });
  assert.deepEqual(compiled.singbox.route, { final: "direct" });
});
test("metering preserves integers beyond JS precision and applies directions once", () => {
  const p = PackageInput.parse({
    name: "P",
    trafficLimitBytes: "0",
    validDays: 30,
    nodeIds: [],
    direction: "download",
    multiplier: 1.5,
  });
  assert.equal(measuredBytes(100n, 9007199254740994n, p), 13510798882111491n);
  const delta = statsDelta(
    { "user>>>7>>>traffic>>>uplink": "9007199254740995" },
    { "user>>>7>>>traffic>>>uplink": "9007199254740993" },
  );
  assert.equal(delta[0].upload, "2");
  assert.equal(
    statsDelta(
      { "user>>>7>>>traffic>>>downlink": "3" },
      { "user>>>7>>>traffic>>>downlink": "100" },
    )[0].download,
    "3",
  );
});
test("secret box authenticates ciphertext and persists the master key", () => {
  const box = new SecretBox(join(temp, "box")),
    cipher = box.seal("private");
  assert.equal(new SecretBox(join(temp, "box")).open(cipher), "private");
  const bytes = Buffer.from(cipher, "base64");
  bytes[bytes.length - 1] ^= 1;
  assert.throws(() => box.open(bytes.toString("base64")));
});
test("port preflight catches conflicts before stopping managed services", async () => {
  const listener = net.createServer();
  await new Promise((r) => listener.listen(0, "0.0.0.0", r));
  const runtime = new Runtime(temp),
    port = listener.address().port;
  try {
    await assert.rejects(
      () => runtime.checkPorts([{ port, transport: "tcp" }]),
      /already in use/,
    );
    await runtime.checkPorts(
      [{ port, transport: "tcp" }],
      new Set([`tcp:${port}`]),
    );
  } finally {
    await new Promise((r) => listener.close(r));
  }
});
test("external source validation is atomic and refuses local destinations", async () => {
  const id = randomUUID();
  const input =
    "proxies:\n  - name: external\n    type: anytls\n    server: example.org\n    port: 443\n    password: test\n";
  const parsed = parseSource(input, id);
  assert.equal(parsed[0].distributionOnly, true);
  assert.equal(parsed[0].id, parseSource(input, id)[0].id);
  assert.throws(() => parseSource("proxies: [{type: unknown}]", id));
  await assert.rejects(async () =>
    fetchSubscription("https://127.0.0.1/private"),
  );
  await assert.rejects(async () => fetchSubscription("https://[::1]/private"));
  await assert.rejects(async () =>
    fetchSubscription("https://[fec0::1]/private"),
  );
  await assert.rejects(async () =>
    fetchSubscription("https://[::ffff:127.0.0.1]/private"),
  );
});
test("subscription conversions retain AnyTLS and REALITY credentials", () => {
  const i = ConfigInput.parse({ inbounds: [inbound()] }).inbounds[0];
  const p = proxyFor(
    i,
    "node.example",
    { vlessUuid: "uuid", trojanPassword: "t", ssPassword: "s" },
    "a",
  );
  assert.equal(singboxFor(p).type, "anytls");
  assert.equal(p.sni, "node.example", "Mihomo AnyTLS uses sni, not servername");
  assert.match(uriFor(p), /^anytls:\/\/a@/);
  assert.equal(singboxFor(p).tls.server_name, "node.example");
});
test("SQLite integration: enrollment replay, entitlement snapshot, traffic dedup and backup restore", async () => {
  const filename = join(temp, "database.sqlite");
  const db = new PrismaClient({
    datasources: { db: { url: `file:${filename.replaceAll("\\", "/")}` } },
  });
  try {
    const migrations = new URL(
      "../apps/backend/prisma/migrations/",
      import.meta.url,
    );
    for (const name of readdirSync(migrations).sort()) {
      const file = new URL(`${name}/migration.sql`, migrations);
      if (!existsSync(file)) continue;
      for (const sql of readFileSync(file, "utf8")
        .replace(/^\uFEFF/, "")
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean))
        await db.$executeRawUnsafe(sql);
    }
    const nullableTemplate = await db.subscriptionTemplate.create({
      data: {
        name: "Nullable JSON regression",
        templateType: "MIHOMO",
        templateYaml: "proxies: []",
      },
    });
    assert.equal(
      nullableTemplate.templateJson,
      null,
      "Fresh SQLite deployments must read nullable JSON as SQL NULL",
    );
    assert.equal(
      (
        await db.subscriptionTemplate.findUniqueOrThrow({
          where: { uuid: nullableTemplate.uuid },
        })
      ).templateJson,
      null,
    );
    const service = new NodifyService(db);
    const resources = new NodifyResourcesService(service);
    const server = await service.createServer({
      name: "server",
      address: "node.example",
    });
    const credential = await service.enroll(server.token, "0.1.0", "test");
    assert.equal(
      (await service.authenticate(credential.credential)).id,
      server.id,
    );
    await assert.rejects(() => service.enroll(server.token, "0.1.0", "test"));
    const i = {
      ...inbound(),
      protocol: "vless",
      security: "none",
      certificateId: undefined,
    };
    const revision = await service.saveDraft(server.id, { inbounds: [i] });
    assert.equal(revision.version, 1);
    const operation = await service.operation(server.id, "apply-config", {
      version: 1,
      config: ConfigInput.parse({ inbounds: [i] }),
    });
    await service.complete(server.id, operation.id, "succeeded", "", {});
    assert.equal((await service.listServers())[0].appliedVersion, 1);
    assert.equal(await db.hosts.count(), 1);
    const originalHost = await db.hosts.findFirstOrThrow();
    const changedInbound = {
      ...i,
      name: "Renamed inbound",
      port: 9443,
      tags: ["edited"],
      extra: { sniffing: { enabled: true, destOverride: ["http", "tls"] } },
    };
    const changedRevision = await service.saveDraft(server.id, {
      inbounds: [changedInbound],
    });
    assert.equal(
      (await db.hosts.findFirstOrThrow()).port,
      i.port,
      "Saving a draft must not change the advertised endpoint",
    );
    const changedOperation = await service.apply(
      server.id,
      changedRevision.version,
    );
    assert.equal(
      (await db.hosts.findFirstOrThrow()).port,
      i.port,
      "Queued publication must wait for Agent confirmation",
    );
    await service.complete(server.id, changedOperation.id, "succeeded", "", {});
    const changedHost = await db.hosts.findFirstOrThrow();
    assert.equal(
      changedHost.uuid,
      originalHost.uuid,
      "Editing must retain the node identity and entitlements",
    );
    assert.equal(changedHost.port, 9443);
    assert.equal(changedHost.remark, "Renamed inbound");
    assert.deepEqual(
      (await db.nodifyInbound.findUniqueOrThrow({ where: { id: i.id } })).config
        .extra,
      changedInbound.extra,
    );
    const disabledRevision = await service.saveDraft(server.id, {
      inbounds: [{ ...changedInbound, enabled: false }],
    });
    const disabledOperation = await service.apply(
      server.id,
      disabledRevision.version,
    );
    await service.complete(
      server.id,
      disabledOperation.id,
      "succeeded",
      "",
      {},
    );
    assert.equal((await db.hosts.findFirstOrThrow()).isDisabled, true);
    const enabledRevision = await service.saveDraft(server.id, {
      inbounds: [i],
    });
    const enabledOperation = await service.apply(
      server.id,
      enabledRevision.version,
    );
    await service.complete(server.id, enabledOperation.id, "succeeded", "", {});
    assert.equal((await db.hosts.findFirstOrThrow()).isDisabled, false);
    await service.heartbeat(server.id, {
      appliedPolicyId: randomUUID(),
      appliedConfigVersion: 2,
    });
    assert.equal(
      (await db.nodifyServer.findUniqueOrThrow({ where: { id: server.id } }))
        .policyHash,
      "",
      "A policy missing after restore must trigger resynchronization",
    );
    const user = await db.users.create({
      data: {
        username: "member",
        shortUuid: "short",
        trojanPassword: "password",
        ssPassword: "password",
        vlessUuid: randomUUID(),
        expireAt: new Date(Date.now() + 86400000),
      },
    });
    const pkg = await service.savePackage({
      name: "base",
      trafficLimitBytes: "10000",
      validDays: 30,
      nodeIds: [i.id],
    });
    await service.assignPackage(user.id.toString(), pkg.id);
    await service.savePackage(
      {
        name: "changed",
        trafficLimitBytes: "1",
        validDays: 30,
        nodeIds: [i.id],
      },
      pkg.id,
    );
    assert.equal(
      (
        await db.nodifyEntitlement.findUniqueOrThrow({
          where: { userId: user.id },
        })
      ).snapshot.trafficLimitBytes,
      "10000",
    );
    const policy = await db.nodifyOperation.findFirstOrThrow({
      where: { serverId: server.id, state: "queued", kind: "apply-config" },
      orderBy: { createdAt: "desc" },
    });
    const batch = {
      session: randomUUID(),
      policyId: policy.id,
      sequence: 0,
      users: [{ userId: user.id.toString(), upload: "12", download: "34" }],
    };
    await service.traffic(server.id, batch);
    await service.traffic(server.id, batch);
    assert.equal(
      (
        await db.nodifyEntitlement.findUniqueOrThrow({
          where: { userId: user.id },
        })
      ).usedBytes,
      46n,
    );
    const backedUpRuleSet = await service.saveRuleSet({
      name: "backup-rules",
      rules: [{ type: "DOMAIN", value: "backup.example", policy: "DIRECT" }],
    });
    const sourceIdForBackup = randomUUID();
    const nodesForBackup = parseSource(
      "proxies: [{name: backup-node, type: anytls, server: backup.example, port: 443, password: backup-credential}]",
      sourceIdForBackup,
    );
    const sourceForBackup = await db.nodifySubscriptionSource.create({
      data: {
        id: sourceIdForBackup,
        name: "backup-source",
        traffic: {
          upload: "9007199254740993",
          download: "42",
          total: "10000000000000000",
          expire: null,
        },
        trafficDirection: "download",
        trafficStale: false,
        encryptedUrl: service.box.seal(
          "https://backup.example/sub?token=test-secret",
        ),
        nodes: nodesForBackup,
        enabled: false,
        tags: ["backup"],
        intervalMinutes: 0,
        nodeOverrides: {
          [nodesForBackup[0].id]: {
            name: "retained-name",
            enabled: false,
            tags: ["retained-tag"],
          },
        },
      },
    });
    const {
      SubscriptionTemplates,
    } = require("../apps/backend/src/modules/nodify/subscription-templates.ts");
    const templates = new SubscriptionTemplates(service);
    const backupTemplate = await templates.save({
      name: "backup-template",
      document: {
        mihomo: { rules: ["MATCH,Nodify"] },
        singbox: { log: { level: "warn" } },
      },
    });
    await templates.select({ templateId: backupTemplate.id, version: 0 });
    const {
      SubscriptionFiles,
    } = require("../apps/backend/src/modules/nodify/subscription-files.ts");
    const files = new SubscriptionFiles(service);
    const backupFile = await files.save({
      name: "backup-file",
      alias: "backup-file-secret",
      displayTrafficLimitBytes: "9007199254740993",
      statisticServerIds: [server.id],
      entitlementId: (await db.nodifyEntitlement.findFirstOrThrow()).id,
      templateId: backupTemplate.id,
      ruleMode: "selected",
      ruleSetIds: [backedUpRuleSet.id],
    });
    const originalFile = await db.nodifySubscriptionFile.findUniqueOrThrow({
      where: { id: backupFile.id },
    });
    const networkServer = await db.nodifyServer.findFirstOrThrow();
    await service.network(networkServer.id, {
      session: randomUUID(),
      sequence: 0,
      bootId: randomUUID(),
      collectedAt: new Date().toISOString(),
      interfaces: [
        {
          name: "eth0",
          index: 2,
          upload: "100",
          download: "200",
          discontinuity: false,
          intervalStart: new Date(Date.now() - 1000).toISOString(),
        },
      ],
    });
    await db.nodifyServer.update({
      where: { id: networkServer.id },
      data: {
        trafficSettings: {
          source: "network",
          interfaces: ["eth0"],
          direction: "upload",
          limitBytes: "12345",
        },
      },
    });
    const {
      TrafficAccounting,
    } = require("../apps/backend/src/modules/nodify/traffic-accounting.ts");
    const accounting = new TrafficAccounting(service);
    const accountingBefore = (await accounting.read(networkServer.id)).current;
    await accounting.change(networkServer.id, {
      requestId: randomUUID(),
      settingsVersion: accountingBefore.settingsVersion,
      periodKey: accountingBefore.periodKey,
      version: accountingBefore.version,
      action: "calibrate",
      targetBytes: "123",
      reason: "backup accounting check",
    });
    await accounting.saveSettings(networkServer.id, {
      version: accountingBefore.settingsVersion,
      source: "network",
      interfaces: ["eth0"],
      direction: "upload",
      limitBytes: "12345",
      includeInOverview: false,
    });
    const {
      TrafficOverview,
    } = require("../apps/backend/src/modules/nodify/overview-traffic.ts");
    await new TrafficOverview(service).save({
      version: 0,
      includeExternal: true,
    });
    const dnsBackupConfig = {
      servers: [
        "9.9.9.9",
        {
          address: "1.1.1.1",
          domains: ["full:backup.test"],
          expectedIPs: ["127.0.0.0/8"],
          skipFallback: true,
          custom: "retained",
        },
      ],
      hosts: { "backup.test": ["127.0.0.1", "::1"] },
      disableFallbackIfMatch: true,
    };
    const dnsBackupRevision = await service.saveDraft(server.id, {
      ...(await service.revisions(server.id))[0].config,
      xray: { dns: dnsBackupConfig },
    });
    const publication = {version: 1, config: {panelUrl:'https://panel.backup.example', subscriptionUrl:'https://sub.backup.example', tunnelId:crypto.randomUUID(), mode:'native', port:3000}};
    await db.nodifySetting.create({data:{key:'publication-domains',value:JSON.stringify(publication)}});
    const backup = await resources.backup("long-test-password");
    const backupPath = await resources.backupFile(backup.id);
    assert.throws(() => decryptBackup(readFileSync(backupPath), "incorrect"));
    const restored = join(temp, "restored.sqlite");
    restoreBackup(
      backupPath,
      "long-test-password",
      restored,
      join(temp, "restored-secrets"),
    );
    assert.ok(existsSync(restored));
    const releaseDirectory = join(temp, "release"),
      currentDirectory = join(temp, "current");
    mkdirSync(releaseDirectory);
    copyFileSync(
      fileURLToPath(new URL("../deploy/restore.mjs", import.meta.url)),
      join(releaseDirectory, "restore.mjs"),
    );
    copyFileSync(
      fileURLToPath(new URL("../deploy/version.json", import.meta.url)),
      join(releaseDirectory, "version.json"),
    );
    symlinkSync(
      releaseDirectory,
      currentDirectory,
      process.platform === "win32" ? "junction" : "dir",
    );
    const cliRestore = execFileSync(
      process.execPath,
      [
        join(currentDirectory, "restore.mjs"),
        backupPath,
        join(temp, "cli-restored.sqlite"),
        join(temp, "cli-secrets"),
      ],
      {
        env: {
          ...process.env,
          NODIFY_OFFLINE_RESTORE: "1",
          NODIFY_BACKUP_PASSWORD: "long-test-password",
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    assert.equal(
      JSON.parse(cliRestore).restored,
      true,
      "The restore CLI must execute through the systemd current release symlink",
    );
    const cliDatabase = join(temp, "cli-restored.sqlite");
    const beforeVersionMismatch = readFileSync(cliDatabase);
    writeFileSync(
      join(releaseDirectory, "version.json"),
      JSON.stringify({ version: "999.0.0" }),
    );
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            join(currentDirectory, "restore.mjs"),
            backupPath,
            cliDatabase,
            join(temp, "cli-secrets"),
          ],
          {
            env: {
              ...process.env,
              NODIFY_OFFLINE_RESTORE: "1",
              NODIFY_BACKUP_PASSWORD: "long-test-password",
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        ),
      /Backup application version does not match/,
    );
    assert.deepEqual(
      readFileSync(cliDatabase),
      beforeVersionMismatch,
      "A backup from another release must not overwrite the current database",
    );
    assert.equal(
      readFileSync(
        join(temp, "restored-secrets", "application-secret"),
        "utf8",
      ),
      process.env.APP_SECRET,
    );
    assert.equal(
      new SecretBox(join(temp, "restored-secrets")).open(
        service.box.seal("private-key-fixture"),
      ),
      "private-key-fixture",
    );
    const recovered = new PrismaClient({
      datasources: { db: { url: `file:${restored.replaceAll("\\", "/")}` } },
    });
    try {
      assert.equal(await recovered.nodifyServer.count(), 1);
      const recoveredServer = await recovered.nodifyServer.findFirstOrThrow();
      assert.equal(recoveredServer.protocolTraffic.upload, "12");
      assert.equal(recoveredServer.protocolTraffic.download, "34");
      const recoveredDaily =
        await recovered.nodifyDailyTraffic.findFirstOrThrow({
          where: { serverId: recoveredServer.id, userId: "" },
        });
      assert.equal(recoveredDaily.upload, "12");
      assert.equal(recoveredDaily.download, "34");
      assert.equal(recoveredDaily.charged, "46");
      assert.equal(recoveredDaily.rated, "46");
      assert.equal(recoveredDaily.reports, 1);
      assert.equal(
        recoveredServer.networkTraffic.interfaces.eth0.upload,
        "100",
      );
      assert.deepEqual(recoveredServer.trafficSettings, {
        source: "network",
        interfaces: ["eth0"],
        direction: "upload",
        limitBytes: "12345",
        resetDay: null,
        includeInOverview: false,
      });
      const restoredOverview =
        await recovered.nodifyOverviewSettings.findUniqueOrThrow({
          where: { id: "global" },
        });
      assert.equal(restoredOverview.includeExternal, true);
      assert.equal(restoredOverview.version, 1);
      assert.deepEqual(
        (
          await recovered.nodifyConfigRevision.findUniqueOrThrow({
            where: { id: dnsBackupRevision.id },
          })
        ).config.xray.dns,
        dnsBackupConfig,
      );
      assert.equal(
        (await recovered.nodifyNetworkDaily.findFirstOrThrow()).download,
        "200",
      );
      assert.equal(await recovered.nodifyNetworkBatch.count(), 1);
      const restoredFile =
        await recovered.nodifySubscriptionFile.findUniqueOrThrow({
          where: { id: backupFile.id },
          include: { ruleSets: true, alias: true },
        });
      const restoredAccounting =
        await recovered.nodifyTrafficAccounting.findFirstOrThrow();
      assert.deepEqual(JSON.parse((await recovered.nodifySetting.findUniqueOrThrow({where:{key:'publication-domains'}})).value), publication);
      assert.equal(restoredAccounting.adjustment, "23");
      assert.equal(restoredAccounting.calibrated, true);
      const restoredEvent =
        await recovered.nodifyTrafficAdjustment.findFirstOrThrow();
      assert.equal(restoredEvent.after.usedBytes, "123");
      assert.equal(restoredEvent.request.reason, "backup accounting check");
      assert.equal(restoredFile.templateId, backupTemplate.id);
      assert.deepEqual(restoredFile.statisticServerIds, [server.id]);
      assert.equal(restoredFile.displayTrafficLimitBytes, "9007199254740993");
      assert.equal(
        new SecretBox(join(temp, "restored-secrets")).open(
          restoredFile.alias.encryptedAlias,
        ),
        "backup-file-secret",
      );
      assert.equal(restoredFile.ruleSets[0].ruleSetId, backedUpRuleSet.id);
      assert.equal(
        new SecretBox(join(temp, "restored-secrets")).open(
          restoredFile.encryptedToken,
        ),
        service.box.open(originalFile.encryptedToken),
      );
      assert.deepEqual(
        (
          await recovered.nodifySubscriptionTemplate.findUniqueOrThrow({
            where: { id: backupTemplate.id },
          })
        ).document,
        backupTemplate.document,
      );
      assert.equal(
        JSON.parse(
          (
            await recovered.nodifySetting.findUniqueOrThrow({
              where: { key: "subscription.default-template" },
            })
          ).value,
        ).templateId,
        backupTemplate.id,
      );
      const recoveredSource =
        await recovered.nodifySubscriptionSource.findUniqueOrThrow({
          where: { id: sourceForBackup.id },
        });
      assert.deepEqual(recoveredSource.traffic, sourceForBackup.traffic);
      assert.equal(recoveredSource.trafficDirection, "download");
      assert.equal(recoveredSource.trafficStale, false);
      assert.deepEqual(
        recoveredSource.nodeOverrides,
        sourceForBackup.nodeOverrides,
      );
      assert.deepEqual(recoveredSource.tags, ["backup"]);
      assert.equal(
        new SecretBox(join(temp, "restored-secrets")).open(
          recoveredSource.encryptedUrl,
        ),
        "https://backup.example/sub?token=test-secret",
      );
      assert.deepEqual(
        (
          await recovered.nodifyRuleSet.findUniqueOrThrow({
            where: { id: backedUpRuleSet.id },
          })
        ).rules,
        backedUpRuleSet.rules,
        "Custom rule sets must survive encrypted backup and restore",
      );
      assert.equal(
        (await recovered.nodifyEntitlement.findFirst()).usedBytes,
        46n,
      );
    } finally {
      await recovered.$disconnect();
    }
    const beforeCorruption = readFileSync(restored);
    const damaged = Buffer.from(readFileSync(backupPath));
    damaged[damaged.length - 1] ^= 1;
    const damagedPath = join(temp, "damaged.nodify");
    writeFileSync(damagedPath, damaged);
    assert.throws(() =>
      restoreBackup(
        damagedPath,
        "long-test-password",
        restored,
        join(temp, "restored-secrets"),
      ),
    );
    assert.deepEqual(
      readFileSync(restored),
      beforeCorruption,
      "A damaged encrypted backup must not replace the current database",
    );
    const runtimeFile = join(temp, "restored-secrets", "panel-runtime.json");
    writeFileSync(
      runtimeFile,
      JSON.stringify({ pid: process.pid, host: hostname() }),
    );
    assert.throws(
      () =>
        restoreBackup(
          backupPath,
          "long-test-password",
          restored,
          join(temp, "restored-secrets"),
        ),
      /supervisor is running/,
    );
    writeFileSync(
      runtimeFile,
      JSON.stringify({ pid: process.pid, host: "stopped-panel-container" }),
    );
    const restoredAgain = restoreBackup(
      backupPath,
      "long-test-password",
      restored,
      join(temp, "restored-secrets"),
    );
    assert.ok(
      existsSync(restoredAgain.previousBackup),
      "Replacing an existing instance must first save an encrypted backup",
    );
    assert.deepEqual(
      decryptBackup(
        readFileSync(restoredAgain.previousBackup),
        "long-test-password",
      ).database,
      beforeCorruption,
    );
    await service.savePackage(
      {
        name: "multiplied",
        trafficLimitBytes: "10000",
        validDays: 30,
        nodeIds: [i.id],
        multiplier: 2,
      },
      pkg.id,
    );
    await service.syncPackage(pkg.id);
    await service.traffic(server.id, { ...batch, sequence: 1 });
    assert.equal(
      (
        await db.nodifyEntitlement.findUniqueOrThrow({
          where: { userId: user.id },
        })
      ).usedBytes,
      92n,
      "An offline batch retains its original tariff after template changes",
    );
    await service.resetEntitlement(user.id.toString());
    await service.traffic(server.id, { ...batch, sequence: 2 });
    assert.equal(
      (
        await db.nodifyEntitlement.findUniqueOrThrow({
          where: { userId: user.id },
        })
      ).usedBytes,
      0n,
      "Pre-reset batches must not charge the new generation",
    );
    await service.complete(server.id, policy.id, "succeeded", "", {});
    const failedDraft = await service.saveDraft(server.id, { inbounds: [i] });
    const failedOperation = await service.apply(server.id, failedDraft.version);
    await service.complete(
      server.id,
      failedOperation.id,
      "failed",
      "Invalid draft",
      {},
    );
    await service.memberAction(user.id.toString(), { action: "disable" });
    const revocation = await db.nodifyOperation.findFirstOrThrow({
      where: { serverId: server.id, kind: "apply-config", state: "queued" },
      orderBy: { createdAt: "desc" },
    });
    assert.deepEqual(
      JSON.parse(service.box.open(revocation.payload)).users,
      [],
      "A failed draft must not postpone revoking a disabled user's protocol access",
    );
    await service.complete(server.id, revocation.id, "succeeded", "", {});
    const profile = await service.saveSharedProfile("Shared QA", {
      inbounds: [i],
      xray: {
        routing: {
          rules: [{ type: "field", inboundTag: [i.id], outboundTag: "direct" }],
        },
      },
    });
    await service.createServer({ name: "unbound", address: "unbound.example" });
    await service.bindProfile(server.id, profile.id);
    const published = await service.publishProfile(profile.id);
    assert.equal(published.length, 1);
    assert.ok(published[0].id);
    const generated = (await service.revisions(server.id))[0].config.inbounds[0]
      .id;
    assert.notEqual(generated, i.id);
    assert.deepEqual(
      (await service.revisions(server.id))[0].config.xray.routing.rules[0]
        .inboundTag,
      [generated],
    );
    await service.complete(server.id, published[0].id, "succeeded", "", {});
    await service.publishProfile(profile.id);
    assert.equal(
      (await service.revisions(server.id))[0].config.inbounds[0].id,
      generated,
      "Shared profile nodes keep stable per-server identifiers",
    );
    assert.equal((await service.sharedProfiles())[0].servers.length, 1);
    const website = await service.saveWebsiteDraft(server.id, {
      name: "site",
      domain: "first.example",
      aliases: ["alias.example"],
      type: "static",
      target: "/srv/first",
    });
    assert.equal(website.version, 1);
    assert.equal(website.appliedConfig, null);
    const websiteTask = await service.publishWebsite(server.id, website.id);
    await assert.rejects(() =>
      service.saveWebsiteDraft(server.id, website.config, website.id),
    );
    await assert.rejects(() => service.publishWebsite(server.id, website.id));
    assert.equal(
      "payload" in (await service.listWebsites(server.id))[0].operation,
      false,
    );
    await service.complete(server.id, websiteTask.id, "succeeded", "", {});
    await assert.rejects(() =>
      service.saveWebsiteDraft(server.id, {
        ...website.config,
        domain: "alias.example",
        aliases: [],
      }),
    );
    const {
      WebsiteFiles,
    } = require("../apps/backend/src/modules/nodify/website-files.ts");
    const fileOperations = new WebsiteFiles(service);
    const appliedSite = (await service.listWebsites(server.id))[0];
    const fileRequest = {
      deployment: appliedSite.appliedDeployment,
      request: { action: "read", path: "index.html" },
    };
    await assert.rejects(() =>
      fileOperations.queue(randomUUID(), website.id, fileRequest),
    );
    await assert.rejects(() =>
      fileOperations.queue(server.id, website.id, {
        ...fileRequest,
        deployment: 999,
      }),
    );
    const fileOperation = await fileOperations.queue(
      server.id,
      website.id,
      fileRequest,
    );
    await assert.rejects(() => service.publishWebsite(server.id, website.id));
    await service.complete(server.id, fileOperation.id, "succeeded", "", {
      data: Buffer.from("private file content").toString("base64"),
      path: "index.html",
    });
    const persistedFile = await db.nodifyOperation.findUniqueOrThrow({
      where: { id: fileOperation.id },
    });
    assert.equal(persistedFile.result.data, undefined);
    assert.equal(
      JSON.parse(service.box.open(persistedFile.payload)).returnedData,
      Buffer.from("private file content").toString("base64"),
    );
    const publicFile = (await service.operations()).find(
      (op) => op.id === fileOperation.id,
    );
    assert.equal(publicFile.result.encryptedData, undefined);
    assert.equal(publicFile.result.contentAvailable, true);
    const site2 = await service.saveWebsiteDraft(
      server.id,
      { ...website.config, domain: "second.example", target: "/srv/second" },
      website.id,
    );
    assert.equal(site2.appliedConfig.domain, "first.example");
    await assert.rejects(() =>
      service.saveWebsiteDraft(server.id, {
        ...website.config,
        name: "conflict",
      }),
    );
    const failedSiteTask = await service.publishWebsite(server.id, website.id);
    await service.complete(
      server.id,
      failedSiteTask.id,
      "failed",
      "Nginx rejected configuration",
      {},
    );
    assert.equal(
      (await service.listWebsites(server.id))[0].appliedConfig.target,
      "/srv/first",
    );
    const siteRollback = await service.publishWebsite(server.id, website.id, 1);
    await service.complete(server.id, siteRollback.id, "succeeded", "", {});
    assert.equal((await service.listWebsites(server.id))[0].state, "draft");
    const timeoutTask = await service.publishWebsite(server.id, website.id, 2);
    await db.nodifyOperation.update({
      where: { id: timeoutTask.id },
      data: { state: "failed", expiresAt: new Date(0) },
    });
    assert.equal(
      (await service.listWebsites(server.id))[0].state,
      "failed",
      "Timed-out operations must not lock website editing forever",
    );
    const retried = await service.publishWebsite(server.id, website.id, 2);
    await service.complete(server.id, retried.id, "succeeded", "", {});
    assert.equal((await service.listWebsites(server.id))[0].appliedVersion, 2);
    await service.saveWebsiteDraft(
      server.id,
      { ...site2.config, target: "/srv/unpublished" },
      website.id,
    );
    await service.heartbeat(server.id, { websiteDeployments: {} });
    await service.reconcile();
    const websiteSync = (await service.listWebsites(server.id))[0].operation;
    assert.equal(websiteSync.state, "queued");
    const syncPayload = JSON.parse(
      service.box.open(
        (
          await db.nodifyOperation.findUniqueOrThrow({
            where: { id: websiteSync.id },
          })
        ).payload,
      ),
    );
    assert.equal(
      syncPayload.version,
      2,
      "A fresh Agent must receive the applied website, never an unpublished draft",
    );
    assert.equal(syncPayload.target, "/srv/second");
    await service.complete(server.id, websiteSync.id, "succeeded", "", {});
    const removeSite = await service.deleteWebsite(server.id, website.id);
    await service.complete(server.id, removeSite.id, "failed", "Offline", {});
    assert.equal((await service.listWebsites(server.id)).length, 1);
    const removeAgain = await service.deleteWebsite(server.id, website.id);
    await service.complete(server.id, removeAgain.id, "succeeded", "", {});
    assert.equal((await service.listWebsites(server.id)).length, 0);
    assert.equal(
      await db.nodifyWebsiteRevision.count({
        where: { websiteId: website.id },
      }),
      0,
    );
    await service.revoke(server.id);
    await assert.rejects(() => service.authenticate(credential.credential));
  } finally {
    await db.$disconnect();
  }
});
