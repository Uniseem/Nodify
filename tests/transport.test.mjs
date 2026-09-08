import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
const require = createRequire(import.meta.url);
require("./loader.cjs");
const { Module } = require("../apps/backend/node_modules/@nestjs/common");
const { NestFactory } = require("../apps/backend/node_modules/@nestjs/core");
const { PrismaClient } = require("../apps/backend/node_modules/@prisma/client");
const {
  NodifyService,
} = require("../apps/backend/src/modules/nodify/nodify.service.ts");
const {
  NodifyAgentController,
} = require("../apps/backend/src/modules/nodify/nodify.controller.ts");
const {
  NodifyAgentGateway,
} = require("../apps/backend/src/modules/nodify/agent.gateway.ts");
const WebSocket = require("../apps/node/node_modules/ws");

test(
  "real HTTP and WS Agent transport: token replay, long poll, task scope and revocation",
  { timeout: 30000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "nodify-transport-"));
    process.env.NODIFY_DATA_DIR = join(directory, "secret");
    process.env.NODIFY_PUBLIC_URL = "https://control.example";
    const db = new PrismaClient({
      datasources: {
        db: {
          url: `file:${join(directory, "db.sqlite").replaceAll("\\", "/")}`,
        },
      },
    });
    let app, ws;
    try {
      const migrations = new URL(
        "../apps/backend/prisma/migrations/",
        import.meta.url,
      );
      for (const name of readdirSync(migrations).sort()) {
        const file = new URL(`${name}/migration.sql`, migrations);
        if (existsSync(file))
          for (const sql of readFileSync(file, "utf8")
            .replace(/^\uFEFF/, "")
            .split(";")
            .map((s) => s.trim())
            .filter(Boolean))
            await db.$executeRawUnsafe(sql);
      }
      const service = new NodifyService(db);
      class TestModule {}
      Module({
        controllers: [NodifyAgentController],
        providers: [
          { provide: NodifyService, useValue: service },
          NodifyAgentGateway,
        ],
      })(TestModule);
      app = await NestFactory.create(TestModule, { logger: false });
      app.setGlobalPrefix("api");
      await app.listen(0, "127.0.0.1");
      const base = await app.getUrl();
      const post = (path, body, token) =>
        fetch(`${base}/api/agent/${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        });
      const server = await service.createServer({
          name: "transport",
          address: "127.0.0.1",
        }),
        body = { token: server.token, version: "0.1.0", hostname: "test" };
      const enrolled = await post("enroll", body);
      assert.equal(enrolled.status, 201);
      const auth = await enrolled.json();
      assert.equal((await post("enroll", body)).status, 401);
      assert.equal((await post("traffic", {}, "invalid")).status, 401);
      const polling = post("poll", { interfaces: {} }, auth.credential);
      await new Promise((r) => setTimeout(r, 100));
      const op = await service.operation(server.id, "logs", {
        service: "xray",
      });
      const polled = await (await polling).json();
      assert.equal(polled.operations[0].id, op.id);
      ws = new WebSocket(`${base.replace("http:", "ws:")}/api/agent/connect`, {
        headers: { Authorization: `Bearer ${auth.credential}` },
      });
      await once(ws, "open");
      const response = once(ws, "message");
      ws.send(
        JSON.stringify({
          id: "test-message",
          type: "heartbeat",
          data: { interfaces: {} },
        }),
      );
      const [bytes] = await response;
      assert.equal(JSON.parse(bytes).result.operations[0].id, op.id);
      const network = {
        session: crypto.randomUUID(),
        sequence: 1,
        bootId: crypto.randomUUID(),
        collectedAt: new Date().toISOString(),
        interfaces: [
          {
            name: "eth0",
            index: 2,
            upload: "12",
            download: "34",
            discontinuity: false,
            intervalStart: new Date(Date.now() - 1000).toISOString(),
          },
        ],
      };
      assert.equal((await post("network", network, "invalid")).status, 401);
      assert.deepEqual(
        await (await post("network", network, auth.credential)).json(),
        { acknowledged: 1 },
      );
      const networkReply = once(ws, "message");
      ws.send(
        JSON.stringify({
          id: "network-replay",
          type: "network",
          data: network,
        }),
      );
      assert.equal(JSON.parse((await networkReply)[0]).result.acknowledged, 1);
      assert.equal(
        await db.nodifyNetworkBatch.count(),
        1,
        "HTTP and WS share the same durable dedupe key",
      );
      assert.equal(
        (await db.nodifyServer.findUnique({ where: { id: server.id } }))
          .networkTraffic.interfaces.eth0.upload,
        "12",
      );
      const stranger = await service.createServer({
        name: "other",
        address: "127.0.0.2",
      });
      await assert.rejects(() =>
        service.complete(stranger.id, op.id, "succeeded", "", {}),
      );
      const finished = await post(
        "results",
        { id: op.id, state: "succeeded", message: "", result: { log: "ok" } },
        auth.credential,
      );
      assert.equal(finished.status, 201);
      await post(
        "results",
        { id: op.id, state: "failed", message: "duplicate", result: {} },
        auth.credential,
      );
      assert.equal(
        (await db.nodifyOperation.findUnique({ where: { id: op.id } })).state,
        "succeeded",
      );
      const rotation = await service.rotateCredential(server.id);
      const rotationPayload = JSON.parse(
        service.box.open(
          (await db.nodifyOperation.findUnique({ where: { id: rotation.id } }))
            .payload,
        ),
      );
      assert.equal(
        (
          await post(
            "results",
            { id: rotation.id, state: "succeeded", result: {}, message: "" },
            rotationPayload.credential,
          )
        ).status,
        201,
      );
      await assert.rejects(() => service.authenticate(auth.credential));
      const closed = once(ws, "close");
      ws.send(JSON.stringify({ id: "revoked", type: "heartbeat", data: {} }));
      assert.equal((await closed)[0], 1008);
      await service.revoke(server.id);
      await assert.rejects(() =>
        service.authenticate(rotationPayload.credential),
      );
    } finally {
      ws?.terminate();
      if (app) await app.close();
      await db.$disconnect();
    }
  },
);
