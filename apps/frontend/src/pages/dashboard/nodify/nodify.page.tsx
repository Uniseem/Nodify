import { NODIFY_SECTIONS } from "@shared/constants/nodify-navigation";
import { Button, Card, Input, Spinner, TextArea } from "@heroui/react";
import { ConfigInput, PackageInput, type TConfig } from "@nodify/contract";
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { instance } from "@shared/api/axios";

import "./nodify.css";
import {
  MemberTools,
  ServerTools,
  BatchUpgrade,
  EngineEditor,
  BackupSettings,
  ThemeToggle,
  NodeTools,
  PackageEditor,
  SharedProfiles,
} from "./management-controls";
import { WebsiteManager } from "./website-manager";
import { ServerTraffic } from "./server-traffic";
import { TrafficHistoryPanel } from "./traffic-history";
import { OverviewTrafficPanel } from "./overview-traffic";
import { RuleSetManager } from "./rule-set-manager";
import { SubscriptionSourceManager } from "./subscription-source-manager";
import { SubscriptionTemplateManager } from "./subscription-template-manager";
import { SubscriptionFileManager } from "./subscription-file-manager";
import { InboundEditor } from "./inbound-editor";
import { useOperationEvents } from "./operation-events";
import { OperationList } from "./operation-list";
import { PublicationSettingsPanel } from './publication-settings';

type Row = Record<string, any>;
const api = async (path: string, body?: unknown, method = "post") => {
  const response =
    body === undefined
      ? await instance.get(`/api/${path}`)
      : await instance.request({ url: `/api/${path}`, method, data: body });
  return response.data.response;
};
const sections = NODIFY_SECTIONS;
const bytes = (value: string | number = 0) =>
  `${(Number(value) / 1073741824).toFixed(2)} GB`;
const date = (value?: string) =>
  value ? new Date(value).toLocaleString("zh-CN") : "—";
const message = (error: any) =>
  Array.isArray(error?.response?.data?.message)
    ? error.response.data.message.join("；")
    : error?.response?.data?.message || error.message || "请求失败";
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="nd-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function TextInput({
  name,
  required = true,
  type = "text",
  defaultValue = "",
  ...props
}: {
  name: string;
  required?: boolean;
  type?: string;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <Input
      name={name}
      aria-label={name}
      required={required}
      type={type}
      defaultValue={defaultValue}
      {...props}
    />
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <div className="nd-empty">{children}</div>;
}
function Form({
  title,
  children,
  submit,
}: {
  title: string;
  children: ReactNode;
  submit: (data: FormData) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const handle = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError("");
    try {
      await submit(new FormData(form));
      form.reset();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="nd-form">
      <Card.Header>
        <Card.Title>{title}</Card.Title>
      </Card.Header>
      <Card.Content>
        <form onSubmit={handle}>
          <div className="nd-fields">{children}</div>
          {error && (
            <p role="alert" className="nd-error">
              {error}
            </p>
          )}
          <Button type="submit" isDisabled={busy}>
            {busy ? "处理中…" : "保存"}
          </Button>
        </form>
      </Card.Content>
    </Card>
  );
}
function ConfigEditor({
  server,
  certificates,
  nodes,
  run,
}: {
  server: Row;
  certificates: Row[];
  nodes: Row[];
  run: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [enginePending, setEnginePending] = useState(false);
  const [inboundPending, setInboundPending] = useState(false);
  const entryPending = enginePending || inboundPending;
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [savedConfig, setSavedConfig] = useState("");
  const [editorRevision, setEditorRevision] = useState(0);
  const [versions, setVersions] = useState<Row[]>([]),
    [config, setConfig] = useState<TConfig>({
      inbounds: [],
      xray: {},
      singbox: {},
    }),
    [raw, setRaw] = useState(""),
    [advanced, setAdvanced] = useState(false);
  const load = useCallback(async () => {
    setLoadingConfig(true);
    setLoadError("");
    try {
      const rows = await api(`servers/${server.id}/configurations`);
      setVersions(rows);
      const value = rows[0]?.config || { inbounds: [], xray: {}, singbox: {} };
      setConfig(value);
      setRaw(JSON.stringify(value, null, 2));
      setSavedConfig(JSON.stringify(value));
      setEditorRevision((revision) => revision + 1);
    } catch (e) {
      setLoadError(message(e));
      throw e;
    } finally {
      setLoadingConfig(false);
    }
  }, [server.id]);
  useEffect(() => {
    void run(load);
  }, [load]);
  const save = async () => {
    if (saving || publishing) return;
    setSaving(true);
    try {
      const value = ConfigInput.parse(advanced ? JSON.parse(raw) : config);
      await api(`servers/${server.id}/configurations`, value);
      await load();
    } finally {
      setSaving(false);
    }
  };
  const publish = async (version: number) => {
    if (saving || publishing) return;
    setPublishing(true);
    try {
      await api(`servers/${server.id}/configurations/${version}/apply`, {});
      await load();
    } finally {
      setPublishing(false);
    }
  };
  let dirty = JSON.stringify(config) !== savedConfig;
  if (advanced) {
    try {
      dirty = JSON.stringify(JSON.parse(raw)) !== savedConfig;
    } catch {
      dirty = true;
    }
  }
  if (!savedConfig)
    return (
      <Card>
        <Card.Content className="nd-stack">
          {loadingConfig ? (
            <p role="status">正在加载服务器配置…</p>
          ) : (
            <>
              <p role="alert" className="nd-error">
                配置加载失败：{loadError}
              </p>
              <Button onPress={() => void run(load)}>重试加载配置</Button>
            </>
          )}
        </Card.Content>
      </Card>
    );
  return (
    <>
      {(saving || publishing || loadingConfig) && (
        <p role="status">
          正在{publishing ? "提交发布" : saving ? "保存" : "加载"}配置…
        </p>
      )}
      <div className="nd-stack" inert={saving || publishing || loadingConfig}>
        <div className="nd-row">
          <h2>{server.node.name} · 协议配置</h2>
          <Button
            variant="secondary"
            isDisabled={entryPending}
            onPress={() => {
              if (advanced) {
                void run(async () => {
                  setConfig(ConfigInput.parse(JSON.parse(raw)));
                  setAdvanced(false);
                });
              } else {
                setRaw(JSON.stringify(config, null, 2));
                setAdvanced(true);
              }
            }}
          >
            {advanced ? "返回向导" : "完整 JSON"}
          </Button>
        </div>
        <p className="nd-muted">
          保存草稿后点击发布。当前生效版本 {server.appliedVersion}，期望版本{" "}
          {server.desiredVersion}。
        </p>
        {advanced ? (
          <TextArea
            aria-label="完整配置"
            className="nd-code"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={20}
          />
        ) : (
          <InboundEditor
            key={editorRevision}
            config={config}
            certificates={certificates}
            nodes={nodes}
            change={setConfig}
            pendingChange={setInboundPending}
            disabled={enginePending}
          />
        )}
        {!advanced && (
          <div inert={inboundPending}>
            <EngineEditor
              key={editorRevision}
              config={config}
              change={setConfig}
              pendingChange={setEnginePending}
            />
          </div>
        )}
        {entryPending && (
          <p className="nd-muted" role="status">
            请先写入或取消正在编辑的条目，再保存整个草稿。
          </p>
        )}
        {dirty && !entryPending && (
          <p className="nd-notice" role="status">
            当前修改尚未保存。保存新草稿后，再选择要发布的版本。
          </p>
        )}
        <Button isDisabled={entryPending} onPress={() => void run(save)}>
          保存新草稿
        </Button>
        {dirty && (
          <Button
            variant="tertiary"
            isDisabled={entryPending || !savedConfig}
            onPress={() => {
              setConfig(JSON.parse(savedConfig));
              setRaw(JSON.stringify(JSON.parse(savedConfig), null, 2));
              setEditorRevision((revision) => revision + 1);
            }}
          >
            放弃本地修改，恢复已保存草稿
          </Button>
        )}
        <ServerTools server={server} run={run} />
        <ServerTraffic
          key={server.id}
          server={server}
          changed={() => void run(async () => undefined)}
        />
        {!entryPending && !advanced && (
          <SharedProfiles server={server} config={config} run={run} />
        )}
        <div className="nd-list">
          {versions.map((v) => (
            <div className="nd-row" key={v.id}>
              <span>
                v{v.version} · {v.state} · {date(v.createdAt)}
              </span>
              <Button
                variant="secondary"
                isDisabled={entryPending || dirty}
                onPress={() => void run(() => publish(v.version))}
              >
                发布此版本
              </Button>
            </div>
          ))}
        </div>
        <WebsiteManager
          key={server.id}
          serverId={server.id}
          certificates={certificates}
        />
      </div>
    </>
  );
}
export function NodifyPage() {
  const { section = "overview" } = useParams();
  const [data, setData] = useState<Record<string, Row[]>>({}),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const selected = searchParams.get("server");
  const setSelected = (id: string | null) =>
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (id) next.set("server", id);
      else next.delete("server");
      return next;
    });
  useEffect(() => {
    setNotice("");
  }, [section]);
  const refresh = useCallback(async () => {
    const paths = [
      "servers",
      "managed-nodes",
      "packages",
      "entitlements",
      "certificates",
      "operations",
      "subscription-sources",
      "backups",
    ];
    const results = await Promise.all(
      paths.map(async (p) => [p, await api(p)]),
    );
    setData(Object.fromEntries(results));
    setLoading(false);
  }, []);
  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setError("");
      try {
        await action();
        await refresh();
      } catch (e) {
        setError(message(e));
        setLoading(false);
      }
    },
    [refresh],
  );
  useEffect(() => {
    void run(refresh);
    const timer = setInterval(() => {
      void refresh().catch((e) => setError(message(e)));
    }, 10000);
    return () => clearInterval(timer);
  }, [refresh, run]);
  const servers = data.servers || [],
    nodes = data["managed-nodes"] || [],
    packages = data.packages || [],
    certificates = data.certificates || [],
    operations = data.operations || [],
    entitlements = data.entitlements || [];
  const server = servers.find((s) => s.id === selected);
  useOperationEvents(
    operations
      .filter((o) => ["queued", "running"].includes(o.state))
      .slice(0, 4)
      .map((o) => o.id)
      .join(","),
    refresh,
  );
  return (
    <main className="nd-page">
      <header className="nd-header">
        <div>
          <p className="nd-eyebrow">NODIFY / CONTROL CENTER</p>
          <h1>{sections.find((s) => s[0] === section)?.[1] || "概览"}</h1>
          <p className="nd-muted">管理你的服务器、连接与订阅。</p>
        </div>
        <ThemeToggle />
        <Button variant="secondary" onPress={() => void run(refresh)}>
          刷新
        </Button>
      </header>
      <nav className="nd-nav" aria-label="Nodify 导航">
        {sections.map(([key, label]) => (
          <Link
            key={key}
            className={section === key ? "active" : ""}
            to={`/dashboard/nodify/${key}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {error && (
        <p className="nd-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <div className="nd-notice">
          <pre>{notice}</pre>
          <Button
            variant="secondary"
            onPress={() => void navigator.clipboard.writeText(notice)}
          >
            复制
          </Button>
        </div>
      )}
      {loading ? (
        <Empty>
          <Spinner /> 正在加载
        </Empty>
      ) : (
        <>
          {section === "overview" && (
            <>
              <div className="nd-grid">
                {[
                  [
                    "在线服务器",
                    `${servers.filter((s) => s.status === "connected").length} / ${servers.length}`,
                  ],
                  ["已发布节点", nodes.length],
                  ["已分配用户", entitlements.length],
                  [
                    "失败任务",
                    operations.filter((o) => o.state === "failed").length,
                  ],
                ].map(([label, value]) => (
                  <Card key={label}>
                    <Card.Content>
                      <span className="nd-muted">{label}</span>
                      <div className="nd-stat">{value}</div>
                    </Card.Content>
                  </Card>
                ))}
              </div>
              <OverviewTrafficPanel />
              <h2>需要处理</h2>
              {operations.filter((o) => o.state === "failed").length === 0 &&
              certificates.filter(
                (c) => Date.parse(c.expiresAt) < Date.now() + 21 * 86400000,
              ).length === 0 ? (
                <Empty>目前没有失败任务或即将到期的证书。</Empty>
              ) : (
                <div className="nd-list">
                  {operations
                    .filter((o) => o.state === "failed")
                    .slice(0, 5)
                    .map((o) => (
                      <Link key={o.id} to="/dashboard/nodify/operations">
                        {o.kind}：{o.message}
                      </Link>
                    ))}
                  {certificates
                    .filter(
                      (c) =>
                        Date.parse(c.expiresAt) < Date.now() + 21 * 86400000,
                    )
                    .map((c) => (
                      <Link key={c.id} to="/dashboard/nodify/certificates">
                        {c.name} 将于 {date(c.expiresAt)} 到期
                      </Link>
                    ))}
                </div>
              )}
              {servers.length === 0 && (
                <Card>
                  <Card.Content>
                    <h2>从第一台服务器开始</h2>
                    <p>
                      接入
                      Agent，申请证书，发布入站，再为用户分配套餐。任务记录会显示每一次发布的实际结果。
                    </p>
                    <Link to="/dashboard/nodify/servers">添加服务器 →</Link>
                  </Card.Content>
                </Card>
              )}
            </>
          )}
          {section === "traffic" && <TrafficHistoryPanel />}
          {section === "servers" && (
            <>
              {server ? (
                <>
                  <Button variant="secondary" onPress={() => setSelected(null)}>
                    ← 所有服务器
                  </Button>
                  <ConfigEditor
                    key={server.id}
                    server={server}
                    certificates={certificates}
                    nodes={nodes}
                    run={run}
                  />
                </>
              ) : (
                <>
                  <Form
                    title="接入服务器"
                    submit={async (form) => {
                      const result = await api("servers", {
                        name: form.get("name"),
                        address: form.get("address"),
                      });
                      setNotice(result.command);
                      await refresh();
                    }}
                  >
                    <Field label="名称">
                      <TextInput name="name" placeholder="香港 · 01" />
                    </Field>
                    <Field label="公网 IP 或域名">
                      <TextInput name="address" />
                    </Field>
                  </Form>
                  <BatchUpgrade servers={servers} run={run} />
                  <div className="nd-grid">
                    {servers.map((s) => (
                      <Card key={s.id}>
                        <Card.Header>
                          <Card.Title>{s.node.name}</Card.Title>
                          <Card.Description>{s.node.address}</Card.Description>
                        </Card.Header>
                        <Card.Content>
                          <span className={`nd-status ${s.status}`}>
                            {s.status === "connected"
                              ? "在线"
                              : s.status === "pending"
                                ? "等待接入"
                                : "离线"}
                          </span>
                          <p>
                            内存 {bytes(s.metrics.memoryUsed)} /{" "}
                            {bytes(s.metrics.memoryTotal)}
                          </p>
                          <p>
                            CPU {Number(s.metrics.cpuPercent || 0).toFixed(1)}%
                            · Agent {s.version || "待接入"}
                          </p>
                          <p>磁盘剩余 {bytes(s.metrics.diskFree)}</p>
                          <p>
                            {s.billing?.period?.start === "lifetime"
                              ? "基线后用量"
                              : "周期用量"}
                            ：
                            {s.billing?.usedBytes == null
                              ? "未知"
                              : bytes(s.billing.usedBytes)}
                          </p>
                          <p>
                            收 / 发{" "}
                            {s.metrics.networkRateAvailable === false ? (
                              "采样间隔不足或计数器变化"
                            ) : (
                              <>
                                {(
                                  Number(s.metrics.networkRxRate || 0) / 1024
                                ).toFixed(1)}{" "}
                                /{" "}
                                {(
                                  Number(s.metrics.networkTxRate || 0) / 1024
                                ).toFixed(1)}{" "}
                                KiB/s
                              </>
                            )}
                          </p>
                          <p>
                            本次开机网卡累计 {bytes(s.metrics.networkRxBytes)} /{" "}
                            {bytes(s.metrics.networkTxBytes)}
                          </p>
                          <p>最后上报 {date(s.lastSeenAt)}</p>
                          {s.metrics.pendingTrafficBatches > 0 && (
                            <p className="nd-muted">
                              本机待补报 {s.metrics.pendingTrafficBatches}{" "}
                              批流量
                              {s.metrics.trafficError ? "，上次补报失败" : ""}
                            </p>
                          )}
                          <p>
                            配置 v{s.appliedVersion} / v{s.desiredVersion}
                          </p>
                        </Card.Content>
                        <Card.Footer>
                          <Button onPress={() => setSelected(s.id)}>
                            管理
                          </Button>
                          <Button
                            variant="secondary"
                            onPress={() =>
                              void run(async () => {
                                const result = await api(
                                  `servers/${s.id}/actions`,
                                  {
                                    action: "logs",
                                    service: "xray",
                                  },
                                );
                                setNotice(
                                  `日志任务：${result.id}，请在任务记录查看。`,
                                );
                              })
                            }
                          >
                            日志
                          </Button>
                        </Card.Footer>
                      </Card>
                    ))}
                  </div>
                  {!servers.length && (
                    <Empty>尚未添加服务器。保存后会生成一次性安装凭据。</Empty>
                  )}
                </>
              )}
            </>
          )}
          {section === "nodes" && (
            <>
              <RuleSetManager />
              <div className="nd-grid">
                {nodes.map((n) => (
                  <Card key={n.id}>
                    <Card.Header>
                      <Card.Title>{n.host.remark}</Card.Title>
                      <Card.Description>
                        {n.server.node.name} · {n.config.protocol}
                      </Card.Description>
                    </Card.Header>
                    <Card.Content>
                      <p>
                        {n.host.address}:{n.host.port}
                      </p>
                      <p>{n.host.isDisabled ? "已停用" : "已发布"}</p>
                      <NodeTools node={n} members={entitlements} run={run} />
                    </Card.Content>
                  </Card>
                ))}
              </div>
              {!nodes.length && (
                <Empty>成功发布入站后，节点会自动出现在这里。</Empty>
              )}
              <SubscriptionSourceManager
                focusId={searchParams.get("source") || undefined}
              />
              <SubscriptionFileManager />
            </>
          )}
          {section === "packages" && (
            <>
              <Form
                title="创建套餐"
                submit={async (form) => {
                  await api(
                    "packages",
                    PackageInput.parse({
                      name: form.get("name"),
                      trafficLimitBytes: (
                        BigInt(String(form.get("traffic") || "0")) * 1073741824n
                      ).toString(),
                      validDays: Number(form.get("days")),
                      resetDays: Number(form.get("resetDays")),
                      direction: form.get("direction"),
                      multiplier: Number(form.get("multiplier")),
                      nodeIds: form.getAll("nodeIds"),
                      deviceLimit: Number(form.get("deviceLimit")),
                      tags: String(form.get("tags") || "")
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    }),
                  );
                  await refresh();
                }}
              >
                <Field label="套餐名称">
                  <TextInput name="name" />
                </Field>
                <Field label="额度 GB（0 不限）">
                  <TextInput name="traffic" type="number" defaultValue="100" />
                </Field>
                <Field label="有效天数">
                  <TextInput name="days" type="number" defaultValue="30" />
                </Field>
                <Field label="重置周期天数（0 不重置）">
                  <TextInput name="resetDays" type="number" defaultValue="30" />
                </Field>
                <Field label="计量方向">
                  <select name="direction">
                    <option value="both">上传 + 下载</option>
                    <option value="download">仅下载</option>
                    <option value="upload">仅上传</option>
                  </select>
                </Field>
                <Field label="流量倍率">
                  <TextInput name="multiplier" defaultValue="1" />
                </Field>
                <Field label="订阅设备数（0 不限）">
                  <TextInput
                    name="deviceLimit"
                    type="number"
                    defaultValue="0"
                  />
                </Field>
                <Field label="允许的节点标签（逗号分隔）">
                  <TextInput name="tags" required={false} />
                </Field>
                <fieldset className="nd-node-picker">
                  <legend>可用节点</legend>
                  {nodes.map((n) => (
                    <label key={n.id}>
                      <input type="checkbox" name="nodeIds" value={n.id} />
                      {n.host.remark}
                    </label>
                  ))}
                  {(data["subscription-sources"] || [])
                    .flatMap((s) => s.nodes)
                    .map((n: Row) => (
                      <label key={n.id}>
                        <input type="checkbox" name="nodeIds" value={n.id} />
                        {n.name}（外部）
                      </label>
                    ))}
                </fieldset>
              </Form>
              <div className="nd-grid">
                {packages.map((p) => (
                  <Card key={p.id}>
                    <Card.Header>
                      <Card.Title>{p.name}</Card.Title>
                    </Card.Header>
                    <Card.Content>
                      <div className="nd-stat">
                        {bytes(p.config.trafficLimitBytes)}
                      </div>
                      <p>
                        {p.config.validDays} 天 · {p._count.entitlements} 位用户
                      </p>
                      <Button
                        variant="secondary"
                        onPress={() =>
                          void run(() => api(`packages/${p.id}/sync`, {}))
                        }
                      >
                        将模板同步给已分配用户
                      </Button>
                      <PackageEditor pkg={p} run={run} />
                    </Card.Content>
                  </Card>
                ))}
              </div>
              <Form
                title="创建成员并分配套餐"
                submit={async (form) => {
                  const result = await api("entitlements", {
                    username: form.get("username"),
                    packageId: form.get("packageId"),
                  });
                  setNotice(result.pageUrl);
                  await refresh();
                }}
              >
                <Field label="用户名（英文、数字、下划线）">
                  <TextInput name="username" />
                </Field>
                <Field label="套餐">
                  <select name="packageId" required>
                    <option value="">选择套餐</option>
                    {packages.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </Form>
              <div className="nd-list">
                {entitlements.map((e) => (
                  <Card key={e.id}>
                    <Card.Content>
                      <div className="nd-row">
                        <strong>
                          {e.user.username} · {e.package.name}
                        </strong>
                        <span>
                          {bytes(e.usedBytes)} /{" "}
                          {bytes(e.snapshot.trafficLimitBytes)}
                        </span>
                        <a href={e.pageUrl} target="_blank" rel="noreferrer">
                          订阅页 ↗
                        </a>
                        <Button
                          variant="secondary"
                          onPress={() =>
                            void run(() =>
                              api(`entitlements/${e.userId}/reset`, {}),
                            )
                          }
                        >
                          重置用量
                        </Button>
                      </div>
                      <p>到期 {date(e.user.expireAt)}</p>
                      {!!e.pendingServers?.length && (
                        <p className="nd-muted">
                          权限待同步：{e.pendingServers.join("、")}
                        </p>
                      )}
                      <MemberTools member={e} packages={packages} run={run} />
                    </Card.Content>
                  </Card>
                ))}
              </div>
              <Link to="/dashboard/management/users">打开现有用户管理 →</Link>
            </>
          )}
          {section === "certificates" && (
            <>
              <Form
                title="上传证书"
                submit={async (form) => {
                  await api("certificates/upload", {
                    name: form.get("name"),
                    certPem: form.get("certPem"),
                    keyPem: form.get("keyPem"),
                  });
                  await refresh();
                }}
              >
                <Field label="名称">
                  <TextInput name="name" />
                </Field>
                <Field label="证书链 PEM">
                  <TextArea
                    name="certPem"
                    aria-label="证书链"
                    rows={5}
                    required
                  />
                </Field>
                <Field label="私钥 PEM">
                  <TextArea name="keyPem" aria-label="私钥" rows={5} required />
                </Field>
              </Form>
              <Form
                title="通过 DNS 自动申请"
                submit={async (form) => {
                  const result = await api("certificates/request", {
                    name: form.get("name"),
                    domains: String(form.get("domains"))
                      .split(",")
                      .map((v) => v.trim()),
                    email: form.get("email"),
                    provider: form.get("provider"),
                    credentials: JSON.parse(String(form.get("credentials"))),
                    staging: form.get("staging") === "on",
                  });
                  setNotice(
                    `证书申请任务 ${result.id}，请到任务记录查看结果。`,
                  );
                  await refresh();
                }}
              >
                <Field label="名称">
                  <TextInput name="name" />
                </Field>
                <Field label="域名（逗号分隔）">
                  <TextInput name="domains" />
                </Field>
                <Field label="ACME 邮箱">
                  <TextInput name="email" type="email" />
                </Field>
                <Field label="DNS 服务商">
                  <select name="provider">
                    <option value="cloudflare">Cloudflare</option>
                    <option value="alidns">阿里云 DNS</option>
                    <option value="tencentcloud">DNSPod</option>
                  </select>
                </Field>
                <Field label="DNS 凭据 JSON">
                  <TextArea
                    name="credentials"
                    aria-label="DNS 凭据"
                    placeholder={'{"CF_DNS_API_TOKEN":"..."}'}
                    required
                  />
                </Field>
                <label>
                  <input type="checkbox" name="staging" defaultChecked />{" "}
                  使用测试 CA（证书不被客户端信任）
                </label>
              </Form>
              <div className="nd-grid">
                {certificates.map((c) => (
                  <Card key={c.id}>
                    <Card.Header>
                      <Card.Title>{c.name}</Card.Title>
                      <Card.Description>
                        {c.domains.join(", ")}
                      </Card.Description>
                    </Card.Header>
                    <Card.Content>
                      <p>到期 {date(c.expiresAt)}</p>
                      <p>{c.lastError}</p>
                    </Card.Content>
                    <Card.Footer>
                      <Button
                        variant="secondary"
                        isDisabled={c.provider === "manual"}
                        onPress={() =>
                          void run(() => api(`certificates/${c.id}/renew`, {}))
                        }
                      >
                        续期并部署
                      </Button>
                    </Card.Footer>
                  </Card>
                ))}
              </div>
            </>
          )}
          {section === "backups" && (
            <>
              <BackupSettings run={run} />
              <Form
                title="创建加密备份"
                submit={async (form) => {
                  await api("backups", { password: form.get("password") });
                  await refresh();
                }}
              >
                <Field label="备份密码（至少 12 个字符）">
                  <TextInput name="password" type="password" />
                </Field>
              </Form>
              <p className="nd-muted">
                备份包含数据库和解密所需的主密钥。恢复需要备份密码，并通过停止服务后的恢复命令执行。
                创建请求会进入持久化任务队列；进程中断后自动恢复，进度和失败重试见任务记录。
              </p>
              <div className="nd-list">
                {(data.backups || []).map((b) => (
                  <Card key={b.id}>
                    <Card.Content>
                      <div className="nd-row">
                        <span>
                          {date(b.createdAt)} · {b.state}
                        </span>
                        <Button
                          variant="secondary"
                          isDisabled={b.state !== "succeeded"}
                          onPress={() =>
                            void run(async () => {
                              const response = await instance.get(
                                `/api/backups/${b.id}/download`,
                                { responseType: "blob" },
                              );
                              const url = URL.createObjectURL(response.data);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = b.filename;
                              a.click();
                              setTimeout(() => URL.revokeObjectURL(url), 1000);
                            })
                          }
                        >
                          下载
                        </Button>
                      </div>
                      {b.message && <p>{b.message}</p>}
                    </Card.Content>
                  </Card>
                ))}
              </div>
            </>
          )}
          {section === "settings" && <><PublicationSettingsPanel /><SubscriptionTemplateManager /></>}
          {section === "operations" && (
            <OperationList
              operations={operations}
              retry={async (id) => {
                const operation = await api(`operations/${id}/retry`, {});
                setNotice(`重试任务已提交：${operation.id}`);
                await refresh();
              }}
            />
          )}
        </>
      )}
    </main>
  );
}
