import { Button, Card, Checkbox, Label, Spinner } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  OverviewTraffic,
  OverviewTrafficSettings,
  type TOverviewTraffic,
} from "@nodify/contract";
import { instance } from "@shared/api/axios";
import { Choice, Field } from "./editor-fields";
import { trafficBytes } from "./traffic-summary";

export function OverviewTrafficPanel() {
  const [data, setData] = useState<TOverviewTraffic | null>(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [draft, setDraft] = useState<TOverviewTraffic["settings"] | null>(null);
  const [selectedDay, setSelectedDay] = useState(""),
    [search, setSearch] = useState("");
  const active = useRef<AbortController | null>(null),
    errorRef = useRef<HTMLParagraphElement>(null);
  const load = async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    try {
      const result = OverviewTraffic.parse(
        (
          await instance.get("/api/overview/traffic", {
            signal: controller.signal,
          })
        ).data.response,
      );
      if (controller.signal.aborted) return;
      setData(result);
      setSelectedDay((previous) =>
        result.days.some((day) => day.day === previous)
          ? previous
          : result.days.at(-1)?.day || "",
      );
      setError("");
      return result;
    } catch (e: any) {
      if (!controller.signal.aborted)
        setError(
          e.response?.data?.message || "无法读取流量概览，已有结果保留。",
        );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    return () => {
      clearInterval(timer);
      active.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  const selected = data?.days.find((row) => row.day === selectedDay);
  const filteredItems =
    data?.items.filter((row) =>
      row.name.toLowerCase().includes(search.toLowerCase()),
    ) || [];
  const maximum = Math.max(
    1,
    ...(data?.days.map((day) => Number(day.usedBytes || 0)) || []),
  );
  const segments: Array<
    Array<{ x: number; y: number; day: TOverviewTraffic["days"][number] }>
  > = [];
  let segment: (typeof segments)[number] = [];
  data?.days.forEach((day, index) => {
    if (day.usedBytes == null) {
      if (segment.length) segments.push(segment);
      segment = [];
      return;
    }
    segment.push({
      x: 16 + (index * 568) / 29,
      y: 164 - (Number(day.usedBytes) / maximum) * 140,
      day,
    });
  });
  if (segment.length) segments.push(segment);
  const warnings =
    data?.items.filter(
      (row) =>
        row.stale ||
        row.expired ||
        row.partial ||
        row.usedBytes == null ||
        row.limitBytes == null,
    ) || [];
  return (
    <Card className="nd-stack">
      <Card.Header>
        <Card.Title>流量与容量</Card.Title>
        <Card.Description>
          当前账面汇总与最近 30 日已收账本，分别显示。
        </Card.Description>
      </Card.Header>
      <Card.Content className="nd-stack">
        <div className="nd-row">
          <Button
            variant="secondary"
            isDisabled={loading || busy}
            onPress={() => void load()}
          >
            {loading ? "正在更新…" : "刷新流量概览"}
          </Button>
          {data && (
            <Button
              variant="secondary"
              isDisabled={busy}
              onPress={() => {
                setError("");
                setDraft({ ...data.settings });
              }}
            >
              首页统计设置
            </Button>
          )}
        </div>
        {error && (
          <p className="nd-error" role="alert" tabIndex={-1} ref={errorRef}>
            {error}
          </p>
        )}
        {!data && loading && (
          <p>
            <Spinner /> 正在读取服务器与上游流量
          </p>
        )}
        {draft && (
          <form
            className="nd-stack"
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              void (async () => {
                try {
                  await instance.put(
                    "/api/overview/traffic-settings",
                    OverviewTrafficSettings.parse(draft),
                  );
                  setDraft(null);
                  await load();
                } catch (e: any) {
                  setError(
                    e.response?.data?.message ||
                      "无法保存首页设置，选择已保留。",
                  );
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            <div className="nd-stack" inert={busy}>
              {data && draft.version !== data.settings.version && (
                <p role="alert">
                  首页设置已在其他页面修改。当前选择已保留，请重新载入统计设置后再保存。
                </p>
              )}
              <Checkbox
                isSelected={draft.includeExternal}
                onChange={(includeExternal) =>
                  setDraft({ ...draft, includeExternal })
                }
              >
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  <Label>首页汇总启用的外部订阅</Label>
                </Checkbox.Content>
              </Checkbox>
              <p>
                当前有 {data?.enabledExternalSources || 0}{" "}
                个启用来源。首页按上游上传 +
                下载计量，不受该来源在订阅文件中的方向影响；外部快照不加入日趋势。
              </p>
              <div className="nd-row">
                <Button type="submit">保存首页设置</Button>
                <Button
                  variant="secondary"
                  isDisabled={loading}
                  onPress={() =>
                    void load().then((result) => {
                      if (result) setDraft({ ...result.settings });
                    })
                  }
                >
                  重新载入统计设置
                </Button>
                <Button variant="secondary" onPress={() => setDraft(null)}>
                  取消首页设置
                </Button>
              </div>
            </div>
          </form>
        )}
        {data && (
          <>
            <p role="status">
              更新于 {new Date(data.generatedAt).toLocaleString()} ·{" "}
              {data.selectedServers} 台服务器计入，{data.excludedServers}{" "}
              台未计入 · 外部订阅
              {data.settings.includeExternal ? "已计入" : "未计入"}
            </p>
            {!data.items.length && (
              <p className="nd-empty">
                尚无统计项目。
                <Link to="/dashboard/nodify/servers">
                  接入服务器或设置统计范围
                </Link>
              </p>
            )}
            <div>
              <h4>有限额项目（{data.finite.count} 项）</h4>
              <div className="nd-grid">
                {[
                  ["已知总容量", data.finite.limitBytes],
                  ["已知用量", data.finite.usedBytes],
                  ["账面剩余", data.finite.remainingBytes],
                  ["已知超额", data.finite.overageBytes],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="nd-entry-form nd-stack"
                    style={{ gap: 4 }}
                  >
                    <span className="nd-muted">{label}</span>
                    <strong className="nd-stat" style={{ margin: 0 }}>
                      {trafficBytes(value)}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
            <p className="nd-muted">
              剩余按各项目分别扣减后相加，超额不会抵消另一项余额。未知用量{" "}
              {data.finite.unknownUsageCount} 项，记录有缺口{" "}
              {data.finite.partialCount} 项，未及时更新 {data.finite.staleCount}{" "}
              项，外部已到期 {data.finite.expiredCount}{" "}
              项；这些情况下不能把账面剩余当作确定可用额度。
            </p>
            <div className="nd-grid">
              <p>
                不限量：{data.unlimited.count} 项 · 已知用量{" "}
                {trafficBytes(data.unlimited.usedBytes)}
              </p>
              <p>
                容量未知：{data.unknownCapacity.count} 项 · 已知用量{" "}
                {trafficBytes(data.unknownCapacity.usedBytes)}
              </p>
            </div>
            <p className="nd-muted">
              服务器使用各自当前周期、方向和手工调整；原始累计与计费用量不能再次相加。不同服务器及上游可能处在不同账期，汇总不代表一个共同计费周期。
            </p>
            {warnings.length > 0 && (
              <p className="nd-notice">
                {warnings.length}{" "}
                个项目需要核对更新、容量或记录完整性，处理入口见下方明细。
              </p>
            )}
            <h4>最近 30 日趋势（UTC）</h4>
            <p className="nd-muted">
              包含当前勾选的全部服务器（含不限量），按当前数据源和每日规则重算。不含手工调整或外部快照，不能与上方当前账期用量直接比较。无记录的日期保留断点。
            </p>
            {segments.length ? (
              <svg
                viewBox="0 0 600 180"
                role="img"
                aria-label="最近 30 日服务器账本趋势，缺失日期不连线"
                style={{ width: "100%", maxHeight: 220, overflow: "visible" }}
              >
                <line
                  x1="16"
                  x2="584"
                  y1="164"
                  y2="164"
                  stroke="var(--border)"
                />
                {segments.map((points, index) => (
                  <g key={index}>
                    <polyline
                      points={points
                        .map((point) => `${point.x},${point.y}`)
                        .join(" ")}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="2"
                    />
                    {points.map((point) => (
                      <circle
                        key={point.day.day}
                        cx={point.x}
                        cy={point.y}
                        r={point.day.day === selectedDay ? 5 : 3}
                        fill="var(--accent)"
                      >
                        <title>
                          {point.day.day}：{trafficBytes(point.day.usedBytes)}
                        </title>
                      </circle>
                    ))}
                  </g>
                ))}
              </svg>
            ) : (
              <p className="nd-empty">此范围尚无上报，不能推断为零流量。</p>
            )}
            <Choice
              label="查看趋势日期"
              value={selectedDay}
              options={data.days.map((day) => [
                day.day,
                `${day.day} · ${day.usedBytes == null ? "无上报" : trafficBytes(day.usedBytes)}`,
              ])}
              change={setSelectedDay}
            />
            {selected && (
              <div className="nd-entry-form">
                <strong>
                  {selected.day}：
                  {selected.usedBytes == null
                    ? "无上报"
                    : trafficBytes(selected.usedBytes)}
                </strong>
                <p>
                  原始上传 {trafficBytes(selected.upload)} / 下载{" "}
                  {trafficBytes(selected.download)} · {selected.reportedServers}
                  /{data.selectedServers} 台有记录。
                </p>
                <p className="nd-muted">
                  有记录不代表全天连续覆盖；缺少网卡记录{" "}
                  {selected.missingInterfaces} 项，基线中断{" "}
                  {selected.discontinuities} 次，跨日间隔{" "}
                  {selected.crossDateReports} 条，按接收日期归档{" "}
                  {selected.receivedDateReports} 条。
                </p>
              </div>
            )}
            <Link to="/dashboard/nodify/traffic">打开流量历史与用户明细 →</Link>
            <details>
              <summary>统计项目与处理入口（{data.items.length} 项）</summary>
              <div className="nd-stack">
                <Field label="筛选统计项目" value={search} change={setSearch} />
                {!filteredItems.length && (
                  <p className="nd-empty">没有匹配的统计项目。</p>
                )}
                {filteredItems.map((row) => (
                  <article
                    key={`${row.kind}/${row.id}`}
                    className="nd-entry-form"
                  >
                    <strong>
                      {row.name} ·{" "}
                      {row.source === "external"
                        ? "上游双向快照"
                        : row.source === "network"
                          ? "系统网卡"
                          : "协议计数器"}
                    </strong>
                    <p>
                      用量 {trafficBytes(row.usedBytes)} / 容量{" "}
                      {row.limitBytes === "0"
                        ? "不限"
                        : trafficBytes(row.limitBytes)}
                    </p>
                    {row.periodStart && (
                      <p>
                        {row.periodStart === "lifetime"
                          ? "无月周期，按接入累计及手工基线计算"
                          : `当前周期 ${row.periodStart} 至 ${row.periodEnd}（UTC）`}
                      </p>
                    )}
                    <p className="nd-muted">
                      {[
                        row.usedBytes == null ? "用量未知" : "",
                        row.limitBytes == null ? "容量待配置" : "",
                        row.partial ? "记录有缺口" : "",
                        row.stale ? "未及时更新或尚未连接" : "",
                        row.expired ? "来源已到期" : "",
                      ]
                        .filter(Boolean)
                        .join(" · ") || "已收到统计数据"}
                    </p>
                    <Link
                      to={
                        row.kind === "server"
                          ? `/dashboard/nodify/servers?server=${row.id}`
                          : `/dashboard/nodify/nodes?source=${row.id}`
                      }
                    >
                      {row.kind === "server"
                        ? "管理此服务器 →"
                        : "管理此来源 →"}
                    </Link>
                  </article>
                ))}
              </div>
            </details>
          </>
        )}
      </Card.Content>
    </Card>
  );
}
