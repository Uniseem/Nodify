import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fork } from "node:child_process";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { ruleFixture } from "./rule-fixture.mjs";
import { decryptBackup } from "../deploy/restore.mjs";
const require = createRequire(import.meta.url);
const {
  LocalOperations,
} = require("../apps/backend/src/modules/nodify/local-operations.ts");
const {
  NodifyResourcesService,
} = require("../apps/backend/src/modules/nodify/resources.service.ts");
const {
  NodifyController,
} = require("../apps/backend/src/modules/nodify/nodify.controller.ts");
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

test(
  "persisted backup survives a killed worker after file commit and is not duplicated",
  { timeout: 30000 },
  async () => {
    const { db, service, directory } = await ruleFixture();
    const resources = new NodifyResourcesService(service);
    let child;
    try {
      const operation = await resources.queueBackup(
        "long-restart-test-password",
      );
      assert.equal(operation.state, "queued");
      const queued = await db.nodifyOperation.findUniqueOrThrow({
        where: { id: operation.id },
      });
      assert.equal(
        queued.payload.includes("long-restart-test-password"),
        false,
      );
      child = fork(
        fileURLToPath(new URL("./local-jobs-worker.mjs", import.meta.url)),
        [],
        {
          stdio: ["ignore", "ignore", "pipe", "ipc"],
          env: {
            ...process.env,
            NODIFY_TEST_DATABASE_URL: `file:${join(directory, "test.sqlite").replaceAll("\\", "/")}`,
          },
        },
      );
      let logs = "";
      child.stderr.on("data", (data) => {
        logs += data;
      });
      const ready = await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(Error(`Worker failed to reach checkpoint: ${logs}`)),
          15000,
        );
        child.once("message", (data) => {
          clearTimeout(timeout);
          resolve(data);
        });
        child.once("exit", (code) => {
          clearTimeout(timeout);
          reject(Error(`Worker exited ${code}: ${logs}`));
        });
        child.once("error", reject);
      });
      assert.equal(ready.phase, "backup-written");
      const file = await resources.backupFile(ready.id),
        bytes = await readFile(file);
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGKILL");
      await exited;
      assert.equal(
        (
          await db.nodifyOperation.findUniqueOrThrow({
            where: { id: operation.id },
          })
        ).state,
        "running",
      );
      // Advance only the crashed worker's lease instead of waiting 30 seconds in the test.
      await db.nodifyOperation.update({
        where: { id: operation.id },
        data: { leaseUntil: new Date(0) },
      });
      const restarted = new NodifyResourcesService(service);
      await restarted.localOperations.drain();
      const final = await db.nodifyOperation.findUniqueOrThrow({
        where: { id: operation.id },
      });
      assert.equal(final.state, "succeeded");
      assert.equal(final.attempts, 2);
      assert.equal(final.localKey, null);
      assert.equal(final.result.id, ready.id);
      assert.equal(await db.nodifyBackup.count(), 1);
      assert.deepEqual(
        await readFile(file),
        bytes,
        "Recovered task must not replace the already committed archive",
      );
      assert.ok(decryptBackup(bytes, "long-restart-test-password").database);
      assert.deepEqual(
        (await readdir(join(process.env.NODIFY_DATA_DIR, "backups"))).filter(
          (name) => /\.(sqlite|partial)$/.test(name),
        ),
        [],
      );
      const publicRow = (await service.operations()).find(
        (row) => row.id === operation.id,
      );
      assert.equal(publicRow.payload, undefined);
      assert.equal(publicRow.leaseOwner, undefined);
      assert.equal(
        JSON.stringify(publicRow).includes("long-restart-test-password"),
        false,
      );
    } finally {
      if (child && child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await db.$disconnect();
    }
  },
);

test("two local workers claim once, fence stale commits and preserve the new owner's result", async () => {
  const { db, service } = await ruleFixture();
  const claimed = deferred(),
    release = deferred();
  let oldTask,
    executions = 0;
  const first = new LocalOperations(service, {
    backup: async (_, task) => {
      executions++;
      oldTask = task;
      claimed.resolve();
      await release.promise;
      return { worker: "old" };
    },
  });
  const second = new LocalOperations(service, {
    backup: async (_, task) => {
      executions++;
      await task.commit((tx) =>
        tx.nodifySetting.upsert({
          where: { key: "lease-proof" },
          create: { key: "lease-proof", value: "new" },
          update: { value: "new" },
        }),
      );
      return { worker: "new" };
    },
  });
  let firstRun;
  try {
    const op = await first.enqueue("backup", "backup", {
      backupId: randomUUID(),
      password: "secret",
    });
    firstRun = first.drain();
    await claimed.promise;
    await second.drain();
    assert.equal(executions, 1);
    await assert.rejects(() => second.enqueue("backup", "backup", {}), /已有/);
    await db.nodifyOperation.update({
      where: { id: op.id },
      data: { leaseUntil: new Date(0) },
    });
    await second.drain();
    await assert.rejects(
      () =>
        oldTask.commit((tx) =>
          tx.nodifySetting.update({
            where: { key: "lease-proof" },
            data: { value: "old" },
          }),
        ),
      /lease lost/,
    );
    const server = await db.nodifyServer.findFirstOrThrow();
    const site = await service.saveWebsiteDraft(server.id, {
      name: "Lease test site",
      domain: "node.example",
      type: "static",
      target: "/srv/nodify-site",
      httpPort: 18080,
    });
    const before = await db.nodifyOperation.count({
      where: { serverId: server.id },
    });
    await assert.rejects(
      () => service.apply(server.id, server.appliedVersion, oldTask.commit),
      /lease lost/,
    );
    await assert.rejects(
      () =>
        service.publishWebsite(
          server.id,
          site.id,
          site.version,
          oldTask.commit,
        ),
      /lease lost/,
    );
    assert.equal(
      await db.nodifyOperation.count({ where: { serverId: server.id } }),
      before,
      "A fenced local worker cannot create Agent tasks",
    );
    release.resolve();
    await firstRun;
    const final = await db.nodifyOperation.findUniqueOrThrow({
      where: { id: op.id },
    });
    assert.equal(final.state, "succeeded");
    assert.deepEqual(final.result, { worker: "new" });
    assert.equal(final.attempts, 2);
    assert.equal(
      (
        await db.nodifySetting.findUniqueOrThrow({
          where: { key: "lease-proof" },
        })
      ).value,
      "new",
    );
  } finally {
    release.resolve();
    await firstRun;
    await db.$disconnect();
  }
});

test("interrupted ACME is not reissued automatically; retries are idempotent and timeouts stay terminal", async () => {
  const { db, service } = await ruleFixture();
  const resources = new NodifyResourcesService(service);
  const controller = new NodifyController(service, resources);
  try {
    const op = await resources.requestCertificate({
      name: "Interrupted",
      email: "test@example.com",
      domains: ["test.example.com"],
      provider: "cloudflare",
      credentials: { CF_DNS_API_TOKEN: "private-fixture-token" },
    });
    await db.nodifyOperation.update({
      where: { id: op.id },
      data: {
        state: "running",
        leaseOwner: "dead-process",
        leaseUntil: new Date(0),
        attempts: 1,
      },
    });
    await resources.localOperations.recover();
    assert.equal(
      (await db.nodifyOperation.findUniqueOrThrow({ where: { id: op.id } }))
        .state,
      "failed",
    );
    const retry = await controller.retryOperation(op.id),
      again = await controller.retryOperation(op.id);
    assert.equal(retry.response.id, again.response.id);
    assert.equal(
      await db.nodifyOperation.count({ where: { retryOf: op.id } }),
      1,
    );
    await assert.rejects(
      () => controller.retryOperation(retry.response.id),
      /只能重试/,
    );
    await db.nodifyOperation.update({
      where: { id: retry.response.id },
      data: { expiresAt: new Date(0) },
    });
    await resources.localOperations.recover();
    const expired = await db.nodifyOperation.findUniqueOrThrow({
      where: { id: retry.response.id },
    });
    assert.equal(expired.state, "failed");
    assert.equal(expired.localKey, null);
    assert.match(expired.message, /超时/);
    assert.equal(
      JSON.stringify(await service.operations()).includes(
        "private-fixture-token",
      ),
      false,
    );
    const remote = await db.nodifyOperation.create({
      data: {
        kind: "backup",
        payload: "not-local",
        expiresAt: new Date(Date.now() + 10000),
        state: "failed",
      },
    });
    await assert.rejects(
      () => controller.retryOperation(remote.id),
      /只能重试/,
    );
  } finally {
    await db.$disconnect();
  }
});

test("backup recovery removes abandoned staging files and scheduled work is persisted once", async () => {
  const { db, service } = await ruleFixture();
  const resources = new NodifyResourcesService(service);
  try {
    await resources.saveBackupSettings({
      enabled: true,
      password: "scheduled-test-password",
      intervalHours: 1,
      retain: 2,
      destination: { type: "local" },
    });
    await resources.scheduledBackup();
    await resources.scheduledBackup();
    const op = await db.nodifyOperation.findFirstOrThrow({
      where: { kind: "scheduled-backup" },
    });
    assert.equal(
      await db.nodifyOperation.count({ where: { kind: "scheduled-backup" } }),
      1,
    );
    const payload = JSON.parse(service.box.open(op.payload));
    const { mkdir } = await import("node:fs/promises");
    const directory = join(process.env.NODIFY_DATA_DIR, "backups");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, `${payload.backupId}.crashed.sqlite`),
      "interrupted snapshot",
    );
    await writeFile(
      join(directory, `${payload.backupId}.crashed.partial`),
      "partial archive",
    );
    await writeFile(join(directory, "unrelated.keep"), "preserve");
    await db.nodifyOperation.update({
      where: { id: op.id },
      data: {
        state: "running",
        leaseOwner: "dead-process",
        leaseUntil: new Date(0),
        attempts: 1,
      },
    });
    await resources.localOperations.drain();
    const final = await db.nodifyOperation.findUniqueOrThrow({
      where: { id: op.id },
    });
    assert.equal(final.state, "succeeded");
    assert.equal(final.result.destination, "local");
    assert.equal(
      await readFile(join(directory, "unrelated.keep"), "utf8"),
      "preserve",
    );
    assert.equal(
      (await readdir(directory)).some((name) =>
        /\.(sqlite|partial)$/.test(name),
      ),
      false,
    );
    assert.ok(
      decryptBackup(
        await readFile(await resources.backupFile(payload.backupId)),
        "scheduled-test-password",
      ).database,
    );
  } finally {
    await db.$disconnect();
  }
});

test(
  "certificate-saved recovery resumes deployment without requesting ACME again",
  { skip: !process.env.NODIFY_TEST_CERT_DIR },
  async () => {
    const { db, service } = await ruleFixture();
    const resources = new NodifyResourcesService(service);
    try {
      const account = {
        name: "Saved",
        email: "test@example.com",
        domains: ["test.example.com"],
        provider: "cloudflare",
        credentials: { CF_DNS_API_TOKEN: "test" },
      };
      const files = await readdir(process.env.NODIFY_TEST_CERT_DIR);
      const certName = files.includes("fullchain.pem")
        ? "fullchain.pem"
        : "cert.pem";
      const keyName = files.includes("privkey.pem") ? "privkey.pem" : "key.pem";
      const certificate = await db.nodifyCertificate.create({
        data: {
          ...service.certificateData({
            name: "Saved",
            certPem: await readFile(
              join(process.env.NODIFY_TEST_CERT_DIR, certName),
              "utf8",
            ),
            keyPem: await readFile(
              join(process.env.NODIFY_TEST_CERT_DIR, keyName),
              "utf8",
            ),
          }),
          provider: "cloudflare",
          encryptedAccount: service.box.seal(JSON.stringify(account)),
        },
      });
      const server = await db.nodifyServer.findFirstOrThrow();
      const site = await service.saveWebsiteDraft(server.id, {
        name: "Lease test site",
        domain: "node.example",
        type: "static",
        target: "/srv/nodify-site",
        httpPort: 18080,
        certificateId: certificate.id,
        httpsPort: 18443,
      });
      const applied = await service.publishWebsite(
        server.id,
        site.id,
        site.version,
      );
      await service.complete(server.id, applied.id, "succeeded", "", {});
      const pending = await service.publishWebsite(
        server.id,
        site.id,
        site.version,
      );
      const before = await db.nodifyOperation.count({
        where: { kind: "website" },
      });
      const op = await resources.localOperations.enqueue(
        "renew-certificate",
        `certificate:${certificate.id}`,
        { certificateId: certificate.id },
        {
          phase: "certificate-saved",
          certificateId: certificate.id,
          deployments: { [`website:${site.id}`]: pending.id },
        },
      );
      await db.nodifyOperation.update({
        where: { id: op.id },
        data: {
          state: "running",
          leaseOwner: "dead-process",
          leaseUntil: new Date(0),
          attempts: 1,
        },
      });
      await resources.localOperations.drain();
      const final = await db.nodifyOperation.findUniqueOrThrow({
        where: { id: op.id },
      });
      assert.equal(final.state, "succeeded");
      assert.equal(final.result.id, certificate.id);
      assert.equal(final.attempts, 2);
      assert.equal(await db.nodifyCertificate.count(), 1);
      assert.equal(
        await db.nodifyOperation.count({ where: { kind: "website" } }),
        before,
        "Committed certificate deployment must not be duplicated on recovery",
      );
    } finally {
      await db.$disconnect();
    }
  },
);

test("startup artifact cleanup keeps active jobs and unrelated files while removing terminal task staging", async () => {
  const { db, service } = await ruleFixture();
  const resources = new NodifyResourcesService(service);
  const { mkdir } = await import("node:fs/promises");
  try {
    const op = await resources.queueBackup("cleanup-test-password");
    const active = await db.nodifyOperation.findUniqueOrThrow({
      where: { id: op.id },
    });
    const backupId = JSON.parse(service.box.open(active.payload)).backupId;
    const backups = join(process.env.NODIFY_DATA_DIR, "backups"),
      acme = join(process.env.NODIFY_DATA_DIR, "acme");
    await mkdir(backups, { recursive: true });
    await mkdir(acme, { recursive: true });
    const keep = `${backupId}.live.sqlite`,
      remove = `${randomUUID()}.dead.sqlite`;
    await writeFile(join(backups, keep), "active");
    await writeFile(join(backups, remove), "stale");
    await writeFile(join(backups, "user.sqlite"), "unrelated");
    const activeDir = `job-${op.id}-active`,
      staleDir = `job-${randomUUID()}-dead`;
    await mkdir(join(acme, activeDir));
    await mkdir(join(acme, staleDir));
    await mkdir(join(acme, "unrelated"));
    await resources.cleanupTaskArtifacts();
    assert.deepEqual(
      (await readdir(backups)).sort(),
      [keep, "user.sqlite"].sort(),
    );
    assert.deepEqual(
      (await readdir(acme)).sort(),
      [activeDir, "unrelated"].sort(),
    );
    await db.nodifyOperation.update({
      where: { id: op.id },
      data: { expiresAt: new Date(0) },
    });
    await resources.localOperations.recover();
    await resources.cleanupTaskArtifacts();
    assert.deepEqual(await readdir(backups), ["user.sqlite"]);
    assert.deepEqual(await readdir(acme), ["unrelated"]);
  } finally {
    await db.$disconnect();
  }
});
