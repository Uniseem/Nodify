import {
  mkdirSync,
  realpathSync,
  statSync,
  copyFileSync,
  readdirSync,
  chmodSync,
} from "node:fs";
import { join, dirname } from "node:path";

// Materialize every dependency link, including nested node_modules/.bin entries.
// Release archives must work after the build directory has disappeared.
export function copyReleaseTree(source, destination, ancestors = new Set()) {
  const actual = realpathSync(source);
  const info = statSync(actual);
  if (info.isFile()) {
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(actual, destination);
    chmodSync(destination, info.mode & 0o111 ? 0o755 : 0o644);
    return;
  }
  if (!info.isDirectory() || ancestors.has(actual))
    throw new Error(`Unsupported or cyclic release entry: ${source}`);
  const parents = new Set(ancestors).add(actual);
  mkdirSync(destination, { recursive: true });
  chmodSync(destination, 0o755);
  for (const name of readdirSync(actual))
    copyReleaseTree(join(actual, name), join(destination, name), parents);
}
