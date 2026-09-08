import { Button, Card } from "@heroui/react";
import { useEffect, useRef, useState } from "react";

type Operation = Record<string, any>;
const labels: Record<string, string> = {
  backup: "创建备份",
  "scheduled-backup": "定时备份与同步",
  certificate: "申请证书",
  "renew-certificate": "续期证书",
  "subscription-sync": "更新订阅来源",
  "website-files": "网站文件操作",
};
const states: Record<string, string> = {
  queued: "待执行",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
};

export function OperationList({
  operations,
  retry,
}: {
  operations: Operation[];
  retry: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) {
      errorRef.current?.scrollIntoView({ block: "nearest" });
      errorRef.current?.focus({ preventScroll: true });
    }
  }, [error]);
  return (
    <div className="nd-list">
      {error && (
        <p role="alert" className="nd-error" tabIndex={-1} ref={errorRef}>
          {error}
        </p>
      )}
      {!operations.length && <p className="nd-muted">还没有任务记录。</p>}
      {operations.map((operation) => (
        <Card key={operation.id}>
          <Card.Content>
            <div className="nd-row">
              <strong>{labels[operation.kind] || operation.kind}</strong>
              <span className={`nd-status ${operation.state}`}>
                {states[operation.state] || operation.state}
              </span>
              <span>{new Date(operation.createdAt).toLocaleString()}</span>
            </div>
            <p className="nd-muted">
              {operation.executor === "local" ? "主控任务" : "服务器任务"} ·{" "}
              {operation.id}
            </p>
            {operation.executor === "local" && (
              <p className="nd-muted">
                已执行 {operation.attempts || 0}{" "}
                次；进程中断后，可安全重复的任务自动恢复，最多执行 3 次。
              </p>
            )}
            {operation.message && <p>{operation.message}</p>}
            {operation.result?.phase === "certificate-saved" && (
              <p>证书已保存，后续重试只补服务下发，不重新申请证书。</p>
            )}
            {Object.keys(operation.result || {}).length > 0 && (
              <pre className="nd-code">
                {JSON.stringify(operation.result, null, 2)}
              </pre>
            )}
            {operation.executor === "local" &&
              operation.state === "failed" &&
              !operations.some((next) => next.retryOf === operation.id) && (
                <Button
                  variant="secondary"
                  isDisabled={!!busy}
                  onPress={() => {
                    setBusy(operation.id);
                    setError("");
                    void retry(operation.id)
                      .catch((error) => {
                        const value =
                          !error.response || error.response.status >= 500
                            ? "未能确认重试结果。任务记录已保留，请刷新后重试。"
                            : error.response?.data?.message ||
                              "重试失败，请稍后再试";
                        setError(
                          Array.isArray(value)
                            ? value.join("；")
                            : String(value),
                        );
                      })
                      .finally(() => setBusy(null));
                  }}
                >
                  {busy === operation.id ? "正在提交重试…" : "重试主控任务"}
                </Button>
              )}
            {operation.retryOf && (
              <p className="nd-muted">重试自 {operation.retryOf}</p>
            )}
          </Card.Content>
        </Card>
      ))}
    </div>
  );
}
