import { Button, Card, Spinner } from "@heroui/react";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { renderSVG } from "uqr";
import { formatBytes } from "@shared/utils/misc/format";

import "./nodify.css";

export function NodifySubscriptionPage() {
  const { token } = useParams();
  const [info, setInfo] = useState<any>(null),
    [error, setError] = useState(""),
    [copyError, setCopyError] = useState(""),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setInfo(null);
    setError("");
    setCopyError("");
    setCopied(false);
    void fetch(`/api/sub/${encodeURIComponent(token || "")}?format=info`, {
      signal: abort.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("订阅已撤销或不存在");
        setInfo(await r.json());
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => abort.abort();
  }, [token]);
  return (
    <main className="nd-page" style={{ maxWidth: 820, padding: 32 }}>
      <header className="nd-header">
        <div>
          <p className="nd-eyebrow">NODIFY</p>
          <h1>你的连接</h1>
        </div>
      </header>
      {error ? (
        <p role="alert" className="nd-error">
          {error}
        </p>
      ) : !info ? (
        <Spinner />
      ) : (
        <>
          <div
            style={{
              width: 160,
              background: "white",
              padding: 12,
              borderRadius: 12,
            }}
            dangerouslySetInnerHTML={{
              __html: renderSVG(info.subscriptionUrl, {
                whiteColor: "#ffffff",
                blackColor: "#000000",
              }),
            }}
            aria-label="订阅二维码"
          />
          <Card>
            <Card.Header>
              <Card.Title>
                {info.username} · {info.package}
                {info.subscriptionName ? ` · ${info.subscriptionName}` : ""}
              </Card.Title>
              <Card.Description>
                {info.active ? "订阅可用" : "订阅已暂停，请联系管理员"}
              </Card.Description>
            </Card.Header>
            <Card.Content>
              <div className="nd-stat">
                {formatBytes(Number(info.usedBytes))}{" "}
                <span className="nd-muted">
                  /{" "}
                  {(info.displayTrafficLimitBytes ?? info.trafficLimitBytes) ===
                  "0"
                    ? "不限"
                    : formatBytes(
                        Number(
                          info.displayTrafficLimitBytes ??
                            info.trafficLimitBytes,
                        ),
                      )}
                </span>
              </div>
              {info.hasDisplayOverride && (
                <p className="nd-muted">
                  上方为文件展示额度。套餐实际额度：
                  {info.trafficLimitBytes === "0"
                    ? "不限"
                    : formatBytes(Number(info.trafficLimitBytes))}
                  ；是否可用按套餐判断。
                </p>
              )}
              <p>到期时间 {new Date(info.expiresAt).toLocaleString("zh-CN")}</p>
              {info.deviceLimit > 0 && (
                <p>
                  最多 {info.deviceLimit} 个订阅设备，请使用支持 HWID 的客户端。
                </p>
              )}
            </Card.Content>
          </Card>
          <h2>导入客户端</h2>
          <div className="nd-grid">
            {[
              ["mihomo", "Clash Verge / Mihomo", "clash://install-config?url="],
              ["singbox", "sing-box", "sing-box://import-remote-profile?url="],
              ["v2ray", "v2rayN / v2rayNG", ""],
              ["shadowrocket", "Shadowrocket", "shadowrocket://add/sub://"],
            ].map(([format, label, scheme]) => {
              const url = `${info.subscriptionUrl}?format=${format}`;
              return (
                <Card key={format}>
                  <Card.Header>
                    <Card.Title>{label}</Card.Title>
                  </Card.Header>
                  <Card.Footer>
                    <Button
                      isDisabled={!info.active}
                      onPress={() => {
                        setCopyError("");
                        void navigator.clipboard
                          .writeText(url)
                          .then(() => setCopied(true))
                          .catch(() =>
                            setCopyError(
                              "无法访问剪贴板，请使用下载入口或手动复制链接。",
                            ),
                          );
                      }}
                    >
                      复制订阅
                    </Button>
                    {info.active && scheme && format !== "shadowrocket" && (
                      <a href={`${scheme}${encodeURIComponent(url)}`}>
                        一键导入 ↗
                      </a>
                    )}
                    {info.active && <a href={url}>下载</a>}
                  </Card.Footer>
                </Card>
              );
            })}
          </div>
          {copied && <p role="status">订阅链接已复制。</p>}
          {copyError && <p role="alert">{copyError}</p>}
          <h2>可用节点</h2>
          <div className="nd-list">
            {info.nodes.length ? (
              info.nodes.map((n: any, i: number) => (
                <Card key={i}>
                  <Card.Content>
                    <div className="nd-row">
                      <strong>{n.name}</strong>
                      <span>{n.protocol.toUpperCase()}</span>
                    </div>
                    {n.exclusions?.map((reason: string) => (
                      <p key={reason} className="nd-muted">
                        {reason}
                      </p>
                    ))}
                  </Card.Content>
                </Card>
              ))
            ) : (
              <p className="nd-muted">目前没有可用节点。</p>
            )}
          </div>
        </>
      )}
    </main>
  );
}
