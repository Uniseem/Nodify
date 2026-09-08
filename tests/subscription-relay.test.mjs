import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import net from "node:net";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ruleFixture } from "./rule-fixture.mjs";
const require = createRequire(import.meta.url);
const {
  SubscriptionTemplates,
} = require("../apps/backend/src/modules/nodify/subscription-templates.ts");
const { load, dump } = require("../apps/backend/node_modules/js-yaml");
const exec = promisify(execFile);
async function port() {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const value = server.address().port;
  await new Promise((r) => server.close(r));
  return value;
}

test(
  "real Mihomo V3 filters and managed/provider relay fail closed when the entry stops",
  {
    skip: !process.env.NODIFY_TEST_MIHOMO || !process.env.NODIFY_TEST_SINGBOX,
    timeout: 120000,
  },
  async () => {
    const landingPort = await port(),
      entryPort = await port(),
      clientPort = await port(),
      apiPort = await port();
    const { db, service, render, directory, user } =
      await ruleFixture(landingPort);
    const children = new Set();
    const stop = async (child) => {
      if (child.exitCode === null) {
        const done = new Promise((r) => child.once("exit", r));
        child.kill();
        await done;
      }
      children.delete(child);
    };
    const start = async (binary, args, readyPort) => {
      const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
      children.add(child);
      let logs = "",
        failure;
      child.on("error", (error) => {
        failure = error;
      });
      child.stdout.on("data", (chunk) => {
        logs = (logs + chunk).slice(-5000);
      });
      child.stderr.on("data", (chunk) => {
        logs = (logs + chunk).slice(-5000);
      });
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        if (failure) throw failure;
        assert.equal(child.exitCode, null, logs);
        const ready = await new Promise((resolve) => {
          const socket = net.connect({ host: "127.0.0.1", port: readyPort });
          socket.on("connect", () => {
            socket.destroy();
            resolve(true);
          });
          socket.on("error", () => resolve(false));
        });
        if (ready) return child;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw Error(`Engine readiness timed out: ${logs}`);
    };
    const destination = createServer((req, res) => res.end("v3-relay-ok"));
    await new Promise((r) => destination.listen(0, "127.0.0.1", r));
    const provider = createServer((req, res) =>
      res.end(
        dump({
          proxies: [
            {
              name: "Remote VLESS",
              type: "vless",
              server: "127.0.0.1",
              port: landingPort,
              uuid: user.vlessUuid,
            },
            {
              name: "Remote SS",
              type: "ss",
              server: "127.0.0.1",
              port: landingPort,
              cipher: "aes-128-gcm",
              password: "fixture",
            },
            {
              name: "Remote HTTP",
              type: "http",
              server: "127.0.0.1",
              port: landingPort,
            },
          ],
        }),
      ),
    );
    await new Promise((r) => provider.listen(0, "127.0.0.1", r));
    const request = () =>
      exec("curl", [
        "--silent",
        "--show-error",
        "--fail",
        "--max-time",
        "3",
        "--noproxy",
        "",
        "--proxy",
        `http://127.0.0.1:${clientPort}`,
        `http://127.0.0.1:${destination.address().port}/`,
      ]);
    const api = async (path, body) => {
      const response = await fetch(`http://127.0.0.1:${apiPort}/${path}`, {
        method: body ? "PUT" : "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer isolated-v3-test",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(3000),
      });
      assert.ok(response.ok, await response.clone().text());
      return response.status === 204 ? undefined : response.json();
    };
    try {
      for (const [label, listenPort] of [
        ["entry", entryPort],
        ["landing", landingPort],
      ]) {
        const config = join(directory, `${label}.json`);
        await writeFile(
          config,
          JSON.stringify({
            inbounds: [
              {
                type: "vless",
                listen: "127.0.0.1",
                listen_port: listenPort,
                users: [{ uuid: user.vlessUuid }],
              },
            ],
            outbounds: [{ type: "direct" }],
          }),
        );
        await start(
          process.env.NODIFY_TEST_SINGBOX,
          ["run", "-c", config],
          listenPort,
        );
      }
      const entry = [...children][0];
      const templates = new SubscriptionTemplates(service);
      const template = await templates.save({
        name: "Real V3",
        document: {
          mihomo: {
            "proxy-providers": {
              entry: {
                type: "inline",
                payload: [
                  {
                    name: "Entry node",
                    type: "vless",
                    server: "127.0.0.1",
                    port: entryPort,
                    uuid: user.vlessUuid,
                  },
                ],
              },
              remote: {
                type: "http",
                url: `http://127.0.0.1:${provider.address().port}/nodes`,
                path: "./remote.yaml",
                interval: 3600,
              },
            },
            "proxy-groups": [
              { name: "Entry", type: "select", use: ["entry"] },
              {
                name: "ManagedLanding",
                type: "relay",
                proxies: ["$NODES"],
                "dialer-proxy-group": "Entry",
                "include-type": "vless",
                filter: "(?i)^nodify",
              },
              {
                name: "ProviderLanding",
                type: "select",
                use: ["remote"],
                "dialer-proxy-group": "Entry",
                "include-type": "VLESS",
                filter: "(?i)remote",
              },
              {
                name: "Types",
                type: "select",
                use: ["remote"],
                "include-type": "ss|vless",
                "exclude-type": "vless",
              },
              {
                name: "Empty",
                type: "select",
                "include-all-proxies": true,
                "include-type": "anytls",
              },
              {
                name: "RegexEmpty",
                type: "select",
                "include-all-proxies": true,
                "include-type": "vless",
                filter: "^absent$",
              },
              {
                name: "AllProviders",
                type: "select",
                "include-all-providers": true,
              },
              { name: "Raw", type: "select", proxies: ["$NODES"] },
              {
                name: "Nodify",
                type: "select",
                proxies: [
                  "ManagedLanding",
                  "ProviderLanding",
                  "Raw",
                  "Empty",
                  "RegexEmpty",
                ],
              },
            ],
            rules: ["MATCH,Nodify"],
          },
        },
      });
      await templates.select({ templateId: template.id, version: 0 });
      const config = load((await render("mihomo")).content);
      assert.deepEqual(
        config["proxy-groups"].find((g) => g.name === "AllProviders").use,
        ["entry", "remote"],
      );
      assert.equal(config.proxies[0]["dialer-proxy"], undefined);
      config["mixed-port"] = clientPort;
      config["external-controller"] = `127.0.0.1:${apiPort}`;
      config.secret = "isolated-v3-test";
      config["allow-lan"] = false;
      const file = join(directory, "v3.yaml");
      await writeFile(file, dump(config));
      await exec(
        process.env.NODIFY_TEST_MIHOMO,
        ["-t", "-d", directory, "-f", file],
        { timeout: 30000 },
      );
      await start(
        process.env.NODIFY_TEST_MIHOMO,
        ["-d", directory, "-f", file],
        clientPort,
      );
      let state;
      for (let i = 0; i < 50; i++) {
        state = (await api("proxies")).proxies;
        if (
          state.Types.all.includes("Remote SS") &&
          state.ProviderLanding.all.includes("Remote VLESS")
        )
          break;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.deepEqual(state.Types.all, ["Remote SS"]);
      assert.deepEqual(state.ProviderLanding.all, ["Remote VLESS"]);
      assert.deepEqual(state.Empty.all, ["REJECT"]);
      assert.deepEqual(state.RegexEmpty.all, ["REJECT"]);
      for (const name of ["ManagedLanding", "ProviderLanding", "Raw"]) {
        await api("proxies/Nodify", { name });
        assert.equal((await request()).stdout, "v3-relay-ok");
      }
      await stop(entry);
      for (const name of [
        "ManagedLanding",
        "ProviderLanding",
        "Empty",
        "RegexEmpty",
      ]) {
        await api("proxies/Nodify", { name });
        await assert.rejects(
          request,
          `${name} must reject rather than bypass its entry/filter`,
        );
      }
      await api("proxies/Nodify", { name: "Raw" });
      assert.equal(
        (await request()).stdout,
        "v3-relay-ok",
        "The original landing node must still work without the entry",
      );
      await db.users.update({
        where: { id: user.id },
        data: { expireAt: new Date(0) },
      });
      const expired = load((await render("mihomo")).content);
      assert.deepEqual(expired["proxy-providers"], {});
      assert.deepEqual(expired.proxies, []);
    } finally {
      for (const child of children) await stop(child);
      destination.closeAllConnections();
      provider.closeAllConnections();
      await Promise.all([
        new Promise((r) => destination.close(r)),
        new Promise((r) => provider.close(r)),
      ]);
      await db.$disconnect();
    }
  },
);
