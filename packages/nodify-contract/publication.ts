import { z } from "zod";

export const CLOUDFLARED_VERSION = "2026.8.3";
export const CLOUDFLARED_SHA256 = {
  amd64: "f29324fe934d1e100617484c78deef803c4dc2cd351d645bbde42e96b4fccc5e",
  arm64: "4bcfd35521a7cbc545ebfd5d57334a71ee180e2a64874981f374c81472118391",
};
const Origin = z
  .string()
  .max(253)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        url.origin === value &&
        !url.port &&
        /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(url.hostname) &&
        url.hostname
          .split(".")
          .every(
            (part) =>
              part.length <= 63 &&
              /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(part),
          )
      );
    } catch {
      return false;
    }
  }, "填写 HTTPS 域名，不含路径、端口、凭据或结尾斜杠");
export const PublicationConfig = z
  .object({
    panelUrl: Origin,
    subscriptionUrl: Origin,
    tunnelId: z.string().uuid(),
    mode: z.enum(["native", "docker"]),
    port: z.number().int().min(1).max(65535).default(3000),
  })
  .refine(
    (input) => input.panelUrl !== input.subscriptionUrl,
    "面板和订阅须使用不同域名",
  );
export const PublicationInput = z.object({
  version: z.number().int().nonnegative(),
  config: PublicationConfig.nullable(),
});
// Keep the edge expression and origin guard identical. Assets are public build artifacts.
export const SUBSCRIPTION_PATH_PATTERN =
  "^/(api/sub/[^/]+|subscription/[^/]+|assets/[^?]+|favicon\\.svg)$";
export function subscriptionRequestAllowed(method: string, rawUrl: string) {
  if (!["GET", "HEAD"].includes(method)) return false;
  const path = rawUrl.split("?")[0];
  if (
    /%(?:2e|2f|5c|00)/i.test(path) ||
    /[\\\x00-\x20]/.test(path) ||
    path.split("/").some((p) => p === "." || p === "..")
  )
    return false;
  return new RegExp(SUBSCRIPTION_PATH_PATTERN).test(path);
}
export function tunnelArtifacts(value: unknown) {
  const config = PublicationConfig.parse(value);
  const origin = `http://${config.mode === "docker" ? "panel" : "127.0.0.1"}:${config.port}`;
  const panel = new URL(config.panelUrl).hostname,
    subscription = new URL(config.subscriptionUrl).hostname;
  // JSON is valid YAML and avoids ambiguous quoting of hostnames and regular expressions.
  const ingress = {
    tunnel: config.tunnelId,
    "credentials-file": "/etc/nodify-tunnel/credentials.json",
    metrics: "127.0.0.1:20241",
    ingress: [
      {
        hostname: panel,
        service: origin,
        originRequest: { httpHostHeader: panel },
      },
      {
        hostname: subscription,
        path: SUBSCRIPTION_PATH_PATTERN,
        service: origin,
        originRequest: { httpHostHeader: subscription },
      },
      { service: "http_status:404" },
    ],
  };
  const compose = {
    services: {
      cloudflared: {
        image: `cloudflare/cloudflared:${CLOUDFLARED_VERSION}`,
        restart: "unless-stopped",
        user: "0:0",
        read_only: true,
        cap_drop: ["ALL"],
        security_opt: ["no-new-privileges:true"],
        command: [
          "tunnel",
          "--no-autoupdate",
          "--config",
          "/etc/nodify-tunnel/config.yml",
          "run",
        ],
        volumes: ["./tunnel:/etc/nodify-tunnel:ro"],
        depends_on: ["panel"],
      },
    },
  };
  const service = `[Unit]\nDescription=Nodify Cloudflare Tunnel\nAfter=network-online.target nodify-panel.service\nWants=network-online.target\n[Service]\nExecStart=/opt/nodify-tunnel/${CLOUDFLARED_VERSION}/cloudflared tunnel --no-autoupdate --config /etc/nodify-tunnel/config.yml run\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=30\nNoNewPrivileges=true\nProtectSystem=strict\nProtectHome=true\nPrivateTmp=true\n[Install]\nWantedBy=multi-user.target\n`;
  const nativeCommands = `# 在本仓库的部署目录操作，先把下载的 config.yml 和 Tunnel JSON 凭据放入 ./tunnel/\ncase "$(uname -m)" in\n  x86_64) arch=amd64; sum=${CLOUDFLARED_SHA256.amd64} ;;\n  aarch64) arch=arm64; sum=${CLOUDFLARED_SHA256.arm64} ;;\n  *) exit 1 ;;\nesac\ncurl --fail --proto '=https' --proto-redir '=https' --location https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-$arch -o ./cloudflared\necho "$sum  ./cloudflared" | sha256sum --check --status\nchmod 755 ./cloudflared\n./cloudflared tunnel --config ./tunnel/config.yml ingress validate\nsudo install -d -m 700 /etc/nodify-tunnel\nsudo install -m 600 ./tunnel/config.yml ./tunnel/credentials.json /etc/nodify-tunnel/\nsudo install -d /opt/nodify-tunnel/${CLOUDFLARED_VERSION}\nsudo install -m 755 ./cloudflared /opt/nodify-tunnel/${CLOUDFLARED_VERSION}/cloudflared\nsudo install -m 644 ./nodify-tunnel.service /etc/systemd/system/\nsudo systemctl daemon-reload\nsudo systemctl enable --now nodify-tunnel\nsudo journalctl -u nodify-tunnel -n 30\n`;
  const dockerCommands = `# 将 config.yml 和 Tunnel JSON 凭据放入 ./tunnel/，此覆盖文件与仓库 compose.yml 同目录\nchmod 700 ./tunnel\nchmod 600 ./tunnel/config.yml ./tunnel/credentials.json\ndocker compose -f compose.yml -f compose.tunnel.yml run --rm --no-deps cloudflared tunnel --config /etc/nodify-tunnel/config.yml ingress validate\ndocker compose -f compose.yml -f compose.tunnel.yml up -d cloudflared\ndocker compose -f compose.yml -f compose.tunnel.yml logs --tail 30 cloudflared\n`;
  return {
    origin,
    verifyCommands: `# 在已执行 cloudflared tunnel login 的环境中创建 DNS 路由\ncloudflared tunnel route dns ${config.tunnelId} ${panel}\ncloudflared tunnel route dns ${config.tunnelId} ${subscription}\n# 依次预期 200、404、404、401；不要跟随跳转掩盖路由错误\ncurl -sS --max-time 10 -o /dev/null -w '%{http_code}\\n' '${config.panelUrl}/auth/login'\ncurl -sS --max-time 10 -o /dev/null -w '%{http_code}\\n' '${config.subscriptionUrl}/'\ncurl -sS --max-time 10 -o /dev/null -w '%{http_code}\\n' '${config.subscriptionUrl}/auth/login'\ncurl -sS --max-time 10 -o /dev/null -w '%{http_code}\\n' '${config.subscriptionUrl}/api/sub/invalid?format=info'\n`,
    commands:
      "#!/usr/bin/env bash\nset -euo pipefail\numask 077\n" +
      (config.mode === "docker" ? dockerCommands : nativeCommands),
    config: JSON.stringify(ingress, null, 2) + "\n",
    compose: JSON.stringify(compose, null, 2) + "\n",
    service,
  };
}
