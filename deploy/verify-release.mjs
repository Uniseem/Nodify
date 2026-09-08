import { readFileSync, lstatSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import { createHash } from "node:crypto";
const [directory, role] = process.argv.slice(2);
const base = resolve(directory),
  manifest = JSON.parse(readFileSync(join(base, "manifest.json"), "utf8"));
const arch = process.arch === "x64" ? "amd64" : "arm64";
if (
  manifest.role !== role ||
  manifest.platform !== `linux-${arch}` ||
  !/^\d+\.\d+\.\d+$/.test(manifest.version)
)
  throw new Error("Release role, architecture or version mismatch");
for (const [name, hash] of Object.entries(manifest.files)) {
  const file = resolve(base, name);
  if (relative(base, file).startsWith("..")) throw new Error("Invalid manifest path");
  if (
    !lstatSync(file).isFile() ||
    createHash("sha256").update(readFileSync(file)).digest("hex") !== hash
  )
    throw new Error(`Checksum mismatch: ${name}`);
}
console.log(manifest.version);
