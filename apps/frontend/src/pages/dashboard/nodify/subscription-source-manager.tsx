import { Button, Card } from "@heroui/react";
import {
  SourceInput,
  SourceUpdateInput,
  SourceNodeInput,
  directionBytes,
} from "@nodify/contract";
import { useCallback, useEffect, useState, useRef } from "react";
import { instance } from "@shared/api/axios";
import { Choice, Field } from "./editor-fields";
import { trafficBytes } from "./traffic-summary";

type Row = Record<string, any>;
const request = async (
  path = "",
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
) =>
  (
    await instance.request({
      url: `/api/subscription-sources${path}`,
      method,
      data,
    })
  ).data.response;
const errorText = (e: any) =>
  e.issues?.map((i: any) => i.message).join("；") ||
  e.response?.data?.message ||
  e.message ||
  "操作失败";
const tagsOf = (text: string) => [
  ...new Set(
    text
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  ),
];
const date = (value?: string) =>
  value ? new Date(value).toLocaleString() : "尚无";
const stateNames: Record<string, string> = {
  running: "同步中",
  queued: "排队中",
  succeeded: "同步成功",
  failed: "同步失败",
};

function SourceForm({
  source,
  save,
  cancel,
}: {
  source: Row;
  save: (input: unknown) => Promise<void>;
  cancel: () => void;
}) {
  const [name, setName] = useState(source.name || ""),
    [url, setUrl] = useState(""),
    [tags, setTags] = useState((source.tags || []).join(","));
  const [enabled, setEnabled] = useState(source.enabled ?? true),
    [minutes, setMinutes] = useState(source.intervalMinutes ?? 360);
  const [trafficDirection, setTrafficDirection] = useState(
    source.trafficDirection || "both",
  );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="nd-entry-form nd-stack"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        void (async () => {
          try {
            const input = {
              name,
              enabled,
              trafficDirection,
              intervalMinutes: minutes,
              tags: tagsOf(tags),
              ...(source.id
                ? {
                    version: source.version,
                    ...(url.trim() ? { url: url.trim() } : {}),
                  }
                : { url: url.trim() }),
            };
            await save(
              (source.id ? SourceUpdateInput : SourceInput).parse(input),
            );
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <div className="nd-fields" inert={busy}>
        <Field label="来源名称" value={name} change={setName} />
        <Field
          label={
            source.id ? "新 HTTPS 地址（留空保持原地址）" : "HTTPS 订阅地址"
          }
          value={url}
          change={setUrl}
          type="password"
        />
        <Choice
          label="更新频率"
          value={
            [0, 60, 360, 1440].includes(minutes) ? String(minutes) : "custom"
          }
          options={[
            ["0", "仅手动"],
            ["60", "每小时"],
            ["360", "每 6 小时"],
            ["1440", "每天"],
            ["custom", "自定义"],
          ]}
          change={(value) =>
            setMinutes(value === "custom" ? 30 : Number(value))
          }
        />
        {![0, 60, 360, 1440].includes(minutes) && (
          <Field
            label="更新间隔（分钟）"
            type="number"
            value={minutes}
            change={(value) => setMinutes(Number(value))}
          />
        )}
        <Field label="来源标签（逗号分隔）" value={tags} change={setTags} />
        <Choice
          label="上游流量展示方向"
          value={trafficDirection}
          options={[
            ["both", "上传 + 下载"],
            ["upload", "仅上传"],
            ["download", "仅下载"],
          ]}
          change={setTrafficDirection}
        />
        <p className="nd-muted">
          仅用于管理员订阅文件汇总。来自上游订阅头，不计入本面板用户配额。
        </p>
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />{" "}
          启用来源分发与自动更新
        </label>
        <p className="nd-muted nd-full">
          来源标签应用于其中全部节点，可在套餐中明确授权这些标签。禁用后不再分发节点或自动更新；仍可手动同步。
          {source.id
            ? `已保存来源：${source.endpointHost}。修改地址后，上次有效节点会保留到下次同步成功。`
            : "保存后创建真实同步任务；下载或解析失败会保留来源记录以便重试。"}
        </p>
      </div>
      {error && (
        <p role="alert" className="nd-error">
          {String(error)}
        </p>
      )}
      <div className="nd-row">
        <Button type="submit" isDisabled={busy}>
          {busy ? "正在保存…" : "保存订阅来源"}
        </Button>
        <Button variant="tertiary" isDisabled={busy} onPress={cancel}>
          取消来源编辑
        </Button>
      </div>
    </form>
  );
}
function NodeForm({
  source,
  node,
  save,
  cancel,
}: {
  source: Row;
  node: Row;
  save: (input: unknown) => Promise<void>;
  cancel: () => void;
}) {
  const [name, setName] = useState(node.customName || ""),
    [enabled, setEnabled] = useState(node.enabled),
    [tags, setTags] = useState((node.ownTags || []).join(","));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
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
              SourceNodeInput.parse({
                version: source.version,
                name: name.trim() || null,
                enabled,
                tags: tagsOf(tags),
              }),
            );
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <div className="nd-fields" inert={busy}>
        <Field
          label="自定义节点名称（留空跟随来源）"
          value={name}
          change={setName}
        />
        <Field label="节点附加标签（逗号分隔）" value={tags} change={setTags} />
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />{" "}
          启用此节点分发
        </label>
        <p className="nd-muted nd-full">
          来源名称：{node.upstreamName}
          。重命名、启停及附加标签会在后续同步中保留；禁用不会撤销外部服务器的凭据。
        </p>
      </div>
      {error && (
        <p role="alert" className="nd-error">
          {String(error)}
        </p>
      )}
      <div className="nd-row">
        <Button type="submit" isDisabled={busy}>
          保存外部节点
        </Button>
        <Button variant="tertiary" isDisabled={busy} onPress={cancel}>
          取消节点编辑
        </Button>
      </div>
    </form>
  );
}
export function SubscriptionSourceManager({
  focusId,
}: { focusId?: string } = {}) {
  const focused = useRef("");
  const [rows, setRows] = useState<Row[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [loadError, setLoadError] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<Row | null>(null),
    [nodeEditing, setNodeEditing] = useState<{ source: Row; node: Row } | null>(
      null,
    ),
    [removeId, setRemoveId] = useState(""),
    [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({}),
    [pages, setPages] = useState<Record<string, number>>({});
  const load = useCallback(async () => {
    try {
      setRows(await request());
      setLoadError("");
    } catch (e) {
      setLoadError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);
  const action = async (work: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      await load();
      setNotice(message);
      setRemoveId("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const locked = busy || loading || !!editing || !!nodeEditing;
  useEffect(() => {
    if (!focusId) {
      focused.current = "";
      return;
    }
    if (focused.current === focusId) return;
    const target = document.getElementById(`nd-source-${focusId}`);
    if (target) {
      target.scrollIntoView({ block: "center" });
      target.focus({ preventScroll: true });
      focused.current = focusId;
    }
  }, [focusId, rows]);
  return (
    <Card>
      <Card.Header>
        <Card.Title>外部订阅来源</Card.Title>
        <Card.Description>合并外部节点，统一按用户套餐分发。</Card.Description>
      </Card.Header>
      <Card.Content className="nd-stack">
        <p className="nd-muted">
          外部节点仅用于订阅分发。本面板不能统计真实协议用量或撤销外部凭据；从套餐中移除节点只影响后续订阅输出。
        </p>
        <div className="nd-row">
          <Button
            isDisabled={locked}
            onPress={() => {
              setEditing({});
              setNotice("");
            }}
          >
            添加订阅来源
          </Button>
          <Button
            variant="tertiary"
            isDisabled={locked}
            onPress={() => void load()}
          >
            刷新来源
          </Button>
        </div>
        {loading && <p role="status">正在加载外部来源…</p>}
        {(error || loadError) && (
          <p role="alert" className="nd-error">
            {String(error || loadError)}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {editing && (
          <SourceForm
            key={editing.id || "new"}
            source={editing}
            cancel={() => setEditing(null)}
            save={async (input) => {
              const result = await request(
                editing.id ? `/${editing.id}` : "",
                input,
                editing.id ? "PUT" : "POST",
              );
              setEditing(null);
              setNotice(
                result.operationId
                  ? `来源已保存，同步任务 ${result.operationId} 已创建。`
                  : "来源已保存；修改地址后可立即同步。",
              );
              await load();
            }}
          />
        )}
        {nodeEditing && (
          <NodeForm
            key={nodeEditing.node.id}
            {...nodeEditing}
            cancel={() => setNodeEditing(null)}
            save={async (input) => {
              await request(
                `/${nodeEditing.source.id}/nodes/${nodeEditing.node.id}`,
                input,
                "PUT",
              );
              setNodeEditing(null);
              setNotice("节点设置已保存，下次客户端刷新订阅时生效。");
              await load();
            }}
          />
        )}
        {!loading && !rows.length && !editing && (
          <p className="nd-empty">
            尚无外部来源。支持 Mihomo YAML、URI 列表和 Base64 节点列表。
          </p>
        )}
        {!!rows.length && (
          <Field
            label="筛选外部节点（名称、地址或标签）"
            value={search}
            change={(value) => {
              setSearch(value);
              setPages({});
            }}
          />
        )}
        {rows.map((source) => {
          const syncing = ["queued", "running"].includes(
              source.operation?.state,
            ),
            disabled = locked || syncing;
          const visibleNodes = source.nodes.filter((node: Row) =>
            `${node.name} ${node.server} ${node.tags.join(" ")}`
              .toLowerCase()
              .includes(search.toLowerCase()),
          );
          const page = Math.min(
            pages[source.id] || 0,
            Math.max(0, Math.ceil(visibleNodes.length / 50) - 1),
          );
          return (
            <div
              className="nd-engine-entry"
              key={source.id}
              id={`nd-source-${source.id}`}
              tabIndex={-1}
            >
              <div className="nd-row">
                <strong>{source.name}</strong>
                <span>
                  {source.enabled ? "已启用" : "已禁用"} · {source.nodes.length}{" "}
                  个节点 · v{source.version}
                </span>
              </div>
              <p className="nd-muted">
                {source.endpointHost} ·{" "}
                {source.intervalMinutes
                  ? `每 ${source.intervalMinutes} 分钟更新`
                  : "仅手动更新"}{" "}
                · 标签：{source.tags.join("、") || "无"}
              </p>
              <p>
                上次成功：{date(source.lastSyncedAt)} · 上次尝试：
                {date(source.lastAttemptAt)}
              </p>
              <p className="nd-muted">
                上游报送：
                {source.traffic
                  ? trafficBytes(
                      directionBytes(
                        source.traffic.upload,
                        source.traffic.download,
                        source.trafficDirection,
                      ),
                    )
                  : "未提供流量头"}{" "}
                · 容量{" "}
                {source.traffic?.total === "0"
                  ? "不限"
                  : trafficBytes(source.traffic?.total)}
                {source.trafficStale ? " · 旧快照，待同步" : ""}
              </p>
              {source.operation && (
                <p role="status">
                  {stateNames[source.operation.state] || source.operation.state}{" "}
                  · {source.operation.id}
                  {source.operation.message
                    ? `：${source.operation.message}`
                    : ""}
                </p>
              )}
              {source.lastError && !source.operation?.message && (
                <p className="nd-error">{source.lastError}</p>
              )}
              <div className="nd-row">
                <Button
                  isDisabled={disabled}
                  onPress={() =>
                    void action(
                      () => request(`/${source.id}/sync`, {}),
                      "已提交同步任务，等待下载和解析结果。",
                    )
                  }
                >
                  同步 {source.name}
                </Button>
                <Button
                  variant="secondary"
                  isDisabled={disabled}
                  onPress={() => {
                    setEditing(source);
                    setNotice("");
                    setRemoveId("");
                  }}
                >
                  编辑 {source.name}
                </Button>
                <Button
                  variant="secondary"
                  isDisabled={disabled}
                  onPress={() =>
                    void action(
                      () =>
                        request(
                          `/${source.id}`,
                          SourceUpdateInput.parse({
                            ...source,
                            enabled: !source.enabled,
                          }),
                          "PUT",
                        ),
                      source.enabled
                        ? "来源已停止分发与自动更新。"
                        : "来源已启用。",
                    )
                  }
                >
                  {source.enabled ? "禁用" : "启用"} {source.name}
                </Button>
                <Button
                  variant="danger-soft"
                  isDisabled={disabled}
                  onPress={() => setRemoveId(source.id)}
                >
                  删除 {source.name}
                </Button>
              </div>
              {removeId === source.id && (
                <div className="nd-notice">
                  <p>
                    删除来源“{source.name}
                    ”及其节点设置。已导入客户端的外部凭据仍由原服务提供方管理。
                  </p>
                  <div className="nd-row">
                    <Button
                      variant="danger"
                      isDisabled={disabled}
                      onPress={() =>
                        void action(
                          () =>
                            request(
                              `/${source.id}`,
                              { version: source.version },
                              "DELETE",
                            ),
                          "来源已删除。",
                        )
                      }
                    >
                      确认删除来源
                    </Button>
                    <Button
                      variant="tertiary"
                      isDisabled={busy}
                      onPress={() => setRemoveId("")}
                    >
                      取消删除来源
                    </Button>
                  </div>
                </div>
              )}
              <details
                open={Boolean(expanded[source.id] || search)}
                onToggle={(event) => {
                  const open = event.currentTarget.open;
                  setExpanded((value) => ({ ...value, [source.id]: open }));
                }}
              >
                <summary>
                  查看 {source.name} 的节点（{visibleNodes.length}）
                </summary>
                {(expanded[source.id] || search) && (
                  <div className="nd-stack">
                    {!visibleNodes.length && (
                      <p className="nd-empty">
                        {source.nodes.length
                          ? "没有匹配的节点"
                          : "尚无成功导入的节点，请查看同步结果。"}
                      </p>
                    )}
                    {visibleNodes
                      .slice(page * 50, (page + 1) * 50)
                      .map((node: Row) => (
                        <div className="nd-engine-entry" key={node.id}>
                          <strong>{node.name}</strong>
                          <p>
                            {node.protocol} · {node.server}:{node.port} ·{" "}
                            {node.enabled && source.enabled
                              ? "分发中"
                              : "不分发"}
                          </p>
                          <p className="nd-muted">
                            {node.tags.join("、") || "无标签"}
                          </p>
                          <Button
                            variant="secondary"
                            isDisabled={disabled}
                            onPress={() => {
                              setNodeEditing({ source, node });
                              setNotice("");
                            }}
                          >
                            编辑节点 {node.name}
                          </Button>
                        </div>
                      ))}
                    {visibleNodes.length > 50 && (
                      <div className="nd-row">
                        <Button
                          variant="tertiary"
                          isDisabled={page === 0}
                          onPress={() =>
                            setPages((value) => ({
                              ...value,
                              [source.id]: page - 1,
                            }))
                          }
                        >
                          上一页 {source.name}
                        </Button>
                        <span>
                          第 {page + 1} / {Math.ceil(visibleNodes.length / 50)}{" "}
                          页
                        </span>
                        <Button
                          variant="tertiary"
                          isDisabled={(page + 1) * 50 >= visibleNodes.length}
                          onPress={() =>
                            setPages((value) => ({
                              ...value,
                              [source.id]: page + 1,
                            }))
                          }
                        >
                          下一页 {source.name}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </details>
            </div>
          );
        })}
      </Card.Content>
    </Card>
  );
}
