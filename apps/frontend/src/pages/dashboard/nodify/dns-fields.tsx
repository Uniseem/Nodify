import { Button, TextArea } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import {
  dnsValues,
  moveItem,
  saveDnsHost,
  updateDnsServer,
  xrayDnsErrors,
  type XrayRecord as Row,
} from "@nodify/contract";
import { Choice, Field } from "./editor-fields";
const booleans: [string, string][] = [
  ["default", "内核默认"],
  ["true", "开启"],
  ["false", "关闭"],
];
const number = (text: string) =>
  text.trim() === ""
    ? undefined
    : Number.isFinite(Number(text))
      ? Number(text)
      : text;
const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
function LinesField({
  label,
  value,
  change,
}: {
  label: string;
  value: unknown;
  change: (v: string[]) => void;
}) {
  const [raw, setRaw] = useState(() => dnsValues(value).join("\n"));
  const sent = useRef(JSON.stringify(value));
  useEffect(() => {
    const signature = JSON.stringify(value);
    if (signature !== sent.current) {
      sent.current = signature;
      setRaw(dnsValues(value).join("\n"));
    }
  }, [value]);
  return (
    <label className="nd-field">
      <span>{label}（每行一条）</span>
      <TextArea
        aria-label={label}
        rows={3}
        value={raw}
        onChange={(e) => {
          const text = e.target.value,
            next = lines(text);
          setRaw(text);
          sent.current = JSON.stringify(next);
          change(next);
        }}
      />
    </label>
  );
}
function Toggle({
  label,
  value,
  change,
}: {
  label: string;
  value: unknown;
  change: (v: boolean | undefined) => void;
}) {
  return (
    <Choice
      label={label}
      value={typeof value === "boolean" ? String(value) : "default"}
      options={booleans}
      change={(v) => change(v === "default" ? undefined : v === "true")}
    />
  );
}
function Common({
  v,
  patch,
  scope,
}: {
  v: Row;
  patch: (p: Row) => void;
  scope: string;
}) {
  return (
    <>
      <Choice
        label={`${scope}查询策略`}
        value={v.queryStrategy || "default"}
        options={[
          ["default", "内核默认"],
          ...[
            ...new Set([
              "UseIP",
              "UseIPv4",
              "UseIPv6",
              ...(v.queryStrategy ? [v.queryStrategy] : []),
            ]),
          ].map((s) => [s, s] as [string, string]),
        ]}
        change={(s) =>
          patch({ queryStrategy: s === "default" ? undefined : s })
        }
      />
      <Field
        label={`${scope}客户端 IP（ECS，可空）`}
        value={v.clientIp ?? v.clientIP ?? ""}
        change={(clientIp) =>
          patch({ clientIp: clientIp || undefined, clientIP: undefined })
        }
      />
      <Field
        label={`${scope}路由标识（tag）`}
        value={v.tag ?? ""}
        change={(tag) => patch({ tag: tag || undefined })}
      />
      <Toggle
        label={`${scope}禁用缓存`}
        value={v.disableCache}
        change={(disableCache) => patch({ disableCache })}
      />
      <Toggle
        label={`${scope}允许过期缓存`}
        value={v.serveStale}
        change={(serveStale) => patch({ serveStale })}
      />
      <Field
        label={`${scope}过期缓存 TTL（秒）`}
        type="number"
        value={v.serveExpiredTTL ?? ""}
        change={(text) => patch({ serveExpiredTTL: number(text) })}
      />
    </>
  );
}
export function DnsFields({
  value: dns,
  patch,
  pendingChange,
}: {
  value: Row;
  patch: (v: Row) => void;
  pendingChange: (pending: boolean) => void;
}) {
  const [active, setActive] = useState<number | null>(null),
    [remove, setRemove] = useState<number | null>(null);
  const [host, setHost] = useState<{
      previous: string | null;
      key: string;
      value: string;
      array: boolean;
    } | null>(null),
    [removeHost, setRemoveHost] = useState<string | null>(null),
    [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    pendingChange(Boolean(host));
    return () => pendingChange(false);
  }, [Boolean(host), pendingChange]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  const servers = dns.servers || [];
  const entry = active === null ? null : servers[active];
  const update = (changes: Row) => {
    if (active !== null) patch(updateDnsServer(dns, active, changes));
  };
  const serverList = (next: any[]) => {
    patch({ ...dns, servers: next });
    setRemove(null);
  };
  const changeHost = (changes: Partial<NonNullable<typeof host>>) => {
    if (host) setHost({ ...host, ...changes });
    setError("");
  };
  return (
    <section className="nd-stack nd-full">
      <h4>DNS 解析</h4>
      <p className="nd-muted">
        供 Xray 路由及出站解析使用，不会修改服务器的系统 DNS。普通 DNS
        请求经过路由；带 +local 的地址直接连接。解析器域名应能通过 Hosts
        或可用解析路径解析，避免循环。
      </p>
      <div className="nd-fields" inert={Boolean(host)}>
        <Common v={dns} patch={(p) => patch({ ...dns, ...p })} scope="全局 " />
        {(
          [
            ["disableFallback", "禁用回退"],
            ["disableFallbackIfMatch", "命中域名后禁用回退"],
            ["enableParallelQuery", "并行查询"],
            ["useSystemHosts", "读取系统 Hosts"],
          ] as [string, string][]
        ).map(([key, label]) => (
          <Toggle
            key={key}
            label={label}
            value={dns[key]}
            change={(v) => patch({ ...dns, [key]: v })}
          />
        ))}
      </div>
      <p className="nd-muted">
        ECS
        会把配置的客户端网段信息交给支持它的上游；留空不主动指定。禁用回退后，没有匹配服务器或结果被过滤时可能解析失败。过期缓存和并行查询需要所部署内核支持，发布时执行内核校验。
      </p>
      <div className="nd-stack" inert={Boolean(host)}>
        <div className="nd-row">
          <h4>DNS 服务器（{servers.length}）</h4>
          <Button
            variant="secondary"
            isDisabled={remove !== null}
            onPress={() => {
              serverList([...servers, ""]);
              setActive(servers.length);
            }}
          >
            添加 DNS 服务器
          </Button>
        </div>
        {!servers.length && (
          <p className="nd-empty">
            尚未指定 DNS 服务器。可添加 UDP、TCP、DoH、localhost 等地址。
          </p>
        )}
        {servers.map((server: any, index: number) => (
          <div className="nd-entry-form nd-row" key={index}>
            <strong style={{ overflowWrap: "anywhere", maxWidth: "100%" }}>
              {index + 1}.{" "}
              {typeof server === "string"
                ? server || "未填写地址"
                : server.address || "未填写地址"}{" "}
              {typeof server === "string" ? "· 简单地址" : "· 高级配置"}
            </strong>
            <div className="nd-row">
              <Button
                variant="secondary"
                isDisabled={remove !== null}
                onPress={() => setActive(active === index ? null : index)}
              >
                {active === index ? "收起 DNS 配置" : `编辑 DNS ${index + 1}`}
              </Button>
              <Button
                variant="tertiary"
                aria-label={`上移 DNS ${index + 1}`}
                isDisabled={index === 0 || remove !== null}
                onPress={() => {
                  serverList(moveItem(servers, index, index - 1));
                  setActive(null);
                }}
              >
                ↑
              </Button>
              <Button
                variant="tertiary"
                aria-label={`下移 DNS ${index + 1}`}
                isDisabled={index === servers.length - 1 || remove !== null}
                onPress={() => {
                  serverList(moveItem(servers, index, index + 1));
                  setActive(null);
                }}
              >
                ↓
              </Button>
              <Button
                variant="tertiary"
                isDisabled={remove !== null}
                onPress={() => setRemove(index)}
              >{`删除 DNS ${index + 1}`}</Button>
            </div>
            {remove === index && (
              <div className="nd-row">
                <p>从草稿移除此 DNS 服务器？其余服务器顺序保留。</p>
                <Button
                  variant="danger"
                  onPress={() => {
                    serverList(
                      servers.filter((_: any, i: number) => i !== index),
                    );
                    setActive(null);
                  }}
                >
                  确认移除 DNS
                </Button>
                <Button variant="secondary" onPress={() => setRemove(null)}>
                  保留 DNS
                </Button>
              </div>
            )}
          </div>
        ))}
        {entry !== null && entry !== undefined && active !== null && (
          <section className="nd-entry-form nd-stack">
            <h4>编辑第 {active + 1} 个 DNS 服务器</h4>
            <Field
              label="DNS 服务器地址"
              value={typeof entry === "string" ? entry : entry.address}
              change={(address) => {
                if (typeof entry === "string") {
                  const next = [...servers];
                  next[active] = address;
                  serverList(next);
                } else update({ address });
              }}
            />
            {typeof entry === "string" ? (
              <Button variant="secondary" onPress={() => update({})}>
                启用高级 DNS 设置
              </Button>
            ) : (
              <>
                <div className="nd-fields">
                  <Field
                    label="DNS 端口（0 为内核默认）"
                    type="number"
                    value={entry.port ?? ""}
                    change={(text) => update({ port: number(text) })}
                  />
                  <Field
                    label="DNS 超时（毫秒）"
                    type="number"
                    value={entry.timeoutMs ?? ""}
                    change={(text) => update({ timeoutMs: number(text) })}
                  />
                  <p className="nd-muted">
                    UDP 地址可使用独立端口字段；TCP、DoH 等 URL 地址请在 URL
                    中填写端口。
                  </p>
                  <Common v={entry} patch={update} scope="此服务器 " />
                  <Toggle
                    label="不参与回退"
                    value={entry.skipFallback}
                    change={(skipFallback) => update({ skipFallback })}
                  />
                  <Toggle
                    label="此服务器之后停止查询"
                    value={entry.finalQuery}
                    change={(finalQuery) => update({ finalQuery })}
                  />
                </div>
                <LinesField
                  key={`${active}/domains`}
                  label="优先匹配域名"
                  value={entry.domains}
                  change={(domains) => update({ domains })}
                />
                <LinesField
                  key={`${active}/expected`}
                  label="期望 IP 范围"
                  value={
                    dnsValues(entry.expectedIPs).length
                      ? entry.expectedIPs
                      : entry.expectIPs
                  }
                  change={(expectedIPs) =>
                    update({ expectedIPs, expectIPs: undefined })
                  }
                />
                <LinesField
                  key={`${active}/unexpected`}
                  label="排除 IP 范围"
                  value={entry.unexpectedIPs}
                  change={(unexpectedIPs) => update({ unexpectedIPs })}
                />
                <p className="nd-muted">
                  域名支持 domain:、full:、regexp:、geosite: 等内核规则；IP
                  范围支持 CIDR 和 geoip:。规则资源必须存在于 Agent
                  的内核资源目录。期望范围过滤为空时可继续回退；finalQuery
                  会截断后面的查询。列表顺序参与优先级判断。未覆盖字段保留，可在系统高级
                  JSON 中编辑。
                </p>
              </>
            )}
          </section>
        )}
      </div>
      <h4>静态 Hosts 映射</h4>
      {error && (
        <p className="nd-error" role="alert" tabIndex={-1} ref={errorRef}>
          {error}
        </p>
      )}
      <div className="nd-stack" inert={Boolean(host)}>
        {!Object.keys(dns.hosts || {}).length && (
          <p className="nd-empty">没有自定义 Hosts 映射。</p>
        )}
        {Object.entries(dns.hosts || {}).map(([key, value]) => (
          <div className="nd-row nd-entry-form" key={key}>
            <span style={{ overflowWrap: "anywhere", maxWidth: "100%" }}>
              {key} →{" "}
              {(Array.isArray(value) ? value : [value]).join("、") || "空列表"}
            </span>
            <Button
              variant="secondary"
              isDisabled={removeHost !== null}
              onPress={() => {
                setError("");
                setHost({
                  previous: key,
                  key,
                  value: (Array.isArray(value) ? value : [value]).join("\n"),
                  array: Array.isArray(value),
                });
              }}
            >
              编辑 Hosts {key}
            </Button>
            <Button
              variant="tertiary"
              isDisabled={removeHost !== null}
              onPress={() => setRemoveHost(key)}
            >
              移除 Hosts {key}
            </Button>
            {removeHost === key && (
              <div className="nd-row">
                <Button
                  variant="danger"
                  onPress={() => {
                    patch({
                      ...dns,
                      hosts: Object.fromEntries(
                        Object.entries(dns.hosts).filter(
                          ([name]) => name !== key,
                        ),
                      ),
                    });
                    setRemoveHost(null);
                  }}
                >
                  确认移除 Hosts
                </Button>
                <Button variant="secondary" onPress={() => setRemoveHost(null)}>
                  保留 Hosts
                </Button>
              </div>
            )}
          </div>
        ))}
        <Button
          variant="secondary"
          isDisabled={removeHost !== null}
          onPress={() => {
            setError("");
            setHost({ previous: null, key: "", value: "", array: false });
          }}
        >
          添加 Hosts 映射
        </Button>
      </div>
      {host && (
        <div className="nd-entry-form nd-stack">
          <Field
            label="Hosts 匹配域名"
            value={host.key}
            change={(key) => changeHost({ key })}
          />
          <Choice
            label="Hosts 地址形式"
            value={host.array ? "array" : "single"}
            options={[
              ["single", "单个地址"],
              ["array", "地址列表"],
            ]}
            change={(value) => changeHost({ array: value === "array" })}
          />
          <label className="nd-field">
            <span>Hosts 目标地址（列表每行一条）</span>
            <TextArea
              aria-label="Hosts 目标地址"
              rows={3}
              value={host.value}
              onChange={(e) => changeHost({ value: e.target.value })}
            />
          </label>
          <p className="nd-muted">
            地址可以是 IP
            或另一个域名。使用多个地址时选择列表，域名转发与空列表的具体行为由内核决定。
          </p>
          <div className="nd-row">
            <Button
              onPress={() => {
                try {
                  const next = saveDnsHost(
                    dns,
                    host.previous,
                    host.key.trim(),
                    host.array ? lines(host.value) : host.value.trim(),
                  );
                  const problems = xrayDnsErrors({ hosts: next.hosts });
                  if (problems.length) throw new Error(problems.join("；"));
                  patch(next);
                  setHost(null);
                  setError("");
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              写入 Hosts 条目
            </Button>
            <Button
              variant="secondary"
              onPress={() => {
                setHost(null);
                setError("");
              }}
            >
              取消 Hosts 编辑
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
