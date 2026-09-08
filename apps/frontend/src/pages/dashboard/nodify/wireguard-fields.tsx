import { Button, Modal, TextArea } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import {
  WIREGUARD_STRATEGIES,
  moveItem,
  updateWireguardPeer,
  type XrayRecord,
} from "@nodify/contract";
import { Choice, Field } from "./editor-fields";

function Lines({
  label,
  value,
  change,
}: {
  label: string;
  value?: string[];
  change: (value: string[] | undefined) => void;
}) {
  const [raw, setRaw] = useState((value || []).join("\n"));
  const sent = useRef<string | undefined>(JSON.stringify(value));
  useEffect(() => {
    const signature = JSON.stringify(value);
    if (signature !== sent.current) {
      sent.current = signature;
      setRaw((value || []).join("\n"));
    }
  }, [value]);
  return (
    <div className="nd-stack">
      <label className="nd-field">
        <span>{label}（每行一条）</span>
        <TextArea
          aria-label={label}
          rows={3}
          value={raw}
          onChange={(e) => {
            const text = e.target.value,
              next = text
                .split(/\r?\n/)
                .map((part) => part.trim())
                .filter(Boolean);
            setRaw(text);
            sent.current = JSON.stringify(next);
            change(next);
          }}
        />
      </label>
      <div className="nd-row">
        <span className="nd-muted">
          {value === undefined
            ? "使用内核默认地址"
            : value.length
              ? `已设置 ${value.length} 条地址`
              : "当前为空数组，不使用默认地址"}
        </span>
        <Button
          size="sm"
          variant="tertiary"
          onPress={() => {
            sent.current = undefined;
            setRaw("");
            change(undefined);
          }}
        >
          恢复默认地址
        </Button>
      </div>
    </div>
  );
}
const numeric = (value: string) =>
  value.trim() === ""
    ? undefined
    : Number.isFinite(Number(value))
      ? Number(value)
      : value;
export function WireguardFields({
  value,
  change,
}: {
  value: XrayRecord;
  change: (value: XrayRecord) => void;
}) {
  const peers: XrayRecord[] = value.peers || [];
  const [removing, setRemoving] = useState<number | null>(null);
  const patch = (next: XrayRecord) => change({ ...value, ...next });
  const peerPatch = (index: number, next: XrayRecord) =>
    change(updateWireguardPeer(value, index, next));
  return (
    <div className="nd-stack nd-full">
      <p className="nd-muted">
        填写已有 WireGuard 端点的凭据。本地地址是隧道内地址；此处不会注册 WARP
        账户。
      </p>
      <div className="nd-fields">
        <Field
          label="WireGuard 私钥"
          type="password"
          value={value.secretKey}
          change={(secretKey) => patch({ secretKey })}
        />
        <Field
          label="WireGuard MTU（空白使用默认）"
          type="number"
          value={value.mtu}
          change={(mtu) => patch({ mtu: numeric(mtu) })}
        />
        <Choice
          label="WireGuard TUN 模式"
          value={
            value.noKernelTun === undefined
              ? "default"
              : String(value.noKernelTun)
          }
          options={[
            ["default", "内核自动判断"],
            ["true", "用户空间（不使用系统 TUN）"],
            ["false", "允许系统 TUN（需要权限）"],
          ]}
          change={(v) =>
            patch({ noKernelTun: v === "default" ? undefined : v === "true" })
          }
        />
        <Choice
          label="WireGuard 域名解析"
          value={
            WIREGUARD_STRATEGIES.find(
              (s) => s.toLowerCase() === value.domainStrategy?.toLowerCase(),
            ) || "default"
          }
          options={[
            ["default", "内核默认（ForceIP）"],
            ...WIREGUARD_STRATEGIES.map((s): [string, string] => [s, s]),
          ]}
          change={(domainStrategy) =>
            patch({
              domainStrategy:
                domainStrategy === "default" ? undefined : domainStrategy,
            })
          }
        />
      </div>
      <Lines
        label="WireGuard 本地 IP / CIDR"
        value={value.address}
        change={(address) => patch({ address })}
      />
      <p className="nd-muted">
        未指定本地地址时使用内核默认双栈地址。用户空间模式不修改宿主路由表；它不等同于启用系统
        WireGuard 接口。
      </p>
      <fieldset className="nd-fields">
        <legend>保留字节（可选，填写时必须为三个 0–255 的整数）</legend>
        {[0, 1, 2].map((index) => (
          <Field
            key={index}
            label={`保留字节 ${index + 1}`}
            type="number"
            value={value.reserved?.[index]}
            change={(text) => {
              const next = [...(value.reserved || [])];
              next[index] = numeric(text);
              patch({
                reserved: next.every((v) => v === undefined)
                  ? undefined
                  : Array.from({ length: 3 }, (_, i) => next[i] ?? null),
              });
            }}
          />
        ))}
        <Button
          size="sm"
          variant="tertiary"
          onPress={() => patch({ reserved: undefined })}
        >
          清空保留字节
        </Button>
      </fieldset>
      <div className="nd-row">
        <h4>WireGuard peers</h4>
        <Button
          size="sm"
          onPress={() =>
            patch({ peers: [...peers, { endpoint: "", publicKey: "" }] })
          }
        >
          添加 peer
        </Button>
      </div>
      {!peers.length && <p>尚无 peer，至少添加一个端点后才能写入草稿。</p>}
      {peers.map((peer, index) => (
        <fieldset className="nd-stack nd-entry-form" key={index}>
          <legend>Peer {index + 1}</legend>
          <div className="nd-fields">
            <Field
              label={`Peer ${index + 1} 端点`}
              value={peer.endpoint}
              change={(endpoint) => peerPatch(index, { endpoint })}
            />
            <Field
              label={`Peer ${index + 1} 公钥`}
              value={peer.publicKey}
              change={(publicKey) => peerPatch(index, { publicKey })}
            />
            <Field
              label={`Peer ${index + 1} 预共享密钥（可选）`}
              type="password"
              value={peer.preSharedKey}
              change={(preSharedKey) =>
                peerPatch(index, { preSharedKey: preSharedKey || undefined })
              }
            />
            <Field
              label={`Peer ${index + 1} 心跳间隔（秒，0 关闭）`}
              type="number"
              value={peer.keepAlive}
              change={(keepAlive) =>
                peerPatch(index, { keepAlive: numeric(keepAlive) })
              }
            />
          </div>
          <Lines
            label={`Peer ${index + 1} allowedIPs`}
            value={peer.allowedIPs}
            change={(allowedIPs) => peerPatch(index, { allowedIPs })}
          />
          <p className="nd-muted">
            端点格式为主机:端口或 [IPv6]:端口。allowedIPs 决定此 peer
            的隧道路由与来源校验；未指定时默认为 0.0.0.0/0 和 ::/0。
          </p>
          <div className="nd-row">
            <Button
              size="sm"
              variant="tertiary"
              isDisabled={index === 0}
              onPress={() =>
                patch({ peers: moveItem(peers, index, index - 1) })
              }
            >
              上移 Peer {index + 1}
            </Button>
            <Button
              size="sm"
              variant="tertiary"
              isDisabled={index === peers.length - 1}
              onPress={() =>
                patch({ peers: moveItem(peers, index, index + 1) })
              }
            >
              下移 Peer {index + 1}
            </Button>
            <Button
              size="sm"
              variant="danger-soft"
              onPress={() => setRemoving(index)}
            >
              移除 Peer {index + 1}
            </Button>
          </div>
        </fieldset>
      ))}
      <Modal>
        <Modal.Backdrop
          isOpen={removing !== null}
          onOpenChange={(open) => {
            if (!open) setRemoving(null);
          }}
        >
          <Modal.Container size="sm">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>移除 WireGuard peer</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <p>
                  从当前草稿移除 Peer {(removing ?? 0) + 1}
                  ？写入并发布配置后，该 peer 才会从服务器移除。
                </p>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="secondary" onPress={() => setRemoving(null)}>
                  保留 peer
                </Button>
                <Button
                  variant="danger"
                  onPress={() => {
                    if (removing !== null)
                      patch({ peers: peers.filter((_, i) => i !== removing) });
                    setRemoving(null);
                  }}
                >
                  确认移除
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}
