import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
const [database, output] = process.argv.slice(2);
if (!database || !output) throw new Error("Usage: database-snapshot.mjs database snapshot");
const db = new DatabaseSync(resolve(database));
const candidate = `${resolve(output)}.${randomUUID()}.candidate`;
try {
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.exec(`VACUUM INTO '${candidate.replaceAll("'", "''")}'`);
} finally {
  db.close();
}
renameSync(candidate, resolve(output));
