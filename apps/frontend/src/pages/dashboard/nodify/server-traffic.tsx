import { Button, Card, Checkbox, Label } from "@heroui/react";
import { useState, useEffect, useRef } from "react";
import {
  ServerTrafficSettings,
  directionBytes,
  serverTrafficRaw,
} from "@nodify/contract";
import { instance } from "@shared/api/axios";
import { Field, Choice } from "./editor-fields";
import { trafficBytes } from "./traffic-summary";
import { TrafficAccountingPanel } from "./traffic-accounting";
export function ServerTraffic({
  server,
  changed,
}: {
  server: Record<string, any>;
  changed: () => void;
}) {
  const [editing, setEditing] = useState<Record<string, any> | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const raw = serverTrafficRaw(server);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  const settings = ServerTrafficSettings.parse(server.trafficSettings || {});
  const interfaces = [
    ...new Set([
      ...Object.keys(server.metrics?.interfaces || {}),
      ...Object.keys(server.networkTraffic?.interfaces || {}),
      ...settings.interfaces,
    ]),
  ];
  return (
    <Card className="nd-stack">
      <Card.Header>
        <Card.Title>服务器流量统计</Card.Title>
      </Card.Header>
      <Card.Content className="nd-stack">
        <p>
          数据源：
          {settings.source === "network"
            ? `系统网卡（${settings.interfaces.join(", ")}）`
            : "协议用户计数器"}
        </p>
        <p>
          展示容量：
          {settings.limitBytes === "0"
            ? "不限"
            : trafficBytes(settings.limitBytes)}
        </p>
        <p>
          接收以来原始累计：上传 {trafficBytes(raw.upload)} · 下载{" "}
          {trafficBytes(raw.download)} · 原始累计按规则汇总{" "}
          {raw.upload != null
            ? trafficBytes(
                directionBytes(raw.upload, raw.download, settings.direction),
              )
            : "尚无数据"}
        </p>
        <p className="nd-muted">
          从{" "}
          {raw.startedAt
            ? new Date(raw.startedAt).toLocaleString()
            : "首次成功接收上报"}{" "}
          开始累计。
          {settings.source === "network"
            ? "所选网卡包含主机其他服务流量；首次采集和计数器变化只建立基线，之前流量不补算。"
            : "协议用户流量不含网卡其他流量。"}
          用户套餐重置不会清空此原始累计值。展示容量不执行服务器断流；周期用量及手工调整见下方对账区。
        </p>
        {raw.missingInterfaces.length > 0 && (
          <p className="nd-notice">
            汇总不完整，尚无网卡记录：{raw.missingInterfaces.join(", ")}
          </p>
        )}
        {settings.source === "network" && (
          <p className="nd-muted">
            已记录 {raw.discontinuities || 0}{" "}
            次基线中断；历史中的每日警示可用于检查缺口。
          </p>
        )}
        {server.metrics?.networkError && (
          <p role="alert">
            网卡采集或上报待恢复：{server.metrics.networkError}
          </p>
        )}
        <p className="nd-muted">
          当前采集网卡：
          {(server.metrics?.networkInterfaces || []).join(", ") || "未知"}
          ；本次开机累计上传 {trafficBytes(server.metrics?.networkTxBytes)} /
          下载 {trafficBytes(server.metrics?.networkRxBytes)}，与账本累计独立。
        </p>
        {error && (
          <p className="nd-error" role="alert" tabIndex={-1} ref={errorRef}>
            {error}
          </p>
        )}
        {!editing ? (
          <Button
            variant="secondary"
            onPress={() => {
              setError("");
              setEditing({
                ...settings,
                limitBytes: settings.limitBytes ?? "",
                resetDay:
                  settings.resetDay == null ? "" : String(settings.resetDay),
                version: server.trafficSettingsVersion,
              });
            }}
          >
            设置数据源、方向与容量
          </Button>
        ) : (
          <form
            className="nd-stack"
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              void (async () => {
                try {
                  const value = ServerTrafficSettings.parse({
                    ...editing,
                    limitBytes: editing.limitBytes.trim() || null,
                    resetDay: String(editing.resetDay).trim()
                      ? Number(editing.resetDay)
                      : null,
                  });
                  await instance.put(
                    `/api/servers/${server.id}/traffic-settings`,
                    { ...value, version: editing.version },
                  );
                  setEditing(null);
                  changed();
                } catch (e: any) {
                  setError(
                    e.response?.data?.message ||
                      e.issues?.map((i: any) => i.message).join("；") ||
                      "无法保存统计设置，请检查连接后重试；当前选择已保留。",
                  );
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            <div className="nd-stack" inert={busy}>
              <Checkbox
                isSelected={editing.includeInOverview}
                onChange={(includeInOverview) =>
                  setEditing({ ...editing, includeInOverview })
                }
              >
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  <Label>计入首页流量统计</Label>
                </Checkbox.Content>
              </Checkbox>
              <Choice
                label="服务器统计数据源"
                value={editing.source}
                options={[
                  ["protocol", "协议用户计数器"],
                  ["network", "系统网卡"],
                ]}
                change={(source) => setEditing({ ...editing, source })}
              />
              {editing.source === "network" && (
                <fieldset className="nd-stack">
                  <legend>统计网卡（至少选择一张）</legend>
                  {!interfaces.length && (
                    <p>尚未收到网卡信息，请等待 Agent 采集后重试。</p>
                  )}
                  {interfaces.map((name) => (
                    <Checkbox
                      key={name}
                      isSelected={editing.interfaces.includes(name)}
                      onChange={(selected) =>
                        setEditing({
                          ...editing,
                          interfaces: selected
                            ? [...editing.interfaces, name]
                            : editing.interfaces.filter(
                                (item: string) => item !== name,
                              ),
                        })
                      }
                    >
                      <Checkbox.Content>
                        <Checkbox.Control>
                          <Checkbox.Indicator />
                        </Checkbox.Control>
                        <Label>
                          {name}
                          {!server.metrics?.interfaces?.[name]
                            ? "（当前未发现）"
                            : ""}
                        </Label>
                      </Checkbox.Content>
                    </Checkbox>
                  ))}
                  <p className="nd-muted">
                    只选择要统计的出口网卡；同时选择网桥及其成员、隧道及底层网卡可能重复累计同一份流量。修改选择会重新汇总这些网卡自开始采集以来的记录，不改变用户配额。
                  </p>
                </fieldset>
              )}
              <Choice
                label="服务器统计方向"
                value={editing.direction}
                options={[
                  ["both", "上传 + 下载"],
                  ["upload", "仅上传"],
                  ["download", "仅下载"],
                  ["max", "上传与下载的较大值"],
                ]}
                change={(direction) => setEditing({ ...editing, direction })}
              />
              <Field
                label="服务器展示容量（字节，留空未知，0 不限）"
                value={editing.limitBytes}
                change={(limitBytes) => setEditing({ ...editing, limitBytes })}
              />
              <Field
                label="每月重置日（UTC，1–31，留空不设周期）"
                value={editing.resetDay}
                change={(resetDay) => setEditing({ ...editing, resetDay })}
              />
              <p>
                短月份取月末。改变数据源、网卡、方向或重置日会建立新的对账口径，旧校准与重置记录保留；新口径先按原始账本计算。仅修改容量会保留当前调整。用户计费不受影响。
              </p>
              <Button type="submit">保存统计设置</Button>
              <Button variant="secondary" onPress={() => setEditing(null)}>
                取消统计编辑
              </Button>
            </div>
          </form>
        )}
        <TrafficAccountingPanel server={server} changed={changed} />
      </Card.Content>
    </Card>
  );
}
