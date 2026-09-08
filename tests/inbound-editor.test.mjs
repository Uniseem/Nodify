import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { generateKeyPairSync, randomUUID } from "node:crypto";
const require = createRequire(import.meta.url);
require("./loader.cjs");
const {
  ConfigInput,
  Inbound,
} = require("../packages/nodify-contract/index.ts");

test("AnyTLS logical routing protects managed inbound references when editing or deleting", () => {
  const id = randomUUID();
  const inbound = {
    id,
    name: "AnyTLS",
    protocol: "anytls",
    port: 8443,
    security: "tls",
    certificateId: randomUUID(),
  };
  const config = {
    inbounds: [inbound],
    singbox: {
      route: {
        rules: [
          {
            type: "logical",
            mode: "and",
            rules: [{ inbound: [id] }],
            action: "route",
            outbound: "direct",
          },
        ],
      },
    },
  };
  assert.equal(ConfigInput.parse(config).inbounds[0].id, id);
  assert.throws(() => ConfigInput.parse({ ...config, inbounds: [] }));
  assert.throws(() =>
    ConfigInput.parse({
      ...config,
      inbounds: [{ ...inbound, protocol: "vless" }],
    }),
  );
  assert.throws(() =>
    ConfigInput.parse({ ...config, singbox: { route: { rules: [null] } } }),
  );
});

test("REALITY accepts generated X25519 keys and rejects malformed keys and short IDs", () => {
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  const inbound = {
    id: randomUUID(),
    name: "REALITY",
    protocol: "vless",
    network: "tcp",
    port: 8443,
    security: "reality",
    realityPrivateKey: privateKey.export({ format: "jwk" }).d,
    realityPublicKey: publicKey.export({ format: "jwk" }).x,
    realityTarget: "example.com:443",
    serverName: "example.com",
    shortId: "0011223344556677",
    flow: "xtls-rprx-vision",
    extra: { sniffing: { enabled: true } },
  };
  assert.deepEqual(Inbound.parse(inbound).extra, inbound.extra);
  assert.throws(() => Inbound.parse({ ...inbound, shortId: "123" }));
  assert.throws(() =>
    Inbound.parse({ ...inbound, realityPrivateKey: "not-a-key" }),
  );
  assert.throws(() => Inbound.parse({ ...inbound, network: "ws" }));
});
