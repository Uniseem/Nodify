#!/usr/bin/env bash
set -euo pipefail

SOURCE_URL="https://github.com/ipverse/as-ip-blocks/releases/latest/download/as-ip-blocks.tar.gz"
DIST_DIR="./dist"
OUTPUT_FILE="${DIST_DIR}/asn-prefixes.json"
TMPDIR="$(mktemp -d)"

cleanup() {
  echo "Cleaning up temp directory: ${TMPDIR}"
  rm -rf "${TMPDIR}"
}
trap cleanup EXIT

echo "=== ASN Index Builder ==="
echo "Source: ${SOURCE_URL}"

mkdir -p "${DIST_DIR}"

echo "Downloading as-ip-blocks archive..."
curl -fsSL --retry 3 --retry-delay 5 -o "${TMPDIR}/as-ip-blocks.tar.gz" "${SOURCE_URL}"
echo "Download complete."

echo "Extracting archive..."
tar -xzf "${TMPDIR}/as-ip-blocks.tar.gz" -C "${TMPDIR}"
echo "Extraction complete."

AS_DIR="${TMPDIR}/as"
if [[ ! -d "${AS_DIR}" ]]; then
  echo "ERROR: Expected 'as/' directory not found in archive." >&2
  exit 1
fi

echo "Building ${OUTPUT_FILE}..."

# Build the combined JSON object using jq
# Each per-ASN file is named like <asn>.json and contains:
# { "asn": 13335, "handle": "...", "description": "...", "subnets": { "ipv4": [...], "ipv6": [...] } }

find "${AS_DIR}" -name 'aggregated.json' -print0 \
  | sort -z \
  | xargs -0 jq -c '
      select(
        ((.prefixes.ipv4 // []) | length) > 0
        or ((.prefixes.ipv6 // []) | length) > 0
      )
      | {
          key: (.asn | tostring),
          value: {
            ipv4: (.prefixes.ipv4 // []),
            ipv6: (.prefixes.ipv6 // [])
          }
        }
    ' \
  | jq -s 'from_entries' \
  > "${OUTPUT_FILE}"

ASN_COUNT=$(jq 'keys | length' "${OUTPUT_FILE}")
echo "Done. ${ASN_COUNT} ASNs written to ${OUTPUT_FILE}."
