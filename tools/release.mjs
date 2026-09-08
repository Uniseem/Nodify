import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  existsSync,
} from "node:fs";
import { resolve, join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyReleaseTree as cpSync } from "./release-copy.mjs";
import { writeVersions } from "./version.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "linux")
  throw new Error(
    "Build release archives on Linux to include the correct Prisma/native binaries",
  );
const version = writeVersions();
const buildRecord = join(root, "apps/backend/dist/nodify-build.json");
if (
  !existsSync(buildRecord) ||
  JSON.parse(readFileSync(buildRecord, "utf8")).version !== version
)
  throw new Error(
    "Run npm run build for the current release version before packaging",
  );
const arch =
  process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : null;
if (!arch) throw new Error("Unsupported architecture");
const output = join(root, "releases");
mkdirSync(output, { recursive: true });
const engineDir = process.env.NODIFY_ENGINE_DIR;
if (!engineDir)
  throw new Error(
    "Set NODIFY_ENGINE_DIR to the pinned xray, sing-box and lego binaries (deploy/Dockerfile engines stage)",
  );
const checksum = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
const sums = [];
for (const role of ["panel", "agent"]) {
  const staging = join(output, `nodify-${role}-linux-${arch}`);
  if (existsSync(staging))
    throw new Error(`Release staging exists: ${staging}`);
  mkdirSync(join(staging, "app"), { recursive: true });
  mkdirSync(join(staging, "bin"));
  const app = join(root, "apps", role === "panel" ? "backend" : "node");
  const files =
    role === "panel"
      ? [
          "dist",
          "node_modules",
          "prisma",
          "prisma.config.ts",
          "src/common/database/sqlite-path.ts",
          "package.json",
          ".env.sample",
          "configs",
        ]
      : ["agent", "node_modules/ws"];
  for (const file of files) {
    mkdirSync(dirname(join(staging, "app", file)), { recursive: true });
    cpSync(join(app, file), join(staging, "app", file));
  }
  if (role === "panel")
    cpSync(join(root, "apps/frontend/dist"), join(staging, "app/frontend"));
  cpSync(process.execPath, join(staging, "bin", "node"));
  for (const name of ["LICENSE", "NOTICE"])
    cpSync(join(root, name), join(staging, name));
  for (const binary of role === "panel"
    ? ["lego", "valkey-server"]
    : ["xray", "sing-box", "nodify-pty"])
    cpSync(join(engineDir, binary), join(staging, "bin", binary));
  if (role === "agent")
    cpSync(join(root, "tools/pty/LICENSE"), join(staging, "PTY-LICENSE"));
  cpSync(join(root, "deploy"), join(staging, "deploy"));
  if (role === "panel")
    cpSync(join(root, "deploy"), join(staging, "app/deploy"));
  const filesums = {};
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else filesums[relative(staging, path)] = checksum(path);
    }
  }
  walk(staging);
  writeFileSync(
    join(staging, "manifest.json"),
    JSON.stringify(
      {
        version,
        role,
        platform: `linux-${arch}`,
        engines: {
          xray: "26.7.28",
          singbox: "1.14.0",
          lego: "4.31.0",
          valkey: "9.0.0",
          node: process.versions.node,
          pty: "nodify-pty/1 (creack/pty v1.1.24)",
        },
        files: filesums,
      },
      null,
      2,
    ),
  );
  const name = `nodify-${role}-linux-${arch}.tar.gz`;
  const result = spawnSync(
    "tar",
    ["-czf", join(output, name), "-C", staging, "."],
    {
      stdio: "inherit",
    },
  );
  if (result.status !== 0) process.exit(result.status || 1);
  sums.push(`${checksum(join(output, name))}  ${name}`);
}
writeFileSync(join(output, "SHA256SUMS"), sums.join("\n") + "\n");
console.log(`Release ${version} written to ${output}`);
