import { Button, Input } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import type { TTerminalInput } from "@nodify/contract";
import { instance } from "@shared/api/axios";
import "@xterm/xterm/css/xterm.css";

type Session = {
  id: string;
  operationId: string;
  state: string;
  expiresAt: string;
};
const reasons: Record<string, string> = {
  closed: "会话已结束",
  expired: "会话已到期",
  idle: "页面失联，会话已结束",
  disconnected: "Agent 失联，会话已结束",
  "helper-failed": "终端启动或运行失败",
  "output-limit": "输出已达到会话上限，请开启新会话",
};
const request = async (
  serverId: string,
  path: string,
  method = "GET",
  data?: unknown,
) =>
  (
    await instance.request({
      url: `/api/servers/${serverId}/terminal-sessions${path}`,
      method,
      data,
      timeout: 8000,
    })
  ).data.response;
const message = (e: any) =>
  e.response?.data?.message ||
  "终端暂时无法同步。输入保留在本页，将按原顺序重试；持续失联会关闭会话。";

export function InteractiveTerminal({
  serverId,
  available,
}: {
  serverId: string;
  available: boolean;
}) {
  const [session, setSession] = useState<Session | null>(null),
    [state, setState] = useState("idle"),
    [error, setError] = useState(""),
    [inputError, setInputError] = useState(""),
    [text, setText] = useState(""),
    [reason, setReason] = useState("");
  const host = useRef<HTMLDivElement>(null),
    terminal = useRef<Terminal | null>(null),
    phase = useRef(state),
    pendingId = useRef<string | null>(null);
  const enqueue = useRef<
    (
      value:
        | Omit<Extract<TTerminalInput, { type: "input" }>, "sequence">
        | Omit<Extract<TTerminalInput, { type: "resize" }>, "sequence">,
    ) => boolean
  >(() => false);
  phase.current = state;
  const open = async () => {
    setState("opening");
    setError("");
    setInputError("");
    setReason("");
    pendingId.current ||= crypto.randomUUID();
    try {
      const value = await request(serverId, "", "POST", {
        requestId: pendingId.current,
        cols: 80,
        rows: 24,
        minutes: 10,
      });
      setSession(value);
      setState(value.state);
      pendingId.current = null;
    } catch (e) {
      setError(message(e));
      setState("idle");
    }
  };
  const close = async () => {
    if (!session) return;
    try {
      await request(serverId, `/${session.id}`, "DELETE");
      setState("closing");
      setReason("closed");
      setError("");
    } catch (e) {
      setError(message(e));
    }
  };
  useEffect(() => {
    if (!session || !host.current) return;
    let disposed = false,
      term: Terminal | undefined,
      observer: ResizeObserver | undefined,
      timer: ReturnType<typeof setTimeout>,
      resizeTimer: ReturnType<typeof setTimeout>;
    let resizeNotify = () => {};
    let sequence = 0,
      cursor = 0,
      queue: TTerminalInput[] = [],
      queueBytes = 0;
    enqueue.current = (value) => {
      if (disposed || phase.current !== "running") return false;
      if (
        value.type === "input" &&
        new TextEncoder().encode(value.data).length > 16384
      ) {
        setInputError("单次输入最多 16 KiB，请缩短后重试。");
        return false;
      }
      const size = JSON.stringify(value).length;
      if (queue.length >= 100 || queueBytes + size > 32000) {
        setInputError("输入队列已满，请等待同步后重试。");
        return false;
      }
      queue.push({ ...value, sequence: ++sequence } as TTerminalInput);
      setInputError("");
      queueBytes += size;
      return true;
    };
    const run = async () => {
      if (disposed) return;
      try {
        // Keep a failed frame with the same sequence: retries must not run input twice.
        for (let sent = 0; queue.length && sent < 16 && !disposed; sent++) {
          await request(serverId, `/${session.id}/input`, "POST", queue[0]);
          queue.shift();
          queueBytes = queue.reduce((n, f) => n + JSON.stringify(f).length, 0);
        }
        const value = await request(serverId, `/${session.id}?after=${cursor}`);
        if (disposed) return;
        for (const frame of value.output) {
          if (frame.sequence <= cursor) continue;
          term?.write(
            Uint8Array.from(atob(frame.data), (c) => c.charCodeAt(0)),
          );
          cursor = frame.sequence;
        }
        const newlyRunning =
          phase.current !== "running" && value.state === "running";
        phase.current = value.state;
        setState(value.state);
        setReason(value.reason);
        setError("");
        if (newlyRunning) resizeNotify();
        if (term) term.options.disableStdin = value.state !== "running";
        if (["closed", "failed"].includes(value.state) && !value.output.length)
          return;
      } catch (e) {
        if (disposed) return;
        setError(message(e));
        // A final-state input rejection must not block retrieving the session's last output.
        if ((e as any).response?.status === 409) {
          const current = await request(
            serverId,
            `/${session.id}?after=${cursor}`,
          ).catch(() => null);
          if (current && ["closed", "failed"].includes(current.state)) {
            queue = [];
            queueBytes = 0;
          }
        }
      }
      if (!disposed) timer = setTimeout(run, 300);
    };
    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed || !host.current) return;
      term = new Terminal({
        cols: 80,
        rows: 24,
        scrollback: 2000,
        fontSize: 13,
        cursorBlink: true,
        disableStdin: true,
        screenReaderMode: true,
        theme: { background: "#101827", foreground: "#e5edf8" },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host.current);
      terminal.current = term;
      term.onData((data) => {
        if (data.length <= 8192) enqueue.current({ type: "input", data });
        else setInputError("单次粘贴请控制在 8,192 个字符以内。");
      });
      let lastSize = "";
      const resize = () => {
        if (!term || !host.current?.clientWidth) return;
        fit.fit();
        const cols = Math.max(20, Math.min(400, term.cols)),
          rows = Math.max(5, Math.min(200, term.rows)),
          key = `${cols}:${rows}`;
        if (lastSize !== key && enqueue.current({ type: "resize", cols, rows }))
          lastSize = key;
      };
      resizeNotify = resize;
      observer = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(resize, 150);
      });
      observer.observe(host.current);
      term.onResize(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(resize, 150);
      });
      fit.fit();
      await run();
      resize();
      term.focus();
    })().catch((e) => {
      if (!disposed) setError(String(e));
    });
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(resizeTimer);
      observer?.disconnect();
      term?.dispose();
      terminal.current = null;
      enqueue.current = () => false;
      void request(serverId, `/${session.id}`, "DELETE").catch(() => {});
    };
  }, [serverId, session?.id]);
  const active = ["opening", "pending", "running", "closing"].includes(state);
  return (
    <section className="nd-stack">
      <div className="nd-row">
        <h3>交互终端</h3>
        <Button isDisabled={active || !available} onPress={() => void open()}>
          {state === "opening"
            ? "正在开启…"
            : session
              ? "开启新会话"
              : "开启终端"}
        </Button>
      </div>
      <p className="nd-muted">
        以 Agent 的系统身份运行 Bash，目录和前台程序会保留在本次会话中。每次最长
        10 分钟，输出最多 1 MiB；页面失联 30
        秒后关闭。输入和输出不显示在普通任务日志中。
      </p>
      {!available && (
        <p className="nd-muted">
          等待在线 Agent 提供 PTY 能力；旧版 Agent 需要升级。
        </p>
      )}
      {session && (
        <>
          <p role="status">
            {state === "pending"
              ? "等待 Agent 开启终端"
              : state === "closing"
                ? "正在关闭终端"
                : state === "running"
                  ? error
                    ? "连接中断，正在重试"
                    : "已连接"
                  : reasons[reason] || "会话已结束"}{" "}
            · 到期 {new Date(session.expiresAt).toLocaleTimeString()}
          </p>
          <div ref={host} className="nd-terminal" aria-label="服务器交互终端" />
          <div className="nd-row">
            <Button
              variant="secondary"
              isDisabled={state !== "running"}
              onPress={() => {
                enqueue.current({ type: "input", data: "\x03" });
                terminal.current?.focus();
              }}
            >
              Ctrl+C
            </Button>
            <Button
              variant="secondary"
              isDisabled={state !== "running"}
              onPress={() => {
                enqueue.current({ type: "input", data: "\t" });
                terminal.current?.focus();
              }}
            >
              Tab
            </Button>
            <Button
              variant="danger-soft"
              isDisabled={!active}
              onPress={() => void close()}
            >
              关闭会话
            </Button>
          </div>
          <form
            className="nd-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (enqueue.current({ type: "input", data: text + "\r" }))
                setText("");
            }}
          >
            <Input
              aria-label="终端输入"
              value={text}
              maxLength={8191}
              onChange={(e) => setText(e.target.value)}
              disabled={state !== "running"}
            />
            <Button type="submit" isDisabled={state !== "running"}>
              发送输入
            </Button>
          </form>
        </>
      )}
      {error && (
        <p role="alert" className="nd-error">
          {String(error)}
        </p>
      )}
      {inputError && (
        <p role="alert" className="nd-error">
          {inputError}
        </p>
      )}
    </section>
  );
}
