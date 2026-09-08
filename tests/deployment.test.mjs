import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  lstatSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { copyReleaseTree } from "../tools/release-copy.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("panel health uses the configured port and production proxy headers", async () => {
  const server = createServer((req, res) => {
    assert.equal(req.url, "/api/agent/version");
    assert.equal(req.headers["x-forwarded-proto"], "https");
    assert.equal(req.headers["x-forwarded-for"], "127.0.0.1");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ application: "Nodify", version: "0.1.0" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await promisify(execFile)(
      process.execPath,
      [
        fileURLToPath(new URL("../deploy/panel-health.mjs", import.meta.url)),
        "0.1.0",
      ],
      {
        env: { ...process.env, APP_PORT: String(server.address().port) },
        timeout: 5000,
      },
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("release copy materializes nested dependency links independently of the build tree", () => {
  const directory = mkdtempSync(join(tmpdir(), "nodify-release-copy-"));
  const source = join(directory, "source"),
    target = join(directory, "dependency");
  mkdirSync(join(source, "node_modules", ".bin"), { recursive: true });
  mkdirSync(target);
  writeFileSync(join(target, "entry.js"), "dependency fixture");
  if (process.platform !== "win32") chmodSync(join(target, "entry.js"), 0o666);
  symlinkSync(
    target,
    join(source, "node_modules", "shared"),
    process.platform === "win32" ? "junction" : "dir",
  );
  if (process.platform !== "win32")
    symlinkSync(
      join(target, "entry.js"),
      join(source, "node_modules", ".bin", "entry"),
    );
  const output = join(directory, "release");
  copyReleaseTree(source, output);
  if (process.platform !== "win32")
    assert.equal(
      lstatSync(join(output, "node_modules", "shared", "entry.js")).mode &
        0o022,
      0,
    );
  rmSync(target, { recursive: true });
  assert.equal(
    readFileSync(join(output, "node_modules", "shared", "entry.js"), "utf8"),
    "dependency fixture",
  );
  assert.equal(
    lstatSync(join(output, "node_modules", "shared")).isSymbolicLink(),
    false,
  );
  if (process.platform !== "win32")
    assert.equal(
      readFileSync(join(output, "node_modules", ".bin", "entry"), "utf8"),
      "dependency fixture",
    );
});

test("release rollback refuses an open WAL database and restores the offline snapshot", () => {
  const directory = mkdtempSync(join(tmpdir(), "nodify-rollback-"));
  const database = join(directory, "panel.db"),
    snapshot = join(directory, "before.db");
  const run = (name, args) =>
    execFileSync(
      process.execPath,
      [
        fileURLToPath(new URL(`../deploy/${name}.mjs`, import.meta.url)),
        ...args,
      ],
      { stdio: "pipe" },
    );
  const writer = new DatabaseSync(database);
  try {
    writer.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE marker (value INTEGER); INSERT INTO marker VALUES (42)",
    );
    run("database-snapshot", [database, snapshot]);
    writer.exec("UPDATE marker SET value=84");
    assert.throws(() => run("database-rollback", [snapshot, database]));
    assert.equal(writer.prepare("SELECT value FROM marker").get().value, 84);
  } finally {
    writer.close();
  }
  run("database-rollback", [snapshot, database]);
  const recovered = new DatabaseSync(database);
  try {
    assert.equal(recovered.prepare("SELECT value FROM marker").get().value, 42);
  } finally {
    recovered.close();
  }
});
