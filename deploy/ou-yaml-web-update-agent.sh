#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_DIR="${OU_YAML_INSTALL_DIR:-/opt/ou-yaml}"
DATA_DIR="${OU_YAML_DATA_DIR:-${INSTALL_DIR}/data}"
REQUEST_FILE="${DATA_DIR}/web-update-request.json"
STATUS_FILE="${DATA_DIR}/web-update-status.json"
LOG_FILE="${DATA_DIR}/web-update.log"
LOCK_FILE="/run/ou-yaml-web-update.lock"

write_status() {
  local status="$1" message="$2" progress="${3:-0}"
  local tmp="${STATUS_FILE}.tmp"
  printf '{"status":"%s","message":"%s","progress":%s,"updatedAt":"%s"}\n' \
    "$status" "$(printf '%s' "$message" | sed 's/\\/\\\\/g; s/"/\\"/g')" "$progress" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$tmp"
  chown 1001:1001 "$tmp" 2>/dev/null || true
  mv -f "$tmp" "$STATUS_FILE"
}

[ -f "$REQUEST_FILE" ] || exit 0
[ -L "$REQUEST_FILE" ] && { rm -f "$REQUEST_FILE"; exit 1; }
mkdir -p "$DATA_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

write_status running "正在准备更新" 5
{
  printf '[%s] web update requested\n' "$(date -Is)"
  write_status running "正在备份数据" 15
  if [ -x "$INSTALL_DIR/backup.sh" ]; then "$INSTALL_DIR/backup.sh" >>"$LOG_FILE" 2>&1 || true; fi
  write_status running "正在拉取最新版本" 35
  cd "$INSTALL_DIR"
  git pull --ff-only >>"$LOG_FILE" 2>&1
  write_status running "正在重建 Docker 服务" 65
  OU_YAML_BUILD_COMMIT="$(git rev-parse HEAD)" export OU_YAML_BUILD_COMMIT
  "$INSTALL_DIR/update.sh" >>"$LOG_FILE" 2>&1
  write_status running "正在等待服务健康检查" 90
  for _ in $(seq 1 30); do
    if command -v docker >/dev/null 2>&1 && [ "$(docker inspect -f '{{.State.Health.Status}}' ou-yaml 2>/dev/null || true)" = "healthy" ]; then
      write_status completed "更新完成，服务已恢复" 100
      rm -f "$REQUEST_FILE"
      exit 0
    fi
    sleep 2
  done
  write_status failed "服务重启后健康检查超时" 90
  rm -f "$REQUEST_FILE"
  exit 1
} || {
  code=$?
  write_status failed "更新失败，请查看 web-update.log" 0
  printf '[%s] update failed with exit code %s\n' "$(date -Is)" "$code" >>"$LOG_FILE"
  rm -f "$REQUEST_FILE"
  exit "$code"
}
