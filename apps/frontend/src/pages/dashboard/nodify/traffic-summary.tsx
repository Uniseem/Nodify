import { formatBytes } from "@shared/utils/misc/format";
export const trafficBytes = (value: string | null | undefined) =>
  value == null ? "未知" : formatBytes(Number(value));
export function TrafficSummary({ summary }: { summary: Record<string, any> }) {
  return (
    <details className="nd-stack">
      <summary>
        管理员统计：{trafficBytes(summary.usedBytes)}
        {summary.unknownUsageCount > 0 || summary.missingServerIds.length > 0
          ? "（不完整）"
          : ""}
        {summary.staleSourceCount > 0 ? "（含旧快照）" : ""} ·{" "}
        {summary.servers.length} 台服务器 / {summary.externalSources.length}{" "}
        个外部来源
      </summary>
      <p className="nd-muted">
        服务器按所选数据源及当前周期、基线和校准汇总，外部流量取上游订阅头；此处不是该用户的套餐扣费。
      </p>
      <p>
        展示限额：
        {summary.displayLimitBytes === "0"
          ? "不限"
          : trafficBytes(summary.displayLimitBytes)}
      </p>
      <p>
        已知有限容量：{trafficBytes(summary.finiteLimitBytes)}；不限量{" "}
        {summary.unlimitedCount} 项，容量未知 {summary.unknownLimitCount} 项。
      </p>
      {(summary.unknownUsageCount > 0 ||
        summary.missingServerIds.length > 0) && (
        <p className="nd-notice">
          汇总不完整：{summary.unknownUsageCount} 项缺少部分或全部用量，
          {summary.missingServerIds.length} 台已选服务器不存在。
        </p>
      )}
      {summary.staleSourceCount > 0 && (
        <p className="nd-notice">
          包含 {summary.staleSourceCount} 个来源的旧快照，请检查来源同步。
        </p>
      )}
      {summary.servers.map((row: any) => (
        <p key={row.id}>
          {row.name} · {row.source === "network" ? "网卡" : "协议"}{" "}
          {trafficBytes(row.usedBytes)} · 从{" "}
          {row.startedAt
            ? new Date(row.startedAt).toLocaleString()
            : "尚未收到数据"}{" "}
          开始
          {row.period?.start && row.period.start !== "lifetime"
            ? ` · 计费周期 ${row.period.start} 至 ${row.period.end}`
            : ""}
          {row.missingInterfaces?.length
            ? ` · 尚无网卡记录：${row.missingInterfaces.join(", ")}`
            : ""}
        </p>
      ))}
      {summary.externalSources.map((row: any) => (
        <p key={row.id}>
          {row.name} · 上游报送 {trafficBytes(row.usedBytes)} ·{" "}
          {row.stale ? "旧快照" : "最近快照"} ·{" "}
          {row.updatedAt
            ? new Date(row.updatedAt).toLocaleString()
            : "尚无数据"}
        </p>
      ))}
    </details>
  );
}
