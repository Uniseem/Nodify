import { BackupSchedule } from "@nodify/contract";
import { Button, Card, Checkbox, Input, Label, Spinner } from "@heroui/react";
import { useEffect, useState } from "react";
import { Choice } from "./editor-fields";

type Settings = {
  enabled: boolean;
  intervalHours: number;
  retain: number;
  destination: string;
};
type Props = {
  api: (path: string, body?: any, method?: string) => Promise<any>;
  run: (work: () => Promise<unknown>) => Promise<void>;
};
const emptyCredentials = {
  url: "",
  username: "",
  password: "",
  endpoint: "",
  region: "auto",
  bucket: "",
  accessKeyId: "",
  secretAccessKey: "",
};
const names: Record<string, string> = {
  local: "本地",
  webdav: "WebDAV",
  s3: "S3 兼容存储",
};
export function BackupSettingsForm({ api, run }: Props) {
  const [settings, setSettings] = useState<Settings>(),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [password, setPassword] = useState(""),
    [type, setType] = useState("local"),
    [credentials, setCredentials] = useState(emptyCredentials),
    [error, setError] = useState("");
  const load = () => {
    setLoading(true);
    void run(async () => {
      try {
        const value = await api("backup-settings");
        setSettings(value);
        setType(value.destination);
      } finally {
        setLoading(false);
      }
    });
  };
  useEffect(load, []);
  const field = (
    key: keyof typeof credentials,
    label: string,
    secret = false,
    placeholder?: string,
  ) => (
    <label className="nd-field" key={key}>
      {label}
      <Input
        aria-label={label}
        type={secret ? "password" : "text"}
        autoComplete="off"
        placeholder={placeholder}
        value={credentials[key]}
        onChange={(event) =>
          setCredentials({ ...credentials, [key]: event.target.value })
        }
      />
    </label>
  );
  return (
    <Card>
      <Card.Header>
        <Card.Title>定时备份与远程存储</Card.Title>
      </Card.Header>
      <Card.Content className="nd-stack">
        {loading ? (
          <Spinner aria-label="读取备份计划" />
        ) : !settings ? (
          <div role="alert">
            无法读取备份计划。<Button onPress={load}>重新加载</Button>
          </div>
        ) : (
          <>
            <div className="nd-stack" inert={busy}>
              <Checkbox
                isSelected={settings.enabled}
                onChange={(enabled) => setSettings({ ...settings, enabled })}
              >
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  <Label>启用定时备份</Label>
                </Checkbox.Content>
              </Checkbox>
              <div className="nd-fields">
                <label className="nd-field">
                  间隔（小时）
                  <Input
                    aria-label="备份间隔（小时）"
                    type="number"
                    min={1}
                    max={720}
                    value={String(settings.intervalHours)}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        intervalHours: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label className="nd-field">
                  保留份数
                  <Input
                    aria-label="备份保留份数"
                    type="number"
                    min={1}
                    max={100}
                    value={String(settings.retain)}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        retain: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label className="nd-field">
                  备份加密密码（12–256 字符）
                  <Input
                    aria-label="备份加密密码"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
              </div>
              <p className="nd-muted">
                当前存储：{names[settings.destination] || settings.destination}
                。保存时需重新填写加密密码和存储凭据。请妥善保管密码，恢复备份时需要使用。
              </p>
              <Choice
                label="备份存储"
                value={type}
                options={Object.entries(names)}
                change={(value) => {
                  setType(value);
                  setCredentials(emptyCredentials);
                  setError("");
                }}
              />
              {type === "webdav" && (
                <div className="nd-fields">
                  {field(
                    "url",
                    "WebDAV 目录地址",
                    false,
                    "https://dav.example/backup",
                  )}
                  {field("username", "WebDAV 用户名")}
                  {field("password", "WebDAV 密码", true)}
                </div>
              )}
              {type === "s3" && (
                <div className="nd-fields">
                  {field(
                    "endpoint",
                    "S3 服务地址",
                    false,
                    "https://s3.example",
                  )}
                  {field(
                    "region",
                    "区域",
                    false,
                    "us-east-1 或服务商指定的区域",
                  )}
                  {field("bucket", "存储桶")}
                  {field("accessKeyId", "Access Key ID")}
                  {field("secretAccessKey", "Secret Access Key", true)}
                </div>
              )}
              {type !== "local" && (
                <p className="nd-muted">
                  请预先创建目录或存储桶，并允许读取、写入和删除。上传后会下载校验加密文件，通过后才清理超出保留份数的备份；校验会产生下载流量。地址仅填写
                  HTTPS 路径。
                </p>
              )}
            </div>
            {error && <p role="alert">{error}</p>}
            <Button
              isDisabled={busy}
              onPress={() => {
                const parsed = BackupSchedule.safeParse({
                  ...settings,
                  password,
                  destination: { ...credentials, type },
                });
                if (!parsed.success) {
                  setError(
                    "请检查备份间隔、保留份数、加密密码及存储配置。" +
                      parsed.error.issues
                        .map((issue) => issue.message)
                        .join("；"),
                  );
                  return;
                }
                setBusy(true);
                setError("");
                void run(async () => {
                  try {
                    setSettings(
                      await api("backup-settings", parsed.data, "PUT"),
                    );
                    setPassword("");
                    setCredentials(emptyCredentials);
                  } finally {
                    setBusy(false);
                  }
                });
              }}
            >
              {busy ? "正在保存…" : "保存备份计划"}
            </Button>
          </>
        )}
      </Card.Content>
    </Card>
  );
}
