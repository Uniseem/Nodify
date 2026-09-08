import { Button, Card } from "@heroui/react";
import { useEffect, useState } from "react";
import { PublicationConfig, tunnelArtifacts } from "@nodify/contract";
import { instance } from "@shared/api/axios";
import { Choice, Field } from "./editor-fields";
import { websiteError } from "./website-error";

const empty = {
  panelUrl: "",
  subscriptionUrl: "",
  tunnelId: "",
  mode: "docker",
  port: 3000,
};
export function PublicationSettingsPanel() {
  const [saved, setSaved] = useState<any>(null),
    [draft, setDraft] = useState<any>(empty);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<ReturnType<
    typeof tunnelArtifacts
  > | null>(null);
  async function load() {
    setBusy(true);
    setError("");
    try {
      const { data } = await instance.get("/api/settings/publication", {
        timeout: 15000,
      });
      setSaved(data.response);
      setDraft(
        data.response.config || {
          ...empty,
          panelUrl: data.response.environmentUrl,
        },
      );
      setPreview(null);
    } catch (e) {
      setError(websiteError(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const edit = (key: string, value: unknown) => {
    setDraft({ ...draft, [key]: value });
    setPreview(null);
    setNotice("");
  };
  async function save(reset = false) {
    const parsed = PublicationConfig.safeParse(draft);
    if (!reset && !parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join("；"));
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { data } = await instance.put(
        "/api/settings/publication",
        { version: saved.version, config: reset ? null : parsed.data },
        { timeout: 15000 },
      );
      setSaved(data.response);
      setNotice(
        reset
          ? "已恢复环境变量中的地址，新链接将使用该地址。"
          : "域名已保存，新安装命令和订阅链接已使用对应域名。Tunnel 仍需部署并验证。",
      );
    } catch (e) {
      setError(websiteError(e));
    } finally {
      setBusy(false);
    }
  }
  function download(name: string, text: string) {
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  return (
    <Card>
      <Card.Header>
        <Card.Title>Cloudflare Tunnel 发布向导</Card.Title>
      </Card.Header>
      <Card.Content className="nd-stack">
        <p className="nd-muted">
          分别发布面板和私有订阅。先部署和验证
          Tunnel，再保存域名；保存不会替你创建 Cloudflare
          资源或启动服务。新实例尚无 HTTPS 入口时，可先用发布包中的
          tunnel-config 命令离线生成相同配置。
        </p>
        {saved && (
          <p role="status">
            {saved.config
              ? `当前面板：${saved.config.panelUrl} · 当前订阅：${saved.config.subscriptionUrl}`
              : `当前使用环境地址：${saved.environmentUrl || "尚未配置"}`}{" "}
            · Tunnel 公网状态尚未验证
          </p>
        )}
        {error && (
          <p role="alert" className="nd-error">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <fieldset
          disabled={busy || !saved}
          className="nd-stack"
          style={{ border: 0, padding: 0, minWidth: 0 }}
        >
          <strong>1. 准备域名与本地 Tunnel</strong>
          <p className="nd-muted">
            在 Cloudflare 托管域名，按
            <a
              href="https://developers.cloudflare.com/tunnel/advanced/local-management/create-local-tunnel/"
              target="_blank"
              rel="noreferrer"
            >
              官方本地 Tunnel 教程
            </a>
            执行 login 和 create。保留生成的 Tunnel UUID 及 JSON
            凭据，将凭据另存为 tunnel/credentials.json。这里不收集账户证书或
            Tunnel 凭据。
          </p>
          <Field
            label="面板 HTTPS 域名"
            value={draft.panelUrl}
            change={(v) => edit("panelUrl", v)}
          />
          <Field
            label="订阅 HTTPS 域名"
            value={draft.subscriptionUrl}
            change={(v) => edit("subscriptionUrl", v)}
          />
          <Field
            label="Tunnel UUID"
            value={draft.tunnelId}
            change={(v) => edit("tunnelId", v)}
          />
          <Choice
            label="主控部署方式"
            value={draft.mode}
            change={(v) => edit("mode", v)}
            options={[
              ["docker", "本仓库 Docker Compose"],
              ["native", "裸机 systemd"],
            ]}
          />
          <Field
            label="主控 API 端口"
            type="number"
            value={draft.port}
            change={(v) => edit("port", Number(v))}
          />
          <p className="nd-muted">
            裸机在 /etc/nodify/panel.env 设置 NODIFY_LISTEN_HOST=127.0.0.1
            后重启 nodify-panel。Docker 保持容器内监听 0.0.0.0，仓库已仅将 3000
            映射到宿主机回环；自定义端口需同步调整 Compose 与 APP_PORT。
          </p>
          <strong>2. 生成部署文件</strong>
          <Button
            onPress={() => {
              try {
                setPreview(tunnelArtifacts(draft));
                setError("");
              } catch (e) {
                setError(websiteError(e));
              }
            }}
          >
            生成配置预览
          </Button>
          {preview && (
            <>
              <p>
                回源地址：{preview.origin}
                。订阅域名仅开放订阅接口、私有页和静态资源，其他路径返回 404。
              </p>
              <pre
                aria-label="Tunnel 配置预览"
                style={{ overflowX: "auto", maxWidth: "100%", fontSize: 12 }}
              >
                {preview.config}
              </pre>
              <div className="nd-row">
                <Button onPress={() => download("config.yml", preview.config)}>
                  下载 config.yml
                </Button>
                {draft.mode === "docker" ? (
                  <Button
                    onPress={() =>
                      download("compose.tunnel.yml", preview.compose)
                    }
                  >
                    下载 Compose 覆盖文件
                  </Button>
                ) : (
                  <Button
                    onPress={() =>
                      download("nodify-tunnel.service", preview.service)
                    }
                  >
                    下载 systemd 服务
                  </Button>
                )}
                <Button
                  onPress={() =>
                    download("install-nodify-tunnel.sh", preview.commands)
                  }
                >
                  下载安装命令
                </Button>
              </div>
              <pre
                aria-label="Tunnel 部署命令"
                style={{ overflowX: "auto", maxWidth: "100%", fontSize: 12 }}
              >
                {preview.commands}
              </pre>
            </>
          )}
          <strong>3. 创建 DNS 路由并验证</strong>
          <p className="nd-muted">
            对两个域名分别执行 cloudflared tunnel route dns &lt;Tunnel UUID&gt;
            &lt;域名&gt;。确认面板登录页正常、订阅域名根路径和 /auth/login 返回
            404，/api/sub/invalid?format=info 到达 Nodify 并返回
            401；最后使用真实订阅验证客户端，Agent
            应能经面板域名连接。Cloudflare Access 的交互登录会阻断订阅客户端和
            Agent，需为其配置合适策略。
          </p>
          {preview && (
            <>
              <pre
                aria-label="DNS 与验证命令"
                style={{ overflowX: "auto", maxWidth: "100%", fontSize: 12 }}
              >
                {preview.verifyCommands}
              </pre>
              <Button
                onPress={() =>
                  download("verify-nodify-tunnel.sh", preview.verifyCommands)
                }
              >
                下载 DNS 与验证命令
              </Button>
            </>
          )}
          <strong>4. 保存链接域名</strong>
          <p className="nd-muted">
            保存后，新安装命令使用面板域名；成员、订阅文件、二维码与客户端链接使用订阅域名。已安装
            Agent 的主控地址需另行修改并重启。域名设置随现有备份保存，Tunnel
            的外部 JSON 凭据须自行保管。
          </p>
          <div className="nd-row">
            <Button onPress={() => void save()}>保存已验证的发布域名</Button>
            <Button variant="secondary" onPress={() => void save(true)}>
              恢复环境地址
            </Button>
          </div>
        </fieldset>
        <Button
          variant="secondary"
          isDisabled={busy}
          onPress={() => void load()}
        >
          {busy ? "正在处理…" : "重新载入并放弃修改"}
        </Button>
      </Card.Content>
    </Card>
  );
}
