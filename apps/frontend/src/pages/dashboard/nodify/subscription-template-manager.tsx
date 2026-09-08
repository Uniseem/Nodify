import { Button, Card, TextArea } from "@heroui/react";
import {
  SubscriptionTemplateInput,
  SubscriptionTemplateDocument,
  TemplateGroup,
} from "@nodify/contract";
import { useCallback, useEffect, useRef, useState } from "react";
import { instance } from "@shared/api/axios";
import { Choice, Field } from "./editor-fields";
import { RuleSetPicker } from "./rule-set-picker";

type Row = Record<string, any>;
const request = async (
  path = "",
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
) =>
  (
    await instance.request({
      url: `/api/subscription-templates${path}`,
      method,
      data,
      timeout: 15000,
    })
  ).data.response;
const message = (error: any) => {
  if (!error.response && ["ECONNABORTED", "ETIMEDOUT"].includes(error.code))
    return "主控响应超时，请稍后刷新确认操作结果。当前编辑内容已保留。";
  if (!error.response && error.code === "ERR_NETWORK")
    return "暂时无法连接主控，请稍后重试。当前内容已保留。";
  const value =
    error.issues?.map((issue: any) => issue.message) ||
    error.response?.data?.message ||
    error.message ||
    "操作失败";
  return Array.isArray(value) ? value.join("；") : value;
};
const stringify = (value: unknown) => JSON.stringify(value, null, 2);
const blank = {
  name: "",
  document: {
    mihomo: {
      "proxy-groups": [{ name: "Nodify", type: "select", proxies: ["$NODES"] }],
      rules: ["MATCH,Nodify"],
    },
    singbox: {},
  },
};
const list = (text: string) =>
  text
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
const target = (rule: string) => {
  const parts = rule.split(",");
  return parts[parts.length - (parts.at(-1) === "no-resolve" ? 2 : 1)];
};

function TemplateEditor({
  row,
  save,
  cancel,
  initialRuleSets,
}: {
  row: Row;
  save: (value: Row) => Promise<void>;
  cancel: () => void;
  initialRuleSets: Row[];
}) {
  const [name, setName] = useState(row.name),
    [text, setText] = useState(stringify(row.document));
  const [ruleMode, setRuleMode] = useState(row.ruleMode || "all"),
    [ruleSetIds, setRuleSetIds] = useState<string[]>(row.ruleSetIds || []),
    [ruleSets, setRuleSets] = useState(initialRuleSets);
  const [group, setGroup] = useState<Row | null>(null),
    [groupIndex, setGroupIndex] = useState(-1);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<Row | null>(null);
  const [importText, setImportText] = useState(""),
    [importFormat, setImportFormat] = useState("mihomo");
  const [previewNames, setPreviewNames] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) {
      errorRef.current?.scrollIntoView({ block: "nearest" });
      errorRef.current?.focus({ preventScroll: true });
    }
  }, [error]);
  const [members, setMembers] = useState(""),
    [uses, setUses] = useState("");
  let document: Row = {},
    jsonError = "";
  try {
    document = SubscriptionTemplateDocument.parse(JSON.parse(text));
  } catch (e) {
    jsonError = message(e);
  }
  const groups: Row[] = Array.isArray(document.mihomo?.["proxy-groups"])
    ? document.mihomo["proxy-groups"]
    : [];
  const changeDocument = (value: Row) => {
    setText(stringify(value));
    setPreview(null);
    setError("");
  };
  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const writeGroup = () => {
    try {
      const parsed = TemplateGroup.parse({
        ...group,
        proxies: list(members),
        use: list(uses),
      });
      const old = groups[groupIndex]?.name;
      if (groups.some((g, i) => i !== groupIndex && g.name === parsed.name))
        throw Error("代理组名称重复");
      const updated = JSON.parse(text);
      const next = groups.map((g, i) => (i === groupIndex ? parsed : g));
      if (groupIndex < 0) next.push(parsed);
      if (old && old !== parsed.name) {
        next.forEach((g) => {
          if (g["dialer-proxy-group"] === old)
            g["dialer-proxy-group"] = parsed.name;
          if (g.proxies)
            g.proxies = g.proxies.map((v: string) =>
              v === old ? parsed.name : v,
            );
        });
        for (const provider of Object.values(
          updated.mihomo["proxy-providers"] || {},
        ) as Row[]) {
          for (const key of ["dialer-proxy", "proxy"])
            if (provider[key] === old) provider[key] = parsed.name;
          if (provider.override?.["dialer-proxy"] === old)
            provider.override["dialer-proxy"] = parsed.name;
          if (Array.isArray(provider.payload))
            for (const node of provider.payload)
              if (node?.["dialer-proxy"] === old)
                node["dialer-proxy"] = parsed.name;
        }
        if (Array.isArray(updated.mihomo.rules))
          updated.mihomo.rules = updated.mihomo.rules.map((rule: string) => {
            if (target(rule) !== old) return rule;
            const parts = rule.split(",");
            parts[parts.length - (parts.at(-1) === "no-resolve" ? 2 : 1)] =
              parsed.name;
            return parts.join(",");
          });
      }
      updated.mihomo = { ...updated.mihomo, "proxy-groups": next };
      changeDocument(SubscriptionTemplateDocument.parse(updated));
      setGroup(null);
    } catch (e) {
      setError(message(e));
    }
  };
  const removeGroup = (index: number) => {
    const name = groups[index].name;
    if (
      groups.some(
        (g, i) =>
          i !== index &&
          (g.proxies?.includes(name) || g["dialer-proxy-group"] === name),
      ) ||
      (Object.values(document.mihomo?.["proxy-providers"] || {}) as Row[]).some(
        (provider) =>
          provider["dialer-proxy"] === name ||
          provider.proxy === name ||
          provider.override?.["dialer-proxy"] === name ||
          (Array.isArray(provider.payload) &&
            provider.payload.some(
              (node: Row) => node?.["dialer-proxy"] === name,
            )),
      ) ||
      document.mihomo?.rules?.some((rule: string) => target(rule) === name)
    ) {
      setError("代理组仍被其他组或规则引用，请先修改引用");
      return;
    }
    changeDocument({
      ...document,
      mihomo: {
        ...document.mihomo,
        "proxy-groups": groups.filter((_, i) => i !== index),
      },
    });
  };
  return (
    <section className="nd-entry-form nd-stack">
      <h3>{row.id ? "编辑模板" : "新建模板"}</h3>
      {error && (
        <p role="alert" className="nd-error" tabIndex={-1} ref={errorRef}>
          {error}
        </p>
      )}
      <div className="nd-stack" inert={busy}>
        <Field label="模板名称" value={name} change={setName} />
        <RuleSetPicker
          mode={ruleMode}
          ids={ruleSetIds}
          sets={ruleSets as { id: string; name: string; enabled: boolean }[]}
          changeMode={(value) => {
            setRuleMode(value);
            setPreview(null);
            setError("");
          }}
          changeIds={(value) => {
            setRuleSetIds(value);
            setPreview(null);
            setError("");
          }}
        />
        <Button
          variant="secondary"
          onPress={() =>
            void act(async () => {
              setRuleSets((await request()).ruleSets);
              setPreview(null);
            })
          }
        >
          刷新可选规则集
        </Button>
        <p className="nd-muted">
          Mihomo 与 sing-box
          各自保留配置。保存模板后，使用它的订阅会在客户端下次刷新时更新。节点和
          sing-box 入站由用户权益生成。
        </p>
        <div className="nd-row">
          <Button
            variant="secondary"
            isDisabled={!!group || !!jsonError}
            onPress={() => {
              setGroupIndex(-1);
              setGroup({ name: "", type: "select", proxies: ["$NODES"] });
              setMembers("$NODES");
              setUses("");
            }}
          >
            新增代理组
          </Button>
        </div>
        {groups.map((g, i) => (
          <div className="nd-row" key={i}>
            <span>
              {g.name} · {g.type}
            </span>
            <Button
              variant="secondary"
              isDisabled={!!group || !!jsonError}
              onPress={() => {
                setGroupIndex(i);
                setGroup(JSON.parse(stringify(g)));
                setMembers((g.proxies || []).join(","));
                setUses((g.use || []).join(","));
              }}
            >
              编辑组 {g.name}
            </Button>
            <Button
              variant="secondary"
              isDisabled={!!group || !!jsonError}
              onPress={() => removeGroup(i)}
            >
              删除组 {g.name}
            </Button>
          </div>
        ))}
        {group && (
          <div className="nd-stack nd-entry-form">
            <div className="nd-fields">
              <Field
                label="代理组名称"
                value={group.name}
                change={(name) => setGroup({ ...group, name })}
              />
              <Choice
                label="代理组类型"
                value={group.type}
                options={[
                  ["select", "手动选择"],
                  ["url-test", "自动选择"],
                  ["fallback", "主备切换"],
                  ["load-balance", "负载均衡"],
                  ["relay", "中转后手动选择"],
                ]}
                change={(type) =>
                  setGroup({
                    ...group,
                    type,
                    ...(!["select", "relay"].includes(type) && !group.url
                      ? {
                          url: "https://cp.cloudflare.com/generate_204",
                          interval: 300,
                        }
                      : {}),
                  })
                }
              />
              <Field
                label="组成员（逗号分隔，$NODES 表示权益节点）"
                value={members}
                change={setMembers}
              />
              <Field
                label="代理集合 use（逗号分隔）"
                value={uses}
                change={setUses}
              />
              <Field
                label="名称筛选 filter（Mihomo 正则）"
                value={group.filter || ""}
                change={(filter) => setGroup({ ...group, filter })}
              />
              <Field
                label="名称排除 exclude-filter"
                value={group["exclude-filter"] || ""}
                change={(value) =>
                  setGroup({ ...group, "exclude-filter": value })
                }
              />
              <Field
                label="包含协议 include-type（如 vless|ss，可留空）"
                value={group["include-type"] || ""}
                change={(value) =>
                  setGroup({ ...group, "include-type": value })
                }
              />
              <Choice
                label="中转代理组（先经过此组选中的节点）"
                value={
                  group["dialer-proxy-group"]
                    ? `group:${group["dialer-proxy-group"]}`
                    : "none"
                }
                options={[
                  ["none", "不使用中转"],
                  ...groups
                    .filter((g, i) => i !== groupIndex)
                    .map((g): [string, string] => [`group:${g.name}`, g.name]),
                ]}
                change={(value) =>
                  setGroup({
                    ...group,
                    "dialer-proxy-group":
                      value === "none" ? undefined : value.slice(6),
                  })
                }
              />
              <Field
                label="排除协议 exclude-type（用 | 分隔）"
                value={group["exclude-type"] || ""}
                change={(value) =>
                  setGroup({ ...group, "exclude-type": value })
                }
              />
              <Field
                label="探测 URL"
                value={group.url || ""}
                change={(url) => setGroup({ ...group, url: url || undefined })}
              />
              <Field
                label="探测间隔（秒）"
                type="number"
                value={group.interval ?? 300}
                change={(value) =>
                  setGroup({ ...group, interval: Number(value) })
                }
              />
              <Field
                label="切换容差（毫秒）"
                type="number"
                value={group.tolerance ?? 50}
                change={(value) =>
                  setGroup({ ...group, tolerance: Number(value) })
                }
              />
            </div>
            {(
              [
                ["include-all-proxies", "动态包含全部权益节点"],
                ["include-all-providers", "动态包含全部代理集合"],
                ["hidden", "在客户端隐藏代理组"],
              ] as const
            ).map(([key, title]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={!!group[key]}
                  onChange={(e) => {
                    setGroup({ ...group, [key]: e.target.checked });
                    if (e.target.checked && key === "include-all-proxies")
                      setMembers(
                        list(members)
                          .filter(
                            (value) =>
                              !["$NODES", "__PROXY_NODES__"].includes(value),
                          )
                          .join(","),
                      );
                  }}
                />{" "}
                {title}
              </label>
            ))}
            <p className="nd-muted">
              协议名称不区分大小写，ss 等同 Shadowsocks。设置协议包含或中转后，
              本组节点放入独立集合，名称正则由 Mihomo 执行，空结果默认拒绝连接。
              中转目标须为节点或集合；不会改动其他组使用的原节点。高级字段通过完整
              JSON 保留。
            </p>
            <div className="nd-row">
              <Button onPress={writeGroup}>写入代理组</Button>
              <Button variant="secondary" onPress={() => setGroup(null)}>
                取消组编辑
              </Button>
            </div>
          </div>
        )}
        <label className="nd-field">
          <span>完整模板 JSON（mihomo / singbox）</span>
          <TextArea
            aria-label="完整模板 JSON"
            rows={14}
            value={text}
            disabled={!!group}
            onChange={(e) => {
              setText(e.target.value);
              setPreview(null);
            }}
          />
        </label>
        {jsonError && (
          <p role="alert" className="nd-error">
            JSON 错误：{jsonError}
          </p>
        )}
        <details>
          <summary>导入 YAML / JSON</summary>
          <div className="nd-stack">
            <Choice
              label="导入格式"
              value={importFormat}
              options={[
                ["mihomo", "Mihomo YAML"],
                ["singbox", "sing-box JSON"],
                ["document", "完整双格式 JSON"],
              ]}
              change={setImportFormat}
            />
            <label className="nd-field">
              <span>读取模板文件（最多 1 MiB）</span>
              <input
                type="file"
                accept=".yaml,.yml,.json"
                disabled={!!group}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 1048576) {
                    setError("文件超过 1 MiB");
                    return;
                  }
                  void act(async () => setImportText(await file.text()));
                  e.target.value = "";
                }}
              />
            </label>
            <TextArea
              aria-label="待导入模板内容"
              rows={6}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <p className="nd-muted">
              导入覆盖所选格式的草稿。含实际 proxies / outbounds
              的文件需先移除节点，使用外部来源导入它们。
            </p>
            <Button
              variant="secondary"
              isDisabled={!!group || !importText.trim() || !!jsonError}
              onPress={() =>
                void act(async () => {
                  const parsed = await request("/parse", {
                    format: importFormat,
                    text: importText,
                  });
                  changeDocument(
                    importFormat === "document"
                      ? parsed
                      : { ...document, [importFormat]: parsed[importFormat] },
                  );
                  setImportText("");
                })
              }
            >
              导入到草稿
            </Button>
          </div>
        </details>
        <Field
          label="预览节点（协议:名称，逗号分隔，如 vless:香港,ss:日本）"
          value={previewNames}
          change={setPreviewNames}
        />
        <div className="nd-row">
          <Button
            variant="secondary"
            isDisabled={!!group || !!jsonError}
            onPress={() =>
              void act(async () =>
                setPreview(
                  await request("/preview", {
                    document,
                    ruleMode,
                    ruleSetIds,
                    nodes: list(previewNames).map((value) => {
                      const colon = value.indexOf(":");
                      return colon < 0
                        ? { name: value }
                        : {
                            type: value.slice(0, colon).trim(),
                            name: value.slice(colon + 1).trim(),
                          };
                    }),
                  }),
                ),
              )
            }
          >
            预览代理组与规则
          </Button>
          <Button
            isDisabled={!!group || !!jsonError || !!importText.trim()}
            onPress={() =>
              void act(async () => {
                const value = SubscriptionTemplateInput.parse({
                  name,
                  document,
                  ruleMode,
                  ruleSetIds,
                });
                await save({
                  ...value,
                  ...(row.id ? { version: row.version } : {}),
                });
              })
            }
          >
            保存模板
          </Button>
          <Button variant="secondary" onPress={cancel}>
            取消模板编辑
          </Button>
        </div>
        {group && (
          <p className="nd-muted">请先写入或取消代理组编辑，再保存模板。</p>
        )}
        {importText.trim() && (
          <p className="nd-muted">
            待导入内容尚未写入草稿，请完成导入或清空后保存。
          </p>
        )}
        {preview && (
          <div>
            <p className="nd-muted">
              预览给定协议和名称的筛选、引用与中转转换；示例权益节点只有协议和名称，不能直接导入客户端。
              名称正则、代理集合下载和完整内核校验由客户端执行。动态集合的协议表以
              Mihomo 1.19.30 为准。
            </p>
            {preview.warnings.map((warning: string, i: number) => (
              <p key={i}>{warning}</p>
            ))}
            <p>
              本次附加：
              {preview.selectedRuleSets.length
                ? preview.selectedRuleSets
                    .map((set: Row) => set.name)
                    .join("、")
                : "无自定义规则集"}
              。停用的规则集不输出。
            </p>
            <pre className="nd-code" tabIndex={0} aria-label="模板规则预览">
              {stringify({
                groups: preview.groups,
                rules: preview.rules,
                proxyProviders: preview.proxyProviders,
                singboxRules: preview.singboxRules,
                singboxRuleSets: preview.customRules.ruleSets,
              })}
            </pre>
          </div>
        )}
      </div>
    </section>
  );
}

export function SubscriptionTemplateManager() {
  const [data, setData] = useState<Row | null>(null),
    [editing, setEditing] = useState<Row | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<Row | null>(null);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const value = await request();
    setData(value);
  }, []);
  const action = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load().catch((e) => setError(message(e)));
  }, [load]);
  const locked = busy || !!editing || !!pending;
  return (
    <Card className="nd-card nd-stack">
      <h3>订阅模板</h3>
      <p className="nd-muted">
        保存多个双格式模板。默认模板作用于主订阅及未单独绑定模板的文件；URI
        节点列表不携带模板规则。启用的自定义分流规则优先于模板规则。
      </p>
      {error && (
        <p className="nd-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="nd-row">
        <Button
          isDisabled={locked || !data}
          onPress={() => {
            setError("");
            setEditing(JSON.parse(stringify(blank)));
          }}
        >
          新建订阅模板
        </Button>
        <Button
          variant="secondary"
          isDisabled={locked}
          onPress={() => void action(async () => {})}
        >
          刷新模板
        </Button>
        <Button
          variant="secondary"
          isDisabled={locked || !data}
          onPress={() =>
            void action(async () => {
              const response = await instance.get(
                "/api/subscription-settings",
                { timeout: 15000 },
              );
              setEditing({
                name: "现有订阅设置",
                document: response.data.response,
              });
            })
          }
        >
          复制现有设置为模板
        </Button>
      </div>
      {!data && <p className="nd-muted">正在读取模板；读取失败后可重试。</p>}
      {editing && (
        <TemplateEditor
          key={editing.id || "new"}
          row={editing}
          initialRuleSets={data?.ruleSets || []}
          cancel={() => setEditing(null)}
          save={async (value) => {
            await request(
              editing.id ? `/${editing.id}` : "",
              value,
              editing.id ? "PUT" : "POST",
            );
            setEditing(null);
            setNotice("模板已保存。");
            try {
              await load();
            } catch (e) {
              setError(
                `模板已保存，但列表刷新失败：${message(e)}。请点击刷新模板。`,
              );
            }
          }}
        />
      )}
      {data && (
        <p>
          默认：
          {data.items.find((row: Row) => row.id === data.selection.templateId)
            ?.name || "原订阅设置"}{" "}
          <Button
            variant="secondary"
            isDisabled={locked || !data.selection.templateId}
            onPress={() =>
              setPending({
                type: "default",
                templateId: null,
                name: "原订阅设置",
              })
            }
          >
            切回原订阅设置
          </Button>
        </p>
      )}
      {data?.items.length === 0 && (
        <p className="nd-muted">尚无命名模板；当前订阅继续使用原设置。</p>
      )}
      {data?.items.map((row: Row) => (
        <div className="nd-entry-form nd-stack" key={row.id}>
          <strong>
            {row.name} · v{row.version}
            {row.id === data.selection.templateId ? " · 默认" : ""}
          </strong>
          <span className="nd-muted">
            自定义规则：
            {row.ruleMode === "none"
              ? "不附加"
              : row.ruleMode === "selected"
                ? `${row.ruleSetIds.length} 个规则集`
                : "全部启用"}{" "}
            · {row.document.mihomo?.["proxy-groups"]?.length || 0} 个代理组 ·
            {row._count?.subscriptionFiles || 0} 个文件引用 · 更新于{" "}
            {new Date(row.updatedAt).toLocaleString()}
          </span>
          <div className="nd-row">
            <Button
              variant="secondary"
              isDisabled={locked}
              onPress={() => setEditing(row)}
            >
              编辑模板 {row.name}
            </Button>
            <Button
              variant="secondary"
              isDisabled={locked}
              onPress={() =>
                setEditing({
                  name: `${row.name.slice(0, 70)} 副本`,
                  document: row.document,
                  ruleMode: row.ruleMode,
                  ruleSetIds: row.ruleSetIds,
                })
              }
            >
              复制模板 {row.name}
            </Button>
            <Button
              variant="secondary"
              isDisabled={locked || row.id === data.selection.templateId}
              onPress={() =>
                setPending({
                  type: "default",
                  templateId: row.id,
                  name: row.name,
                })
              }
            >
              设为默认 {row.name}
            </Button>
            <Button
              variant="secondary"
              isDisabled={locked || row.id === data.selection.templateId}
              onPress={() => setPending({ type: "delete", ...row })}
            >
              删除模板 {row.name}
            </Button>
          </div>
        </div>
      ))}
      {pending && (
        <div className="nd-entry-form">
          <p>
            {pending.type === "default"
              ? `将“${pending.name}”设为默认模板，下次刷新时作用于主订阅及未单独绑定模板的文件。`
              : `删除模板“${pending.name}”。此操作不能撤销。`}
          </p>
          <div className="nd-row">
            <Button
              isDisabled={busy}
              onPress={() =>
                void action(async () => {
                  if (pending.type === "default")
                    await request(
                      "/default",
                      {
                        templateId: pending.templateId,
                        version: data!.selection.version,
                      },
                      "PUT",
                    );
                  else
                    await request(
                      `/${pending.id}`,
                      { version: pending.version },
                      "DELETE",
                    );
                  setPending(null);
                  setNotice("模板设置已更新。");
                })
              }
            >
              确认模板操作
            </Button>
            <Button
              variant="secondary"
              isDisabled={busy}
              onPress={() => setPending(null)}
            >
              取消模板操作
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
