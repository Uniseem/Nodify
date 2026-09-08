import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { hostname } from "node:os";
const cwd = process.cwd();
for (const file of [
  resolve(cwd, "manifest.json"),
  resolve(cwd, "../manifest.json"),
])
  if (existsSync(file)) {
    process.env.NODIFY_VERSION = JSON.parse(readFileSync(file, "utf8")).version;
    break;
  }
const data = resolve(process.env.NODIFY_DATA_DIR || "data/nodify");
mkdirSync(data, { recursive: true, mode: 0o700 });
if (existsSync(resolve(data, "application-secret")))
  process.env.APP_SECRET = readFileSync(
    resolve(data, "application-secret"),
    "utf8",
  );
else {
  if (!process.env.APP_SECRET || process.env.APP_SECRET === "change_me")
    throw new Error("Set a unique APP_SECRET before starting Nodify");
  writeFileSync(resolve(data, "application-secret"), process.env.APP_SECRET, {
    mode: 0o600,
    flag: "wx",
  });
}
writeFileSync(
  resolve(data, "panel-runtime.json"),
  JSON.stringify({ pid: process.pid, host: hostname() }),
  {
    mode: 0o600,
  },
);
const children = new Map();
let stopping = false;
function startValkey() {
  const directory = resolve(data, "valkey");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const child = spawn(
    process.env.NODIFY_VALKEY_BINARY || "valkey-server",
    [
      "--bind",
      "127.0.0.1",
      "--port",
      process.env.REDIS_PORT || "6380",
      "--appendonly",
      "yes",
      "--dir",
      directory,
    ],
    { stdio: "inherit" },
  );
  children.set("valkey", child);
  child.on("error", (error) => console.error(error.message));
  child.on("exit", () => {
    children.delete("valkey");
    if (!stopping) setTimeout(startValkey, 2000);
  });
}
if (process.env.NODIFY_MANAGE_VALKEY === "1") startValkey();
// Seed initialization opens Redis connections, so the bundled service must already run.
const prisma = resolve(cwd, "node_modules/prisma/build/index.js");
for (const args of [
  [prisma, "migrate", "deploy"],
  [resolve(cwd, "dist/seed.js")],
]) {
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    env: process.env,
    timeout: 120000,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
function start(name, file, instanceType) {
  const child = spawn(process.execPath, [resolve(cwd, "dist", file)], {
    stdio: "inherit",
    env: { ...process.env, INSTANCE_TYPE: instanceType, INSTANCE_ID: "0" },
  });
  children.set(name, child);
  child.on("error", (error) => console.error(`${name}: ${error.message}`));
  child.on("exit", () => {
    children.delete(name);
    if (!stopping) setTimeout(() => start(name, file, instanceType), 2000);
  });
}
start("api", "app.js", "api");
start("worker", "processors.js", "processor");
start("scheduler", "scheduler.js", "scheduler");
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    stopping = true;
    for (const child of children.values()) child.kill("SIGTERM");
    setTimeout(() => {
      for (const child of children.values()) child.kill("SIGKILL");
      process.exit(0);
    }, 10000).unref();
  });
