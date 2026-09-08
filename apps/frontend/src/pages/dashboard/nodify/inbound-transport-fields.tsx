import { useState } from "react";
import {
  readInboundTransport,
  patchInboundTransport,
  XHTTP_MODES,
  type TInbound,
} from "@nodify/contract";
import { Choice, Field } from "./editor-fields";

export function InboundTransportFields({
  value,
  change,
}: {
  value: TInbound;
  change: (extra: Record<string, unknown>) => void;
}) {
  const transport = readInboundTransport(value);
  const [alpn, setAlpn] = useState((transport.alpn || []).join(", "));
  const patch = (
    field: "host" | "heartbeat" | "mode" | "alpn",
    next: unknown,
  ) => change(patchInboundTransport(value, field, next));
  return (
    <>
      {["ws", "xhttp"].includes(value.network) && (
        <>
          <Field
            label="传输 Host（可选）"
            value={transport.host}
            change={(host) => patch("host", host)}
          />
          <p className="nd-muted nd-full">
            Host 填写 ASCII 域名或 IPv4，不包含端口，与 TLS 的 SNI
            分开设置。填写后，入站会校验请求
            Host，订阅将携带相同值；留空时不限制 Host，订阅沿用 SNI
            或服务器地址。
          </p>
        </>
      )}
      {value.network === "ws" && (
        <Field
          label="WebSocket 心跳间隔（秒，留空用默认值）"
          type="number"
          value={transport.heartbeat ?? ""}
          change={(value) =>
            patch("heartbeat", value === "" ? undefined : Number(value))
          }
        />
      )}
      {value.network === "xhttp" && (
        <>
          <Choice
            label="XHTTP 模式"
            value={transport.mode}
            options={XHTTP_MODES.map((mode) => [
              mode,
              mode === "auto" ? "auto（自动）" : mode,
            ])}
            change={(mode) => patch("mode", mode)}
          />
          <p className="nd-muted nd-full">
            模式会同步到客户端配置。stream-up / stream-one 需要 HTTP/2 或 HTTP/3
            链路支持；Mihomo 1.19.30 仅支持 VLESS + XHTTP，sing-box 不支持
            XHTTP。
          </p>
        </>
      )}
      {value.security === "tls" && (
        <>
          <Field
            label="TLS ALPN（逗号分隔，可选）"
            value={alpn}
            change={(text) => {
              setAlpn(text);
              const protocols = text
                .split(",")
                .map((part) => part.trim())
                .filter(Boolean);
              patch("alpn", protocols.length ? protocols : undefined);
            }}
          />
          <p className="nd-muted nd-full">
            留空使用内核默认值。WebSocket 使用 http/1.1；gRPC 需要
            h2。此设置同步到配置订阅；不改变证书校验。
          </p>
        </>
      )}
    </>
  );
}
