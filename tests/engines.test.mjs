import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { queryStats } from "../apps/node/agent/statistics.mjs";
import { restrictPolicy } from "../apps/node/agent/policy.mjs";
const require = createRequire(import.meta.url);
require("./loader.cjs");
const { ConfigInput } = require("../packages/nodify-contract/index.ts");
const { compileConfiguration } = require("../apps/backend/src/modules/nodify/configuration.ts");
const {
  proxyFor,
  singboxFor,
} = require("../apps/backend/src/modules/nodify/subscription.controller.ts");
const exec = promisify(execFile);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const xray = process.env.NODIFY_TEST_XRAY,
  singbox = process.env.NODIFY_TEST_SINGBOX,
  cert = process.env.NODIFY_TEST_CERT_DIR;
test(
  "six real protocol connections and per-user counters",
  { skip: !xray || !singbox || !cert, timeout: 90000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "nodify-engines-"));
    const certificateId = randomUUID();
    const inbounds = ["vless", "vmess", "trojan", "shadowsocks", "hysteria2", "anytls"].map(
      (protocol, i) => ({
        id: randomUUID(),
        name: protocol,
        protocol,
        port: 25440 + i,
        network: protocol === "hysteria2" ? "udp" : "tcp",
        security: protocol === "shadowsocks" ? "none" : "tls",
        certificateId: protocol === "shadowsocks" ? undefined : certificateId,
        serverName: "node.example",
      }),
    );
    const user = {
      id: "1",
      uuid: randomUUID(),
      password: "test-trojan",
      ssPassword: "test-shadowsocks",
      anytlsPassword: "test-anytls",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      remainingBytes: "100000000",
      nodeIds: inbounds.map((i) => i.id),
      tags: [],
    };
    const config = ConfigInput.parse({ inbounds });
    const other = {
      ...user,
      id: "2",
      uuid: randomUUID(),
      password: "other-trojan",
      ssPassword: "other-ss",
      anytlsPassword: "independent-anytls",
    };
    const compiled = compileConfiguration(config, [user, other]);
    compiled.xray.outbounds[0].settings = {
      finalRules: [{ action: "allow", ip: ["127.0.0.1/32"] }],
    };
    const children = [];
    const logs = [];
    const start = (binary, args) => {
      const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
      children.push(child);
      child.stdout.on("data", (c) => logs.push(c.toString()));
      child.stderr.on("data", (c) => logs.push(c.toString()));
      return child;
    };
    const destination = createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end(Buffer.alloc(65536, 65));
    });
    await new Promise((r) => destination.listen(0, "127.0.0.1", r));
    try {
      for (const [name, value] of Object.entries({
        xray: compiled.xray,
        singbox: compiled.singbox,
      })) {
        writeFileSync(
          join(dir, `${name}.json`),
          JSON.stringify(value).replaceAll(
            `/var/lib/nodify-agent/certificates/${certificateId}`,
            resolve(cert).replaceAll("\\", "/"),
          ),
        );
      }
      await exec(xray, ["run", "-test", "-config", join(dir, "xray.json")]);
      await exec(singbox, ["check", "-c", join(dir, "singbox.json")]);
      start(xray, ["run", "-config", join(dir, "xray.json")]);
      let singServer = start(singbox, ["run", "-c", join(dir, "singbox.json")]);
      await wait(1000);
      for (let index = 0; index < config.inbounds.length; index++) {
        const inbound = config.inbounds[index],
          proxy = proxyFor(
            inbound,
            "127.0.0.1",
            { vlessUuid: user.uuid, trojanPassword: user.password, ssPassword: user.ssPassword },
            user.anytlsPassword,
          );
        const outbound = singboxFor(proxy);
        outbound.tag = "proxy";
        if (outbound.tls) outbound.tls.insecure = true;
        const client = {
          inbounds: [
            { type: "mixed", tag: "mixed", listen: "127.0.0.1", listen_port: 25540 + index },
          ],
          outbounds: [outbound],
          route: { final: "proxy" },
        };
        const file = join(dir, `client-${inbound.protocol}.json`);
        writeFileSync(file, JSON.stringify(client));
        const child = start(singbox, ["run", "-c", file]);
        await wait(400);
        try {
          const response = await exec(
            process.platform === "win32" ? "curl.exe" : "curl",
            [
              "--silent",
              "--show-error",
              "--fail",
              "--max-time",
              "10",
              "--noproxy",
              "",
              "--proxy",
              `socks5h://127.0.0.1:${25540 + index}`,
              `http://127.0.0.1:${destination.address().port}/payload`,
            ],
            { maxBuffer: 2 * 1024 * 1024 },
          );
          assert.equal(response.stdout.length, 65536, `${inbound.protocol} payload mismatch`);
          console.log(`${inbound.protocol}: 65536 bytes verified`);
        } catch (error) {
          throw new Error(`${inbound.protocol}: ${error.message}\n${logs.slice(-30).join("")}`);
        } finally {
          child.kill();
        }
      }
      const xs = await queryStats(61001),
        ss = await queryStats(61002);
      assert.ok(BigInt(xs["user>>>1>>>traffic>>>downlink"] || "0") >= 5n * 65536n);
      assert.ok(BigInt(ss["user>>>1>>>traffic>>>downlink"] || "0") >= 65536n);
      assert.equal(
        BigInt(ss["user>>>2>>>traffic>>>downlink"] || "0"),
        0n,
        "Inactive second user must not receive the first user traffic",
      );
      const clientFile = join(dir, "client-anytls.json"),
        client = JSON.parse(readFileSync(clientFile, "utf8"));
      client.outbounds[0].password = other.anytlsPassword;
      writeFileSync(clientFile, JSON.stringify(client));
      const otherClient = start(singbox, ["run", "-c", clientFile]);
      await wait(400);
      const download = () =>
        exec(process.platform === "win32" ? "curl.exe" : "curl", [
          "--silent",
          "--show-error",
          "--fail",
          "--max-time",
          "3",
          "--noproxy",
          "",
          "--proxy",
          "socks5h://127.0.0.1:25545",
          `http://127.0.0.1:${destination.address().port}/payload`,
        ]);
      assert.equal((await download()).stdout.length, 65536);
      const isolated = await queryStats(61002);
      assert.ok(BigInt(isolated["user>>>2>>>traffic>>>downlink"] || "0") >= 65536n);
      // The same cached policy function is used by an offline Agent to revoke quota/expiry access.
      const exhausted = restrictPolicy(compiled, {
        1: user.remainingBytes,
        2: other.remainingBytes,
      });
      assert.equal(exhausted.singbox.inbounds[0].users.length, 0);
      assert.equal(
        restrictPolicy(compiled, {}, Date.now() + 2 * 86400000).singbox.inbounds[0].users.length,
        0,
      );
      const exited = new Promise((r) => singServer.once("exit", r));
      singServer.kill();
      await exited;
      writeFileSync(
        join(dir, "singbox.json"),
        JSON.stringify(exhausted.singbox).replaceAll(
          `/var/lib/nodify-agent/certificates/${certificateId}`,
          resolve(cert).replaceAll("\\", "/"),
        ),
      );
      singServer = start(singbox, ["run", "-c", join(dir, "singbox.json")]);
      await wait(400);
      await assert.rejects(
        download,
        "AnyTLS must reject an exhausted user after controlled restart",
      );
      otherClient.kill();
      console.log("AnyTLS: isolated user counters, expiry policy and quota revocation verified");
    } finally {
      for (const child of children) child.kill();
      destination.closeAllConnections();
      await new Promise((r) => destination.close(r));
    }
  },
);
