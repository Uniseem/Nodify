import { Button, Card, TextArea } from "@heroui/react";
import {
  ConfigInput,
  Inbound,
  PROTOCOL_CAPABILITIES,
  splitValues,
  type TConfig,
  type TInbound,
} from "@nodify/contract";
import { useEffect, useState } from "react";
import { Choice, Field } from "./editor-fields";
import { InboundTransportFields } from "./inbound-transport-fields";

type Row = Record<string, any>;
const titles: Record<string, string> = {
  vless: "VLESS",
  vmess: "VMess",
  trojan: "Trojan",
  shadowsocks: "Shadowsocks",
  hysteria2: "Hysteria2",
  anytls: "AnyTLS",
  tunnel: "端口转发",
};
const describe = (e: unknown) =>
  e instanceof Error && "issues" in e
    ? (e as any).issues
        .map((i: any) => `${i.path.join(".")} ${i.message}`)
        .join("；")
    : String(e instanceof Error ? e.message : e);
const options = (values: string[]) =>
  values.map((v) => [v, v.toUpperCase()] as [string, string]);

function InboundForm({
  initial,
  certificates,
  nodes,
  save,
  cancel,
}: {
  initial: Row;
  certificates: Row[];
  nodes: Row[];
  save: (value: TInbound) => void;
  cancel: () => void;
}) {
  const [value, setValue] = useState(initial),
    [raw, setRaw] = useState(JSON.stringify(initial, null, 2)),
    [advanced, setAdvanced] = useState(false),
    [preview, setPreview] = useState(false),
    [error, setError] = useState(""),
    [keyBusy, setKeyBusy] = useState(false);
  const patch = (fields: Row) => {
    setValue((v) => ({ ...v, ...fields }));
    setPreview(false);
    setError("");
  };
  const capability = PROTOCOL_CAPABILITIES[value.protocol];
  const securityChoices = capability.security.filter(
    (s) => s !== "reality" || value.network !== "ws",
  );
  const vision =
    value.protocol === "vless" &&
    value.network === "tcp" &&
    value.security !== "none";
  const parsedValue = () => {
    const next = Inbound.parse(advanced ? JSON.parse(raw) : value);
    if (next.id !== initial.id)
      throw new Error("入站标识不可修改；保留标识才能维持路由和套餐关联");
    return next;
  };
  const generateKeys = async () => {
    setKeyBusy(true);
    setError("");
    try {
      const pair = (await crypto.subtle.generateKey({ name: "X25519" }, true, [
        "deriveBits",
      ])) as CryptoKeyPair;
      const [privateKey, publicKey] = await Promise.all([
        crypto.subtle.exportKey("jwk", pair.privateKey),
        crypto.subtle.exportKey("jwk", pair.publicKey),
      ]);
      if (!privateKey.d || !publicKey.x)
        throw new Error("浏览器未返回 X25519 密钥");
      patch({
        realityPrivateKey: privateKey.d,
        realityPublicKey: publicKey.x,
        shortId: Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join(""),
      });
    } catch (e) {
      setError(
        `密钥生成失败，请使用支持 Web Crypto 的 HTTPS 浏览器或手动填写。${describe(e)}`,
      );
    } finally {
      setKeyBusy(false);
    }
  };
  return (
    <form
      className="nd-entry-form nd-stack"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          save(parsedValue());
        } catch (e) {
          setError(describe(e));
        }
      }}
    >
      <div className="nd-row">
        <h3>{initial.name ? "编辑入站" : "添加入站"}</h3>
        <Button
          variant="tertiary"
          onPress={() => {
            try {
              if (advanced) {
                setValue(parsedValue());
                setAdvanced(false);
              } else {
                setRaw(JSON.stringify(value, null, 2));
                setAdvanced(true);
              }
              setError("");
              setPreview(false);
            } catch (e) {
              setError(describe(e));
            }
          }}
        >
          {advanced ? "返回向导" : "入站 JSON"}
        </Button>
      </div>
      {advanced ? (
        <TextArea
          aria-label="入站 JSON"
          rows={18}
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setPreview(false);
          }}
        />
      ) : (
        <div className="nd-fields">
          <Field
            label="入站名称"
            value={value.name}
            change={(name) => patch({ name })}
          />
          <Choice
            label="入站协议"
            value={value.protocol}
            options={Object.entries(titles)}
            change={(protocol) => {
              const c = PROTOCOL_CAPABILITIES[protocol];
              patch({
                protocol,
                network: c.networks[0],
                security: c.security[0],
                flow: "",
                extra: {},
              });
            }}
          />
          <Field
            label="监听端口"
            type="number"
            value={value.port}
            change={(port) => patch({ port: Number(port) })}
          />
          <Choice
            label="入站传输"
            value={value.network}
            options={options(capability.networks)}
            change={(network) =>
              patch({
                network,
                flow: network === "tcp" ? value.flow : "",
                ...(network === "ws" && value.security === "reality"
                  ? { security: "tls" }
                  : {}),
              })
            }
          />
          <Choice
            label="入站安全层"
            value={value.security}
            options={options(securityChoices)}
            change={(security) =>
              patch({ security, flow: security === "none" ? "" : value.flow })
            }
          />
          {vision && (
            <Choice
              label="VLESS Flow"
              value={value.flow || "none"}
              options={[
                ["none", "不启用 Vision"],
                ["xtls-rprx-vision", "XTLS Vision"],
              ]}
              change={(flow) => patch({ flow: flow === "none" ? "" : flow })}
            />
          )}
          {value.security === "tls" && (
            <Choice
              label="绑定证书"
              value={value.certificateId || "none"}
              options={[
                ["none", "选择证书"],
                ...certificates.map((c) => [c.id, c.name] as [string, string]),
              ]}
              change={(certificateId) =>
                patch({
                  certificateId:
                    certificateId === "none" ? undefined : certificateId,
                })
              }
            />
          )}
          {value.security !== "none" && (
            <Field
              label="SNI / 服务域名"
              value={value.serverName}
              change={(serverName) => patch({ serverName })}
            />
          )}
          {["ws", "grpc", "xhttp"].includes(value.network) && (
            <Field
              label={value.network === "grpc" ? "gRPC 服务名称" : "传输路径"}
              value={value.path}
              change={(path) => patch({ path })}
            />
          )}
          {value.security === "reality" && (
            <>
              <Field
                label="REALITY 目标（域名:端口）"
                value={value.realityTarget}
                change={(realityTarget) => patch({ realityTarget })}
              />
              <Field
                label="REALITY 私钥"
                type="password"
                value={value.realityPrivateKey}
                change={(realityPrivateKey) => patch({ realityPrivateKey })}
              />
              <Field
                label="REALITY 公钥"
                value={value.realityPublicKey}
                change={(realityPublicKey) => patch({ realityPublicKey })}
              />
              <Field
                label="REALITY shortId"
                value={value.shortId}
                change={(shortId) => patch({ shortId })}
              />
              <Button
                variant="secondary"
                isDisabled={keyBusy}
                onPress={() => void generateKeys()}
              >
                {keyBusy ? "生成中…" : "生成新 REALITY 密钥"}
              </Button>
            </>
          )}
          <InboundTransportFields
            key={`${value.protocol}:${value.network}:${value.security}`}
            value={value as TInbound}
            change={(extra) => patch({ extra })}
          />
          {value.protocol === "shadowsocks" && (
            <Choice
              label="Shadowsocks 加密算法"
              value={value.method}
              options={options(["aes-256-gcm", "chacha20-ietf-poly1305"])}
              change={(method) => patch({ method })}
            />
          )}
          {value.protocol === "tunnel" && (
            <>
              <Choice
                label="从节点填入转发目标"
                value="manual"
                options={[
                  ["manual", "手动指定目标"],
                  ...nodes
                    .filter((n) => n.host?.address && n.host?.port)
                    .map(
                      (n) =>
                        [
                          n.id,
                          `${n.host.remark} · ${n.host.address}:${n.host.port}`,
                        ] as [string, string],
                    ),
                ]}
                change={(id) => {
                  const node = nodes.find((n) => n.id === id);
                  if (node)
                    patch({
                      target: node.host.address,
                      targetPort: node.host.port,
                    });
                }}
              />
              <Field
                label="转发目标地址"
                value={value.target}
                change={(target) => patch({ target })}
              />
              <Field
                label="转发目标端口"
                type="number"
                value={value.targetPort}
                change={(targetPort) =>
                  patch({ targetPort: Number(targetPort) })
                }
              />
              <label>
                <input
                  type="checkbox"
                  checked={value.udp}
                  onChange={(e) => patch({ udp: e.target.checked })}
                />
                同时转发 UDP
              </label>
            </>
          )}
          <Field
            label="入站标签（逗号分隔）"
            value={value.tags?.join(", ")}
            change={(tags) => patch({ tags: splitValues(tags) })}
          />
          <label>
            <input
              type="checkbox"
              checked={value.enabled}
              onChange={(e) => patch({ enabled: e.target.checked })}
            />
            启用入站
          </label>
          <p className="nd-muted nd-full">
            用户 UUID
            和密码由套餐授权生成。修改已有入站会保留高级字段；切换协议会清空
            extra 协议参数。端口先检查草稿冲突，发布时再由 Agent 检查实际占用。
          </p>
        </div>
      )}
      {error && (
        <p className="nd-error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <pre className="nd-code" aria-label="入站配置预览">
          {JSON.stringify(
            {
              ...parsedValue(),
              realityPrivateKey: value.realityPrivateKey
                ? "••••••（保存时保留）"
                : undefined,
            },
            null,
            2,
          )}
        </pre>
      )}
      <div className="nd-row">
        <Button type="submit" isDisabled={keyBusy}>
          写入草稿
        </Button>
        <Button
          variant="secondary"
          onPress={() => {
            try {
              parsedValue();
              setPreview(true);
              setError("");
            } catch (e) {
              setError(describe(e));
            }
          }}
        >
          预览配置
        </Button>
        <Button variant="tertiary" onPress={cancel}>
          取消入站编辑
        </Button>
      </div>
    </form>
  );
}

export function InboundEditor({
  config,
  certificates,
  nodes,
  change,
  pendingChange,
  disabled,
}: {
  config: TConfig;
  certificates: Row[];
  nodes: Row[];
  change: (config: TConfig) => void;
  pendingChange: (pending: boolean) => void;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    pendingChange(Boolean(editing));
    return () => pendingChange(false);
  }, [editing, pendingChange]);
  const commit = (inbounds: TInbound[]) => {
    change(ConfigInput.parse({ ...config, inbounds }));
    setError("");
    setNotice("已写入本地草稿。保存并发布后，等待 Agent 确认生效。");
  };
  const act = (action: () => void) => {
    try {
      action();
      setError("");
    } catch (e) {
      setError(describe(e));
    }
  };
  return (
    <Card>
      <Card.Header>
        <Card.Title>协议入站</Card.Title>
      </Card.Header>
      <Card.Content className="nd-stack">
        <div className="nd-row">
          <p className="nd-muted">
            {config.inbounds.length} 个入站 ·{" "}
            {config.inbounds.filter((i) => i.enabled).length} 个启用
          </p>
          <Button
            isDisabled={disabled || Boolean(editing)}
            onPress={() => {
              let port = 8443;
              while (config.inbounds.some((i) => i.port === port)) port++;
              setEditing({
                id: crypto.randomUUID(),
                name: "",
                protocol: "vless",
                network: "tcp",
                security: "tls",
                port,
                enabled: true,
                serverName: "",
                path: "/",
                flow: "",
                shortId: "",
                tags: [],
                extra: {},
                method: "aes-256-gcm",
                udp: false,
              });
            }}
          >
            添加入站
          </Button>
        </div>
        {error && (
          <p role="alert" className="nd-error">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <div className="nd-engine-layout">
          <div className="nd-stack">
            {!config.inbounds.length && (
              <p className="nd-empty">
                尚无入站。添加协议入站后，发布成功会生成客户端节点。
              </p>
            )}
            {config.inbounds.map((i) => (
              <div key={i.id} className="nd-engine-entry">
                <strong>{i.name}</strong>
                <span>
                  {titles[i.protocol]} · {i.port} · {i.network.toUpperCase()} /{" "}
                  {i.security.toUpperCase()} · {i.enabled ? "启用" : "禁用"}
                </span>
                <span className="nd-muted">
                  {i.tags.join("、") || "无标签"}
                </span>
                <div className="nd-row">
                  <Button
                    variant="secondary"
                    isDisabled={disabled || Boolean(editing)}
                    onPress={() => {
                      setEditing(structuredClone(i));
                      setError("");
                    }}
                  >
                    编辑入站
                  </Button>
                  <Button
                    variant="tertiary"
                    isDisabled={disabled || Boolean(editing)}
                    onPress={() =>
                      act(() =>
                        commit(
                          config.inbounds.map((v) =>
                            v.id === i.id ? { ...v, enabled: !v.enabled } : v,
                          ),
                        ),
                      )
                    }
                  >
                    {i.enabled ? "禁用入站" : "启用入站"}
                  </Button>
                  <Button
                    variant="danger-soft"
                    isDisabled={disabled || Boolean(editing)}
                    onPress={() =>
                      act(() =>
                        commit(config.inbounds.filter((v) => v.id !== i.id)),
                      )
                    }
                  >
                    删除入站
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {editing ? (
            <InboundForm
              key={editing.id}
              initial={editing}
              certificates={certificates}
              nodes={nodes}
              cancel={() => setEditing(null)}
              save={(value) => {
                const found = config.inbounds.some((i) => i.id === value.id);
                commit(
                  found
                    ? config.inbounds.map((i) =>
                        i.id === value.id ? value : i,
                      )
                    : [...config.inbounds, value],
                );
                setEditing(null);
              }}
            />
          ) : (
            <div className="nd-empty">
              选择入站编辑配置。禁用或删除同样需要保存并发布。
            </div>
          )}
        </div>
      </Card.Content>
    </Card>
  );
}
