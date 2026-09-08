import type { TConfig } from "@nodify/contract";
import { BackupSettingsForm } from "./backup-settings";
import { InteractiveTerminal } from './interactive-terminal';
import { AgentConnection } from './agent-connection';

import { Button, Card, Input, TextArea } from "@heroui/react";
import { useEffect, useState } from "react";
import { renderSVG } from "uqr";

import { instance } from "@shared/api/axios";

type Row = Record<string, any>;
export function BatchUpgrade({ servers, run }: { servers: Row[]; run: Run }) {
  const [selected, setSelected] = useState<string[]>([]),
    [version, setVersion] = useState(""),
    [url, setUrl] = useState(""),
    [sha256, setSha256] = useState("");
  return (
    <details>
      <summary>批量升级 Agent 与协议内核</summary>
      <div className="nd-stack">
        <p className="nd-muted">
          请选择相同架构的服务器，并填写该架构的固定版本包；每台服务器独立检查清单，升级失败会尝试回退。
        </p>
        <div className="nd-fields">
          {servers.map((s) => (
            <label key={s.id}>
              <input
                type="checkbox"
                checked={selected.includes(s.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, s.id]
                      : selected.filter((id) => id !== s.id),
                  )
                }
              />{" "}
              {s.node.name}
            </label>
          ))}
        </div>
        <Input
          aria-label="批量升级版本"
          placeholder="版本号，例如 0.2.0"
          value={version}
          onChange={(e) => setVersion(e.target.value)}
        />
        <Input
          aria-label="批量升级包 URL"
          placeholder="HTTPS 发布包 URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Input
          aria-label="批量升级 SHA256"
          placeholder="SHA256 校验值"
          value={sha256}
          onChange={(e) => setSha256(e.target.value)}
        />
        <Button
          isDisabled={
            !selected.length || !version || !url || sha256.length !== 64
          }
          onPress={() =>
            void run(() =>
              api("servers/upgrade", {
                serverIds: selected,
                version,
                url,
                sha256,
              }),
            )
          }
        >
          为 {selected.length} 台服务器创建升级任务
        </Button>
      </div>
    </details>
  );
}
export function PackageEditor({ pkg, run }: { pkg: Row; run: Run }) {
  return (
    <details>
      <summary>编辑套餐模板</summary>
      <p className="nd-muted">
        保存模板不影响已分配权益；需要应用给现有用户时，点击显式同步。
      </p>
      <JsonEditor
        value={pkg.config}
        save={async (value) =>
          run(() => api(`packages/${pkg.id}`, value, "PUT"))
        }
      />
    </details>
  );
}
export function SharedProfiles({
  server,
  config,
  run,
}: {
  server: Row;
  config: TConfig;
  run: Run;
}) {
  const [profiles, setProfiles] = useState<Row[]>([]),
    [name, setName] = useState(""),
    [binding, setBinding] = useState(server.node.activeConfigProfileUuid || ""),
    [result, setResult] = useState("");
  const load = async () => setProfiles(await api("server-profiles"));
  useEffect(() => {
    void run(load);
  }, [server.id]);
  const selected = profiles.find((p) => p.id === binding);
  return (
    <Card>
      <Card.Header>
        <Card.Title>共享配置（可选）</Card.Title>
      </Card.Header>
      <Card.Content className="nd-stack">
        <p className="nd-muted">
          默认独立配置。只有明确绑定的服务器才会收到共享发布；首次切换模板后，请检查套餐可用节点，或使用标签授权。
        </p>
        <div className="nd-row">
          <Input
            aria-label="共享配置名称"
            placeholder="将当前草稿保存为模板"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            variant="secondary"
            isDisabled={!name.trim()}
            onPress={() =>
              void run(async () => {
                await api("server-profiles", { name, config });
                setName("");
                await load();
              })
            }
          >
            创建共享模板
          </Button>
        </div>
        <div className="nd-row">
          <select
            aria-label="共享配置绑定"
            value={binding}
            onChange={(e) => setBinding(e.target.value)}
          >
            <option value="">独立配置</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            onPress={() =>
              void run(async () => {
                await api(
                  `servers/${server.id}/profile`,
                  { profileId: binding || null },
                  "PUT",
                );
                await load();
              })
            }
          >
            保存绑定
          </Button>
        </div>
        {selected && (
          <>
            <p>
              发布将影响：
              <strong>
                {selected.servers.map((s: Row) => s.name).join("、") ||
                  "尚未绑定服务器"}
              </strong>
            </p>
            <details>
              <summary>编辑共享模板</summary>
              <JsonEditor
                value={selected.config}
                save={async (value) => {
                  await api(
                    `server-profiles/${selected.id}`,
                    { name: selected.name, config: value },
                    "PUT",
                  );
                  await load();
                }}
              />
            </details>
            <Button
              isDisabled={!selected.servers.length}
              onPress={() =>
                void run(async () =>
                  setResult(
                    JSON.stringify(
                      await api(`server-profiles/${selected.id}/publish`, {}),
                      null,
                      2,
                    ),
                  ),
                )
              }
            >
              发布到以上已绑定服务器
            </Button>
          </>
        )}
        {result && <pre className="nd-code">{result}</pre>}
      </Card.Content>
    </Card>
  );
}
export function NodeTools({
  node,
  members,
  run,
}: {
  node: Row;
  members: Row[];
  run: Run;
}) {
  const [name, setName] = useState(node.host.remark),
    [tags, setTags] = useState(node.config.tags.join(",")),
    [position, setPosition] = useState(node.host.viewPosition),
    [enabled, setEnabled] = useState(!node.host.isDisabled),
    [member, setMember] = useState(""),
    [uri, setUri] = useState("");
  return (
    <details>
      <summary>编辑、分组与分享</summary>
      <div className="nd-stack">
        <Input
          aria-label="节点名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          aria-label="标签与分组"
          placeholder="标签与分组，逗号分隔"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />
        <Input
          aria-label="节点排序"
          type="number"
          value={String(position)}
          onChange={(e) => setPosition(Number(e.target.value))}
        />
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />{" "}
          启用节点
        </label>
        <Button
          variant="secondary"
          onPress={() =>
            void run(() =>
              api(
                `managed-nodes/${node.id}`,
                {
                  name,
                  tags: tags
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                  position,
                  enabled,
                },
                "PUT",
              ),
            )
          }
        >
          发布修改
        </Button>
        <select
          aria-label="分享给用户"
          value={member}
          onChange={(e) => setMember(e.target.value)}
        >
          <option value="">选择有权使用的用户</option>
          {members.map((m) => (
            <option key={m.id} value={m.userId}>
              {m.user.username}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          isDisabled={!member}
          onPress={() =>
            void run(async () =>
              setUri(
                (await api(`managed-nodes/${node.id}/share?userId=${member}`))
                  .uri,
              ),
            )
          }
        >
          生成此用户的分享码
        </Button>
        {uri && (
          <>
            <pre className="nd-code">{uri}</pre>
            <div
              style={{ width: 180, background: "white", padding: 8 }}
              dangerouslySetInnerHTML={{ __html: renderSVG(uri) }}
            />
            <Button
              variant="secondary"
              onPress={() => void navigator.clipboard.writeText(uri)}
            >
              复制分享 URI
            </Button>
          </>
        )}
      </div>
    </details>
  );
}
export function ThemeToggle() {
  const [light, setLight] = useState(
    () => localStorage.getItem("nodify-theme") === "light",
  );
  useEffect(() => {
    document.documentElement.dataset.nodifyTheme = light ? "light" : "dark";
    localStorage.setItem("nodify-theme", light ? "light" : "dark");
  }, [light]);
  return (
    <Button variant="secondary" onPress={() => setLight(!light)}>
      {light ? "深色" : "浅色"}
    </Button>
  );
}
type Run = (work: () => Promise<unknown>) => Promise<void>;
const api = async (path: string, body?: unknown, method = "POST") =>
  (
    await instance.request({
      url: `/api/${path}`,
      method: body === undefined ? "GET" : method,
      data: body,
    })
  ).data.response;

export function MemberTools({
  member,
  packages,
  run,
}: {
  member: Row;
  packages: Row[];
  run: Run;
}) {
  const [packageId, setPackageId] = useState(member.packageId),
    [devices, setDevices] = useState<Row[] | null>(null);
  const base = `entitlements/${member.userId}`;
  return (
    <div className="nd-stack">
      <div className="nd-row">
        <span>
          {member.user.status === "ACTIVE" ? "启用" : member.user.status}
        </span>
        <Button
          variant="secondary"
          onPress={() =>
            void run(() =>
              api(`${base}/actions`, {
                action: member.user.status === "ACTIVE" ? "disable" : "enable",
              }),
            )
          }
        >
          {member.user.status === "ACTIVE" ? "禁用" : "启用"}
        </Button>
        <Button
          variant="secondary"
          onPress={() =>
            void run(() =>
              api(`${base}/actions`, { action: "renew", days: 30 }),
            )
          }
        >
          续期 30 天
        </Button>
        <Button
          variant="secondary"
          onPress={() => void run(() => api(`${base}/revoke`, {}))}
        >
          撤销旧订阅及凭据
        </Button>
        <Button
          variant="secondary"
          onPress={() =>
            void run(async () => setDevices(await api(`${base}/devices`)))
          }
        >
          订阅设备
        </Button>
      </div>
      <div className="nd-row">
        <select
          aria-label="更换套餐"
          value={packageId}
          onChange={(e) => setPackageId(e.target.value)}
        >
          {packages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          onPress={() =>
            void run(() =>
              api("packages/assign", {
                userId: String(member.userId),
                packageId,
              }),
            )
          }
        >
          分配所选套餐并重新计期
        </Button>
      </div>
      {devices && (
        <div>
          {devices.length ? (
            devices.map((d) => (
              <div key={d.hwid} className="nd-row">
                <code>{d.hwid}</code>
                <span>{d.userAgent}</span>
                <Button
                  variant="danger-soft"
                  onPress={() =>
                    void run(async () => {
                      await api(`${base}/devices`, { hwid: d.hwid }, "DELETE");
                      setDevices(await api(`${base}/devices`));
                    })
                  }
                >
                  移除
                </Button>
              </div>
            ))
          ) : (
            <p>尚未登记设备。此限制只作用于支持 HWID 的订阅客户端。</p>
          )}
        </div>
      )}
    </div>
  );
}

export function ServerTools({ server, run }: { server: Row; run: Run }) {
  const [multiplier, setMultiplier] = useState(
    String(Number(server.node.consumptionMultiplier) / 1e9),
  );
  const [command, setCommand] = useState(""),
    [service, setService] = useState("xray"),
    [sites, setSites] = useState<Row[]>([]);
  const [target, setTarget] = useState("example.com"),
    [url, setUrl] = useState(""),
    [version, setVersion] = useState(""),
    [hash, setHash] = useState("");
  useEffect(() => {
    void run(async () => setSites(await api(`servers/${server.id}/websites`)));
  }, [server.id]);
  const action = (action: string) =>
    run(() =>
      api(`servers/${server.id}/actions`, {
        action,
        service,
        host: target,
        port: 443,
      }),
    );
  return (
    <Card>
      <Card.Header>
        <Card.Title>服务与维护</Card.Title>
      </Card.Header>
      <Card.Content className="nd-stack">
        <label className="nd-field">
          本机用户流量倍率
          <Input
            aria-label="服务器倍率"
            value={multiplier}
            onChange={(e) => setMultiplier(e.target.value)}
          />
        </label>
        <Button
          variant="secondary"
          onPress={() =>
            void run(() =>
              api(
                `servers/${server.id}/multiplier`,
                { multiplier: Number(multiplier) },
                "PUT",
              ),
            )
          }
        >
          保存倍率（生效后只计入新增流量）
        </Button>
        <div className="nd-row">
          <select
            aria-label="服务"
            value={service}
            onChange={(e) => setService(e.target.value)}
          >
            {["xray", "sing-box", "nginx"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <Button variant="secondary" onPress={() => void action("logs")}>
            读取日志
          </Button>
          <Button variant="secondary" onPress={() => void action("restart")}>
            重启服务
          </Button>
          <Button
            variant="secondary"
            onPress={() =>
              void run(() => api(`servers/${server.id}/rotate-credential`, {}))
            }
          >
            轮换 Agent 凭据
          </Button>
        </div>
        <div className="nd-row">
          <Input
            aria-label="TCP 检测目标"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
          <Button variant="secondary" onPress={() => void action("latency")}>
            检测 TCP 443 延迟
          </Button>
        </div>
        <details>
          <summary>一次性命令</summary>
          <p className="nd-muted">
            命令在此服务器上执行，结果显示在任务记录中。每次最多运行 30 秒。
          </p>
          <TextArea
            aria-label="服务器命令"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            rows={3}
          />
          <Button
            isDisabled={!command.trim()}
            onPress={() =>
              void run(() =>
                api(`servers/${server.id}/terminal`, {
                  command,
                  timeoutSeconds: 30,
                }),
              )
            }
          >
            执行命令
          </Button>
        </details>
        <InteractiveTerminal key={server.id} serverId={server.id} available={server.metrics?.terminalAvailable === true} />
        <AgentConnection key={`connection-${server.id}`} server={server} />
        <details>
          <summary>升级 Agent 与协议内核</summary>
          <div className="nd-fields">
            <Input
              aria-label="固定版本号"
              placeholder="版本号，例如 0.2.0"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            />
            <Input
              aria-label="发布包 URL"
              placeholder="HTTPS 发布包 URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Input
              aria-label="SHA256"
              placeholder="发布清单中的 SHA256"
              value={hash}
              onChange={(e) => setHash(e.target.value)}
            />
          </div>
          <Button
            isDisabled={!version || !url || hash.length !== 64}
            onPress={() =>
              void run(() =>
                api("servers/upgrade", {
                  serverIds: [server.id],
                  version,
                  url,
                  sha256: hash,
                }),
              )
            }
          >
            安装固定版本
          </Button>
        </details>
        <h3>网站</h3>
        {sites.length ? (
          sites.map((site) => (
            <div key={site.id} className="nd-row">
              <span>
                {site.domain} · {site.state}
              </span>
              <Button
                variant="danger-soft"
                onPress={() =>
                  void run(async () => {
                    await api(
                      `servers/${server.id}/websites/${site.id}`,
                      {},
                      "DELETE",
                    );
                    setSites(await api(`servers/${server.id}/websites`));
                  })
                }
              >
                移除网站
              </Button>
            </div>
          ))
        ) : (
          <p className="nd-muted">暂无网站；网站发布成功后由 Agent 确认。</p>
        )}
      </Card.Content>
    </Card>
  );
}

export { EngineEditor } from "./engine-editor";

function JsonEditor({
  value,
  save,
}: {
  value: unknown;
  save: (value: any) => Promise<unknown>;
}) {
  const [raw, setRaw] = useState(JSON.stringify(value, null, 2)),
    [error, setError] = useState("");
  return (
    <div className="nd-stack">
      <TextArea
        aria-label="JSON 配置"
        rows={8}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
      />
      {error && <p className="nd-error">{error}</p>}
      <Button
        variant="secondary"
        onPress={() => {
          try {
            const parsed = JSON.parse(raw);
            setError("");
            void save(parsed).catch((e) => setError(e.message));
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        保存这部分配置
      </Button>
    </div>
  );
}

export function BackupSettings({ run }: { run: Run }) {
  return <BackupSettingsForm api={api} run={run} />;
}

export function SubscriptionSettings({ run }: { run: Run }) {
  const [value, setValue] = useState<Row>();
  useEffect(() => {
    void run(async () => setValue(await api("subscription-settings")));
  }, []);
  return (
    <Card>
      <Card.Header>
        <Card.Title>订阅模板与规则</Card.Title>
      </Card.Header>
      <Card.Content>
        <p className="nd-muted">
          支持 mihomo 的 dns、rules、rule-providers、proxy-groups，以及 singbox
          的 dns、route。代理组中的 $NODES 展开为当前用户获准使用的节点。
        </p>
        {value && (
          <JsonEditor
            value={value}
            save={async (value) => {
              await api("subscription-settings", value, "PUT");
            }}
          />
        )}
      </Card.Content>
    </Card>
  );
}
