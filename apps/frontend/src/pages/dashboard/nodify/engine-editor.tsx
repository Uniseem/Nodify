import { SystemFields } from "./system-fields";
import { WireguardFields } from "./wireguard-fields";
import { Choice, Field } from "./editor-fields";
import { Button, Card, Tabs, TextArea } from "@heroui/react";
import {
  ConfigInput,
  moveItem,
  renameOutbound,
  routeWarnings,
  splitValues,
  xrayOutbounds,
  xrayShapeErrors,
  withBalancingObservers,
  type TConfig,
  type XrayRecord as Row,
} from "@nodify/contract";
import { useEffect, useRef, useState, type ReactNode } from "react";

function ObjectForm({
  value,
  title,
  kind,
  fields,
  save,
  cancel,
  onEdit,
}: {
  value: Row;
  title: string;
  kind: Editing["kind"];
  fields: (
    v: Row,
    patch: (p: Row) => void,
    pending: (value: boolean) => void,
  ) => ReactNode;
  save: (v: Row) => boolean;
  cancel: () => void;
  onEdit?: () => void;
}) {
  const [raw, setRaw] = useState(JSON.stringify(value, null, 2)),
    [advanced, setAdvanced] = useState(false),
    [error, setError] = useState(""),
    [fieldPending, setFieldPending] = useState(false);
  let parsed = value,
    parseError = "";
  try {
    parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("请输入 JSON 对象");
  } catch (e) {
    parseError = (e as Error).message;
  }
  if (!parseError)
    parseError = xrayShapeErrors(
      kind === "system"
        ? parsed
        : kind === "outbounds"
          ? { outbounds: [parsed] }
          : { routing: { [kind]: [parsed] } },
    ).join("；");
  return (
    <form
      className="nd-stack nd-entry-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (fieldPending) return;
        if (parseError) {
          setError(parseError);
          return;
        }
        if (save(parsed)) cancel();
      }}
    >
      <div className="nd-row">
        <h3>{title}</h3>
        <Button
          variant="tertiary"
          isDisabled={fieldPending || (advanced && Boolean(parseError))}
          onPress={() => setAdvanced(!advanced)}
        >
          {advanced ? "表单模式" : "高级 JSON"}
        </Button>
      </div>
      {advanced ? (
        <TextArea
          aria-label={`${title} JSON`}
          rows={15}
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setError("");
            onEdit?.();
          }}
        />
      ) : (
        !parseError && (
          <fieldset className="nd-fields">
            {fields(
              parsed,
              (p) => {
                setRaw(JSON.stringify({ ...parsed, ...p }, null, 2));
                onEdit?.();
              },
              setFieldPending,
            )}
          </fieldset>
        )
      )}
      {(parseError || error) && (
        <p className="nd-error" role="alert">
          {parseError || error}
        </p>
      )}
      <div className="nd-row">
        {fieldPending && (
          <p role="status">请先写入或取消正在编辑的条目，再保存系统草稿。</p>
        )}
        <Button type="submit" isDisabled={fieldPending || Boolean(parseError)}>
          写入草稿
        </Button>
        <Button variant="secondary" onPress={cancel}>
          取消编辑
        </Button>
      </div>
    </form>
  );
}
const protocols = [
  "freedom",
  "blackhole",
  "socks",
  "http",
  "vless",
  "vmess",
  "trojan",
  "shadowsocks",
  "wireguard",
  "hysteria",
  "dns",
  "loopback",
];
function OutboundFields({
  value: v,
  patch,
}: {
  value: Row;
  patch: (p: Row) => void;
}) {
  const vnext = ["vless", "vmess"].includes(v.protocol),
    key = vnext ? "vnext" : "servers";
  const server = v.settings?.[key]?.[0] ?? {},
    user = server.users?.[0] ?? {};
  const settings = (p: Row) => patch({ settings: { ...v.settings, ...p } });
  const updateServer = (p: Row) =>
    settings({
      [key]: [
        {
          port: 443,
          ...(v.protocol === "shadowsocks" ? { method: "aes-256-gcm" } : {}),
          ...server,
          ...p,
        },
        ...(v.settings?.[key]?.slice(1) ?? []),
      ],
    });
  const updateUser = (p: Row) =>
    updateServer({
      users: [{ ...user, ...p }, ...(server.users?.slice(1) ?? [])],
    });
  const proxy = [
    "socks",
    "http",
    "vless",
    "vmess",
    "trojan",
    "shadowsocks",
  ].includes(v.protocol);
  return (
    <>
      <Field label="出站标识" value={v.tag} change={(tag) => patch({ tag })} />
      <Choice
        label="出站协议"
        value={v.protocol}
        options={[...new Set([...protocols, v.protocol])].map((p) => [p, p])}
        change={(protocol) =>
          patch({
            protocol,
            settings:
              protocol === "wireguard"
                ? {
                    noKernelTun: true,
                    peers: [{ endpoint: "", publicKey: "" }],
                  }
                : {},
            streamSettings: undefined,
          })
        }
      />
      {v.protocol === "freedom" && (
        <Choice
          label="出站域名解析"
          value={v.settings?.domainStrategy || "AsIs"}
          options={["AsIs", "UseIP", "UseIPv4", "UseIPv6"].map((v) => [v, v])}
          change={(domainStrategy) => settings({ domainStrategy })}
        />
      )}
      {v.protocol === "wireguard" && (
        <WireguardFields
          value={v.settings || {}}
          change={(settings) => patch({ settings })}
        />
      )}
      {proxy && (
        <>
          <Field
            label="主服务器地址"
            value={server.address}
            change={(address) => updateServer({ address })}
          />
          <Field
            label="服务器端口"
            type="number"
            value={server.port ?? 443}
            change={(port) => updateServer({ port: Number(port) })}
          />
          {vnext ? (
            <Field
              label="用户 UUID"
              value={user.id}
              change={(id) =>
                updateUser({
                  id,
                  ...(v.protocol === "vless" ? { encryption: "none" } : {}),
                })
              }
            />
          ) : ["socks", "http"].includes(v.protocol) ? (
            <>
              <Field
                label="用户名（可选）"
                value={user.user}
                change={(user) => updateUser({ user })}
              />
              <Field
                label="认证密码"
                type="password"
                value={user.pass}
                change={(pass) => updateUser({ pass })}
              />
            </>
          ) : (
            <Field
              label="协议密码"
              type="password"
              value={server.password}
              change={(password) => updateServer({ password })}
            />
          )}
          {v.protocol === "shadowsocks" && (
            <Field
              label="加密算法"
              value={server.method || "aes-256-gcm"}
              change={(method) => updateServer({ method })}
            />
          )}
          {v.protocol !== "shadowsocks" && (
            <>
              <Choice
                label="出站安全层"
                value={v.streamSettings?.security || "none"}
                options={["none", "tls", "reality"].map((p) => [p, p])}
                change={(security) =>
                  patch({ streamSettings: { ...v.streamSettings, security } })
                }
              />
              {v.streamSettings?.security === "tls" && (
                <Field
                  label="TLS 服务器名称"
                  value={v.streamSettings?.tlsSettings?.serverName}
                  change={(serverName) =>
                    patch({
                      streamSettings: {
                        ...v.streamSettings,
                        tlsSettings: {
                          ...v.streamSettings?.tlsSettings,
                          serverName,
                        },
                      },
                    })
                  }
                />
              )}
            </>
          )}
        </>
      )}
      <p className="nd-muted nd-full">
        高级 JSON
        可配置传输、REALITY、多个代理服务器及未覆盖的高级字段。切换协议会重置该出站的协议参数和传输配置。
      </p>
    </>
  );
}
const ruleArrays = [
  ["domain", "域名匹配"],
  ["ip", "目标 IP / CIDR"],
  ["protocol", "协议匹配"],
  ["sourceIP", "来源 IP"],
  ["user", "用户标识"],
] as const;
const ruleStrings = [
  ["port", "目标端口 / 范围"],
  ["sourcePort", "来源端口"],
] as const;
type Editing = {
  kind: "outbounds" | "rules" | "balancers" | "system";
  index: number;
  value: Row;
};
export function EngineEditor({
  config,
  change,
  pendingChange,
}: {
  config: TConfig;
  change: (config: TConfig) => void;
  pendingChange?: (pending: boolean) => void;
}) {
  const x = config.xray as Row,
    outbounds = xrayOutbounds(x),
    rules: Row[] = x.routing?.rules ?? [],
    balancers: Row[] = x.routing?.balancers ?? [];
  const [tab, setTab] = useState("outbounds"),
    [editing, setEditing] = useState<Editing | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [undo, setUndo] = useState<Row | null>(null),
    [scope, setScope] = useState("all"),
    [dragging, setDragging] = useState<number | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    pendingChange?.(Boolean(editing));
    return () => pendingChange?.(false);
  }, [editing, pendingChange]);
  const commit = (next: Row): boolean => {
    try {
      const parsed = ConfigInput.parse({ ...config, xray: next });
      setUndo(structuredClone(x));
      change(parsed);
      setError("");
      setNotice("已更新本地草稿；保存并发布后，由 Agent 确认生效。");
      return true;
    } catch (e) {
      setError(
        e instanceof Error && "issues" in e
          ? (e as any).issues.map((i: any) => i.message).join("；")
          : (e as Error).message,
      );
      return false;
    }
  };
  const setList = (kind: string, value: Row[]) =>
    commit(
      kind === "outbounds"
        ? { ...x, outbounds: value }
        : { ...x, routing: { ...x.routing, [kind]: value } },
    );
  const edit = (kind: Editing["kind"], index: number, value: Row) => {
    setError("");
    setEditing({ kind, index, value: structuredClone(value) });
  };
  const saveEntry = (value: Row) => {
    if (!editing) return false;
    const { kind, index } = editing;
    if (kind === "system") return commit(withBalancingObservers(value));
    if (
      kind === "outbounds" &&
      ["socks", "http", "vless", "vmess", "trojan", "shadowsocks"].includes(
        value.protocol,
      )
    ) {
      const server =
        value.settings?.[
          ["vless", "vmess"].includes(value.protocol) ? "vnext" : "servers"
        ]?.[0];
      if (
        !server?.address?.trim() ||
        !Number.isInteger(server.port) ||
        server.port < 1 ||
        server.port > 65535
      ) {
        setError("请填写服务器地址和有效端口");
        return false;
      }
      if (
        ["vless", "vmess"].includes(value.protocol) &&
        !server.users?.[0]?.id
      ) {
        setError("请填写用户 UUID");
        return false;
      }
      if (
        ["trojan", "shadowsocks"].includes(value.protocol) &&
        !server.password
      ) {
        setError("请填写协议密码");
        return false;
      }
    }
    const list = [
      ...(kind === "outbounds"
        ? outbounds
        : kind === "rules"
          ? rules
          : balancers),
    ];
    if (kind === "outbounds" && index >= 0) {
      try {
        return commit(renameOutbound(x, index, value));
      } catch (e) {
        setError((e as Error).message);
        return false;
      }
    }
    if (index < 0) list.push(value);
    else list[index] = value;
    let next: Row =
      kind === "outbounds"
        ? { ...x, outbounds: list }
        : { ...x, routing: { ...x.routing, [kind]: list } };
    if (kind === "balancers") {
      const oldTag = index >= 0 ? balancers[index].tag : undefined;
      if (oldTag && oldTag !== value.tag)
        next = {
          ...next,
          routing: {
            ...next.routing,
            rules: rules.map((r) =>
              r.balancerTag === oldTag ? { ...r, balancerTag: value.tag } : r,
            ),
          },
        };
      next = withBalancingObservers(next);
    }
    return commit(next);
  };
  const destinations: [string, string][] = [
    ...outbounds
      .filter((o) => o.tag)
      .map((o) => [`out:${o.tag}`, `出站 · ${o.tag}`] as [string, string]),
    ...balancers.map(
      (b) => [`bal:${b.tag}`, `均衡 · ${b.tag}`] as [string, string],
    ),
  ];
  const ruleFields = (v: Row, patch: (p: Row) => void) => (
    <>
      <Field
        label="规则名称"
        value={v.ruleTag}
        change={(ruleTag) => patch({ ruleTag })}
      />
      <Choice
        label="路由目标"
        value={v.balancerTag ? `bal:${v.balancerTag}` : `out:${v.outboundTag}`}
        options={destinations}
        change={(target) =>
          patch(
            target.startsWith("bal:")
              ? { balancerTag: target.slice(4), outboundTag: undefined }
              : { outboundTag: target.slice(4), balancerTag: undefined },
          )
        }
      />
      <Choice
        label="网络类型"
        value={v.network || "any"}
        options={[
          ["any", "不限"],
          ["tcp", "TCP"],
          ["udp", "UDP"],
          ["tcp,udp", "TCP 和 UDP（全部流量）"],
        ]}
        change={(network) =>
          patch({ network: network === "any" ? undefined : network })
        }
      />
      <Field
        label="入站标识（逗号分隔，空表示全部）"
        value={v.inboundTag?.join(", ") || ""}
        change={(v) =>
          patch({
            inboundTag: splitValues(v).length ? splitValues(v) : undefined,
          })
        }
      />
      <p className="nd-muted nd-full">
        {config.inbounds
          .filter((i) => i.protocol !== "anytls")
          .map((i) => `${i.name}: ${i.id}`)
          .join("；") || "尚未添加 Xray 入站"}
      </p>
      {ruleArrays.map(([key, label]) => (
        <Field
          key={key}
          label={label}
          value={v[key]?.join(", ") || ""}
          change={(value) =>
            patch({
              [key]: splitValues(value).length ? splitValues(value) : undefined,
            })
          }
        />
      ))}
      {ruleStrings.map(([key, label]) => (
        <Field
          key={key}
          label={label}
          value={v[key]}
          change={(value) => patch({ [key]: value || undefined })}
        />
      ))}
      <p className="nd-muted nd-full">
        多个值用逗号或换行分隔。不同条件同时满足才匹配；列表从上到下命中第一条后停止。高级
        JSON 保留其他匹配字段。
      </p>
    </>
  );
  const balanceFields = (v: Row, patch: (p: Row) => void) => (
    <>
      <Field
        label="负载均衡标识"
        value={v.tag}
        change={(tag) => patch({ tag })}
      />
      <Field
        label="出站前缀（逗号分隔）"
        value={v.selector?.join(", ") || ""}
        change={(value) => patch({ selector: splitValues(value) })}
      />
      <Choice
        label="分流策略"
        value={v.strategy?.type || "random"}
        options={[
          ["random", "随机"],
          ["roundRobin", "轮询"],
          ["leastPing", "最低延迟"],
          ["leastLoad", "最低负载"],
        ]}
        change={(type) => patch({ strategy: { ...v.strategy, type } })}
      />
      <Choice
        label="备用出站"
        value={v.fallbackTag || "none"}
        options={[
          ["none", "不指定"],
          ...outbounds
            .filter((o) => o.tag)
            .map((o) => [o.tag, o.tag] as [string, string]),
        ]}
        change={(value) =>
          patch({ fallbackTag: value === "none" ? undefined : value })
        }
      />
      <p className="nd-muted nd-full">
        匹配出站：
        {outbounds
          .filter(
            (o) =>
              o.tag && v.selector?.some((p: string) => o.tag.startsWith(p)),
          )
          .map((o) => o.tag)
          .join("、") || "无"}
        。最低延迟、最低负载或备用出站会自动加入连接观测；探测地址与频率可在系统配置中编辑。
      </p>
    </>
  );
  const list =
    tab === "outbounds" ? outbounds : tab === "rules" ? rules : balancers;
  return (
    <Card>
      <Card.Header>
        <Card.Title>Xray 流量与系统配置</Card.Title>
      </Card.Header>
      <Card.Content className="nd-stack">
        <Tabs
          className="nd-engine-tabs"
          selectedKey={tab}
          onSelectionChange={(key) => {
            setTab(String(key));
            setError("");
          }}
        >
          <Tabs.ListContainer>
            <Tabs.List aria-label="Xray 配置分类">
              {[
                ["outbounds", "出站"],
                ["rules", "路由"],
                ["balancers", "负载均衡"],
                ["system", "DNS 与系统"],
              ].map(([id, label]) => (
                <Tabs.Tab
                  id={id}
                  key={id}
                  isDisabled={Boolean(editing) && tab !== id}
                >
                  {label}
                  <Tabs.Indicator />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.ListContainer>
          <Tabs.Panel key={tab} id={tab} className="nd-stack">
            {error && (
              <p role="alert" className="nd-error" tabIndex={-1} ref={errorRef}>
                {error}
              </p>
            )}
            {notice && (
              <div className="nd-row" role="status">
                <span>{notice}</span>
                <Button
                  variant="tertiary"
                  isDisabled={!undo || Boolean(editing)}
                  onPress={() => {
                    if (undo) {
                      change({ ...config, xray: undo });
                      setUndo(null);
                      setNotice("已撤销上一步修改");
                    }
                  }}
                >
                  撤销上一步
                </Button>
              </div>
            )}
            {tab === "system" ? (
              <>
                <p className="nd-muted">
                  表单修改保留高级 DNS 对象、策略、日志路径和观测设置。API
                  与用户统计由 Agent 管理。
                </p>
                {editing ? (
                  <ObjectForm
                    key="system"
                    onEdit={() => setError("")}
                    kind="system"
                    title="系统配置"
                    value={editing.value}
                    save={saveEntry}
                    cancel={() => setEditing(null)}
                    fields={(v, patch, pendingChange) => (
                      <SystemFields
                        value={v}
                        patch={patch}
                        pendingChange={pendingChange}
                      />
                    )}
                  />
                ) : (
                  <>
                    <div className="nd-row">
                      <span>日志：{x.log?.loglevel || "warning"}</span>
                      <span>DNS 服务器：{x.dns?.servers?.length ?? 0}</span>
                    </div>
                    <Button onPress={() => edit("system", 0, x)}>
                      编辑系统配置
                    </Button>
                  </>
                )}
              </>
            ) : (
              <>
                <div className="nd-row">
                  <Button
                    isDisabled={Boolean(editing)}
                    onPress={() =>
                      edit(
                        tab as Editing["kind"],
                        -1,
                        tab === "outbounds"
                          ? {
                              tag: `proxy-${outbounds.length + 1}`,
                              protocol: "freedom",
                              settings: {},
                            }
                          : tab === "rules"
                            ? {
                                type: "field",
                                outboundTag: outbounds[0]?.tag,
                                network: "tcp,udp",
                                ...(scope !== "all"
                                  ? { inboundTag: [scope] }
                                  : {}),
                              }
                            : {
                                tag: `balance-${balancers.length + 1}`,
                                selector: [],
                                strategy: { type: "random" },
                              },
                      )
                    }
                  >
                    添加
                    {tab === "outbounds"
                      ? "出站"
                      : tab === "rules"
                        ? "规则"
                        : "负载均衡器"}
                  </Button>
                  <span className="nd-muted">
                    共 {list.length} 项
                    {tab === "outbounds"
                      ? ` · 默认出站：${outbounds[0]?.tag || "未命名"}`
                      : ""}
                  </span>
                </div>
                {tab === "rules" && (
                  <>
                    <Choice
                      label="查看入站路由"
                      value={scope}
                      options={[
                        ["all", "全部入站"],
                        ...config.inbounds
                          .filter((i) => i.protocol !== "anytls")
                          .map((i) => [i.id, i.name] as [string, string]),
                      ]}
                      change={setScope}
                    />
                    <div className="nd-row">
                      {[
                        [
                          "禁止 BT",
                          { protocol: ["bittorrent"], outboundTag: "block" },
                        ],
                        [
                          "禁止内网",
                          {
                            ip: [
                              "127.0.0.0/8",
                              "10.0.0.0/8",
                              "172.16.0.0/12",
                              "192.168.0.0/16",
                              "::1/128",
                              "fc00::/7",
                              "169.254.0.0/16",
                              "fe80::/10",
                            ],
                            outboundTag: "block",
                          },
                        ],
                      ].map(([name, rule]) => (
                        <Button
                          key={String(name)}
                          variant="secondary"
                          isDisabled={
                            Boolean(editing) ||
                            !outbounds.some((o) => o.tag === "block")
                          }
                          onPress={() =>
                            edit("rules", -1, {
                              type: "field",
                              ruleTag: name,
                              ...(rule as Row),
                              ...(scope !== "all"
                                ? { inboundTag: [scope] }
                                : {}),
                            })
                          }
                        >
                          {String(name)}
                        </Button>
                      ))}
                    </div>
                    {routeWarnings(rules).map((w) => (
                      <p className="nd-notice" key={w}>
                        {w}
                      </p>
                    ))}
                    <p className="nd-muted">
                      先匹配上方规则；可拖动卡片排序，也可使用上移、下移按钮。查看特定入站时仍显示全局规则并保留原始顺序。
                    </p>
                  </>
                )}
                <div className="nd-engine-layout">
                  <div className="nd-stack" aria-label={`${tab}列表`}>
                    {list.map((item, index) =>
                      tab === "rules" &&
                      scope !== "all" &&
                      item.inboundTag?.length &&
                      !item.inboundTag.includes(scope) ? null : (
                        <div
                          key={index}
                          className="nd-engine-entry"
                          draggable={!editing && tab !== "balancers"}
                          onDragStart={() => setDragging(index)}
                          onDragEnd={() => setDragging(null)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (dragging !== null && !editing)
                              setList(tab, moveItem(list, dragging, index));
                            setDragging(null);
                          }}
                        >
                          <strong>
                            {index + 1}.{" "}
                            {item.tag ||
                              item.ruleTag ||
                              (tab === "rules" ? "路由规则" : "未命名出站")}
                          </strong>
                          <span className="nd-muted">
                            {tab === "rules"
                              ? `${item.inboundTag?.length ? "指定入站" : "全局"} → ${item.outboundTag || item.balancerTag}`
                              : item.protocol || item.strategy?.type}
                          </span>
                          <div className="nd-row">
                            <Button
                              variant="secondary"
                              isDisabled={Boolean(editing)}
                              onPress={() =>
                                edit(tab as Editing["kind"], index, item)
                              }
                            >
                              编辑
                            </Button>
                            <Button
                              variant="tertiary"
                              aria-label={`上移第 ${index + 1} 项`}
                              isDisabled={Boolean(editing) || index === 0}
                              onPress={() =>
                                setList(tab, moveItem(list, index, index - 1))
                              }
                            >
                              ↑
                            </Button>
                            <Button
                              variant="tertiary"
                              aria-label={`下移第 ${index + 1} 项`}
                              isDisabled={
                                Boolean(editing) || index === list.length - 1
                              }
                              onPress={() =>
                                setList(tab, moveItem(list, index, index + 1))
                              }
                            >
                              ↓
                            </Button>
                            <Button
                              variant="danger-soft"
                              isDisabled={Boolean(editing)}
                              onPress={() =>
                                setList(
                                  tab,
                                  list.filter((_, i) => i !== index),
                                )
                              }
                            >
                              删除
                            </Button>
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                  {editing ? (
                    <ObjectForm
                      key={`${editing.kind}-${editing.index}`}
                      kind={editing.kind}
                      title={
                        editing.kind === "outbounds"
                          ? "编辑出站"
                          : editing.kind === "rules"
                            ? "编辑路由规则"
                            : "编辑负载均衡器"
                      }
                      value={editing.value}
                      save={saveEntry}
                      cancel={() => setEditing(null)}
                      fields={(v, patch) =>
                        editing.kind === "outbounds" ? (
                          <OutboundFields value={v} patch={patch} />
                        ) : editing.kind === "rules" ? (
                          ruleFields(v, patch)
                        ) : (
                          balanceFields(v, patch)
                        )
                      }
                    />
                  ) : (
                    <div className="nd-empty">
                      选择一项进行编辑，或添加新配置。所有修改先写入草稿。
                    </div>
                  )}
                </div>
              </>
            )}
          </Tabs.Panel>
        </Tabs>
      </Card.Content>
    </Card>
  );
}
