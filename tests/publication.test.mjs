import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { request as httpRequest } from "node:http";
import { promisify } from "node:util";
import { ruleFixture } from "./rule-fixture.mjs";
const require = createRequire(import.meta.url);
const {
  PublicationConfig,
  tunnelArtifacts,
  subscriptionRequestAllowed,
  CLOUDFLARED_SHA256,
} = require("../packages/nodify-contract/index.ts");
const {
  PublicationSettings,
  publicationGuard,
} = require("../apps/backend/src/modules/nodify/publication.ts");
const {
  SubscriptionFiles,
} = require("../apps/backend/src/modules/nodify/subscription-files.ts");
const fetchHost = (url, options = {}) =>
  new Promise((resolve, reject) => {
    const req = httpRequest(
      url,
      { headers: options.headers, timeout: 5000 },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("error", reject);
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            text: async () => data,
            json: async () => JSON.parse(data),
          }),
        );
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(Error("timeout")));
    req.end();
  });
const config = {
  panelUrl: "https://panel.nodify.example",
  subscriptionUrl: "https://sub.nodify.example",
  tunnelId: randomUUID(),
  mode: "native",
  port: 3000,
};

test("publication validates origins and generates isolated, pinned native and Docker ingress", () => {
  for (const panelUrl of [
    "http://panel.example",
    "https://panel.example/",
    "https://user:secret@panel.example",
    "https://panel.example:444",
    "https://panel.example/path",
    "https://panel..example",
    "https://127.0.0.1",
    "https://-bad.example",
  ])
    assert.equal(
      PublicationConfig.safeParse({ ...config, panelUrl }).success,
      false,
      panelUrl,
    );
  assert.equal(
    PublicationConfig.safeParse({ ...config, subscriptionUrl: config.panelUrl })
      .success,
    false,
  );
  for (const mode of ["native", "docker"]) {
    const files = tunnelArtifacts({ ...config, mode }),
      value = JSON.parse(files.config);
    assert.equal(value.ingress.length, 3);
    assert.equal(value.ingress[2].service, "http_status:404");
    assert.equal(
      value.ingress[1].originRequest.httpHostHeader,
      "sub.nodify.example",
    );
    assert.equal(
      value.ingress[0].service,
      `http://${mode === "native" ? "127.0.0.1" : "panel"}:3000`,
    );
    assert.equal(files.compose.includes("latest"), false);
    assert.equal(files.service.includes("--no-autoupdate"), true);
  }
  for (const path of [
    "/api/sub/valid",
    "/api/sub/~alias?format=mihomo",
    "/subscription/valid",
    "/assets/index-a.js",
    "/assets/fonts/font.woff2",
  ])
    assert.equal(subscriptionRequestAllowed("GET", path), true, path);
  for (const path of [
    "/",
    "/login",
    "/api/servers",
    "/api/agent/connect",
    "/api/sub",
    "/api/sub/a/b",
    "/assets/../login",
    "/assets/%2e%2e/login",
    "/assets/x%2fy",
    "/assets/x\\y",
  ])
    assert.equal(subscriptionRequestAllowed("GET", path), false, path);
  assert.equal(subscriptionRequestAllowed("POST", "/api/sub/a"), false);
});

test("publication persists versions, rejects stale edits, switches real member/file URLs and restores environment defaults", async () => {
  const f = await ruleFixture(),
    settings = new PublicationSettings(f.service);
  try {
    assert.deepEqual(await settings.read(), { version: 0, config: null });
    await settings.save({ version: 0, config });
    assert.equal((await settings.read()).config.tunnelId, config.tunnelId);
    await assert.rejects(
      settings.save({ version: 0, config: { ...config, port: 4444 } }),
      /已变化/,
    );
    const assignment = await f.service.assignPackage(
      String(f.user.id),
      (await f.db.nodifyPackage.findFirstOrThrow()).id,
    );
    assert.equal(
      new URL(assignment.subscriptionUrl).origin,
      config.subscriptionUrl,
    );
    assert.equal(new URL(assignment.pageUrl).origin, config.subscriptionUrl);
    assert.equal(
      new URL((await f.service.entitlements())[0].pageUrl).origin,
      config.subscriptionUrl,
    );
    const newMember = await f.service.createMember({
      username: "published_member",
      packageId: (await f.db.nodifyPackage.findFirstOrThrow()).id,
    });
    assert.equal(new URL(newMember.pageUrl).origin, config.subscriptionUrl);
    const created = await f.service.createServer({
      name: "published",
      address: "127.0.0.4",
    });
    assert.ok(JSON.stringify(created).includes(config.panelUrl));
    assert.equal(
      JSON.stringify(created).includes(config.subscriptionUrl),
      false,
    );
    const token = assignment.subscriptionUrl.split("/").at(-1);
    const info = await f.render("info", token);
    assert.equal(info.content.subscriptionUrl, assignment.subscriptionUrl);
    const files = new SubscriptionFiles(f.service);
    await files.save({ name: "Public file", entitlementId: f.entitlement.id });
    const listing = await files.list();
    assert.equal(listing.length, 1);
    assert.equal(new URL(listing[0].pageUrl).origin, config.subscriptionUrl);
    assert.equal(
      new URL(listing[0].subscriptionUrl).origin,
      config.subscriptionUrl,
    );
    assert.equal(
      new URL((await f.service.revokeSubscription(String(f.user.id))).pageUrl)
        .origin,
      config.subscriptionUrl,
    );
    await settings.save({ version: 1, config: null });
    assert.equal(
      await f.service.publishedUrl("panel"),
      "https://rules.example",
    );
    assert.equal(
      new URL((await files.list())[0].pageUrl).origin,
      "https://rules.example",
    );
  } finally {
    await f.db.$disconnect();
  }
});

test("real HTTP origin guard rejects subscription management routes and WebSocket upgrades while serving subscriptions", async () => {
  const f = await ruleFixture(),
    settings = new PublicationSettings(f.service);
  const { Module } = require("../apps/backend/node_modules/@nestjs/common");
  const { NestFactory } = require("../apps/backend/node_modules/@nestjs/core");
  const {
    NodifyService,
  } = require("../apps/backend/src/modules/nodify/nodify.service.ts");
  const {
    NodifyAgentController,
  } = require("../apps/backend/src/modules/nodify/nodify.controller.ts");
  const {
    NodifySubscriptionController,
  } = require("../apps/backend/src/modules/nodify/subscription.controller.ts");
  const {
    NodifyAgentGateway,
  } = require("../apps/backend/src/modules/nodify/agent.gateway.ts");
  const WebSocket = require("../apps/node/node_modules/ws");
  const { SshTerminalGateway } = require("../apps/backend/src/modules/node-ssh/ssh/ssh-terminal.gateway.ts");
  const { SubscriptionModule } = require("../apps/backend/src/modules/subscription/subscription.module.ts");
  const { SubscriptionController } = require("../apps/backend/src/modules/subscription/controllers/subscription.controller.ts");
  const { SubscriptionService } = require("../apps/backend/src/modules/subscription/subscription.service.ts");
  const { ResponseRulesEncryptionService } = require("../apps/backend/src/modules/subscription-response-rules/services/response-rules-encryption.service.ts");
  const { ResponseRulesMiddleware } = require("../apps/backend/src/modules/subscription-response-rules/middleware/response-rules.middleware.ts");
  const { QueryBus } = require("../apps/backend/node_modules/@nestjs/cqrs");
  const { ResponseRulesMatcherService } = require("../apps/backend/src/modules/subscription-response-rules/services/response-rules-matcher.service.ts");
  let app;
  let ssh;
  try {
    await settings.save({ version: 0, config });
    class TestModule extends SubscriptionModule {}
    Module({
      imports: [],
      controllers: [NodifyAgentController, NodifySubscriptionController, SubscriptionController],
      providers: [
        { provide: NodifyService, useValue: f.service },
        { provide: SubscriptionService, useValue: {} },
        { provide: ResponseRulesEncryptionService, useValue: {} },
        { provide: ResponseRulesMiddleware, useValue: { use: (_req, res) => res.status(403).end() } },
        { provide: QueryBus, useValue: { execute: async () => null } },
        { provide: ResponseRulesMatcherService, useValue: {} },
        NodifyAgentGateway,
      ],
    })(TestModule);
    app = await NestFactory.create(TestModule, { logger: false, abortOnError: false });
    ssh = new SshTerminalGateway({}, { httpAdapter: app.getHttpAdapter() }, {}, {}, f.service);
    ssh.onApplicationBootstrap();
    app.use(publicationGuard(f.service));
    app.setGlobalPrefix("api");
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl(),
      host = "sub.nodify.example";
    for (const path of [
      "/",
      "/login",
      "/api/agent/version",
      "/api/servers",
      "/api/settings/publication",
    ]) {
      const res = await fetchHost(base + path, {
        headers: { Host: host, "X-Forwarded-Host": "panel.nodify.example" },
      });
      assert.equal(res.status, 404, path);
      assert.equal(await res.text(), "");
    }
    assert.equal(
      (
        await fetchHost(base + "/api/agent/version", {
          headers: { Host: "panel.nodify.example" },
        })
      ).status,
      200,
    );
    const res = await fetchHost(
      base +
        `/api/sub/${f.service.box.open(f.entitlement.encryptedToken)}?format=info`,
      { headers: { Host: host } },
    );
    assert.equal(res.status, 200);
    assert.equal((await fetchHost(base + '/api/legacy-sub/legacy-token', {headers: {Host: 'panel.nodify.example'}})).status, 403);
    assert.equal(
      new URL((await res.json()).subscriptionUrl).origin,
      config.subscriptionUrl,
    );
    assert.equal(
      (
        await fetchHost(base + "/api/sub/invalid?format=info", {
          headers: { Host: host },
        })
      ).status,
      401,
    );
    const server = await f.service.createServer({
        name: "ws-probe",
        address: "127.0.0.9",
      }),
      enrolled = await f.service.enroll(server.token, "0.3.0", "QA");
    const upgrade = async (host, path = '/api/agent/connect') =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(
          base.replace("http:", "ws:") + path,
          {
            handshakeTimeout: 3000,
            headers: {
              Host: host,
              Authorization: `Bearer ${enrolled.credential}`,
            },
          },
        );
        ws.on("error", reject);
        ws.once("open", () => {
          ws.close();
          resolve(true);
        });
        ws.once("unexpected-response", (_req, res) => {
          res.resume();
          ws.terminate();
          resolve(res.statusCode);
        });
        ws.once("close", () => {});
      });
    assert.equal(await upgrade("sub.nodify.example"), 401);
    assert.equal(await upgrade("sub.nodify.example", '/api/node-ssh/ws'), 404);
    assert.equal(await upgrade("panel.nodify.example"), true);
  } finally {
    ssh?.onModuleDestroy();
    await app?.close();
    await f.db.$disconnect();
  }
});

test(
  "pinned cloudflared validates and matches generated native and Docker routes",
  { skip: !process.env.NODIFY_TEST_CLOUDFLARED },
  async () => {
    const f = await ruleFixture();
    try {
      const binary = process.env.NODIFY_TEST_CLOUDFLARED;
      assert.equal(
        createHash("sha256")
          .update(await readFile(binary))
          .digest("hex"),
        CLOUDFLARED_SHA256[process.arch === "arm64" ? "arm64" : "amd64"],
      );
      for (const mode of ["native", "docker"]) {
        const path = join(f.directory, `cloudflared-${mode}.yml`);
        const files = tunnelArtifacts({ ...config, mode });
        await writeFile(path, files.config);
        await writeFile(path + ".sh", files.commands);
        await writeFile(path + ".verify.sh", files.verifyCommands);
        await promisify(execFile)("bash", ["-n", path + ".verify.sh"], {
          timeout: 5000,
        });
        await promisify(execFile)("bash", ["-n", path + ".sh"], {
          timeout: 5000,
        });
        await promisify(execFile)(
          binary,
          ["tunnel", "--config", path, "ingress", "validate"],
          { timeout: 15000 },
        );
        for (const [url, expected] of [
          [config.panelUrl + "/login", 0],
          [config.panelUrl + "/api/agent/connect", 0],
          [config.subscriptionUrl + "/api/sub/~test", 1],
          [config.subscriptionUrl + "/subscription/test", 1],
          [config.subscriptionUrl + "/assets/index.js", 1],
          [config.subscriptionUrl + "/login", 2],
          [config.subscriptionUrl + "/auth/login", 2],
          [config.subscriptionUrl + "/api/servers", 2],
          ["https://unrelated.example/", 2],
        ]) {
          const { stdout } = await promisify(execFile)(
            binary,
            ["tunnel", "--config", path, "ingress", "rule", url],
            { timeout: 15000 },
          );
          assert.match(stdout, new RegExp(`Matched rule #${expected}`), stdout);
        }
      }
    } finally {
      await f.db.$disconnect();
    }
  },
);

test(
  "built offline Tunnel CLI produces the same files and refuses overwriting existing output",
  { skip: !process.env.NODIFY_TEST_TUNNEL_CLI },
  async () => {
    const f = await ruleFixture();
    try {
      for (const mode of ["native", "docker"]) {
        const input = join(f.directory, mode + ".json"),
          output = join(f.directory, mode + "-output");
        const value = { ...config, mode };
        await writeFile(input, JSON.stringify(value));
        await promisify(execFile)(
          process.execPath,
          [process.env.NODIFY_TEST_TUNNEL_CLI, input, output],
          { timeout: 10000 },
        );
        const files = tunnelArtifacts(value);
        assert.equal(
          await readFile(join(output, "tunnel/config.yml"), "utf8"),
          files.config,
        );
        assert.equal(
          await readFile(join(output, "install-nodify-tunnel.sh"), "utf8"),
          files.commands,
        );
        assert.equal(
          await readFile(join(output, "verify-nodify-tunnel.sh"), "utf8"),
          files.verifyCommands,
        );
        await assert.rejects(
          promisify(execFile)(
            process.execPath,
            [process.env.NODIFY_TEST_TUNNEL_CLI, input, output],
            { timeout: 10000 },
          ),
        );
        assert.equal(
          await readFile(join(output, "tunnel/config.yml"), "utf8"),
          files.config,
        );
      }
    } finally {
      await f.db.$disconnect();
    }
  },
);
