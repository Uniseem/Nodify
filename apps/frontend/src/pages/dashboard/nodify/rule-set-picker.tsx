import { Checkbox, Label } from "@heroui/react";
import { Choice } from "./editor-fields";

export function RuleSetPicker({
  mode,
  ids,
  sets,
  changeMode,
  changeIds,
  inherit = false,
}: {
  mode: string;
  ids: string[];
  sets: { id: string; name: string; enabled: boolean }[];
  changeMode: (value: string) => void;
  changeIds: (value: string[]) => void;
  inherit?: boolean;
}) {
  const choices: [string, string][] = [
    ...(inherit ? [["template", "跟随当前模板"] as [string, string]] : []),
    ["all", "全部启用的规则集"],
    ["selected", "仅选中的规则集"],
    ["none", "不附加自定义规则集"],
  ];
  const missing = ids.filter((id) => !sets.some((set) => set.id === id));
  return (
    <div className="nd-stack">
      <Choice
        label="自定义规则集范围"
        value={mode}
        options={choices}
        change={changeMode}
      />
      {mode === "selected" && (
        <div className="nd-stack" role="group" aria-label="选择自定义规则集">
          {[
            ...sets,
            ...missing.map((id) => ({
              id,
              name: `已删除或未加载的规则集 ${id}`,
              enabled: false,
            })),
          ].map((set) => (
            <Checkbox
              key={set.id}
              isSelected={ids.includes(set.id)}
              onChange={(selected) =>
                changeIds(
                  selected
                    ? [...ids, set.id]
                    : ids.filter((id) => id !== set.id),
                )
              }
            >
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Label>
                  {set.name}
                  {set.enabled ? "" : "（不输出）"}
                </Label>
              </Checkbox.Content>
            </Checkbox>
          ))}
          {!sets.length && (
            <p className="nd-muted">尚无可选规则集，可先在自定义规则中创建。</p>
          )}
          {!ids.length && (
            <p className="nd-muted">未选择规则集，此范围不会附加自定义规则。</p>
          )}
          {!!missing.length && (
            <p className="nd-error">
              有规则集已删除或未加载，请刷新列表或取消选择后保存。
            </p>
          )}
        </div>
      )}
      <p className="nd-muted">
        {mode === "template"
          ? "沿用所绑定模板的规则选择；未绑定模板时跟随系统默认。切换模板后自动更新。"
          : "只附加启用的规则集，按全局规则顺序排列，并优先于模板自带规则。"}
        {inherit && mode !== "template"
          ? " 此文件的选择覆盖模板的规则集范围。"
          : ""}
        选择“不附加”不会移除模板自带规则。
      </p>
    </div>
  );
}
