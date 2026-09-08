import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { resolve } from "node:path";
const [snapshot, target] = process.argv.slice(2);
if (!snapshot || !target)
  throw new Error("Usage: database-rollback.mjs snapshot database (all writers must be stopped)");
const source = new DatabaseSync(resolve(snapshot), { readOnly: true });
try {
  if (Object.values(source.prepare("PRAGMA integrity_check").get())[0] !== "ok")
    throw new Error("Invalid rollback snapshot");
} finally {
  source.close();
}
const destination = resolve(target);
if (existsSync(destination)) {
  const current = new DatabaseSync(destination);
  try {
    const result = current.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    if (result.busy !== 0) throw new Error("Database is still in use; rollback refused");
  } finally {
    current.close();
  }
}
if (existsSync(`${destination}-wal`) || existsSync(`${destination}-shm`))
  throw new Error("Database sidecars remain; rollback refused");
writeFileSync(`${destination}.rollback-candidate`, readFileSync(resolve(snapshot)), {
  mode: 0o600,
});
renameSync(`${destination}.rollback-candidate`, destination);
