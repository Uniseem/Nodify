#!/usr/bin/env bash
set -euo pipefail
umask 077
role="${1:-panel}"
[[ "$role" == panel || "$role" == agent ]] || { echo 'Usage: install.sh panel|agent'; exit 1; }
[[ "$(id -u)" == 0 ]] || { echo 'Run as root.'; exit 1; }
command -v systemctl >/dev/null || { echo 'A systemd Linux host is required.'; exit 1; }
# Release packages include this script. Remote invocation requires an explicit release URL.
base="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -f "$base/manifest.json" || "${NODIFY_FORCE_DOWNLOAD:-0}" == 1 ]]; then
  : "${NODIFY_RELEASE_URL:?Set NODIFY_RELEASE_URL to the pinned Nodify release directory}"
  case "$(uname -m)" in x86_64) arch=amd64;; aarch64) arch=arm64;; *) echo 'Unsupported architecture'; exit 1;; esac
  work="$(mktemp -d)"
  curl --fail --location --proto '=https' "$NODIFY_RELEASE_URL/nodify-$role-linux-$arch.tar.gz" -o "$work/release.tar.gz"
  curl --fail --location --proto '=https' "$NODIFY_RELEASE_URL/SHA256SUMS" -o "$work/SHA256SUMS"
  expected="$(awk -v file="nodify-$role-linux-$arch.tar.gz" '$2 == file { print $1 }' "$work/SHA256SUMS")"
  [[ "$expected" =~ ^[a-f0-9]{64}$ ]] || { echo 'Missing release checksum'; exit 1; }
  echo "$expected  $work/release.tar.gz" | sha256sum --check --status
  tar -tzf "$work/release.tar.gz" | awk '/^\// || /(^|\/)\.\.(\/|$)/ {bad=1} END {exit bad}'
  tar -tvzf "$work/release.tar.gz" | awk 'substr($0,1,1) != "-" && substr($0,1,1) != "d" {bad=1} END {exit bad}'
  mkdir "$work/unpacked"; tar -xzf "$work/release.tar.gz" -C "$work/unpacked"
  base="$work/unpacked"
fi
node_binary="$base/bin/node"; [[ -x "$node_binary" ]] || { echo "Release is missing the bundled Node runtime"; exit 1; }
"$node_binary" -e 'if(Number(process.versions.node.split(".")[0])<24)process.exit(1)'
version="$("$node_binary" "$base/deploy/verify-release.mjs" "$base" "$role")"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid release version'; exit 1; }
root="/opt/nodify-$role"
destination="$root/releases/$version"
reinstall=0
if [[ -e "$destination" ]]; then
  "$node_binary" "$base/deploy/verify-release.mjs" "$destination" "$role" >/dev/null
  cmp -s "$base/manifest.json" "$destination/manifest.json" || { echo 'This version already exists with different contents; use a new release version.'; exit 1; }
  if [[ "$(readlink "$root/current" || true)" == "$destination" ]]; then
    if systemctl is-active --quiet "nodify-$role"; then echo 'This version is already current and running.'; exit 1; fi
    reinstall=1
  fi
else
  mkdir -p "$destination"
  cp -a "$base/." "$destination/"
fi
mkdir -p "/var/lib/nodify-$role" /etc/nodify
if [[ "$role" == panel ]]; then
  [[ -x "$destination/bin/valkey-server" ]] || { echo "Missing bundled Valkey"; exit 1; }
  if [[ ! -e /etc/nodify/panel.env ]]; then
    : "${NODIFY_PUBLIC_URL:?Set the public HTTPS panel URL}"
    cp "$destination/app/.env.sample" /etc/nodify/panel.env
    secret="$("$node_binary" -p 'require("crypto").randomBytes(32).toString("hex")')"
    port="${NODIFY_APP_PORT:-3000}"
    [[ "$port" =~ ^[0-9]+$ && "$port" -ge 1 && "$port" -le 65535 ]] || { echo 'Invalid API port'; exit 1; }
    printf '\nAPP_PORT=%s\n' "$port" >> /etc/nodify/panel.env
    printf '\nAPP_SECRET=%s\nDATABASE_URL=file:/var/lib/nodify-panel/nodify.db\nREDIS_SOCKET=\nREDIS_HOST=127.0.0.1\nREDIS_PORT=6380\nNODIFY_MANAGE_VALKEY=1\nNODIFY_PUBLIC_URL=%s\nNODIFY_DATA_DIR=/var/lib/nodify-panel/nodify\nNODIFY_FRONTEND_DIR=%s/current/app/frontend\n' "$secret" "$NODIFY_PUBLIC_URL" "$root" >> /etc/nodify/panel.env
    if [[ -n "${NODIFY_RELEASE_URL:-}" ]]; then printf 'NODIFY_RELEASE_URL=%s\n' "$NODIFY_RELEASE_URL" >> /etc/nodify/panel.env; fi
  fi
  working="$root/current/app"; entry='deploy/panel-supervisor.mjs'
else
  if [[ ! -e /etc/nodify/agent.env ]]; then
    : "${NODIFY_PANEL:?Set NODIFY_PANEL}"; : "${NODIFY_ENROLLMENT:?Set NODIFY_ENROLLMENT}"
    [[ "$NODIFY_PANEL" =~ ^https://[^[:space:]\"\']+$ && "$NODIFY_ENROLLMENT" =~ ^[A-Za-z0-9_-]+$ ]] || { echo 'Invalid enrollment environment'; exit 1; }
    connection_mode="${NODIFY_CONNECTION_MODE:-auto}"
    [[ "$connection_mode" =~ ^(auto|ws|pull|direct)$ ]] || { echo 'Invalid Agent connection mode'; exit 1; }
    if [[ "$connection_mode" == direct || ( "$connection_mode" == auto && -n "${NODIFY_DIRECT_TOKEN:-}" ) ]]; then
      [[ "${NODIFY_DIRECT_TOKEN:-}" =~ ^[A-Za-z0-9_-]{32,128}$ ]] || { echo 'Set a 32-128 character NODIFY_DIRECT_TOKEN'; exit 1; }
      direct_port="${NODIFY_DIRECT_PORT:-23889}"
      [[ "$direct_port" =~ ^[0-9]+$ && "$direct_port" -ge 1 && "$direct_port" -le 65535 ]] || { echo 'Invalid direct listener port'; exit 1; }
      for direct_name in NODIFY_DIRECT_HOST NODIFY_DIRECT_CERT NODIFY_DIRECT_KEY; do
        direct_value="${!direct_name:-}"
        [[ -z "$direct_value" || "$direct_value" =~ ^[A-Za-z0-9_/:.-]+$ ]] || { echo "Invalid $direct_name"; exit 1; }
      done
      if [[ "${NODIFY_DIRECT_HOST:-127.0.0.1}" != 127.0.0.1 && "${NODIFY_DIRECT_HOST:-127.0.0.1}" != ::1 ]]; then
        [[ -n "${NODIFY_DIRECT_CERT:-}" && -n "${NODIFY_DIRECT_KEY:-}" ]] || { echo 'Public direct listener requires TLS certificate and key'; exit 1; }
      fi
      [[ -z "${NODIFY_DIRECT_CERT:-}" && -z "${NODIFY_DIRECT_KEY:-}" || -n "${NODIFY_DIRECT_CERT:-}" && -n "${NODIFY_DIRECT_KEY:-}" ]] || { echo 'Both direct TLS files are required'; exit 1; }
    fi
    printf 'NODIFY_PANEL=%s\nNODIFY_ENROLLMENT=%s\nNODIFY_AGENT_DATA=/var/lib/nodify-agent\n' "$NODIFY_PANEL" "$NODIFY_ENROLLMENT" > /etc/nodify/agent.env
    printf 'NODIFY_CONNECTION_MODE=%s\n' "$connection_mode" >> /etc/nodify/agent.env
    if [[ "$connection_mode" == direct || ( "$connection_mode" == auto && -n "${NODIFY_DIRECT_TOKEN:-}" ) ]]; then
      printf 'NODIFY_DIRECT_TOKEN=%s\nNODIFY_DIRECT_HOST=%s\nNODIFY_DIRECT_PORT=%s\n' "$NODIFY_DIRECT_TOKEN" "${NODIFY_DIRECT_HOST:-127.0.0.1}" "$direct_port" >> /etc/nodify/agent.env
      for direct_name in NODIFY_DIRECT_CERT NODIFY_DIRECT_KEY; do
        direct_value="${!direct_name:-}"; if [[ -n "$direct_value" ]]; then printf '%s=%s\n' "$direct_name" "$direct_value" >> /etc/nodify/agent.env; fi
      done
    fi
  fi
  command -v nginx >/dev/null || { apt-get update; apt-get install -y nginx-core; systemctl disable --now nginx; }
  working="$root/current/app"; entry='agent/supervisor.mjs'
fi
previous="$(readlink "$root/current" || true)"
if [[ "$reinstall" == 1 ]]; then previous=''; fi
if [[ "$role" == panel && -n "$previous" && -f /var/lib/nodify-panel/nodify.db ]]; then
  # Uninstall retains releases and data but removes the service unit.
  if systemctl cat nodify-panel.service >/dev/null 2>&1; then systemctl stop nodify-panel; fi
  mkdir -p "$root/rollback"
  "$node_binary" "$destination/deploy/database-snapshot.mjs" /var/lib/nodify-panel/nodify.db "$root/rollback/$version.db"
fi
[[ -z "$previous" ]] || ln -sfn "$previous" "$root/previous"
ln -sfn "$destination" "$root/current"
cat > "/etc/systemd/system/nodify-$role.service" <<EOF
[Unit]
Description=Nodify $role
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
WorkingDirectory=$working
EnvironmentFile=/etc/nodify/$role.env
Environment=NODE_ENV=production
Environment=PATH=$root/current/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$root/current/bin/node $entry
Restart=on-failure
RestartSec=3
TimeoutStopSec=30
KillMode=control-group
UMask=0077
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "nodify-$role.service"
if [[ "$role" == agent ]]; then rm -f -- /var/lib/nodify-agent/ready; fi
systemctl restart "nodify-$role.service"
healthy=0
if [[ "$role" == panel ]]; then
  if "$node_binary" "$destination/deploy/panel-health.mjs" "$version"; then healthy=1; fi
else
  for attempt in $(seq 1 120); do
    if [[ -s /var/lib/nodify-agent/ready ]]; then healthy=1; break; fi
    sleep 1
  done
fi
if [[ "$healthy" != 1 ]]; then
  systemctl stop "nodify-$role.service"
  if [[ "$role" == panel && -f "$root/rollback/$version.db" ]]; then "$node_binary" "$destination/deploy/database-rollback.mjs" "$root/rollback/$version.db" /var/lib/nodify-panel/nodify.db; fi
  if [[ -n "$previous" ]]; then ln -sfn "$previous" "$root/current"; systemctl start "nodify-$role.service"; elif [[ "$reinstall" != 1 ]]; then rm -f -- "$root/current"; fi
  echo 'Service did not start; previous release restored where available.'; exit 1
fi
echo "Nodify $role $version installed. Logs: journalctl -u nodify-$role -f"
