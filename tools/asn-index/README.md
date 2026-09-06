# asn-index

Daily-updated index of ASN → IP prefix mappings, available in JSON and LMDB formats. Built from [ipverse/as-ip-blocks](https://github.com/ipverse/as-ip-blocks) and published as GitHub Release assets.

## Browser lookup

Browse and search ASNs interactively at **[lens.ipverse.net](https://lens.ipverse.net)** (powered by the same ipverse dataset).

## Downloads

| Format | URL |
|--------|-----|
| JSON | https://github.com/remnawave/asn-index/releases/latest/download/asn-prefixes.json |
| LMDB (tar.gz) | https://github.com/remnawave/asn-index/releases/latest/download/asn-prefixes-lmdb.tar.gz |

## Data format

### asn-prefixes.json

A single JSON object where each key is an ASN number (as a string) and the value contains IPv4 and IPv6 prefix lists:

```json
{
  "13335": {
    "ipv4": ["1.0.0.0/24", "1.1.1.0/24"],
    "ipv6": ["2400:cb00::/32", "2606:4700::/32"]
  },
  "15169": {
    "ipv4": ["8.8.8.0/24"],
    "ipv6": ["2001:4860::/32"]
  }
}
```

### asn-prefixes.lmdb

An LMDB database with:
- **Key**: ASN number (`number`)
- **Value**: `{ ipv4: string[], ipv6: string[] }` (MessagePack-serialized via lmdb-js)

## Usage

### JSON

```js
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync('asn-prefixes.json', 'utf8'));

// Direct object lookup
const cloudflare = data['13335'];
console.log(cloudflare.ipv4); // ["1.0.0.0/24", ...]

// Convert to Map for repeated lookups
const asnMap = new Map(Object.entries(data));
console.log(asnMap.get('13335').ipv6);
```

### LMDB

```js
import { open } from 'lmdb';

// Extract asn-prefixes-lmdb.tar.gz first, then:
const db = open({
  path: './asn-prefixes.lmdb',
  encoding: 'msgpack',
  readOnly: true,
});

const cloudflare = db.get(13335);
console.log(cloudflare.ipv4); // ["1.0.0.0/24", ...]

db.close();
```

## Update frequency

The index is rebuilt **daily at 04:00 UTC** via a scheduled GitHub Actions workflow. Each run downloads the latest snapshot from ipverse/as-ip-blocks and overwrites the `latest` release assets.

## Data source

IP prefix data is sourced from [ipverse/as-ip-blocks](https://github.com/ipverse/as-ip-blocks), which aggregates routing data from public BGP sources.

## License

MIT
