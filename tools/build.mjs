import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeVersions } from "./version.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = writeVersions();
const run = (cwd, command, args = []) => {
  console.log(`[nodify] ${cwd}: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: resolve(root, cwd),
    stdio: "inherit",
    shell: process.platform === "win32" && command === "npm",
    env: { ...process.env, NODE_ENV: "production" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
const npm = (cwd, args) => run(cwd, "npm", args);
const contracts = [
  ["apps/node/libs/contract", ["apps/backend"]],
  ["apps/backend/libs/contract", ["apps/frontend"]],
];
function buildContracts() {
  for (const [cwd, consumers] of contracts) {
    // Use the installed application compiler. Contracts are always built from this checkout.
    const compiler = resolve(
      root,
      "apps/backend/node_modules/typescript/bin/tsc",
    );
    const configs = cwd.includes("backend")
      ? ["tsconfig.backend.json", "tsconfig.frontend.json"]
      : ["tsconfig.json"];
    for (const config of configs)
      run(cwd, process.execPath, [compiler, "-p", config]);
    const manifest = JSON.parse(
      readFileSync(resolve(root, cwd, "package.json"), "utf8"),
    );
    for (const app of consumers) {
      const dest = resolve(root, app, "node_modules", manifest.name);
      mkdirSync(dest, { recursive: true });
      cpSync(resolve(root, cwd, "build"), resolve(dest, "build"), {
        recursive: true,
      });
      writeFileSync(
        resolve(dest, "package.json"),
        JSON.stringify(manifest, null, 2),
      );
    }
  }
}
const action = process.argv[2] ?? "build";
if (action === "setup") {
  npm("packages/nodify-contract", ["ci", "--no-audit", "--no-fund"]);
  for (const app of ["apps/backend", "apps/frontend", "apps/node"])
    npm(app, ["ci", "--include=dev", "--no-audit", "--no-fund"]);
  // Contract source files resolve zod through their application ancestor.
  buildContracts();
} else if (action === "contracts") buildContracts();
else if (action === "typecheck") {
  buildContracts();
  for (const app of ["apps/backend", "apps/frontend", "apps/node"])
    run(app, process.execPath, [
      resolve(root, app, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--pretty",
      "false",
    ]);
} else if (action === "build") {
  buildContracts();
  npm("apps/backend", ["run", "migrate:generate"]);
  run("apps/frontend", process.execPath, [
    resolve(root, "apps/frontend/node_modules/vite/bin/vite.js"),
    "build",
  ]);
  npm("apps/backend", ["run", "build"]);
  npm("apps/node", ["run", "build"]);
  const assets = resolve(root, "apps/backend/dist/frontend");
  mkdirSync(assets, { recursive: true });
  cpSync(resolve(root, "apps/frontend/dist"), assets, { recursive: true });
  writeFileSync(
    resolve(root, "apps/backend/dist/nodify-build.json"),
    JSON.stringify({ version }),
  );
} else throw new Error(`Unknown build action: ${action}`);
