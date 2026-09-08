import { Button, Card, TextArea } from "@heroui/react";
import {
  RuleSetInput,
  SUBSCRIPTION_RULE_TYPES,
  parseSubscriptionRules,
  subscriptionRulesText,
  compileSubscriptionRules,
} from "@nodify/contract";
import { useCallback, useEffect, useState } from "react";
import { instance } from "@shared/api/axios";
import { Choice, Field } from "./editor-fields";

type Row = Record<string, any>;
const request = async (
  path = "",
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
) =>
  (await instance.request({ url: `/api/rule-sets${path}`, method, data })).data
    .response;
const errorText = (e: any) =>
  e.issues?.map((i: any) => i.message).join("；") ||
  e.response?.data?.message ||
  e.message ||
  "操作失败";

function RuleForm({
  initial,
  save,
  cancel,
}: {
  initial: Row;
  save: (input: unknown) => Promise<void>;
  cancel: () => void;
}) {
  const [name, setName] = useState(initial.name || ""),
    [enabled, setEnabled] = useState(initial.enabled ?? true);
  const [text, setText] = useState(subscriptionRulesText(initial.rules || [])),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [type, setType] = useState("DOMAIN-SUFFIX"),
    [value, setValue] = useState(""),
    [policy, setPolicy] = useState("PROXY");
  const [preview, setPreview] = useState<ReturnType<
    typeof compileSubscriptionRules
  > | null>(null);
  const parse = () => {
    if (value.trim())
      throw new Error("匹配内容尚未追加，请先追加规则或清空该输入。");
    return RuleSetInput.parse({
      name,
      enabled,
      rules: parseSubscriptionRules(text),
    });
  };
  const editText = (value: string) => {
    setText(value);
    setPreview(null);
    setError("");
  };
  return (
    <form
      className="nd-entry-form nd-stack"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        void (async () => {
          try {
            await save(parse());
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <div className="nd-fields" inert={busy}>
        <Field label="规则集名称" value={name} change={setName} />
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              setPreview(null);
            }}
          />{" "}
          启用规则集
        </label>
        <Choice
          label="匹配类型"
          value={type}
          change={setType}
          options={SUBSCRIPTION_RULE_TYPES.map((type) => [type, type])}
        />
        <Field label="匹配内容" value={value} change={setValue} />
        <Choice
          label="访问策略"
          value={policy}
          change={setPolicy}
          options={[
            ["PROXY", "代理（Nodify）"],
            ["DIRECT", "直连"],
            ["REJECT", "拒绝连接"],
          ]}
        />
        <Button
          type="button"
          variant="secondary"
          onPress={() => {
            try {
              const rule = parseSubscriptionRules(`${type},${value},${policy}`);
              editText(
                [text.trim(), subscriptionRulesText(rule)]
                  .filter(Boolean)
                  .join("\n"),
              );
              setValue("");
            } catch (e) {
              setError(errorText(e));
            }
          }}
        >
          追加规则
        </Button>
        <label className="nd-field nd-full">
          <span>规则内容（按行从上到下匹配）</span>
          <TextArea
            aria-label="规则内容"
            rows={8}
            value={text}
            onChange={(e) => editText(e.target.value)}
          />
        </label>
        <p className="nd-muted nd-full">
          每行使用 类型,匹配值,策略；支持粘贴多行，#
          开头为注释。首条匹配生效，可直接调整行顺序。保存后的启用规则会排在模板规则之前，下次刷新订阅时生效。
        </p>
      </div>
      {error && (
        <p className="nd-error" role="alert">
          {String(error)}
        </p>
      )}
      <div className="nd-row">
        <Button type="submit" isDisabled={busy}>
          {busy ? "正在保存…" : "保存规则集"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          isDisabled={busy}
          onPress={() => {
            try {
              setPreview(compileSubscriptionRules([parse()]));
              setError("");
            } catch (e) {
              setError(errorText(e));
            }
          }}
        >
          预览规则输出
        </Button>
        <Button
          type="button"
          variant="tertiary"
          isDisabled={busy}
          onPress={cancel}
        >
          取消规则编辑
        </Button>
      </div>
      {preview && (
        <div className="nd-stack">
          <strong>Mihomo / Clash 规则</strong>
          <pre className="nd-code">
            {preview.mihomo.join("\n") || "规则集已禁用，不输出规则"}
          </pre>
          <strong>sing-box 路由</strong>
          <pre className="nd-code">
            {JSON.stringify(
              { rules: preview.singbox, rule_set: preview.ruleSets },
              null,
              2,
            )}
          </pre>
          {!!preview.ruleSets.length && (
            <p className="nd-muted">
              GEOIP 由 sing-box 下载 SagerNet
              国家规则文件；客户端需要能够访问预览中的地址。Mihomo
              使用客户端配置的 GeoIP 数据。
            </p>
          )}
        </div>
      )}
    </form>
  );
}
export function RuleSetManager() {
  const [rows, setRows] = useState<Row[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [remove, setRemove] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await request());
      setError("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const action = async (work: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      setRows(await request());
      setNotice(message);
      setRemove("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const move = (index: number, direction: number) => {
    const next = [...rows];
    [next[index], next[index + direction]] = [
      next[index + direction],
      next[index],
    ];
    void action(
      () =>
        request("/reorder", {
          items: next.map(({ id, version }) => ({ id, version })),
        }),
      "规则集顺序已保存。",
    );
  };
  const locked = busy || loading || !!editing;
  return (
    <Card>
      <Card.Header>
        <Card.Title>自定义分流规则</Card.Title>
        <Card.Description>
          按规则集顺序优先匹配，再使用订阅模板规则。
        </Card.Description>
      </Card.Header>
      <Card.Content className="nd-stack">
        <p className="nd-muted">
          应用于全部有效用户的 Mihomo / Clash 和 sing-box 订阅。URI 与 Base64
          节点列表不携带分流规则；到期或超额后的订阅仍保持拒绝访问。
        </p>
        <div className="nd-row">
          <Button
            isDisabled={locked}
            onPress={() => {
              setEditing({});
              setNotice("");
            }}
          >
            新建规则集
          </Button>
          <Button
            variant="tertiary"
            isDisabled={busy || !!editing}
            onPress={() => void load()}
          >
            刷新规则集
          </Button>
        </div>
        {loading && <p role="status">正在加载规则集…</p>}
        {error && (
          <p className="nd-error" role="alert">
            {String(error)}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {editing && (
          <RuleForm
            key={editing.id || "new"}
            initial={editing}
            cancel={() => setEditing(null)}
            save={async (input) => {
              await request(
                editing.id ? `/${editing.id}` : "",
                {
                  ...(input as Row),
                  ...(editing.id ? { version: editing.version } : {}),
                },
                editing.id ? "PUT" : "POST",
              );
              setEditing(null);
              setNotice("规则集已保存；客户端下次刷新订阅时生效。");
              await load();
            }}
          />
        )}
        {!loading && !rows.length && !editing && (
          <p className="nd-empty">尚无自定义规则集，当前使用订阅模板的规则。</p>
        )}
        {rows.map((row, index) => (
          <div className="nd-engine-entry" key={row.id}>
            <div className="nd-row">
              <strong>
                {index + 1}. {row.name}
              </strong>
              <span>
                {row.enabled ? "已启用" : "已禁用"} · {row.rules.length} 条规则
                · v{row.version}
              </span>
            </div>
            <div className="nd-row">
              <Button
                variant="secondary"
                isDisabled={locked}
                onPress={() => {
                  setEditing(row);
                  setRemove("");
                  setNotice("");
                }}
              >
                编辑 {row.name}
              </Button>
              <Button
                variant="secondary"
                isDisabled={locked}
                onPress={() =>
                  void action(
                    () =>
                      request(
                        `/${row.id}`,
                        { ...row, enabled: !row.enabled },
                        "PUT",
                      ),
                    row.enabled ? "规则集已禁用。" : "规则集已启用。",
                  )
                }
              >
                {row.enabled ? "禁用" : "启用"} {row.name}
              </Button>
              <Button
                variant="tertiary"
                isDisabled={locked || index === 0}
                onPress={() => move(index, -1)}
              >
                上移 {row.name}
              </Button>
              <Button
                variant="tertiary"
                isDisabled={locked || index === rows.length - 1}
                onPress={() => move(index, 1)}
              >
                下移 {row.name}
              </Button>
              <Button
                variant="danger-soft"
                isDisabled={locked}
                onPress={() => setRemove(row.id)}
              >
                删除 {row.name}
              </Button>
            </div>
            {remove === row.id && (
              <div className="nd-notice">
                <p>
                  删除规则集“{row.name}
                  ”后，客户端下次刷新订阅将不再收到其中的规则。
                </p>
                <div className="nd-row">
                  <Button
                    variant="danger"
                    isDisabled={locked}
                    onPress={() =>
                      void action(
                        () =>
                          request(
                            `/${row.id}`,
                            { version: row.version },
                            "DELETE",
                          ),
                        "规则集已删除。",
                      )
                    }
                  >
                    确认删除规则集
                  </Button>
                  <Button
                    variant="tertiary"
                    isDisabled={busy}
                    onPress={() => setRemove("")}
                  >
                    取消删除规则集
                  </Button>
                </div>
              </div>
            )}
            <details>
              <summary>查看 {row.name} 的规则</summary>
              <pre className="nd-code">{subscriptionRulesText(row.rules)}</pre>
            </details>
          </div>
        ))}
      </Card.Content>
    </Card>
  );
}
