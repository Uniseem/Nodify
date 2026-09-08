import { Button, Card } from "@heroui/react";
import { useState, useEffect, useRef } from "react";
import { TrafficHistoryQuery } from "@nodify/contract";
import { instance } from "@shared/api/axios";
import { Choice, Field } from "./editor-fields";
import { trafficBytes } from "./traffic-summary";
type Row = Record<string, any>;
const day = (time = Date.now()) => new Date(time).toISOString().slice(0, 10);
export function TrafficHistoryPanel() {
  const [from, setFrom] = useState(day(Date.now() - 29 * 86400000)),
    [to, setTo] = useState(day()),
    [serverId, setServerId] = useState("all"),
    [userId, setUserId] = useState("all");
  const [options, setOptions] = useState<Row | null>(null),
    [result, setResult] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [optionsError, setOptionsError] = useState("");
  const active = useRef<AbortController | null>(null),
    errorRef = useRef<HTMLParagraphElement>(null);
  const loadOptions = async () => {
    try {
      setOptionsError("");
      setOptions(
        (await instance.get("/api/traffic/history/options")).data.response,
      );
    } catch {
      setOptionsError("无法加载筛选选项，请重试。");
    }
  };
  const load = async (range?: { from: string; to: string }) => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    try {
      const query = TrafficHistoryQuery.parse({
        from: range?.from ?? from,
        to: range?.to ?? to,
        ...(serverId === "all" ? {} : { serverId }),
        ...(userId === "all" ? {} : { userId }),
      });
      const response = await instance.get("/api/traffic/history", {
        params: query,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setResult(response.data.response);
    } catch (e: any) {
      if (!controller.signal.aborted)
        setError(
          e.issues?.map((issue: any) => issue.message).join("；") ||
            e.response?.data?.message ||
            "无法读取历史，原结果已保留。",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  useEffect(() => {
    void loadOptions();
    void load();
    return () => active.current?.abort();
  }, []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  const dailyValue = (row: Row) =>
    row.hasData
      ? result?.scope === "user"
        ? row.rated
        : (BigInt(row.upload) + BigInt(row.download)).toString()
      : null;
  const max = result
    ? Math.max(
        1,
        ...result.days.map((row: Row) => Number(dailyValue(row) || 0)),
      )
    : 1;
  return (
    <Card className="nd-stack">
      <Card.Header>
        <Card.Title>流量日账本</Card.Title>
        <Card.Description>
          按 UTC 日期查看服务器流量、用户原策略计费与配额入账，最多 90 天。
        </Card.Description>
      </Card.Header>
      <Card.Content className="nd-stack">
        <form
          className="nd-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <div className="nd-fields" inert={busy}>
            <Field
              label="开始日期（UTC）"
              type="date"
              value={from}
              change={setFrom}
            />
            <Field
              label="结束日期（UTC）"
              type="date"
              value={to}
              change={setTo}
            />
            <Choice
              label="统计服务器"
              value={serverId}
              options={[
                ["all", "全部服务器"],
                ...(options?.servers || []).map(
                  (row: Row): [string, string] => [row.id, row.name],
                ),
              ]}
              change={setServerId}
            />
            <Choice
              label="计费用户"
              value={userId}
              options={[
                ["all", "服务器统计流量"],
                ...(options?.users || []).map((row: Row): [string, string] => [
                  row.id,
                  row.name,
                ]),
              ]}
              change={setUserId}
            />
          </div>
          {optionsError && (
            <p role="alert">
              {optionsError}
              <Button variant="secondary" onPress={() => void loadOptions()}>
                重试筛选选项
              </Button>
            </p>
          )}
          <div className="nd-row">
            <Button type="submit" isDisabled={busy}>
              {busy ? "正在读取…" : "查询日账本"}
            </Button>
            {[7, 30, 90].map((days) => (
              <Button
                key={days}
                type="button"
                variant="secondary"
                isDisabled={busy}
                onPress={() => {
                  const range = {
                    from: day(Date.now() - (days - 1) * 86400000),
                    to: day(),
                  };
                  setFrom(range.from);
                  setTo(range.to);
                  void load(range);
                }}
              >
                最近 {days} 天
              </Button>
            ))}
          </div>
        </form>
        {error && (
          <p className="nd-error" role="alert" tabIndex={-1} ref={errorRef}>
            {error}
          </p>
        )}
        <p className="nd-muted">
          没有记录的日期显示“无上报”，不代表零流量。服务器按当前设置选择协议或网卡数据源；用户始终只用协议计量。异常时钟可能按接收日期归档，离线补报会更新历史。此处不含上游订阅。
        </p>
        {result && (
          <>
            <p role="status">
              结果：{result.query.from} 至 {result.query.to}（UTC） ·{" "}
              {result.scope === "user"
                ? `用户 ${result.userName || result.query.userId}`
                : "服务器统计流量"}{" "}
              · {result.selectedServers} 台服务器
            </p>
            <div className="nd-grid">
              <p>上传：{trafficBytes(result.totals.upload)}</p>
              <p>下载：{trafficBytes(result.totals.download)}</p>
              <p>
                {result.scope === "user"
                  ? "按采集策略计费"
                  : "按服务器规则汇总"}
                ：{trafficBytes(result.totals.displayBytes)}
              </p>
            </div>
            {result.scope === "user" && (
              <p>
                历史实际写入配额：{trafficBytes(result.totals.charged)}
                。旧周期补报保留原策略金额，但不会重复扣除新周期配额。
              </p>
            )}
            {result.totals.unratedRaw !== "0" &&
              result.totals.unratedRaw != null && (
                <p className="nd-notice">
                  缺少原用户策略的流量：{trafficBytes(result.totals.unratedRaw)}
                  ，未估算计费金额。
                </p>
              )}
            {result.totals.receivedDateReports > 0 && (
              <p className="nd-notice">
                包含 {result.totals.receivedDateReports}{" "}
                条按接收日期归档的上报。
              </p>
            )}
            {(result.totals.discontinuities > 0 ||
              result.totals.crossDateReports > 0) && (
              <p className="nd-notice">
                网卡基线中断 {result.totals.discontinuities}{" "}
                次（首次采集、重启或计数器变化），未估算中断前流量；
                跨日采集间隔 {result.totals.crossDateReports}{" "}
                条，整段增量归到采集结束日，不能视为精确日界划分。
              </p>
            )}
            {result.totals.unchargedRaw !== "0" &&
              result.totals.unchargedRaw != null && (
                <p>
                  未计入用户配额的原始流量：
                  {trafficBytes(result.totals.unchargedRaw)}
                  （旧权益代次、无有效策略或用户不存在）。
                </p>
              )}
            <p className="nd-muted">
              {result.scope === "user"
                ? "计费值在处理批次时保存，之后修改倍率或重置配额不会重算历史。"
                : "每日条展示上传加下载；较大值模式的区间总计会先合并每台服务器的区间上下行，不等于每日较大值相加。"}
            </p>
            <div className="nd-stack" aria-label="每日流量明细">
              {result.days.map((row: Row) => {
                const value = dailyValue(row);
                return (
                  <div key={row.day} className="nd-entry-form">
                    <div className="nd-row">
                      <strong>{row.day}</strong>
                      <span>
                        {value == null ? "无上报" : trafficBytes(value)} ·{" "}
                        {row.reportedServers}/{result.selectedServers} 台有记录
                      </span>
                    </div>
                    {row.hasData && (
                      <p className="nd-muted">
                        上传 {trafficBytes(row.upload)} · 下载{" "}
                        {trafficBytes(row.download)}
                        {result.scope === "user"
                          ? ` · 写入配额 ${trafficBytes(row.charged)}`
                          : ""}
                        {row.receivedDateReports
                          ? ` · ${row.receivedDateReports} 条按接收日期`
                          : ""}
                        {row.discontinuities
                          ? ` · ${row.discontinuities} 次基线中断`
                          : ""}
                        {row.crossDateReports
                          ? ` · ${row.crossDateReports} 条跨日间隔`
                          : ""}
                      </p>
                    )}
                    {value != null && (
                      <div
                        style={{
                          height: 8,
                          background: "var(--surface-secondary)",
                          borderRadius: 4,
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${value === "0" ? 0 : Math.max(0.5, (Number(value) / max) * 100)}%`,
                            background: "var(--accent)",
                            borderRadius: 4,
                          }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <details>
              <summary>服务器明细与开始接收时间</summary>
              {result.servers.map((row: Row) => (
                <p key={row.id}>
                  {row.name}（
                  {row.source === "network"
                    ? `网卡 ${row.interfaces.join(", ")}`
                    : "协议用户"}
                  ）：上传 {trafficBytes(row.upload)} / 下载{" "}
                  {trafficBytes(row.download)} / 汇总{" "}
                  {trafficBytes(row.displayBytes)}；开始接收日账本{" "}
                  {row.ledgerStartedAt
                    ? new Date(row.ledgerStartedAt).toLocaleString()
                    : "尚无"}
                  {row.missingInterfaces?.length
                    ? `；范围内无记录网卡：${row.missingInterfaces.join(", ")}`
                    : ""}
                </p>
              ))}
            </details>
          </>
        )}
        {!result && !busy && !error && <p>暂无日账本结果。</p>}
      </Card.Content>
    </Card>
  );
}
