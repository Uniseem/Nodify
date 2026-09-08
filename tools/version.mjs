import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

export function writeVersions() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { version } = JSON.parse(
    readFileSync(resolve(root, "package.json"), "utf8"),
  );
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("Nodify release version must be major.minor.patch");
  for (const [file, contents] of [
    ["deploy/version.json", JSON.stringify({ version }, null, 2) + "\n"],
    [
      "packages/nodify-contract/version.ts",
      `// Generated from the root package.json by tools/version.mjs.\nexport const NODIFY_VERSION = ${JSON.stringify(version)};\n`,
    ],
    [
      "apps/node/agent/version.mjs",
      `// Generated from the root package.json by tools/version.mjs.\nexport const NODIFY_VERSION = ${JSON.stringify(version)};\n`,
    ],
  ]) {
    const path = resolve(root, file);
    if (!existsSync(path) || readFileSync(path, "utf8") !== contents)
      writeFileSync(path, contents);
  }
  for (const [file, role] of [
    ["compose.yml", "panel"],
    ["deploy/agent-compose.yml", "agent"],
  ]) {
    const path = resolve(root, file);
    const contents = readFileSync(path, "utf8");
    const pattern = new RegExp(`^(\\s*image: nodify/${role}:)\\S+$`, "gm");
    if ([...contents.matchAll(pattern)].length !== 1)
      throw new Error(`Expected one Nodify ${role} image in ${file}`);
    const updated = contents.replace(pattern, `$1${version}`);
    if (updated !== contents) writeFileSync(path, updated);
  }
  return version;
}
