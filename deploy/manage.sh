#!/usr/bin/env bash
set -euo pipefail
role="${1:?panel or agent}"; action="${2:?logs, upgrade, rollback, restore or uninstall}"
[[ "$role" == panel || "$role" == agent ]] || exit 1
root="/opt/nodify-$role"
case "$action" in
  upgrade) NODIFY_FORCE_DOWNLOAD=1 NODIFY_RELEASE_URL="${3:?pinned release directory URL}" bash "$root/current/deploy/install.sh" "$role" ;;
  restore)
    [[ "$role" == panel ]] || { echo 'Restore is a panel operation'; exit 1; }
    : "${NODIFY_BACKUP_PASSWORD:?Set the backup password}"
    archive="${3:?encrypted backup file}"
    systemctl stop nodify-panel
    if [[ -f /var/lib/nodify-panel/nodify.db ]]; then "$root/current/bin/node" -e 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.argv[1]);db.exec("PRAGMA wal_checkpoint(TRUNCATE)");db.close()' /var/lib/nodify-panel/nodify.db; fi
    if report="$(NODIFY_OFFLINE_RESTORE=1 "$root/current/bin/node" "$root/current/deploy/restore.mjs" "$archive" /var/lib/nodify-panel/nodify.db /var/lib/nodify-panel/nodify)"; then
      systemctl start nodify-panel
      if ! "$root/current/bin/node" "$root/current/deploy/panel-health.mjs"; then
        systemctl stop nodify-panel
        previous_backup="$(printf '%s' "$report" | "$root/current/bin/node" -e 'let b="";process.stdin.on("data",c=>b+=c);process.stdin.on("end",()=>process.stdout.write(JSON.parse(b).previousBackup||""))')"
        if [[ -n "$previous_backup" ]]; then
          "$root/current/bin/node" -e 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.argv[1]);db.exec("PRAGMA wal_checkpoint(TRUNCATE)");db.close()' /var/lib/nodify-panel/nodify.db
          NODIFY_OFFLINE_RESTORE=1 "$root/current/bin/node" "$root/current/deploy/restore.mjs" "$previous_backup" /var/lib/nodify-panel/nodify.db /var/lib/nodify-panel/nodify
          systemctl start nodify-panel
        fi
        echo 'Restore startup failed; pre-restore state restored where available.'; exit 1
      fi
      echo 'Restore completed and Nodify passed the startup health check.'
    else systemctl start nodify-panel; exit 1; fi ;;
  logs) exec journalctl -u "nodify-$role" -f ;;
  rollback)
    previous="$(readlink -f "$root/previous")"
    [[ "$previous" == "$root/releases/"* && -d "$previous" ]] || { echo 'No valid previous release'; exit 1; }
    current="$(readlink -f "$root/current")"
    systemctl stop "nodify-$role"
    current_version="$(basename "$current")"
    if [[ "$role" == panel && -f "$root/rollback/$current_version.db" ]]; then "$root/current/bin/node" "$root/current/deploy/database-rollback.mjs" "$root/rollback/$current_version.db" /var/lib/nodify-panel/nodify.db; fi
    if [[ "$role" == agent && -f /var/lib/nodify-agent/active-release.json ]]; then printf 'null' > /var/lib/nodify-agent/active-release.json; fi
    ln -sfn "$previous" "$root/current"; ln -sfn "$current" "$root/previous"; systemctl start "nodify-$role" ;;
  uninstall)
    systemctl disable --now "nodify-$role"; rm -f -- "/etc/systemd/system/nodify-$role.service"; systemctl daemon-reload
    echo "Service removed. Data, credentials and releases retained at /var/lib/nodify-$role, /etc/nodify and $root." ;;
  *) echo 'Unknown action'; exit 1 ;;
esac
