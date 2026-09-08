import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer, get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import net from "node:net";
import { mkdtemp, mkdir, writeFile, readFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { Runtime, pause } from "../apps/node/agent/runtime.mjs";
import {
  renderWebsites,
  websitePorts,
} from "../apps/node/agent/website-config.mjs";
const require = createRequire(import.meta.url);
require("./loader.cjs");
const { WebsiteInput } = require("../packages/nodify-contract/index.ts");

test("website contracts and renderer reject injection and mixed HTTP/TLS ports", () => {
  const input = {
    name: "site",
    domain: "node.example",
    type: "static",
    target: "/srv/static content",
    httpPort: 8080,
  };
  assert.equal(WebsiteInput.parse(input).target, input.target);
  for (const target of [
    "/srv/../etc",
    '/tmp/";include /etc/passwd;',
    "/srv/$secret",
    "/srv/\nroot",
  ])
    assert.throws(() => WebsiteInput.parse({ ...input, target }));
  for (const target of [
    "file:///etc/passwd",
    "https://user:password@example.com",
    "http://example.com/#fragment",
    "http://example.com/a b",
  ])
    assert.throws(() =>
      WebsiteInput.parse({ ...input, type: "proxy", target }),
    );
  const a = { ...WebsiteInput.parse(input), id: randomUUID() };
  assert.throws(() =>
    WebsiteInput.parse({ ...input, aliases: ["NODE.EXAMPLE"] }),
  );
  const aliases = { ...a, aliases: ["alias.example"] };
  assert.match(
    renderWebsites("/agent/nginx", { a: aliases }),
    /server_name node.example alias.example;/,
  );
  assert.throws(() =>
    renderWebsites("/agent/nginx", {
      a: aliases,
      b: { ...a, id: randomUUID(), domain: "alias.example" },
    }),
  );
  assert.throws(() =>
    renderWebsites("/agent/nginx", {
      a: { ...a, aliases: ["bad;include.example"] },
    }),
  );
  assert.match(
    renderWebsites("/agent/nginx", { [a.id]: a }),
    /root "\/srv\/static content"/,
  );
  assert.deepEqual(websitePorts({ [a.id]: { ...a, remove: true } }), []);
  assert.throws(() =>
    renderWebsites("/agent/nginx", {
      a,
      b: {
        ...a,
        id: randomUUID(),
        domain: "other.example",
        certificateId: randomUUID(),
        httpPort: 8888,
        httpsPort: 8080,
      },
    }),
  );
});

async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
test(
  "real Nginx: static, TLS redirect, proxy, WebSocket, logs, rollback and deletion replay",
  {
    skip: !process.env.NODIFY_TEST_NGINX || !process.env.NODIFY_TEST_CERT_DIR,
    timeout: 45000,
  },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "nodify-websites-"));
    await chmod(directory, 0o755);
    const root = join(directory, "static content");
    await mkdir(root);
    await writeFile(join(root, "index.html"), "static-website-ok");
    const runtime = new Runtime(join(directory, "agent"));
    await runtime.init();
    runtime.binary = (service) =>
      service === "nginx" ? process.env.NODIFY_TEST_NGINX : service;
    const sockets = new Set();
    const upstream = createServer(async (req, res) => {
      let bytes = 0;
      for await (const chunk of req) bytes += chunk.length;
      res.end(`proxy:${req.url}:${bytes}`);
    });
    upstream.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    upstream.on("upgrade", (req, socket) => {
      assert.equal(req.headers.upgrade, "websocket");
      const accept = createHash("sha1")
        .update(
          req.headers["sec-websocket-key"] +
            "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
        )
        .digest("base64");
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      const text = Buffer.from("websocket-ok");
      socket.write(Buffer.concat([Buffer.from([0x81, text.length]), text]));
    });
    await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
    const id = randomUUID(),
      port = await freePort();
    const site = {
      ...WebsiteInput.parse({
        name: "test",
        domain: "node.example",
        type: "static",
        target: root.replaceAll("\\", "/"),
        httpPort: port,
      }),
      id,
      deployment: 1,
      version: 1,
    };
    const get = async () => {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(3000),
      });
      assert.equal(response.status, 200);
      return response.text();
    };
    try {
      await runtime.website(site);
      assert.equal(await get(), "static-website-ok");
      const file = (action, path, extra = {}) =>
        runtime.action("website-files", {
          websiteId: id,
          deployment: 1,
          action,
          path,
          ...extra,
        });
      const original = await file("read", "index.html");
      await file("write", "index.html", {
        expected: original.etag,
        data: Buffer.from("updated-through-agent").toString("base64"),
      });
      assert.equal(await get(), "updated-through-agent");
      const updated = await file("read", "index.html");
      await file("write", "index.html", {
        expected: updated.etag,
        data: original.data,
      });
      await file("write", "style.css", {
        expected: null,
        data: Buffer.from("body { color: red; }").toString("base64"),
      });
      const css = await fetch(`http://127.0.0.1:${port}/style.css`);
      assert.match(css.headers.get("content-type"), /text\/css/);
      assert.equal(await css.text(), "body { color: red; }");
      const otherRoot = join(directory, "other");
      await mkdir(otherRoot);
      await writeFile(join(otherRoot, "index.html"), "alias-routing-ok");
      const other = {
        ...site,
        id: randomUUID(),
        domain: "other.example",
        aliases: ["alias.example"],
        target: otherRoot,
      };
      await runtime.website(other);
      const aliasBody = await new Promise((resolve, reject) => {
        httpGet(
          {
            hostname: "127.0.0.1",
            port,
            path: "/",
            headers: { Host: "alias.example" },
          },
          (response) => {
            let body = "";
            response.on("data", (chunk) => (body += chunk));
            response.on("end", () => resolve(body));
            response.on("error", reject);
          },
        ).on("error", reject);
      });
      assert.equal(aliasBody, "alias-routing-ok");
      await assert.rejects(() =>
        runtime.website({ ...site, id: randomUUID(), domain: "alias.example" }),
      );
      await runtime.website({ ...other, deployment: 2, remove: true });
      await assert.rejects(() =>
        runtime.website({
          ...site,
          deployment: 2,
          target: "/nonexistent-nodify-directory",
        }),
      );
      assert.equal(await get(), "static-website-ok");
      await assert.rejects(() =>
        runtime.website({
          ...site,
          deployment: 3,
          certificateId: randomUUID(),
          httpsPort: port + 1,
          certificate: {
            certPem: "invalid certificate",
            keyPem: "invalid key",
          },
        }),
      );
      assert.equal(await get(), "static-website-ok");
      const certPem = await readFile(
        join(process.env.NODIFY_TEST_CERT_DIR, "fullchain.pem"),
        "utf8",
      );
      const keyPem = await readFile(
        join(process.env.NODIFY_TEST_CERT_DIR, "privkey.pem"),
        "utf8",
      );
      const secureSite = {
        ...site,
        deployment: 4,
        certificateId: randomUUID(),
        httpsPort: await freePort(),
        redirectHttps: true,
        certificate: { certPem, keyPem },
      };
      const getSecure = () =>
        new Promise((resolve, reject) => {
          const request = httpsGet(
            {
              hostname: "127.0.0.1",
              port: secureSite.httpsPort,
              servername: "node.example",
              ca: certPem,
              headers: { Host: "node.example" },
              timeout: 3000,
            },
            (response) => {
              const chunks = [];
              response.on("data", (chunk) => chunks.push(chunk));
              response.on("end", () =>
                resolve({
                  status: response.statusCode,
                  body: Buffer.concat(chunks).toString(),
                }),
              );
              response.on("error", reject);
            },
          );
          request.on("timeout", () =>
            request.destroy(new Error("HTTPS timeout")),
          );
          request.on("error", reject);
        });
      await runtime.website(secureSite);
      assert.deepEqual(await getSecure(), {
        status: 200,
        body: "static-website-ok",
      });
      const redirect = await fetch(`http://127.0.0.1:${port}/hello?name=test`, {
        headers: { Host: "node.example" },
        redirect: "manual",
        signal: AbortSignal.timeout(3000),
      });
      assert.equal(redirect.status, 308);
      assert.equal(
        redirect.headers.get("location"),
        `https://node.example:${secureSite.httpsPort}/hello?name=test`,
      );
      await assert.rejects(() =>
        runtime.website({
          ...secureSite,
          deployment: 5,
          certificate: { certPem: "invalid replacement", keyPem },
        }),
      );
      assert.deepEqual(
        await getSecure(),
        { status: 200, body: "static-website-ok" },
        "Failed certificate replacement must retain the active certificate",
      );
      const proxy = {
        ...site,
        deployment: 6,
        version: 4,
        type: "proxy",
        target: `http://127.0.0.1:${upstream.address().port}`,
      };
      await runtime.website(proxy);
      assert.equal(await get(), "proxy:/:0");
      const posted = await fetch(`http://127.0.0.1:${port}/upload`, {
        method: "POST",
        body: "x".repeat(131072),
        signal: AbortSignal.timeout(3000),
      });
      assert.equal(
        await posted.text(),
        "proxy:/upload:131072",
        "Unprivileged workers must be able to buffer large proxy requests",
      );
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/socket`);
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error("WebSocket timeout"));
        }, 5000);
        ws.onerror = () => {
          clearTimeout(timer);
          reject(new Error("WebSocket failed"));
        };
        ws.onmessage = (e) => {
          clearTimeout(timer);
          assert.equal(e.data, "websocket-ok");
          ws.close();
          resolve();
        };
      });
      await pause(50);
      assert.match((await runtime.websiteLog(id)).log, /upload/);
      await assert.rejects(() => runtime.websiteLog("../credentials"));
      await runtime.stop("nginx");
      await writeFile(
        join(runtime.directory, "nginx", "nginx.conf"),
        "interrupted uncommitted configuration",
      );
      const recovered = new Runtime(runtime.directory);
      await recovered.init();
      recovered.binary = runtime.binary;
      try {
        await recovered.start("nginx");
        assert.equal(
          await get(),
          "proxy:/:0",
          "Restart must restore the last durable website configuration after interrupted activation",
        );
      } finally {
        await recovered.stopAll();
      }
      await runtime.start("nginx");
      const start = runtime.start.bind(runtime);
      let failOnce = true;
      runtime.start = async (service) => {
        if (failOnce) {
          failOnce = false;
          throw new Error("Injected startup failure");
        }
        return start(service);
      };
      await assert.rejects(
        () =>
          runtime.website({
            ...proxy,
            deployment: 7,
            target: `${proxy.target}/changed`,
          }),
        /Injected/,
      );
      assert.equal(
        await get(),
        "proxy:/:0",
        "Failed activation must restore the last serving configuration",
      );
      await runtime.website({ ...proxy, deployment: 8, remove: true });
      assert.equal(runtime.children.has("nginx"), false);
      assert.equal(
        await readFile(join(root, "index.html"), "utf8"),
        "static-website-ok",
      );
      const restarted = new Runtime(runtime.directory);
      await restarted.init();
      await assert.rejects(() => restarted.website(proxy), /Stale/);
      await assert.rejects(() => get());
    } finally {
      await runtime.stopAll();
      for (const socket of sockets) socket.destroy();
      await new Promise((r) => upstream.close(r));
    }
  },
);
