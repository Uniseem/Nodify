import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { ruleFixture } from "./rule-fixture.mjs";
import { restoreBackup } from "../deploy/restore.mjs";
const require = createRequire(import.meta.url);
require("./loader.cjs");
const { PrismaClient } = require("../apps/backend/node_modules/@prisma/client");
const {
  NodifyService,
} = require("../apps/backend/src/modules/nodify/nodify.service.ts");
const {
  NodifyResourcesService,
} = require("../apps/backend/src/modules/nodify/resources.service.ts");

test("encrypted offline restore accepts post-snapshot policy receipts, rejects substitution and counts retries once", async () => {
  const { db, service, directory, user } = await ruleFixture();
  const secretDirectory = process.env.NODIFY_DATA_DIR;
  let recovered;
  try {
    const server = await db.nodifyServer.findFirstOrThrow();
    const other = await service.createServer({
      name: "Other receipt server",
      address: "127.0.0.2",
    });
    await service.apply(server.id, 1);
    const pending = await service.pendingOperations(server.id);
    const previous = pending.find((op) => op.kind === "apply-config");
    assert.ok(previous.payload.policyReceipt);
    await service.complete(server.id, previous.id, "succeeded", "", {});
    const resources = new NodifyResourcesService(service);
    const password = "receipt-restore-test-password";
    const backup = await resources.backup(password);

    // The restored DB will never have this operation. Preserve the actual billing
    // policy issued after the snapshot, even if current package settings differ.
    const issued = await service.operation(server.id, "apply-config", {
      ...previous.payload,
      users: previous.payload.users.map((u) => ({
        ...u,
        direction: "download",
        multiplier: 2.5,
      })),
    });
    const operation = await db.nodifyOperation.findUniqueOrThrow({
      where: { id: issued.id },
    });
    const payload = JSON.parse(service.box.open(operation.payload));
    const receipt = payload.policyReceipt;
    assert.equal(receipt.includes(user.trojanPassword), false);
    const decoded = service.box.open(receipt);
    assert.equal(decoded.includes("password"), false);
    assert.equal(decoded.includes("remainingBytes"), false);
    await service.complete(server.id, issued.id, "succeeded", "", {});

    const recoveredSecrets = join(directory, "recovered-secrets");
    const restoredFile = join(directory, "recovered.sqlite");
    restoreBackup(
      join(secretDirectory, "backups", `${backup.id}.nodify`),
      password,
      restoredFile,
      recoveredSecrets,
    );
    process.env.NODIFY_DATA_DIR = recoveredSecrets;
    recovered = new PrismaClient({
      datasources: {
        db: { url: `file:${restoredFile.replaceAll("\\", "/")}` },
      },
    });
    const restored = new NodifyService(recovered);
    assert.equal(
      await recovered.nodifyOperation.findUnique({ where: { id: issued.id } }),
      null,
    );
    const batch = {
      session: randomUUID(),
      sequence: 7,
      policyId: issued.id,
      policyReceipt: receipt,
      collectedAt: new Date().toISOString(),
      users: [{ userId: String(user.id), upload: "40", download: "100" }],
    };
    const corrupted = Buffer.from(receipt, "base64");
    corrupted[30] ^= 1;
    for (const invalid of [
      { ...batch, policyReceipt: undefined },
      { ...batch, policyReceipt: corrupted.toString("base64") },
      { ...batch, policyId: randomUUID() },
      {
        ...batch,
        policyReceipt: service.box.seal(
          JSON.stringify({ users: previous.payload.users }),
        ),
      },
    ])
      await assert.rejects(
        restored.traffic(server.id, invalid),
        /traffic policy/i,
      );
    await assert.rejects(restored.traffic(other.id, batch), /traffic policy/i);
    assert.equal(await recovered.nodifyTrafficBatch.count(), 0);
    assert.equal(
      await recovered.nodifySetting.count({
        where: { key: { startsWith: "traffic.policy." } },
      }),
      0,
    );

    // A unique constraint elsewhere in the transaction is not a duplicate batch.
    // Fail actual SQLite persistence and ensure the Agent receives no false ACK.
    await recovered.nodifySetting.create({
      data: { key: "receipt-conflict-fixture", value: "retained" },
    });
    await recovered.$executeRawUnsafe(`CREATE TRIGGER receipt_archive_conflict
      BEFORE INSERT ON NodifySetting WHEN NEW.key LIKE 'traffic.policy.%'
      BEGIN INSERT INTO NodifySetting (key,value) VALUES ('receipt-conflict-fixture','conflict'); END`);
    await assert.rejects(
      restored.traffic(server.id, batch),
      (error) => error.code === "P2002",
    );
    assert.equal(await recovered.nodifyTrafficBatch.count(), 0);
    assert.equal(
      (
        await recovered.nodifyEntitlement.findUniqueOrThrow({
          where: { userId: user.id },
        })
      ).usedBytes,
      0n,
    );
    await recovered.$executeRawUnsafe("DROP TRIGGER receipt_archive_conflict");

    assert.deepEqual(await restored.traffic(server.id, batch), {
      acknowledged: 7,
    });
    assert.deepEqual(await restored.traffic(server.id, batch), {
      acknowledged: 7,
    });
    const after = await recovered.nodifyEntitlement.findUniqueOrThrow({
      where: { userId: user.id },
    });
    assert.equal(after.usedBytes, 250n);
    assert.equal(after.uploadBytes, 40n);
    assert.equal(after.downloadBytes, 100n);
    assert.equal(await recovered.nodifyTrafficBatch.count(), 1);
    const archive = await recovered.nodifySetting.findUniqueOrThrow({
      where: { key: `traffic.policy.${server.id}.${issued.id}` },
    });
    assert.equal(archive.value, receipt);

    // A fresh service instance uses the durable validated receipt; it needn't be
    // sent again, and reporting an old quota generation must not recharge a reset.
    const restarted = new NodifyService(recovered);
    await restarted.traffic(server.id, {
      ...batch,
      sequence: 8,
      policyReceipt: undefined,
    });
    assert.equal(
      (
        await recovered.nodifyEntitlement.findUniqueOrThrow({
          where: { userId: user.id },
        })
      ).usedBytes,
      500n,
    );
    await recovered.nodifyEntitlement.update({
      where: { userId: user.id },
      data: { generation: { increment: 1 }, usedBytes: 0n },
    });
    await restarted.traffic(server.id, { ...batch, sequence: 9 });
    assert.equal(
      (
        await recovered.nodifyEntitlement.findUniqueOrThrow({
          where: { userId: user.id },
        })
      ).usedBytes,
      0n,
    );
    const ledger = await recovered.nodifyDailyTraffic.findFirstOrThrow({
      where: { serverId: server.id, userId: String(user.id) },
    });
    assert.equal(ledger.upload, "120");
    assert.equal(ledger.download, "300");
    assert.equal(ledger.charged, "500");
    assert.equal(ledger.unchargedRaw, "140");
  } finally {
    process.env.NODIFY_DATA_DIR = secretDirectory;
    await recovered?.$disconnect();
    await db.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
