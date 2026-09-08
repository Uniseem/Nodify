import { Button } from "@heroui/react";
import { useEffect, useState } from "react";
import {
  splitValues,
  updatePolicyLevel,
  withBalancingObservers,
  xrayDurationSeconds,
  xrayOutbounds,
  type XrayRecord as Row,
} from "@nodify/contract";
import { Choice, Field } from "./editor-fields";
import { DnsFields } from "./dns-fields";

const booleanOptions: [string, string][] = [
  ["default", "内核默认"],
  ["true", "开启"],
  ["false", "关闭"],
];
const boolValue = (value: unknown) =>
  typeof value === "boolean" ? String(value) : "default";
const optionalNumber = (text: string) =>
  text.trim() === ""
    ? undefined
    : Number.isFinite(Number(text))
      ? Number(text)
      : text;

export function SystemFields({
  value: v,
  patch,
  pendingChange,
}: {
  value: Row;
  patch: (p: Row) => void;
  pendingChange: (value: boolean) => void;
}) {
  const [selectedLevel, setSelectedLevel] = useState("0"),
    [newLevel, setNewLevel] = useState(""),
    [remove, setRemove] = useState(false),
    [dnsPending, setDnsPending] = useState(false);
  useEffect(() => {
    pendingChange(Boolean(newLevel.trim()) || dnsPending);
    return () => pendingChange(false);
  }, [newLevel, dnsPending, pendingChange]);
  const levels = v.policy?.levels || {},
    level = levels[selectedLevel] || {};
  const changeLevel = (changes: Row) =>
    patch({ policy: updatePolicyLevel(v, selectedLevel, changes).policy });
  const mode = v.observatory
    ? "observatory"
    : v.burstObservatory
      ? "burstObservatory"
      : "auto";
  const observer = v[mode] || {},
    ping = observer.pingConfig || {};
  const updateObserver = (changes: Row) =>
    patch({ [mode]: { ...observer, ...changes } });
  const updatePing = (changes: Row) =>
    updateObserver({ pingConfig: { ...ping, ...changes } });
  const effective = withBalancingObservers(v);
  const active = effective.observatory || effective.burstObservatory;
  const matches = xrayOutbounds(v)
    .filter(
      (o) =>
        typeof o.tag === "string" &&
        active?.subjectSelector?.some((p: string) => o.tag.startsWith(p)),
    )
    .map((o) => o.tag);
  const levelOptions = [
    ...new Set(["0", ...Object.keys(levels), selectedLevel]),
  ].sort((a, b) => Number(a) - Number(b));
  return (
    <>
      <Choice
        label="日志等级"
        value={v.log?.loglevel || "warning"}
        options={["none", "error", "warning", "info", "debug"].map((p) => [
          p,
          p,
        ])}
        change={(loglevel) => patch({ log: { ...v.log, loglevel } })}
      />
      <Choice
        label="路由域名解析策略"
        value={v.routing?.domainStrategy || "AsIs"}
        options={["AsIs", "IPIfNonMatch", "IPOnDemand"].map((p) => [p, p])}
        change={(domainStrategy) =>
          patch({ routing: { ...v.routing, domainStrategy } })
        }
      />
      <p className="nd-muted nd-full">
        保留{" "}
        {
          (v.dns?.servers || []).filter((s: unknown) => typeof s !== "string")
            .length
        }{" "}
        个高级 DNS 对象及未覆盖字段。留空的策略数值交给内核默认值。
      </p>
      <DnsFields
        value={v.dns || {}}
        patch={(dns) => patch({ dns })}
        pendingChange={setDnsPending}
      />
      <section className="nd-stack nd-full">
        <h4>连接策略</h4>
        <div className="nd-fields">
          <Choice
            label="策略用户等级"
            value={selectedLevel}
            options={levelOptions.map((p) => [
              p,
              p === "0" ? "0 · 受管用户" : p,
            ])}
            change={(key) => {
              setSelectedLevel(key);
              setRemove(false);
            }}
          />
          <Field label="新增策略等级" value={newLevel} change={setNewLevel} />
          <Button
            variant="secondary"
            isDisabled={
              !/^(0|[1-9]\d*)$/.test(newLevel) ||
              Number(newLevel) > 4294967295 ||
              levelOptions.includes(newLevel)
            }
            onPress={() => {
              patch({ policy: updatePolicyLevel(v, newLevel, {}).policy });
              setSelectedLevel(newLevel);
              setNewLevel("");
              setRemove(false);
            }}
          >
            添加等级
          </Button>
        </div>
        <p className="nd-muted">
          受管入站用户使用等级
          0。其他等级供出站等高级配置引用；创建等级不会自动分配用户或套餐。
        </p>
        <div className="nd-fields">
          {(
            [
              ["handshake", "握手超时（秒）"],
              ["connIdle", "连接空闲超时（秒）"],
              ["uplinkOnly", "仅上传等待（秒）"],
              ["downlinkOnly", "仅下载等待（秒）"],
              ["bufferSize", "每请求缓冲区（KiB，-1 不限）"],
            ] as [string, string][]
          ).map(([key, label]) => (
            <Field
              key={`${selectedLevel}/${key}`}
              label={label}
              value={level[key] ?? ""}
              type="number"
              change={(text) => changeLevel({ [key]: optionalNumber(text) })}
            />
          ))}
          <Choice
            label="用户在线计数"
            value={boolValue(level.statsUserOnline)}
            options={booleanOptions}
            change={(text) =>
              changeLevel({
                statsUserOnline:
                  text === "default" ? undefined : text === "true",
              })
            }
          />
          {selectedLevel !== "0" &&
            (["statsUserUplink", "statsUserDownlink"] as const).map(
              (key, index) => (
                <Choice
                  key={key}
                  label={index ? "此等级用户下载统计" : "此等级用户上传统计"}
                  value={boolValue(level[key])}
                  options={booleanOptions}
                  change={(text) =>
                    changeLevel({
                      [key]: text === "default" ? undefined : text === "true",
                    })
                  }
                />
              ),
            )}
        </div>
        <p className="nd-muted">
          缓冲区按每个请求分配。0 表示不缓冲，-1
          表示不限；数值过大可能增加内存占用。在线计数开关只影响内核统计，本页不宣称提供所有协议在线设备限制。
        </p>
        {selectedLevel !== "0" &&
          (remove ? (
            <div className="nd-row">
              <p>
                移除等级 {selectedLevel} 后，引用它的连接会使用内核缺省策略。
              </p>
              <Button
                variant="danger"
                onPress={() => {
                  const copy = { ...levels };
                  delete copy[selectedLevel];
                  patch({ policy: { ...v.policy, levels: copy } });
                  setSelectedLevel("0");
                  setRemove(false);
                }}
              >
                确认移除此等级
              </Button>
              <Button variant="secondary" onPress={() => setRemove(false)}>
                保留等级
              </Button>
            </div>
          ) : (
            <Button variant="secondary" onPress={() => setRemove(true)}>
              移除此等级策略
            </Button>
          ))}
      </section>
      <section className="nd-stack nd-full">
        <h4>统计与本地 API</h4>
        <p className="nd-notice">
          Nodify 固定开启等级 0 用户上下行和入站上下行统计。统计 API 监听 Agent
          内的 127.0.0.1:61001，仅启用 StatsService；高级 JSON 中的 API、stats
          及这些必需开关会由发布配置覆盖。
        </p>
        <div className="nd-fields">
          {(["statsOutboundUplink", "statsOutboundDownlink"] as const).map(
            (key, index) => (
              <Choice
                key={key}
                label={index ? "出站下载统计" : "出站上传统计"}
                value={boolValue(v.policy?.system?.[key])}
                options={booleanOptions}
                change={(text) =>
                  patch({
                    policy: {
                      ...v.policy,
                      system: {
                        ...v.policy?.system,
                        [key]: text === "default" ? undefined : text === "true",
                      },
                    },
                  })
                }
              />
            ),
          )}
        </div>
        <p className="nd-muted">
          出站统计用于内核诊断，不额外加入用户套餐用量，避免重复计费。AnyTLS
          由独立 sing-box 进程计量，不使用这些 Xray 策略。
        </p>
      </section>
      <section className="nd-stack nd-full">
        <h4>连接观测</h4>
        <Choice
          label="连接观测方式"
          value={mode}
          options={[
            ["auto", "由负载均衡自动配置 / 无自定义"],
            ["observatory", "后台观测"],
            ["burstObservatory", "突发观测"],
          ]}
          change={(kind) => {
            const clean = {
              ...v,
              observatory: undefined,
              burstObservatory: undefined,
            };
            if (kind === "auto") {
              const auto = withBalancingObservers(clean);
              patch({
                observatory: auto.observatory,
                burstObservatory: auto.burstObservatory,
              });
            } else
              patch({
                observatory: undefined,
                burstObservatory: undefined,
                [kind]:
                  v[kind] ||
                  (kind === "observatory"
                    ? {
                        subjectSelector: active?.subjectSelector || [],
                        probeURL:
                          "https://connectivitycheck.gstatic.com/generate_204",
                        probeInterval: "1m",
                        enableConcurrency: false,
                      }
                    : {
                        subjectSelector: active?.subjectSelector || [],
                        pingConfig: {
                          destination:
                            "https://connectivitycheck.gstatic.com/generate_204",
                          interval: "1m",
                          sampling: 3,
                          timeout: "5s",
                        },
                      }),
              });
          }}
        />
        <p className="nd-muted">
          切换方式会替换另一种观测配置，可取消整个系统编辑恢复原值。最低延迟、最低负载及备用出站需要观测；写入草稿时会补充其前缀。无相关均衡器且不配置自定义观测时不启用探测。
        </p>
        {mode !== "auto" && (
          <>
            <Field
              label="观测出站前缀（逗号分隔）"
              value={(observer.subjectSelector || []).join(", ")}
              change={(text) =>
                updateObserver({ subjectSelector: splitValues(text) })
              }
            />
            <div className="nd-fields">
              {mode === "observatory" ? (
                <>
                  <Field
                    label="后台探测地址"
                    value={observer.probeURL ?? observer.probeUrl ?? ""}
                    change={(probeURL) =>
                      updateObserver({ probeURL, probeUrl: undefined })
                    }
                  />
                  <Field
                    label="后台探测间隔"
                    value={observer.probeInterval ?? ""}
                    change={(text) =>
                      updateObserver({ probeInterval: text || undefined })
                    }
                  />
                  <Choice
                    label="并发探测"
                    value={boolValue(observer.enableConcurrency)}
                    options={booleanOptions}
                    change={(text) =>
                      updateObserver({
                        enableConcurrency:
                          text === "default" ? undefined : text === "true",
                      })
                    }
                  />
                </>
              ) : (
                <>
                  <Field
                    label="突发探测地址"
                    value={ping.destination ?? ""}
                    change={(destination) => updatePing({ destination })}
                  />
                  <Field
                    label="本地连通性地址（可空）"
                    value={ping.connectivity ?? ""}
                    change={(connectivity) => updatePing({ connectivity })}
                  />
                  <Field
                    label="突发探测间隔"
                    value={ping.interval ?? ""}
                    change={(text) =>
                      updatePing({ interval: text || undefined })
                    }
                  />
                  <Field
                    label="探测超时"
                    value={ping.timeout ?? ""}
                    change={(text) =>
                      updatePing({ timeout: text || undefined })
                    }
                  />
                  <Field
                    label="探测采样数"
                    type="number"
                    value={ping.sampling ?? ""}
                    change={(text) =>
                      updatePing({ sampling: optionalNumber(text) })
                    }
                  />
                  <Choice
                    label="探测 HTTP 方法"
                    value={ping.httpMethod || "HEAD"}
                    options={[
                      ...new Set([
                        "HEAD",
                        "GET",
                        ...(ping.httpMethod ? [ping.httpMethod] : []),
                      ]),
                    ].map((method) => [method, method])}
                    change={(httpMethod) => updatePing({ httpMethod })}
                  />
                </>
              )}
            </div>
          </>
        )}
        <p className="nd-muted">
          有效匹配：{matches.join("、") || "无"}。探测产生实际 HTTP
          请求；请选择会返回 204 的地址。时长支持 10s、1m、2h45m。
        </p>
        {mode === "burstObservatory" &&
          ping.interval &&
          xrayDurationSeconds(ping.interval)! > 0 &&
          xrayDurationSeconds(ping.interval)! < 10 && (
            <p className="nd-notice">
              Xray 会把不足 10 秒的突发探测间隔按 10 秒执行。
            </p>
          )}
      </section>
    </>
  );
}
