#!/usr/bin/env node
/**
 * Local verification script — not used in CI, just for sanity-checking the build.
 * Usage: node scripts/verify.mjs
 */
import { open } from 'lmdb';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DIST_DIR = resolve('./dist');

// ── 1. Verify JSON ──────────────────────────────────────────────────────────
console.log('── JSON verification ──────────────────────────────────────────');
const json = JSON.parse(readFileSync(resolve(DIST_DIR, 'asn-prefixes.json'), 'utf8'));
const jsonKeys = Object.keys(json);
console.log(`Total ASNs in JSON : ${jsonKeys.length}`);

const noData = jsonKeys.filter(k => json[k].ipv4.length === 0 && json[k].ipv6.length === 0);
console.log(`ASNs with no prefixes (should be 0): ${noData.length}`);

// Spot-check well-known ASNs
const SPOT = [
  { asn: '13335', name: 'Cloudflare',   expectedIpv4: '1.1.1.0/24' },
  { asn: '15169', name: 'Google',        expectedIpv4: '8.8.8.0/24' },
  { asn: '16509', name: 'Amazon AWS',    expectedIpv4: null },
];
for (const { asn, name, expectedIpv4 } of SPOT) {
  const entry = json[asn];
  if (!entry) {
    console.log(`  [FAIL] ${name} (AS${asn}) — not found`);
    continue;
  }
  const ipv4ok = expectedIpv4 ? entry.ipv4.includes(expectedIpv4) : entry.ipv4.length > 0;
  const status = ipv4ok ? 'OK  ' : 'WARN';
  console.log(`  [${status}] ${name} (AS${asn}) — ${entry.ipv4.length} IPv4, ${entry.ipv6.length} IPv6 prefixes${expectedIpv4 ? ` (${expectedIpv4}: ${ipv4ok ? 'present' : 'MISSING'})` : ''}`);
}

// ── 2. Verify LMDB ──────────────────────────────────────────────────────────
console.log('\n── LMDB verification ──────────────────────────────────────────');
const db = open({
  path: resolve(DIST_DIR, 'asn-prefixes.lmdb'),
  encoding: 'msgpack',
  readOnly: true,
});

const dbCount = db.getCount();
console.log(`Total entries in LMDB: ${dbCount}`);
console.log(`Match JSON count: ${dbCount === jsonKeys.length ? 'YES' : `NO (delta: ${dbCount - jsonKeys.length})`}`);

for (const { asn, name, expectedIpv4 } of SPOT) {
  const entry = db.get(Number(asn));
  if (!entry) {
    console.log(`  [FAIL] ${name} (AS${asn}) — not found`);
    continue;
  }
  const ipv4ok = expectedIpv4 ? entry.ipv4.includes(expectedIpv4) : entry.ipv4.length > 0;
  const status = ipv4ok ? 'OK  ' : 'WARN';
  console.log(`  [${status}] ${name} (AS${asn}) — ${entry.ipv4.length} IPv4, ${entry.ipv6.length} IPv6 prefixes`);
}

// Verify a random sample from JSON matches LMDB
console.log('\nRandom sample cross-check (10 entries):');
const sampleKeys = jsonKeys.sort(() => Math.random() - 0.5).slice(0, 10);
let mismatches = 0;
for (const k of sampleKeys) {
  const fromJson = json[k];
  const fromLmdb = db.get(Number(k));
  if (!fromLmdb) { mismatches++; console.log(`  [FAIL] AS${k} missing in LMDB`); continue; }
  const match =
    JSON.stringify(fromJson.ipv4.sort()) === JSON.stringify(fromLmdb.ipv4.sort()) &&
    JSON.stringify(fromJson.ipv6.sort()) === JSON.stringify(fromLmdb.ipv6.sort());
  if (!match) { mismatches++; console.log(`  [FAIL] AS${k} data mismatch`); }
  else console.log(`  [OK  ] AS${k}`);
}
if (mismatches === 0) console.log('All samples match.');

await db.close();

// ── 3. File sizes ────────────────────────────────────────────────────────────
console.log('\n── Artifact sizes ─────────────────────────────────────────────');
import { statSync } from 'node:fs';
const fmt = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
for (const name of ['asn-prefixes.json', 'asn-prefixes-lmdb.tar.gz']) {
  const { size } = statSync(resolve(DIST_DIR, name));
  console.log(`  ${name}: ${fmt(size)}`);
}

console.log('\nVerification complete.');
