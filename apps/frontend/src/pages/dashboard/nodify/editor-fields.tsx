import { Input, Label, ListBox, Select } from "@heroui/react";

export function Choice({
  label,
  value,
  options,
  change,
}: {
  label: string;
  value: string;
  options: [string, string][];
  change: (value: string) => void;
}) {
  return (
    <Select
      aria-label={label}
      value={value || null}
      onChange={(key) => change(String(key ?? ""))}
    >
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map(([id, title]) => (
            <ListBox.Item id={id} key={id} textValue={title}>
              {title}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
export function Field({
  label,
  value,
  change,
  type = "text",
}: {
  label: string;
  value: unknown;
  change: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="nd-field">
      <span>{label}</span>
      <Input
        aria-label={label}
        type={type}
        value={String(value ?? "")}
        onChange={(e) => change(e.target.value)}
      />
    </label>
  );
}
