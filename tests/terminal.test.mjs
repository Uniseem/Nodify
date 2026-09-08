import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { ruleFixture } from "./rule-fixture.mjs";
import { TerminalRuntime } from "../apps/node/agent/terminal.mjs";
import { spawn } from "node:child_process";
import { once } from "node:events";
const require = createRequire(import.meta.url);
const {
  TerminalSessions,
} = require("../apps/backend/src/modules/nodify/terminal-sessions.ts");
const {
  TerminalOpen,
  TerminalInput,
} = require("../packages/nodify-contract/index.ts");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const options = () => ({
  requestId: randomUUID(),
  cols: 80,
  rows: 24,
  minutes: 1,
});
async function fixture() {
  const f = await ruleFixture();
  const server = await f.db.nodifyServer.findFirstOrThrow();
  await f.db.nodifyServer.update({
    where: { id: server.id },
    data: { lastSeenAt: new Date(), metrics: { terminalAvailable: true } },
  });
  return { ...f, server, terminals: new TerminalSessions(f.service) };
}
test("terminal sessions enforce scope, idempotent opening/input/output, encrypted contents and bounded lifetimes", async () => {
  const f = await fixture();
  try {
    assert.throws(() => TerminalOpen.parse({ ...options(), cols: 0 }));
    assert.throws(() =>
      TerminalInput.parse({ type: "input", sequence: 0, data: "x" }),
    );
    const input = options(),
      session = await f.terminals.open(f.server.id, input);
    assert.equal((await f.terminals.open(f.server.id, input)).id, session.id);
    assert.equal(
      await f.db.nodifyOperation.count({ where: { kind: "terminal-session" } }),
      1,
    );
    await f.service.complete(
      f.server.id,
      session.operationId,
      "succeeded",
      "",
      { sessionId: session.id },
    );
    const other = await f.service.createServer({
      name: "terminal-other",
      address: "127.0.0.2",
    });
    for (const fn of [
      () => f.terminals.read(other.id, session.id, 0),
      () =>
        f.terminals.input(other.id, session.id, {
          type: "input",
          sequence: 1,
          data: "x",
        }),
      () => f.terminals.close(other.id, session.id),
    ])
      await assert.rejects(fn);
    const frame = {
      id: session.id,
      inputAck: 0,
      state: "running",
      output: [
        { sequence: 1, data: Buffer.from("private-output").toString("base64") },
      ],
    };
    await assert.rejects(() =>
      f.terminals.exchange(other.id, { sessions: [frame] }),
    );
    assert.equal(
      (await f.terminals.exchange(f.server.id, { sessions: [frame] }))
        .sessions[0].outputAck,
      1,
    );
    await f.terminals.exchange(f.server.id, { sessions: [frame] });
    await f.terminals.input(f.server.id, session.id, {
      type: "input",
      sequence: 1,
      data: "private-input\r",
    });
    await f.terminals.input(f.server.id, session.id, {
      type: "input",
      sequence: 1,
      data: "private-input\r",
    });
    await assert.rejects(() =>
      f.terminals.input(f.server.id, session.id, {
        type: "input",
        sequence: 3,
        data: "gap",
      }),
    );
    const sent = await f.terminals.exchange(f.server.id, { sessions: [frame] });
    assert.equal(sent.sessions[0].inputs.length, 1);
    await f.terminals.exchange(f.server.id, {
      sessions: [{ ...frame, inputAck: 1 }],
    });
    const row = await f.db.nodifyTerminalSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    assert.equal(row.outputSequence, 1);
    assert.equal(row.inputAck, 1);
    assert.equal(row.encryptedData.includes("private"), false);
    assert.equal(
      JSON.stringify(await f.service.operations()).includes("private"),
      false,
    );
    assert.equal(
      (await f.terminals.read(f.server.id, session.id, 1)).output.length,
      0,
    );
    await assert.rejects(() => f.terminals.read(f.server.id, session.id, 2));
    await f.terminals.open(f.server.id, options());
    await assert.rejects(
      () => f.terminals.open(f.server.id, options()),
      /两个终端/,
    );
    await f.db.nodifyTerminalSession.update({
      where: { id: session.id },
      data: { clientUntil: new Date(0) },
    });
    assert.equal(
      (await f.terminals.read(f.server.id, session.id, 0)).reason,
      "idle",
    );
    await assert.rejects(() =>
      f.terminals.input(f.server.id, session.id, {
        type: "input",
        sequence: 2,
        data: "late",
      }),
    );
    const retired = await f.terminals.exchange(f.server.id, {
      sessions: [{ ...frame, id: randomUUID() }],
    });
    assert.equal(retired.sessions[0].close, true);
    const stored = await f.db.nodifyTerminalOutput.findMany({
      where: { sessionId: session.id },
    });
    assert.equal(stored.length, 1);
    assert.equal(stored[0].encryptedData.includes(frame.output[0].data), false);
    const overflow = await f.terminals.open(f.server.id, options());
    await f.db.nodifyTerminalSession.update({
      where: { id: overflow.id },
      data: { outputBytes: 1048576 },
    });
    const capped = await f.terminals.exchange(f.server.id, {
      sessions: [{ ...frame, id: overflow.id }],
    });
    assert.equal(capped.sessions[0].discardOutput, true);
    assert.equal(
      (await f.terminals.read(f.server.id, overflow.id, 0)).reason,
      "output-limit",
    );
  } finally {
    await f.db.$disconnect();
  }
});

test(
  "real Linux PTY preserves shell state, resizes, interrupts jobs, retries once and cleans up",
  {
    skip: process.platform !== "linux" || !process.env.NODIFY_TEST_PTY,
    timeout: 45000,
  },
  async () => {
    const f = await fixture(),
      runtime = new TerminalRuntime(f.directory, process.env.NODIFY_TEST_PTY);
    await runtime.init();
    assert.equal(runtime.available, true);
    const session = await f.terminals.open(f.server.id, options());
    let sequence = 0;
    const exchange = async (repeat = false) => {
      const snapshot = runtime.snapshot();
      const reply = await f.terminals.exchange(f.server.id, snapshot);
      if (repeat)
        assert.deepEqual(
          await f.terminals.exchange(f.server.id, snapshot),
          reply,
        );
      runtime.accept(reply);
    };
    const input = async (data) => {
      const frame = { type: "input", sequence: ++sequence, data };
      await f.terminals.input(f.server.id, session.id, frame);
      await f.terminals.input(f.server.id, session.id, frame);
      await exchange();
    };
    const output = async () =>
      Buffer.concat(
        (await f.terminals.read(f.server.id, session.id, 0)).output.map((f) =>
          Buffer.from(f.data, "base64"),
        ),
      ).toString();
    const wait = async (predicate) => {
      const until = Date.now() + 10000;
      while (Date.now() < until) {
        await exchange();
        if (await predicate()) return;
        await delay(50);
      }
      throw Error("PTY condition timed out: " + (await output()));
    };
    try {
      const op = await f.db.nodifyOperation.findUniqueOrThrow({
        where: { id: session.operationId },
      });
      await runtime.open(JSON.parse(f.service.box.open(op.payload)));
      await f.service.complete(f.server.id, op.id, "succeeded", "", {
        sessionId: session.id,
      });
      await wait(async () => /Nodify:/.test(await output()));
      await input("stty -echo; export NODIFY_QA_STATE=kept; cd /tmp\r");
      await input('printf \'STATE=%s DIR=%s\\n\' "$NODIFY_QA_STATE" "$PWD"\r');
      await wait(async () => /STATE=kept DIR=\/tmp/.test(await output()));
      await f.terminals.input(f.server.id, session.id, {
        type: "resize",
        sequence: ++sequence,
        cols: 101,
        rows: 37,
      });
      await exchange();
      await input("stty size\r");
      await wait(async () => /37 101/.test(await output()));
      const file = join(f.directory, "once.txt");
      await input(`printf x >> '${file}'\r`);
      await wait(
        async () => (await readFile(file, "utf8").catch(() => "")) === "x",
      );
      await exchange(true);
      assert.equal(await readFile(file, "utf8"), "x");
      await input("sleep 30\r");
      await delay(150);
      await input("\x03");
      await input("printf 'INTERRUPTED\\n'\r");
      await wait(async () => /INTERRUPTED/.test(await output()));
      await input("printf '\\033[31m中文\\033[0m\\n'\r");
      await wait(async () => /中文/.test(await output()));
      const pidfile = join(f.directory, "job.pid");
      await input(`sleep 120 & printf '%s' "$!" > '${pidfile}'\r`);
      await wait(
        async () => !!(await readFile(pidfile, "utf8").catch(() => "")),
      );
      const pid = Number(await readFile(pidfile, "utf8"));
      await f.terminals.close(f.server.id, session.id);
      await exchange();
      await wait(async () => runtime.sessions.size === 0);
      const status = await readFile(`/proc/${pid}/stat`, "utf8").catch(
        () => "",
      );
      assert.ok(!status, "session job was not reaped");
      const saved = await f.db.nodifyTerminalSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      assert.equal(saved.encryptedData.includes("INTERRUPTED"), false);
    } finally {
      await runtime.stopAll();
      await f.db.$disconnect();
    }
  },
);

test(
  "real Agent terminal uses authenticated WebSocket and HTTP fallback, hides content and cleans up on exit",
  {
    skip: process.platform !== "linux" || !process.env.NODIFY_TEST_PTY,
    timeout: 90000,
  },
  async () => {
    const { Module } = require("../apps/backend/node_modules/@nestjs/common");
    const {
      NestFactory,
    } = require("../apps/backend/node_modules/@nestjs/core");
    const {
      NodifyService,
    } = require("../apps/backend/src/modules/nodify/nodify.service.ts");
    const {
      NodifyAgentController,
    } = require("../apps/backend/src/modules/nodify/nodify.controller.ts");
    const {
      NodifyAgentGateway,
    } = require("../apps/backend/src/modules/nodify/agent.gateway.ts");
    for (const mode of ["ws", "http"]) {
      const f = await fixture();
      let app,
        agent,
        log = "";
      try {
        class TestModule {}
        Module({
          controllers: [NodifyAgentController],
          providers: [
            { provide: NodifyService, useValue: f.service },
            ...(mode === "ws" ? [NodifyAgentGateway] : []),
          ],
        })(TestModule);
        app = await NestFactory.create(TestModule, { logger: false });
        app.setGlobalPrefix("api");
        await app.listen(0, "127.0.0.1");
        const url = await app.getUrl(),
          server = await f.service.createServer({
            name: "pty-" + mode,
            address: "127.0.0.3",
          }),
          directory = join(f.directory, "agent");
        agent = spawn(
          process.execPath,
          [new URL("../apps/node/agent/main.mjs", import.meta.url).pathname],
          {
            env: {
              ...process.env,
              NODIFY_AGENT_DATA: directory,
              NODIFY_PANEL: url,
              NODIFY_ALLOW_HTTP: "1",
              NODIFY_ENROLLMENT: server.token,
              NODIFY_PTY_BINARY: process.env.NODIFY_TEST_PTY,
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        agent.stdout.on("data", (b) => (log = (log + b).slice(-16000)));
        agent.stderr.on("data", (b) => (log = (log + b).slice(-16000)));
        const wait = async (predicate) => {
          const until = Date.now() + 25000;
          while (Date.now() < until) {
            assert.equal(agent.exitCode, null, log);
            if (await predicate()) return;
            await delay(100);
          }
          throw Error("Agent PTY timed out: " + log);
        };
        await wait(
          async () =>
            (
              await f.db.nodifyServer.findUniqueOrThrow({
                where: { id: server.id },
              })
            ).metrics.terminalAvailable === true,
        );
        const session = await f.terminals.open(server.id, options());
        const output = async () =>
          Buffer.concat(
            (await f.terminals.read(server.id, session.id, 0)).output.map((f) =>
              Buffer.from(f.data, "base64"),
            ),
          ).toString();
        await wait(
          async () =>
            (await f.terminals.read(server.id, session.id, 0)).state ===
            "running",
        );
        await f.terminals.input(server.id, session.id, {
          type: "input",
          sequence: 1,
          data:
            "stty -echo; printf 'REAL-PTY-%s ENV=%s\\n' '" +
            mode +
            '\' "${NODIFY_ENROLLMENT-unset}"\r',
        });
        await wait(async () =>
          (await output()).includes("REAL-PTY-" + mode + " ENV=unset"),
        );
        const metadata = await f.service.operations(server.id);
        assert.equal(JSON.stringify(metadata).includes("REAL-PTY-"), false);
        assert.equal(log.includes("REAL-PTY-"), false);
        const stranger = await f.service.createServer({
          name: "wrong-" + mode,
          address: "127.0.0.2",
        });
        const credentials = await f.service.enroll(
          stranger.token,
          "0.3.0",
          "test",
        );
        const denied = await fetch(url + "/api/agent/terminal-exchange", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + credentials.credential,
          },
          body: JSON.stringify({
            sessions: [
              { id: session.id, state: "running", inputAck: 0, output: [] },
            ],
          }),
        });
        assert.equal(denied.status, 404);
        const unauthorized = await fetch(url + "/api/agent/terminal-exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: '{"sessions":[]}',
        });
        assert.equal(unauthorized.status, 401);
        const pidfile = join(directory, "foreground.pid");
        await f.terminals.input(server.id, session.id, {
          type: "input",
          sequence: 2,
          data: `sleep 120 & printf '%s' "$!" > '${pidfile}'\r`,
        });
        await wait(
          async () => !!(await readFile(pidfile, "utf8").catch(() => "")),
        );
        const pid = Number(await readFile(pidfile, "utf8"));
        const ended = once(agent, "exit");
        agent.kill(mode === "ws" ? "SIGKILL" : "SIGTERM");
        await ended;
        const until = Date.now() + 5000;
        let live = true;
        while (Date.now() < until) {
          const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(
            () => "",
          );
          live = !!stat;
          if (!live) break;
          await delay(100);
        }
        assert.equal(live, false, "PTY job survived Agent exit");
        await f.db.nodifyTerminalSession.update({
          where: { id: session.id },
          data: { agentSeenAt: new Date(Date.now() - 31000) },
        });
        assert.equal(
          (await f.terminals.read(server.id, session.id, 0)).state,
          "closed",
        );
      } finally {
        if (agent?.exitCode === null && agent?.signalCode === null) {
          const ended = once(agent, "exit");
          agent.kill("SIGKILL");
          await ended;
        }
        if (app) await app.close();
        await f.db.$disconnect();
      }
    }
  },
);
