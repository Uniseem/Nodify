import {
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
  mkdirSync,
  copyFileSync,
  unlinkSync,
  realpathSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";
import {
  createDecipheriv,
  createCipheriv,
  randomBytes,
  scryptSync,
  createHash,
} from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { hostname } from "node:os";
const VERSION = JSON.parse(
  readFileSync(new URL("./version.json", import.meta.url), "utf8"),
).version;
export function decryptBackup(bytes, password) {
  if (bytes.length < 52 || bytes.subarray(0, 8).toString() !== "NODIFY01")
    throw new Error("Unknown backup format");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    scryptSync(password, bytes.subarray(8, 24), 32),
    bytes.subarray(24, 36),
  );
  decipher.setAuthTag(bytes.subarray(36, 52));
  const archive = Buffer.concat([
    decipher.update(bytes.subarray(52)),
    decipher.final(),
  ]);
  const record = JSON.parse(
    gunzipSync(archive, { maxOutputLength: 200 * 1024 * 1024 }).toString(),
  );
  if (record.format !== 1) throw new Error("Unsupported backup version");
  if (record.version !== VERSION)
    throw new Error("Backup application version does not match this release");
  if (
    record.applicationSecret !== undefined &&
    (typeof record.applicationSecret !== "string" ||
      record.applicationSecret.length > 4096)
  )
    throw new Error("Invalid application secret");
  const database = Buffer.from(record.database, "base64"),
    key = Buffer.from(record.masterKey, "base64");
  if (
    database.subarray(0, 16).toString() !== "SQLite format 3\0" ||
    key.length !== 32 ||
    createHash("sha256").update(database).digest("hex") !== record.databaseHash
  )
    throw new Error("Invalid backup contents");
  return { database, key, applicationSecret: record.applicationSecret };
}
export function restoreBackup(
  archive,
  password,
  databaseFile,
  secretDirectory,
) {
  const runtimeFile = join(secretDirectory, "panel-runtime.json");
  if (existsSync(runtimeFile)) {
    const runtime = JSON.parse(readFileSync(runtimeFile, "utf8"));
    // PIDs are local to a host/container. A stopped Docker panel commonly left PID 1,
    // which is the restore process itself in the replacement container.
    if (!runtime.host || runtime.host === hostname()) {
      try {
        process.kill(runtime.pid, 0);
        throw new Error(
          "Nodify supervisor is running; stop the service before restore",
        );
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  }
  const { database, key, applicationSecret } = decryptBackup(
    readFileSync(archive),
    password,
  );
  mkdirSync(dirname(databaseFile), { recursive: true });
  mkdirSync(secretDirectory, { recursive: true, mode: 0o700 });
  const staging = `${databaseFile}.restore-candidate`;
  writeFileSync(staging, database, { mode: 0o600 });
  const check = new DatabaseSync(staging);
  try {
    const result = check.prepare("PRAGMA integrity_check").get();
    if (Object.values(result)[0] !== "ok")
      throw new Error("SQLite integrity check failed");
    if (
      !check
        .prepare("SELECT name FROM sqlite_master WHERE name='NodifyServer'")
        .get()
    )
      throw new Error("Backup predates Nodify control schema");
  } finally {
    check.close();
  }
  const stamp = Date.now();
  const keyFile = join(secretDirectory, "master.key");
  const applicationFile = join(secretDirectory, "application-secret");
  const oldApplication = existsSync(applicationFile)
    ? readFileSync(applicationFile)
    : null;
  if (existsSync(`${databaseFile}-wal`) || existsSync(`${databaseFile}-shm`))
    throw new Error(
      "SQLite sidecars exist. Stop all writers and checkpoint the database before restoring.",
    );
  const previousDatabase = existsSync(databaseFile)
    ? readFileSync(databaseFile)
    : null;
  const previousKey = existsSync(keyFile) ? readFileSync(keyFile) : null;
  if (previousDatabase) {
    if (!previousKey)
      throw new Error(
        "Current database has no master key; cannot create the required pre-restore backup",
      );
    const record = {
      format: 1,
      version: VERSION,
      createdAt: new Date().toISOString(),
      database: previousDatabase.toString("base64"),
      databaseHash: createHash("sha256").update(previousDatabase).digest("hex"),
      masterKey: previousKey.toString("base64"),
      applicationSecret: oldApplication?.toString() || process.env.APP_SECRET,
    };
    const salt = randomBytes(16),
      iv = randomBytes(12),
      cipher = createCipheriv(
        "aes-256-gcm",
        scryptSync(password, salt, 32),
        iv,
      );
    const encrypted = Buffer.concat([
      cipher.update(gzipSync(Buffer.from(JSON.stringify(record)))),
      cipher.final(),
    ]);
    writeFileSync(
      `${databaseFile}.before-restore-${stamp}.nodify`,
      Buffer.concat([
        Buffer.from("NODIFY01"),
        salt,
        iv,
        cipher.getAuthTag(),
        encrypted,
      ]),
      { mode: 0o600 },
    );
  }
  try {
    writeFileSync(`${keyFile}.restore`, key, { mode: 0o600 });
    renameSync(staging, databaseFile);
    renameSync(`${keyFile}.restore`, keyFile);
    if (applicationSecret !== undefined) {
      writeFileSync(`${applicationFile}.restore`, applicationSecret, {
        mode: 0o600,
      });
      renameSync(`${applicationFile}.restore`, applicationFile);
    }
  } catch (error) {
    if (previousDatabase)
      writeFileSync(databaseFile, previousDatabase, { mode: 0o600 });
    else if (existsSync(databaseFile)) unlinkSync(databaseFile);
    if (previousKey) writeFileSync(keyFile, previousKey, { mode: 0o600 });
    else if (existsSync(keyFile)) unlinkSync(keyFile);
    if (oldApplication)
      writeFileSync(applicationFile, oldApplication, { mode: 0o600 });
    else if (existsSync(applicationFile)) unlinkSync(applicationFile);
    throw error;
  }
  return {
    restored: true,
    previousBackup: previousDatabase
      ? `${databaseFile}.before-restore-${stamp}.nodify`
      : null,
  };
}
if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  if (process.env.NODIFY_OFFLINE_RESTORE !== "1")
    throw new Error(
      "Stop all Nodify processes, then set NODIFY_OFFLINE_RESTORE=1",
    );
  const password = process.env.NODIFY_BACKUP_PASSWORD;
  if (!password) throw new Error("Set NODIFY_BACKUP_PASSWORD");
  const [archive, database, secret] = process.argv.slice(2);
  if (!archive || !database || !secret)
    throw new Error(
      "Usage: restore.mjs backup.nodify database.sqlite secret-directory",
    );
  console.log(
    JSON.stringify(
      restoreBackup(
        resolve(archive),
        password,
        resolve(database),
        resolve(secret),
      ),
    ),
  );
}
