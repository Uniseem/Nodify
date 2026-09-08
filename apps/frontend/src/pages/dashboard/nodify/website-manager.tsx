import { Button, Card } from "@heroui/react";
import { WebsiteInput } from "@nodify/contract";
import { useCallback, useEffect, useState } from "react";
import { instance } from "@shared/api/axios";
import { Choice, Field } from "./editor-fields";
import { WebsiteFileManager } from "./website-files";
import { websiteError as message } from "./website-error";

type Row = Record<string, any>;
const request = async (
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
) =>
  (await instance.request({ url: `/api/${path}`, method, data: body })).data
    .response;
const stateNames: Record<string, string> = {
  draft: "草稿",
  applied: "已应用",
  pending: "等待 Agent 确认",
  deleting: "正在删除",
  failed: "失败",
  queued: "排队中",
  running: "执行中",
  succeeded: "成功",
};
const emptySite = {
  name: "",
  domain: "",
  aliases: [] as string[],
  type: "static",
  target: "",
  certificateId: undefined,
  enabled: true,
  httpPort: 80,
  httpsPort: 443,
  redirectHttps: false,
  websocket: true,
};

export function WebsiteForm({
  initial,
  certificates,
  save,
  cancel,
}: {
  initial: Row;
  certificates: Row[];
  save: (input: unknown) => Promise<void>;
  cancel: () => void;
}) {
  const [value, setValue] = useState({ ...emptySite, ...initial }),
    [aliases, setAliases] = useState((initial.aliases || []).join(", ")),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const patch = (fields: Row) => {
    setValue((v) => ({ ...v, ...fields }));
    setError("");
  };
  return (
    <form
      className="nd-entry-form nd-stack"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        void (async () => {
          try {
            await save(
              WebsiteInput.parse({
                ...value,
                aliases: aliases.split(/[,，\s]+/).filter(Boolean),
              }),
            );
          } catch (e) {
            setError(message(e));
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <div className="nd-fields" inert={busy}>
        <Field
          label="网站名称"
          value={value.name}
          change={(name) => patch({ name })}
        />
        <Field
          label="网站域名"
          value={value.domain}
          change={(domain) => patch({ domain })}
        />
        <Choice
          label="网站类型"
          value={value.type}
          options={[
            ["static", "静态目录"],
            ["proxy", "反向代理"],
          ]}
          change={(type) => patch({ type, target: "" })}
        />
        <Field
          label="其他域名（逗号分隔）"
          value={aliases}
          change={setAliases}
        />
        <Field
          label={
            value.type === "static" ? "服务器绝对目录" : "上游 HTTP/HTTPS URL"
          }
          value={value.target}
          change={(target) => patch({ target })}
        />
        <Field
          label="HTTP 端口"
          type="number"
          value={value.httpPort}
          change={(httpPort) => patch({ httpPort: Number(httpPort) })}
        />
        <Choice
          label="网站证书"
          value={value.certificateId || "none"}
          options={[
            ["none", "仅 HTTP"],
            ...certificates.map((c) => [c.id, c.name] as [string, string]),
          ]}
          change={(certificateId) =>
            patch({
              certificateId:
                certificateId === "none" ? undefined : certificateId,
              ...(certificateId === "none" ? { redirectHttps: false } : {}),
            })
          }
        />
        {value.certificateId && (
          <>
            <Field
              label="HTTPS 端口"
              type="number"
              value={value.httpsPort}
              change={(httpsPort) => patch({ httpsPort: Number(httpsPort) })}
            />
            <label>
              <input
                type="checkbox"
                checked={value.redirectHttps}
                onChange={(e) => patch({ redirectHttps: e.target.checked })}
              />
              HTTP 自动跳转 HTTPS
            </label>
          </>
        )}
        {value.type === "proxy" && (
          <label>
            <input
              type="checkbox"
              checked={value.websocket}
              onChange={(e) => patch({ websocket: e.target.checked })}
            />
            支持 WebSocket 转发
          </label>
        )}
        <label>
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          启用网站
        </label>
        <p className="nd-muted nd-full">
          {value.type === "static"
            ? "静态目录位于服务器上，需要 Nginx 读取权限。"
            : "上游地址需要服务器能够访问，支持 HTTP、HTTPS 和 WebSocket。"}
          保存只创建草稿；发布时检查配置和端口，Agent 确认后才标记已应用。
        </p>
      </div>
      {error && (
        <p className="nd-error" role="alert">
          {String(error)}
        </p>
      )}
      <div className="nd-row">
        <Button type="submit" isDisabled={busy}>
          {busy ? "正在保存…" : "保存网站草稿"}
        </Button>
        <Button variant="secondary" isDisabled={busy} onPress={cancel}>
          取消网站编辑
        </Button>
      </div>
    </form>
  );
}

export function WebsiteManager({
  serverId,
  certificates,
}: {
  serverId: string;
  certificates: Row[];
}) {
  const [sites, setSites] = useState<Row[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [editing, setEditing] = useState<Row | null>(null),
    [files, setFiles] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [removeId, setRemoveId] = useState(""),
    [notice, setNotice] = useState(""),
    [logTask, setLogTask] = useState<Row | null>(null);
  const load = useCallback(async () => {
    try {
      setSites(await request(`servers/${serverId}/websites`));
      setError("");
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, [serverId]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (!logTask || ["succeeded", "failed"].includes(logTask.state)) return;
    let closed = false;
    const poll = async () => {
      try {
        const op = await request(`operations/${logTask.id}`);
        if (!closed) setLogTask(op);
      } catch (e) {
        if (!closed) setError(message(e));
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    return () => {
      closed = true;
      clearInterval(timer);
    };
  }, [logTask?.id, logTask?.state]);
  // The dashboard already owns authenticated operation SSE connections.
  // The local list polling keeps details current without duplicating streams.
  const action = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const publish = (site: Row, version = site.version) =>
    void action(async () => {
      const op = await request(
        `servers/${serverId}/websites/${site.id}/apply`,
        { version },
      );
      setNotice(`已提交网站 v${version}，任务 ${op.id}，等待 Agent 确认。`);
    });
  const logs = (site: Row, logType: string) =>
    void action(async () =>
      setLogTask(
        await request(`servers/${serverId}/actions`, {
          action: "logs",
          service: "nginx",
          websiteId: site.id,
          logType,
        }),
      ),
    );
  return (
    <Card>
      <Card.Header>
        <Card.Title>Nginx 网站</Card.Title>
      </Card.Header>
      <Card.Content className="nd-stack">
        <div className="nd-row">
          <span className="nd-muted">
            只管理 Nodify 网站配置；删除配置不会删除静态文件或上游应用。
          </span>
          <Button
            isDisabled={busy || Boolean(editing) || Boolean(files)}
            onPress={() => setEditing({ config: emptySite })}
          >
            添加网站
          </Button>
          <Button
            variant="tertiary"
            isDisabled={busy}
            onPress={() => void load()}
          >
            刷新网站
          </Button>
        </div>
        {loading && <p role="status">正在加载网站…</p>}
        {error && (
          <p className="nd-error" role="alert">
            {String(error)}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {files && (
          <WebsiteFileManager
            key={files.id}
            site={files}
            serverId={serverId}
            close={() => setFiles(null)}
          />
        )}
        {editing && (
          <WebsiteForm
            key={editing.id || "new"}
            initial={editing.config}
            certificates={certificates}
            cancel={() => setEditing(null)}
            save={async (input) => {
              await request(
                editing.id
                  ? `servers/${serverId}/websites/${editing.id}`
                  : `servers/${serverId}/websites/drafts`,
                input,
                editing.id ? "PUT" : "POST",
              );
              setEditing(null);
              setNotice("网站草稿已保存，请检查后发布。");
              await load();
            }}
          />
        )}
        {!loading && !sites.length && !editing && (
          <p className="nd-empty">还没有网站。可添加静态目录或反向代理。</p>
        )}
        {sites.map((site) => {
          const waiting = ["pending", "deleting"].includes(site.state),
            locked = busy || Boolean(editing) || Boolean(files) || waiting;
          return (
            <div key={site.id} className="nd-engine-entry">
              <div className="nd-row">
                <strong>
                  {site.config.name} · {site.domain}
                </strong>
                <span>{stateNames[site.state] || site.state}</span>
              </div>
              {site.config.aliases?.length > 0 && (
                <p className="nd-muted">
                  其他域名：{site.config.aliases.join("、")}
                </p>
              )}
              <p>
                草稿 v{site.version} · 已应用{" "}
                {site.appliedVersion ? `v${site.appliedVersion}` : "尚无"} ·{" "}
                {site.config.enabled ? "启用" : "禁用"}（草稿）
              </p>
              <p className="nd-muted">
                {site.config.type === "static" ? "静态目录" : "反向代理"}：
                {site.config.target}
              </p>
              {site.appliedConfig && (
                <p className="nd-muted">
                  Agent 已确认：{site.appliedConfig.enabled ? "启用" : "禁用"} ·{" "}
                  {site.appliedConfig.domain} · {site.appliedConfig.target}
                </p>
              )}
              {site.operation && (
                <p role="status">
                  任务 {site.operation.id} ·{" "}
                  {stateNames[site.operation.state] || site.operation.state}
                  {site.operation.message ? `：${site.operation.message}` : ""}
                </p>
              )}
              <div className="nd-row">
                {site.appliedConfig?.type === "static" && (
                  <Button isDisabled={locked} onPress={() => setFiles(site)}>
                    管理网站文件
                  </Button>
                )}
                <Button
                  variant="secondary"
                  isDisabled={locked}
                  onPress={() => setEditing(site)}
                >
                  编辑网站
                </Button>
                <Button isDisabled={locked} onPress={() => publish(site)}>
                  发布网站草稿
                </Button>
                <Button
                  variant="danger-soft"
                  isDisabled={locked}
                  onPress={() => setRemoveId(site.id)}
                >
                  删除网站配置
                </Button>
                <Button
                  variant="tertiary"
                  isDisabled={busy || !site.appliedVersion}
                  onPress={() => logs(site, "access")}
                >
                  访问日志
                </Button>
                <Button
                  variant="tertiary"
                  isDisabled={busy || !site.appliedVersion}
                  onPress={() => logs(site, "error")}
                >
                  错误日志
                </Button>
              </div>
              {removeId === site.id && (
                <div className="nd-notice">
                  <p>
                    删除 {site.domain}{" "}
                    的网站配置和历史版本；任务成功前仍保留当前记录。静态文件与上游应用会保留。
                  </p>
                  <div className="nd-row">
                    <Button
                      variant="danger"
                      isDisabled={locked}
                      onPress={() =>
                        void action(async () => {
                          await request(
                            `servers/${serverId}/websites/${site.id}`,
                            undefined,
                            "DELETE",
                          );
                          setRemoveId("");
                        })
                      }
                    >
                      确认删除网站配置
                    </Button>
                    <Button variant="tertiary" onPress={() => setRemoveId("")}>
                      取消删除
                    </Button>
                  </div>
                </div>
              )}
              <details>
                <summary>历史版本与回退</summary>
                <div className="nd-stack">
                  {site.revisions.map((revision: Row) => (
                    <div key={revision.id}>
                      <div className="nd-row">
                        <span>
                          v{revision.version} ·{" "}
                          {new Date(revision.createdAt).toLocaleString()} ·{" "}
                          {revision.config.domain}
                        </span>
                        <Button
                          variant="secondary"
                          isDisabled={locked}
                          onPress={() => publish(site, revision.version)}
                        >
                          发布 v{revision.version}
                        </Button>
                      </div>
                      <pre className="nd-code">
                        {JSON.stringify(revision.config, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          );
        })}
        {logTask && (
          <div className="nd-stack">
            <div className="nd-row">
              <strong>
                网站日志 · {stateNames[logTask.state] || logTask.state}
              </strong>
              <Button variant="tertiary" onPress={() => setLogTask(null)}>
                关闭日志
              </Button>
            </div>
            {logTask.state === "failed" ? (
              <p role="alert" className="nd-error">
                {logTask.message}
              </p>
            ) : logTask.state === "succeeded" ? (
              <>
                <pre className="nd-code">
                  {logTask.result?.log || "暂无日志"}
                </pre>
                {logTask.result?.truncated && (
                  <p className="nd-muted">仅显示最近 16 KB 日志。</p>
                )}
              </>
            ) : (
              <p role="status">等待 Agent 返回日志…</p>
            )}
          </div>
        )}
      </Card.Content>
    </Card>
  );
}
