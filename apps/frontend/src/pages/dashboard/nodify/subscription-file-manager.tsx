import { Button, Card } from "@heroui/react";
import {
  SubscriptionFileCreate,
  SubscriptionFileUpdate,
} from "@nodify/contract";
import { useCallback, useEffect, useRef, useState } from "react";
import { instance } from "@shared/api/axios";
import { formatBytes } from "@shared/utils/misc/format";
import { Choice, Field } from "./editor-fields";
import { TrafficSummary } from "./traffic-summary";
import { RuleSetPicker } from "./rule-set-picker";

type Row = Record<string, any>;
const api = async (
  path = "",
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
) =>
  (
    await instance.request({
      url: `/api/subscription-files${path}`,
      method,
      data: body,
      timeout: 15000,
    })
  ).data.response;
const errorText = (e: any) => {
  if (!e.response && ["ECONNABORTED", "ETIMEDOUT"].includes(e.code))
    return "主控响应超时，请稍后刷新确认操作结果。当前编辑内容已保留。";
  if (
    !e.response?.data?.message &&
    (e.response?.status >= 500 || e.code === "ERR_NETWORK")
  )
    return "暂时无法连接主控，请稍后重试。当前内容已保留。";
  const value =
    e.issues?.map((issue: any) => issue.message) ||
    e.response?.data?.message ||
    e.message ||
    "操作失败";
  return Array.isArray(value) ? value.join("；") : value;
};
const localDate = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const toggle = (values: string[], id: string, checked: boolean) =>
  checked
    ? [...new Set([...values, id])]
    : values.filter((value) => value !== id);
const state = (row: Row) =>
  row.revoked
    ? "主订阅已撤销，需重置文件链接"
    : !row.enabled
      ? "文件已停用"
      : row.userStatus !== "ACTIVE"
        ? "用户已停用"
        : Math.min(
              new Date(row.userExpiresAt).getTime(),
              row.expiresAt ? new Date(row.expiresAt).getTime() : Infinity,
            ) <= Date.now()
          ? "已到期"
          : row.trafficLimitBytes !== "0" &&
              BigInt(row.usedBytes) >= BigInt(row.trafficLimitBytes)
            ? "额度已用尽"
            : "可用";

function FileEditor({
  file,
  save,
  cancel,
}: {
  file: Row;
  save: (value: unknown) => Promise<void>;
  cancel: () => void;
}) {
  const [name, setName] = useState(file.name || ""),
    [entitlementId, setEntitlementId] = useState(file.entitlementId || "");
  const [statisticServerIds, setStatisticServerIds] = useState<string[]>(
    file.statisticServerIds || [],
  );
  const [alias, setAlias] = useState(file.alias || ""),
    [displayLimit, setDisplayLimit] = useState(
      file.displayTrafficLimitBytes ?? "",
    );
  const [templateId, setTemplateId] = useState(file.templateId || "default"),
    [enabled, setEnabled] = useState(file.enabled ?? true);
  const [nodeMode, setNodeMode] = useState(file.nodeMode || "all"),
    [nodeIds, setNodeIds] = useState<string[]>(file.nodeIds || []),
    [tags, setTags] = useState((file.tags || []).join(","));
  const [ruleMode, setRuleMode] = useState(file.ruleMode || "template"),
    [ruleSetIds, setRuleSetIds] = useState<string[]>(file.ruleSetIds || []);
  const [expires, setExpires] = useState(localDate(file.expiresAt)),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(0);
  const [options, setOptions] = useState<Row | null>(null),
    [optionsError, setOptionsError] = useState(""),
    [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) {
      errorRef.current?.scrollIntoView({ block: "nearest" });
      errorRef.current?.focus({ preventScroll: true });
    }
  }, [error]);
  useEffect(() => {
    let current = true;
    setOptions(null);
    setOptionsError("");
    void api(
      `/options${entitlementId ? `?entitlementId=${encodeURIComponent(entitlementId)}` : ""}`,
    )
      .then((value) => {
        if (current) setOptions(value);
      })
      .catch((e) => {
        if (current) setOptionsError(errorText(e));
      });
    return () => {
      current = false;
    };
  }, [entitlementId, refresh]);
  const candidates: Row[] = options?.nodes || [];
  const matching = candidates.filter((row) =>
    `${row.name} ${row.tags.join(" ")}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(matching.length / 100)),
    currentPage = Math.min(page, pages - 1);
  const missing = options
    ? nodeIds.filter((id) => !candidates.some((row) => row.id === id))
    : [];
  return (
    <form
      className="nd-entry-form nd-stack"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        void (async () => {
          try {
            const value = {
              name,
              statisticServerIds,
              alias: alias.trim() || null,
              displayTrafficLimitBytes: displayLimit.trim() || null,
              enabled,
              templateId: templateId === "default" ? null : templateId,
              nodeMode,
              nodeIds,
              tags: [
                ...new Set(
                  tags
                    .split(",")
                    .map((tag: string) => tag.trim())
                    .filter(Boolean),
                ),
              ],
              ruleMode,
              ruleSetIds,
              expiresAt: expires ? new Date(expires).toISOString() : null,
              ...(file.id ? { version: file.version } : { entitlementId }),
            };
            await save(
              (file.id ? SubscriptionFileUpdate : SubscriptionFileCreate).parse(
                value,
              ),
            );
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <h4>{file.id ? "编辑订阅文件" : "新建订阅文件"}</h4>
      {error && (
        <p className="nd-error" role="alert" tabIndex={-1} ref={errorRef}>
          {error}
        </p>
      )}
      <div className="nd-stack" inert={busy}>
        <Field label="订阅文件名称" value={name} change={setName} />
        <Field label="短链别名（可选）" value={alias} change={setAlias} />
        <Button
          type="button"
          variant="secondary"
          onPress={() =>
            setAlias(crypto.randomUUID().replaceAll("-", "").slice(0, 20))
          }
        >
          生成随机别名
        </Button>
        <p className="nd-muted">
          12–64
          位字母、数字、下划线或连字符。短链本身就是访问凭据，请使用难以猜测的值。清空、更换、重置或删除后，旧别名永久停用，不能再次使用。
          仅更换别名不会重置原随机链接；撤销所有旧文件入口请用“重置链接”。
        </p>
        {alias.trim() && (
          <p style={{ overflowWrap: "anywhere" }}>
            链接路径：/api/sub/~{alias.trim().toLowerCase()}
          </p>
        )}
        <Field
          label="展示额度（字节，可选）"
          value={displayLimit}
          change={setDisplayLimit}
        />
        <p className="nd-muted">
          留空跟随套餐，0
          表示展示不限额。仅改变客户端订阅头与私有页展示，真实用量及断流仍按套餐执行。
        </p>
        {file.id ? (
          <p>所属用户：{file.username}（不能转移给其他用户）</p>
        ) : (
          options && (
            <Choice
              label="所属用户"
              value={entitlementId}
              options={options.entitlements.map((row: Row) => [
                row.id,
                row.name,
              ])}
              change={(value) => {
                setEntitlementId(value);
                setNodeIds([]);
                setSearch("");
                setPage(0);
              }}
            />
          )
        )}
        {optionsError && (
          <p className="nd-error" role="alert">
            {optionsError}
          </p>
        )}
        {!options && (
          <div>
            <p>正在读取用户及可选资源；加载失败后可重试。</p>
            <Button
              type="button"
              variant="secondary"
              onPress={() => setRefresh((value) => value + 1)}
            >
              重试可选资源
            </Button>
          </div>
        )}
        {options && (
          <>
            <fieldset className="nd-stack">
              <legend>管理员流量统计服务器</legend>
              <p className="nd-muted">
                未选择时汇总全部服务器。仅影响管理员统计，不改变用户套餐、节点分发或实际计费。
              </p>
              {(options.servers || []).map((server: Row) => (
                <label key={server.id}>
                  <input
                    type="checkbox"
                    checked={statisticServerIds.includes(server.id)}
                    onChange={(e) =>
                      setStatisticServerIds(
                        toggle(statisticServerIds, server.id, e.target.checked),
                      )
                    }
                  />
                  {server.node.name}
                </label>
              ))}
              {statisticServerIds
                .filter(
                  (id) =>
                    !(options.servers || []).some(
                      (server: Row) => server.id === id,
                    ),
                )
                .map((id) => (
                  <label key={id}>
                    <input
                      type="checkbox"
                      checked
                      onChange={() =>
                        setStatisticServerIds(
                          statisticServerIds.filter((value) => value !== id),
                        )
                      }
                    />
                    已删除服务器 {id}（取消选择后可保存）
                  </label>
                ))}
            </fieldset>
            {!options.entitlements.length && (
              <p>先在“用户与套餐”中创建用户并分配套餐。</p>
            )}
            <Choice
              label="绑定订阅模板"
              value={templateId}
              options={[
                ["default", "跟随系统默认模板"],
                ...options.templates.map((row: Row): [string, string] => [
                  row.id,
                  row.name,
                ]),
              ]}
              change={setTemplateId}
            />
            <Choice
              label="文件节点范围"
              value={nodeMode}
              options={[
                ["all", "全部套餐授权节点"],
                ["selected", "仅选中节点或标签"],
              ]}
              change={setNodeMode}
            />
            <Field
              label="文件允许标签（逗号分隔）"
              value={tags}
              change={setTags}
            />
            <p className="nd-muted">
              管理员只合并命中这些标签的外部来源流量。节点范围为“全部”时，标签不额外筛选节点。
            </p>
            {nodeMode === "selected" && (
              <div className="nd-stack">
                <p className="nd-muted">
                  选中节点和标签取并集，再与用户当前套餐授权取交集。标签不会扩大套餐权限；都不选时不分发节点。
                </p>
                <Field
                  label="查找可选节点（名称或标签）"
                  value={search}
                  change={(value) => {
                    setSearch(value);
                    setPage(0);
                  }}
                />
                {missing.map((id) => (
                  <label key={id}>
                    <input
                      type="checkbox"
                      checked
                      onChange={() =>
                        setNodeIds((values) =>
                          values.filter((value) => value !== id),
                        )
                      }
                    />{" "}
                    已失去授权或停用：{id}，请取消选择
                  </label>
                ))}
                {matching
                  .slice(currentPage * 100, (currentPage + 1) * 100)
                  .map((row) => (
                    <label key={row.id}>
                      <input
                        type="checkbox"
                        checked={nodeIds.includes(row.id)}
                        onChange={(event) =>
                          setNodeIds((values) =>
                            toggle(values, row.id, event.target.checked),
                          )
                        }
                      />{" "}
                      {row.name}
                      {row.external ? " · 仅订阅分发" : ""}{" "}
                      <span className="nd-muted">{row.tags.join("、")}</span>
                    </label>
                  ))}
                {!matching.length && (
                  <p className="nd-muted">没有匹配的已授权节点。</p>
                )}
                {pages > 1 && (
                  <div className="nd-row">
                    <Button
                      type="button"
                      variant="secondary"
                      isDisabled={currentPage === 0}
                      onPress={() => setPage(currentPage - 1)}
                    >
                      节点上一页
                    </Button>
                    <span>
                      {currentPage + 1}/{pages}
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      isDisabled={currentPage === pages - 1}
                      onPress={() => setPage(currentPage + 1)}
                    >
                      节点下一页
                    </Button>
                  </div>
                )}
              </div>
            )}
            <RuleSetPicker
              mode={ruleMode}
              ids={ruleSetIds}
              sets={options.ruleSets}
              changeMode={setRuleMode}
              changeIds={setRuleSetIds}
              inherit
            />
          </>
        )}
        <Field
          label="文件到期时间（本地时间，留空沿用用户到期）"
          type="datetime-local"
          value={expires}
          change={setExpires}
        />
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />{" "}
          启用订阅文件
        </label>
        <p className="nd-muted">
          文件共享所属用户的协议凭据、用量及 HWID
          限制。实际到期取文件与用户到期的较早时间。文件到期或停用只停止此链接的分发；要撤销已导入的协议访问，请在用户管理中禁用用户或撤销主订阅。
        </p>
        <div className="nd-row">
          <Button
            type="submit"
            isDisabled={
              !options ||
              !entitlementId ||
              (nodeMode === "selected" && missing.length > 0)
            }
          >
            保存订阅文件
          </Button>
          <Button type="button" variant="secondary" onPress={cancel}>
            取消文件编辑
          </Button>
        </div>
      </div>
    </form>
  );
}

export function SubscriptionFileManager() {
  const [rows, setRows] = useState<Row[] | null>(null),
    [editing, setEditing] = useState<Row | null>(null),
    [pending, setPending] = useState<Row | null>(null);
  const [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState(0);
  const load = useCallback(async () => setRows(await api()), []);
  const action = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load().catch((e) => setError(errorText(e)));
  }, [load]);
  const locked = busy || !!editing || !!pending;
  const filtered = (rows || []).filter((row) =>
    `${row.name} ${row.username}`.toLowerCase().includes(search.toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 25)),
    currentPage = Math.min(page, pages - 1);
  return (
    <Card className="nd-card nd-stack">
      <h3>订阅文件</h3>
      <p className="nd-muted">
        为用户生成独立私有链接，绑定模板、节点范围和规则集。各文件共享用户套餐用量，不重复累计。
      </p>
      {error && (
        <p className="nd-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="nd-row">
        <Button
          isDisabled={locked || !rows}
          onPress={() => {
            setEditing({});
            setError("");
          }}
        >
          新建订阅文件
        </Button>
        <Button
          variant="secondary"
          isDisabled={locked}
          onPress={() => void action(async () => {})}
        >
          刷新订阅文件
        </Button>
      </div>
      {editing && (
        <FileEditor
          key={editing.id || "new"}
          file={editing}
          cancel={() => setEditing(null)}
          save={async (value) => {
            await api(
              editing.id ? `/${editing.id}` : "",
              value,
              editing.id ? "PUT" : "POST",
            );
            setEditing(null);
            setNotice("订阅文件已保存，下次客户端刷新时生效。");
            try {
              await load();
            } catch (e) {
              setError(`文件已保存，列表刷新失败：${errorText(e)}`);
            }
          }}
        />
      )}
      {!rows && <p>正在读取订阅文件；加载失败后可重试。</p>}
      {rows && (
        <Field
          label="筛选订阅文件或用户"
          value={search}
          change={(value) => {
            setSearch(value);
            setPage(0);
          }}
        />
      )}
      {rows && !filtered.length && (
        <p className="nd-muted">暂无匹配的订阅文件。</p>
      )}
      {filtered.slice(currentPage * 25, (currentPage + 1) * 25).map((row) => (
        <div className="nd-entry-form nd-stack" key={row.id}>
          <strong>
            {row.name} · {row.username} · v{row.version}
          </strong>
          <span>{state(row)}</span>
          {row.trafficSummary && (
            <TrafficSummary summary={row.trafficSummary} />
          )}
          {row.alias && (
            <span style={{ overflowWrap: "anywhere" }}>
              短链：/api/sub/~{row.alias}
            </span>
          )}
          {row.displayTrafficLimitBytes != null && (
            <span className="nd-muted">
              展示额度：
              {row.displayTrafficLimitBytes === "0"
                ? "不限"
                : formatBytes(Number(row.displayTrafficLimitBytes))}
              ；实际额度仍按套餐。
            </span>
          )}
          <span className="nd-muted">
            模板：{row.template?.name || "跟随系统默认"} · 节点：
            {row.nodeMode === "all"
              ? "全部套餐授权"
              : `${row.nodeIds.length} 个节点 / ${row.tags.length} 个标签`}{" "}
            · 规则：
            {row.ruleMode === "template"
              ? "跟随模板"
              : row.ruleMode === "all"
                ? "全部启用"
                : row.ruleMode === "none"
                  ? "仅模板规则"
                  : `${row.ruleSetIds.length} 个规则集`}
          </span>
          <span className="nd-muted">
            用户协议用量：{formatBytes(Number(row.usedBytes))}；实际到期：
            {new Date(
              Math.min(
                new Date(row.userExpiresAt).getTime(),
                row.expiresAt ? new Date(row.expiresAt).getTime() : Infinity,
              ),
            ).toLocaleString()}
          </span>
          <div className="nd-row">
            <Button
              variant="secondary"
              isDisabled={locked}
              onPress={() => setEditing(row)}
            >
              编辑文件 {row.name}
            </Button>
            <Button
              variant="secondary"
              isDisabled={locked}
              onPress={() =>
                void action(async () => {
                  await api(
                    `/${row.id}`,
                    { ...row, enabled: !row.enabled },
                    "PUT",
                  );
                })
              }
            >
              {row.enabled ? "停用" : "启用"}文件 {row.name}
            </Button>
            <Button
              variant="secondary"
              isDisabled={locked}
              onPress={() => setPending({ ...row, action: "rotate" })}
            >
              重置链接 {row.name}
            </Button>
            <Button
              variant="secondary"
              isDisabled={locked}
              onPress={() => setPending({ ...row, action: "delete" })}
            >
              删除文件 {row.name}
            </Button>
          </div>
          <div className="nd-row">
            <a href={row.pageUrl} target="_blank" rel="noopener noreferrer">
              私有订阅页 / 二维码
            </a>
            <Button
              variant="secondary"
              isDisabled={locked || row.revoked}
              onPress={() => {
                void navigator.clipboard.writeText(row.subscriptionUrl).then(
                  () => setNotice("订阅链接已复制。请仅交给此用户。"),
                  () => setError("无法访问剪贴板，请打开私有页复制链接。"),
                );
              }}
            >
              复制订阅链接 {row.name}
            </Button>
          </div>
        </div>
      ))}
      {pages > 1 && (
        <div className="nd-row">
          <Button
            variant="secondary"
            isDisabled={currentPage === 0}
            onPress={() => setPage(currentPage - 1)}
          >
            文件上一页
          </Button>
          <span>
            {currentPage + 1}/{pages}
          </span>
          <Button
            variant="secondary"
            isDisabled={currentPage === pages - 1}
            onPress={() => setPage(currentPage + 1)}
          >
            文件下一页
          </Button>
        </div>
      )}
      {pending && (
        <div className="nd-entry-form">
          <p>
            {pending.action === "rotate"
              ? `重置“${pending.name}”的链接，旧文件链接及短链别名立即失效，新链接使用随机令牌。若用户主订阅曾被撤销，新链接将重新关联当前权益。`
              : `删除“${pending.name}”及其链接。`}{" "}
            已导入的协议凭据仍由用户管理控制。
          </p>
          <div className="nd-row">
            <Button
              isDisabled={busy}
              onPress={() =>
                void action(async () => {
                  await api(
                    `/${pending.id}${pending.action === "rotate" ? "/rotate" : ""}`,
                    { version: pending.version },
                    pending.action === "rotate" ? "POST" : "DELETE",
                  );
                  setPending(null);
                  setNotice("文件链接设置已更新。");
                })
              }
            >
              确认文件操作
            </Button>
            <Button
              variant="secondary"
              isDisabled={busy}
              onPress={() => setPending(null)}
            >
              取消文件操作
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
