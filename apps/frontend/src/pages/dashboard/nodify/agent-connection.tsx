import { Button, Card } from "@heroui/react";
import { useEffect, useState } from "react";
import {
  AgentConnectionInput,
  DirectAgentToken,
  AgentConnectionMode,
} from "@nodify/contract";
import { instance } from "@shared/api/axios";
import { Choice, Field } from "./editor-fields";

type Connection = {
  version: number;
  enabled: boolean;
  endpoint: string;
  configured: boolean;
  lastContactAt: string | null;
  lastError: string;
};
export function AgentConnection({ server }: { server: Record<string, any> }) {
  const [saved, setSaved] = useState<Connection | null>(null),
    [draft, setDraft] = useState<Connection | null>(null);
  const [token, setToken] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [statusError, setStatusError] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [copyMode, setCopyMode] = useState("auto");
  const request = async (data?: unknown) =>
    (
      await instance.request({
        url: `/api/servers/${server.id}/connection`,
        method: data ? "PUT" : "GET",
        data,
        timeout: 15000,
      })
    ).data.response as Connection;
  const fail = (e: any) =>
    setError(e.response?.data?.message || "连接配置请求失败，请检查网络后重试");
  async function load() {
    setBusy(true);
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const value = await request();
      setSaved(value);
      setDraft(value);
      setToken("");
      setStatusError(false);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [server.id]);
  useEffect(() => {
    let disposed = false,
      running = false;
    const timer = setInterval(() => {
      if (running) return;
      running = true;
      void request()
        .then((value) => {
          if (!disposed) {
            setSaved(value);
            setStatusError(false);
          }
        })
        .catch(() => {
          if (!disposed) setStatusError(true);
        })
        .finally(() => {
          running = false;
        });
    }, 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [server.id]);
  async function save() {
    if (!draft) return;
    const parsed = AgentConnectionInput.safeParse({
      version: draft.version,
      enabled: draft.enabled,
      endpoint: draft.endpoint,
      ...(token ? { token } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join("；"));
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = await request(parsed.data);
      setSaved(value);
      setDraft(value);
      setToken("");
      setNotice("配置已保存，连接状态以认证后的 Agent 通信为准。");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  const current = statusError
    ? "无法刷新连接状态"
    : !saved
      ? "尚未读取连接状态"
      : saved.enabled
        ? saved.lastContactAt &&
          Date.now() - Date.parse(saved.lastContactAt) < 40000
          ? "直连通信正常"
          : server.metrics?.connectionMode === "auto" &&
              ["ws", "pull"].includes(server.metrics?.connectionTransport) &&
              Date.now() - Date.parse(server.lastSeenAt || "") < 45000
            ? "直连待用（当前使用其他通道）"
            : "等待直连 Agent"
        : "主控未启用直连";
  return (
    <Card>
      <Card.Header>
        <Card.Title>Agent 连接</Card.Title>
      </Card.Header>
      <Card.Content className="nd-stack">
        <p role="status">
          {current} · 最近心跳通道：
          {(
            {
              ws: "WebSocket",
              pull: "HTTPS 拉取",
              direct: "HTTPS 直连",
            } as Record<string, string>
          )[server.metrics?.connectionTransport] || "尚未上报"}
          {server.metrics?.connectionMode &&
            ` · 策略：${({ auto: "自动", ws: "仅 WebSocket", pull: "仅拉取", direct: "仅直连" } as Record<string, string>)[server.metrics.connectionMode] || "未知"}`}
        </p>
        {saved?.lastError && <p className="nd-error">{saved.lastError}</p>}
        <p className="nd-muted">
          默认由 Agent 主动连接。直连由主控访问 Agent 的 HTTPS 接口，需先在
          Agent 配置独立凭据和监听，再启用下方连接。首次注册仍需 Agent
          访问主控一次。
        </p>
        {!draft && (
          <Button isDisabled={busy} onPress={() => void load()}>
            {busy ? "正在加载…" : "重新加载"}
          </Button>
        )}
        {draft && (
          <fieldset disabled={busy} className="nd-stack">
            <Choice
              label="主控直连"
              value={draft.enabled ? "on" : "off"}
              options={[
                ["off", "不启用"],
                ["on", "启用 HTTPS 直连"],
              ]}
              change={(value) =>
                setDraft({ ...draft, enabled: value === "on" })
              }
            />
            <Field
              label="Agent HTTPS 地址"
              value={draft.endpoint}
              change={(endpoint) => setDraft({ ...draft, endpoint })}
            />
            <Field
              label={
                saved?.configured ? "更换直连凭据（留空保留）" : "直连凭据"
              }
              type="password"
              value={token}
              change={setToken}
            />
            <div className="nd-row">
              <Button
                variant="secondary"
                onPress={() => {
                  setToken(
                    Array.from(
                      crypto.getRandomValues(new Uint8Array(32)),
                      (b) => b.toString(16).padStart(2, "0"),
                    ).join(""),
                  );
                  setNotice("已生成新凭据，请先复制 Agent 配置。");
                }}
              >
                生成凭据
              </Button>
            </div>
            <Choice
              label="复制配置的 Agent 策略"
              value={copyMode}
              options={[
                ["auto", "自动：WebSocket → 直连 → 拉取"],
                ["ws", "仅 WebSocket"],
                ["pull", "仅 HTTPS 拉取"],
                ["direct", "仅 HTTPS 直连"],
              ]}
              change={(value) => setCopyMode(AgentConnectionMode.parse(value))}
            />
            <p className="nd-muted">
              策略仅用于生成下面的配置，复制后需在 Agent
              上应用并重启。自动模式只有配置了直连凭据和监听才会尝试直连；没有直连配置时直接回退到拉取。
            </p>
            <div className="nd-row">
              <Button
                variant="secondary"
                isDisabled={
                  copyMode === "direct" && !token && !saved?.configured
                }
                onPress={() => {
                  const parsed = token
                    ? DirectAgentToken.safeParse(token)
                    : null;
                  if (parsed && !parsed.success) {
                    setError(parsed.error.issues[0].message);
                    return;
                  }
                  const listener =
                    token && ["auto", "direct"].includes(copyMode)
                      ? `NODIFY_DIRECT_TOKEN=${token}\nNODIFY_DIRECT_HOST=127.0.0.1\nNODIFY_DIRECT_PORT=23889\n`
                      : "";
                  void navigator.clipboard
                    .writeText(
                      `NODIFY_CONNECTION_MODE=${copyMode}\n${listener}`,
                    )
                    .then(() =>
                      setNotice(
                        listener
                          ? "已复制策略和直连配置。回环监听需要 HTTPS 反向代理。"
                          : "已复制策略。未包含新的直连凭据；如需直连，请保留或另行配置 Agent 的凭据与监听。",
                      ),
                    )
                    .catch(() => setError("复制失败，请允许剪贴板访问后重试"));
                }}
              >
                复制 Agent 配置
              </Button>
            </div>
            <p className="nd-muted">
              裸机写入 /etc/nodify/agent.env 后重启专属服务；Docker
              添加环境变量后重建 Agent 容器。也可设置 NODIFY_DIRECT_CERT /
              NODIFY_DIRECT_KEY 使用 Agent 自身
              TLS，公开监听必须配置证书。自动模式恢复后优先使用 WebSocket；
              如需关闭直连监听，请改为 ws 或 pull，或从 auto
              配置中移除直连凭据。
            </p>
            <div className="nd-row">
              <Button isDisabled={busy} onPress={() => void save()}>
                {busy ? (loading ? "正在载入…" : "正在保存…") : "保存连接配置"}
              </Button>
              <Button
                variant="secondary"
                isDisabled={busy}
                onPress={() => void load()}
              >
                重新载入并放弃修改
              </Button>
            </div>
          </fieldset>
        )}
        {notice && <p role="status">{notice}</p>}
        {error && (
          <p role="alert" className="nd-error">
            {String(error)}
          </p>
        )}
      </Card.Content>
    </Card>
  );
}
