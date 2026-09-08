import { createRequire } from "node:module";
import { mkdtempSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
const require = createRequire(import.meta.url);
require("./loader.cjs");
const { PrismaClient } = require("../apps/backend/node_modules/@prisma/client");
const {
  NodifyService,
} = require("../apps/backend/src/modules/nodify/nodify.service.ts");
const {
  NodifySubscriptionController,
} = require("../apps/backend/src/modules/nodify/subscription.controller.ts");
export async function ruleFixture(port = 34567) {
  const directory = mkdtempSync(join(tmpdir(), "nodify-rules-"));
  process.env.NODIFY_DATA_DIR = join(directory, "secrets");
  process.env.APP_SECRET = "isolated-rules-test-secret";
  process.env.NODIFY_PUBLIC_URL = "https://rules.example";
  const db = new PrismaClient({
    datasources: {
      db: {
        url: `file:${join(directory, "test.sqlite").replaceAll("\\", "/")}`,
      },
    },
  });
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
  const service = new NodifyService(db);
  const server = await service.createServer({
    name: "rule-server",
    address: "127.0.0.1",
  });
  const inboundId = randomUUID();
  const revision = await service.saveDraft(server.id, {
    inbounds: [
      {
        id: inboundId,
        name: "Nodify",
        protocol: "vless",
        port,
        network: "tcp",
        security: "none",
      },
    ],
  });
  const op = await service.apply(server.id, revision.version);
  await service.complete(server.id, op.id, "succeeded", "", {});
  const user = await db.users.create({
    data: {
      username: "rules-user",
      shortUuid: "rules-short",
      trojanPassword: "test-password",
      ssPassword: "test-password",
      vlessUuid: randomUUID(),
      expireAt: new Date(Date.now() + 86400000),
    },
  });
  const pkg = await service.savePackage({
    name: "rules-test",
    trafficLimitBytes: "1000000",
    validDays: 1,
    nodeIds: [inboundId],
  });
  await service.assignPackage(String(user.id), pkg.id);
  const entitlement = await db.nodifyEntitlement.findUniqueOrThrow({
    where: { userId: user.id },
  });
  const token = service.box.open(entitlement.encryptedToken);
  const controller = new NodifySubscriptionController(service);
  const render = async (format, selectedToken = token, headers = {}) => {
    const result = { headers: {}, content: undefined };
    const response = {
      setHeader: (key, value) => (result.headers[key] = value),
      type: () => response,
      send: (value) => (result.content = value),
      json: (value) => (result.content = value),
    };
    await controller.subscription(selectedToken, format, { headers }, response);
    return result;
  };
  return { directory, db, service, render, user, entitlement };
}
