import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  symlink,
  link,
  stat,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { websiteFiles } from "../apps/node/agent/website-files.mjs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "nodify-site-files-"));
  const root = join(directory, "public");
  await mkdir(root);
  const id = randomUUID(),
    site = { id, type: "static", target: root, deployment: 4 };
  const run = (action, path, extra = {}) =>
    websiteFiles(
      { [id]: site },
      { websiteId: id, deployment: 4, action, path, ...extra },
    );
  return { directory, root, id, site, run };
}
test("website files: actual writes, optimistic conflict, binary reads, rename and safe deletion", async () => {
  const { root, run, site, id } = await fixture();
  const data = Buffer.from([0, 1, 2, 255]).toString("base64");
  await run("write", "文件.bin", { data, expected: null });
  const opened = await run("read", "文件.bin");
  assert.equal(opened.data, data);
  if (process.platform === "linux") {
    const previousMask = process.umask(0o077);
    try {
      await run("mkdir", "permissions");
      await run("write", "permissions/readable.txt", { data, expected: null });
      assert.equal((await stat(join(root, "permissions"))).mode & 0o777, 0o755);
      assert.equal(
        (await stat(join(root, "permissions/readable.txt"))).mode & 0o777,
        0o644,
      );
      await chmod(join(root, "permissions/readable.txt"), 0o600);
      const before = await stat(join(root, "permissions/readable.txt"));
      await run("write", "permissions/readable.txt", {
        data,
        expected: opened.etag,
      });
      const after = await stat(join(root, "permissions/readable.txt"));
      assert.equal(after.mode & 0o777, 0o600);
      assert.equal(after.uid, before.uid);
      assert.equal(after.gid, before.gid);
      await run("remove", "permissions/readable.txt", {
        expected: opened.etag,
      });
      const folder = (await run("list", "")).entries.find(
        (e) => e.name === "permissions",
      );
      await run("remove", "permissions", { expected: folder.etag });
    } finally {
      process.umask(previousMask);
    }
  }
  await assert.rejects(() =>
    run("write", "文件.bin", { data, expected: null }),
  );
  await writeFile(join(root, "文件.bin"), "external edit");
  await assert.rejects(() =>
    run("write", "文件.bin", { data, expected: opened.etag }),
  );
  assert.equal(await readFile(join(root, "文件.bin"), "utf8"), "external edit");
  const current = await run("read", "文件.bin");
  await run("write", "文件.bin", { data, expected: current.etag });
  await run("mkdir", "assets");
  await run("rename", "文件.bin", {
    destination: "assets/renamed.bin",
    expected: opened.etag,
  });
  assert.equal((await run("read", "assets/renamed.bin")).data, data);
  await writeFile(join(root, "exists"), "keep");
  await assert.rejects(() =>
    run("rename", "assets/renamed.bin", {
      destination: "exists",
      expected: opened.etag,
    }),
  );
  assert.equal(await readFile(join(root, "exists"), "utf8"), "keep");
  const list = await run("list", "");
  const directory = list.entries.find((e) => e.name === "assets");
  await assert.rejects(() =>
    run("remove", "assets", { expected: directory.etag }),
  );
  await run("remove", "assets/renamed.bin", { expected: opened.etag });
  const fresh = (await run("list", "")).entries.find(
    (e) => e.name === "assets",
  );
  await run("remove", "assets", { expected: fresh.etag });
  assert.deepEqual((await readdir(root)).sort(), ["exists"]);
  await assert.rejects(() =>
    websiteFiles(
      { [id]: site },
      { websiteId: id, deployment: 3, action: "list", path: "" },
    ),
  );
  await assert.rejects(() =>
    run("write", "bad", { data: "not base64", expected: null }),
  );
  await assert.rejects(() =>
    run("write", "big", {
      data: Buffer.alloc(1024 * 1024 + 1).toString("base64"),
      expected: null,
    }),
  );
});
test("website files reject traversal, directory/file symlinks, hard links and root mutation", async () => {
  const { directory, root, run } = await fixture();
  const outside = join(directory, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "secret"), "untouched");
  for (const path of [
    "../outside/secret",
    "/outside/secret",
    "a/../../secret",
    "a\\secret",
    "C:secret",
    ".",
    "",
    ".nodify-secret",
    "a//b",
  ])
    await assert.rejects(() =>
      run("write", path, { data: "", expected: null }),
    );
  await symlink(
    outside,
    join(root, "directory-link"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(() => run("list", "directory-link"));
  await assert.rejects(() =>
    run("write", "directory-link/secret", { data: "", expected: null }),
  );
  if (process.platform !== "win32") {
    await symlink(join(outside, "secret"), join(root, "file-link"));
    await assert.rejects(() => run("read", "file-link"));
  }
  await link(join(outside, "secret"), join(root, "hard-link"));
  await assert.rejects(() => run("read", "hard-link"));
  assert.equal(await readFile(join(outside, "secret"), "utf8"), "untouched");
});
test("website directory pagination preserves names and excludes internal staging", async () => {
  const { root, run } = await fixture();
  await Promise.all(
    Array.from({ length: 203 }, (_, i) =>
      writeFile(join(root, String(i).padStart(3, "0")), String(i)),
    ),
  );
  await writeFile(join(root, ".nodify-interrupted.tmp"), "partial");
  const first = await run("list", "");
  assert.equal(first.entries.length, 200);
  const second = await run("list", "", { after: first.next });
  assert.equal(second.entries.length, 3);
  assert.equal(second.next, null);
  assert.equal(
    new Set([...first.entries, ...second.entries].map((e) => e.name)).size,
    203,
  );
});

test(
  "real Agent retries unacknowledged file content then drops it from its durable journal",
  { timeout: 25000 },
  async () => {
    const { directory, root, site, id } = await fixture();
    const agentDirectory = join(directory, "agent");
    await mkdir(agentDirectory);
    await writeFile(join(root, "index.html"), "agent-file-transfer");
    await writeFile(
      join(agentDirectory, "websites.json"),
      JSON.stringify({ [id]: { ...site, enabled: false } }),
    );
    const operation = {
      id: randomUUID(),
      kind: "website-files",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      payload: {
        websiteId: id,
        deployment: 4,
        action: "read",
        path: "index.html",
      },
    };
    let reports = 0,
      received;
    const server = createServer(async (req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/agent/enroll") {
        res.end(JSON.stringify({ credential: randomUUID() }));
        return;
      }
      if (req.url === "/api/agent/poll") {
        res.end(JSON.stringify({ operations: reports < 2 ? [operation] : [] }));
        return;
      }
      if (req.url === "/api/agent/results") {
        let body = "";
        for await (const chunk of req) body += chunk;
        received = JSON.parse(body);
        reports++;
        res.statusCode = reports === 1 ? 503 : 200;
        res.end("{}");
        return;
      }
      res.statusCode = 403;
      res.end("{}");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("../apps/node/agent/main.mjs", import.meta.url))],
      {
        env: {
          ...process.env,
          NODIFY_AGENT_DATA: agentDirectory,
          NODIFY_PANEL: `http://127.0.0.1:${server.address().port}`,
          NODIFY_ALLOW_HTTP: "1",
          NODIFY_ENROLLMENT: randomUUID(),
        },
        stdio: "ignore",
      },
    );
    const waitFor = async (check) => {
      for (let i = 0; i < 200; i++) {
        if (await check()) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("Agent file acknowledgement timed out");
    };
    try {
      await waitFor(() => reports === 1);
      const snapshot = JSON.parse(
        await readFile(join(agentDirectory, "state.json"), "utf8"),
      );
      assert.equal(
        Buffer.from(
          snapshot.journal[operation.id].result.data,
          "base64",
        ).toString(),
        "agent-file-transfer",
      );
      await waitFor(() => reports === 2);
      assert.equal(
        Buffer.from(received.result.data, "base64").toString(),
        "agent-file-transfer",
      );
      await waitFor(
        async () =>
          JSON.parse(await readFile(join(agentDirectory, "state.json"), "utf8"))
            .journal[operation.id].result.data === undefined,
      );
    } finally {
      const ended = once(child, "exit");
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 4000);
      await ended;
      clearTimeout(timer);
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
