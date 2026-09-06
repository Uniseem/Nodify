#!/usr/bin/env node
import { open } from 'lmdb';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const DIST_DIR = resolve('./dist');
const JSON_PATH = resolve(DIST_DIR, 'asn-prefixes.json');
const LMDB_PATH = resolve(DIST_DIR, 'asn-prefixes.lmdb');
const TAR_PATH = resolve(DIST_DIR, 'asn-prefixes-lmdb.tar.gz');
const ZST_PATH = resolve(DIST_DIR, 'asn-prefixes.lmdb.zst');

console.log('=== LMDB Builder ===');
console.log(`Reading ${JSON_PATH}...`);

const data = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
const entries = Object.entries(data);
console.log(`Loaded ${entries.length} ASN entries.`);

console.log(`Opening LMDB at ${LMDB_PATH}...`);
const db = open({
  path: LMDB_PATH,
  mapSize: 256 * 1024 * 1024, // 256 MB
  encoding: 'msgpack',
});

console.log('Writing entries...');
await db.transaction(() => {
  for (const [asn, prefixes] of entries) {
    db.put(Number(asn), prefixes);
  }
});

const count = db.getCount();
console.log(`Written ${count} entries to LMDB.`);

await db.close();
console.log('LMDB closed.');

console.log(`Creating tarball: ${TAR_PATH}...`);
execSync(
  `tar -czf "${TAR_PATH}" -C "${DIST_DIR}" asn-prefixes.lmdb`,
  { stdio: 'inherit' },
);

console.log(`Compressing LMDB with zstd: ${ZST_PATH}...`);
execSync(
  `zstd -19 -T0 -f -o "${ZST_PATH}" "${LMDB_PATH}"`,
  { stdio: 'inherit' },
);
console.log('Done.');
