import { Button } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { TrafficAccountingAction } from "@nodify/contract";
import { instance } from "@shared/api/axios";
import { Field } from "./editor-fields";
import { trafficBytes } from "./traffic-summary";
type Row = Record<string, any>;
const directions: Row = {
  both: "上传 + 下载",
  upload: "仅上传",
  download: "仅下载",
  max: "上下行较大值",
};
const fresher = (previous: Row | null, next: Row) => {
  if (!previous) return next;
  if (previous.settingsVersion !== next.settingsVersion)
    return previous.settingsVersion > next.settingsVersion ? previous : next;
  if (
    previous.periodKey === next.periodKey &&
    previous.version !== next.version
  )
    return previous.version > next.version ? previous : next;
  return previous.asOf > next.asOf ? previous : next;
};
const names: Row = {
  calibrate: "校准用量",
  reset: "建立零用量基线",
  clear: "清除手工调整",
};
const signed = (value: string) =>
  `${value.startsWith("-") ? "−" : "+"}${trafficBytes(value.replace(/^-/, ""))}`;
export function TrafficAccountingPanel({
  server,
  changed,
}: {
  server: Row;
  changed: () => void;
}) {
  const [data, setData] = useState<Row | null>(null),
    [events, setEvents] = useState<Row[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const request = useRef<{ key: string; id: string } | null>(null),
    active = useRef<AbortController | null>(null),
    errorRef = useRef<HTMLParagraphElement>(null);
  const load = async (next?: string) => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setError("");
    try {
      const response = (
        await instance.get(`/api/servers/${server.id}/traffic-accounting`, {
          params: next ? { cursor: next } : {},
          signal: controller.signal,
        })
      ).data.response;
      if (controller.signal.aborted) return;
      setData((previous) => fresher(previous, response.current));
      setEvents((previous) =>
        next ? [...previous, ...response.events] : response.events,
      );
      setCursor(response.nextCursor);
    } catch (e: any) {
      if (!controller.signal.aborted)
        setError(
          e.response?.data?.message || "无法读取周期与记录，已有内容保留。",
        );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };
  useEffect(() => {
    setDraft(null);
    setData(null);
    setEvents([]);
    setCursor(null);
    request.current = null;
  }, [server.id]);
  useEffect(() => {
    if (server.billing)
      setData((previous) => fresher(previous, server.billing));
  }, [server.billing]);
  useEffect(() => {
    void load();
    return () => active.current?.abort();
  }, [
    server.id,
    server.trafficSettingsVersion,
    server.billing?.periodKey,
    server.billing?.version,
  ]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  return (
    <section className="nd-stack" aria-label="服务器计费用量与对账">
      <h4>计费用量与对账</h4>
      <Button
        variant="secondary"
        isDisabled={loading || busy}
        onPress={() => void load()}
      >
        {loading ? "正在读取周期…" : "刷新周期与记录"}
      </Button>
      {error && (
        <p className="nd-error" role="alert" tabIndex={-1} ref={errorRef}>
          {error}
        </p>
      )}
      {data && (
        <>
          {draft &&
            (draft.periodKey !== data.periodKey ||
              draft.settingsVersion !== data.settingsVersion ||
              draft.version !== data.version) && (
              <p className="nd-notice">
                周期、设置或对账版本已变化。输入保留，请核对当前用量后重新准备操作。
                <Button
                  variant="secondary"
                  isDisabled={busy || loading}
                  onPress={() => {
                    request.current = null;
                    setDraft({
                      ...draft,
                      periodKey: data.periodKey,
                      settingsVersion: data.settingsVersion,
                      version: data.version,
                    });
                  }}
                >
                  按当前周期重新准备
                </Button>
              </p>
            )}
          <p role="status">
            {data.period.start === "lifetime"
              ? "未设置月周期，使用接入本统计以来的计数及手工基线"
              : `当前周期：${data.period.start} 至 ${data.period.end}（UTC，结束日 00:00 不含）`}
          </p>
          <p>
            计费用量：{trafficBytes(data.usedBytes)} · 容量：
            {data.limitBytes === "0" ? "不限" : trafficBytes(data.limitBytes)} ·
            剩余：
            {data.limitBytes === "0"
              ? "不限"
              : trafficBytes(data.remainingBytes)}
          </p>
          {data.hasData ? (
            <p>
              按当前规则计算的原始量 {trafficBytes(data.measuredBytes)} + 调整（
              {signed(data.totalAdjustment)}） = {trafficBytes(data.usedBytes)}
            </p>
          ) : (
            <p className="nd-notice">
              尚无本范围原始上报。
              {data.calibrated
                ? "当前已知用量来自手工设定。"
                : "没有记录不能当作零用量。"}
            </p>
          )}
          <p className="nd-muted">
            基线调整 {signed(data.baselineAdjustment)}；手工校准{" "}
            {signed(data.manualAdjustment)}
            。原始上下行与调整后的用量不能再次相加。
          </p>
          {data.inconsistent && (
            <p className="nd-error">
              账本低于已保存基线或调整后为负，请检查数据或清除手工调整；当前用量暂不可用。
            </p>
          )}
          <details>
            <summary>查看原始记录与基线</summary>
            <p>
              范围原始上传 {trafficBytes(data.rawUpload)} / 下载{" "}
              {trafficBytes(data.rawDownload)}；手工基线上传{" "}
              {trafficBytes(data.baselineUpload)} / 下载{" "}
              {trafficBytes(data.baselineDownload)}。
            </p>
            <p>
              {data.expectedDays == null
                ? "此范围没有月周期边界。"
                : `本周期至今 ${data.expectedDays} 天，${data.observedDays} 天有上报。`}
              有上报不代表全天完整覆盖；同周期迟到数据会补入，旧周期数据不进入本周期。
            </p>
            {!!data.missingInterfaces.length && (
              <p>尚无所选网卡记录：{data.missingInterfaces.join(", ")}</p>
            )}
            <p>
              基线中断 {data.discontinuities} 次，跨日间隔{" "}
              {data.crossDateReports} 条，按接收日期归档{" "}
              {data.receivedDateReports}{" "}
              条。月周期原始量按日账本归档，不做跨日插值。
            </p>
          </details>
          {!draft ? (
            <div className="nd-row">
              {Object.entries(names).map(([action, label]) => (
                <Button
                  key={action}
                  variant="secondary"
                  isDisabled={busy || loading}
                  onPress={() => {
                    setError("");
                    setDraft({
                      action,
                      targetBytes: data.usedBytes ?? "",
                      reason: "",
                      version: data.version,
                      settingsVersion: data.settingsVersion,
                      periodKey: data.periodKey,
                    });
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
          ) : (
            <form
              className="nd-stack"
              onSubmit={(event) => {
                event.preventDefault();
                setBusy(true);
                setError("");
                void (async () => {
                  try {
                    const body = {
                      ...draft,
                      ...(draft.action !== "calibrate"
                        ? { targetBytes: undefined }
                        : {}),
                    };
                    const key = JSON.stringify({
                      serverId: server.id,
                      ...body,
                    });
                    if (request.current?.key !== key)
                      request.current = { key, id: crypto.randomUUID() };
                    const input = TrafficAccountingAction.parse({
                      ...body,
                      requestId: request.current.id,
                    });
                    await instance.post(
                      `/api/servers/${server.id}/traffic-accounting`,
                      input,
                    );
                    setDraft(null);
                    request.current = null;
                    await load();
                    changed();
                  } catch (e: any) {
                    setError(
                      e.response?.data?.message ||
                        e.issues
                          ?.map((issue: any) => issue.message)
                          .join("；") ||
                        "无法提交对账操作，输入已保留；重试会沿用请求标识。",
                    );
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              <div className="nd-stack" inert={busy || loading}>
                <strong>{names[draft.action]}</strong>
                {draft.action === "calibrate" && (
                  <Field
                    label="目标计费用量（字节）"
                    value={draft.targetBytes}
                    change={(targetBytes) =>
                      setDraft({ ...draft, targetBytes })
                    }
                  />
                )}
                <Field
                  label="操作原因"
                  value={draft.reason}
                  change={(reason) => setDraft({ ...draft, reason })}
                />
                <p>
                  {draft.action === "reset"
                    ? "将当前已收到的上下行作为新基线，并清除当前手工校准，用量归零。"
                    : draft.action === "clear"
                      ? "清除当前范围的手工基线与校准，恢复按原始账本计算。"
                      : "将当前已收到账本的计算值调整为目标用量。"}
                  原始账本保留，后续收到的同周期增量（包括离线补报）仍会计入；此操作不重置用户套餐，也不改变服务器内核计数器。
                </p>
                <Button type="submit">执行{names[draft.action]}</Button>
                <Button variant="secondary" onPress={() => setDraft(null)}>
                  取消对账操作
                </Button>
              </div>
            </form>
          )}
          <details>
            <summary>校准与重置记录（{events.length} 条已加载）</summary>
            <div className="nd-stack">
              {!events.length && (
                <p>尚无手工对账记录；自动切换月周期无需修改原始账本。</p>
              )}
              {events.map((event) => (
                <article key={event.id} className="nd-entry-form">
                  <strong>
                    {names[event.request.action]} ·{" "}
                    {new Date(event.createdAt).toLocaleString()}
                  </strong>
                  <p>{event.request.reason}</p>
                  <p>
                    {event.accounting.periodStart === "lifetime"
                      ? "无月周期"
                      : `${event.accounting.periodStart} 至 ${event.accounting.periodEnd}`}{" "}
                    · 统计口径 #{event.accounting.epoch} ·{" "}
                    {event.accounting.settings.source === "network"
                      ? "网卡"
                      : "协议"}{" "}
                    /{" "}
                    {directions[event.accounting.settings.direction] ||
                      event.accounting.settings.direction}
                  </p>
                  <p>
                    用量 {trafficBytes(event.before.usedBytes)} →{" "}
                    {trafficBytes(event.after.usedBytes)}；调整{" "}
                    {signed(event.before.totalAdjustment)} →{" "}
                    {signed(event.after.totalAdjustment)}。
                  </p>
                </article>
              ))}
              {cursor && (
                <Button
                  variant="secondary"
                  isDisabled={loading || busy}
                  onPress={() => void load(cursor)}
                >
                  加载更早记录
                </Button>
              )}
            </div>
          </details>
        </>
      )}
    </section>
  );
}
