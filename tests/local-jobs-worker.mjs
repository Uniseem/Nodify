import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
require("./loader.cjs");
const { PrismaClient } = require("../apps/backend/node_modules/@prisma/client");
const {
  NodifyService,
} = require("../apps/backend/src/modules/nodify/nodify.service.ts");
const {
  NodifyResourcesService,
} = require("../apps/backend/src/modules/nodify/resources.service.ts");
const {
  LocalOperations,
} = require("../apps/backend/src/modules/nodify/local-operations.ts");
const db = new PrismaClient({
  datasources: { db: { url: process.env.NODIFY_TEST_DATABASE_URL } },
});
const service = new NodifyService(db),
  resources = new NodifyResourcesService(service);
const worker = new LocalOperations(service, {
  backup: async (payload, task) => {
    const result = await resources.backup(
      payload.password,
      payload.backupId,
      task,
    );
    process.send({ phase: "backup-written", id: result.id });
    await new Promise(() => {});
  },
});
await worker.drain();
await db.$disconnect();
