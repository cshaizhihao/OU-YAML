#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

INSTALL_DIR="${OU_YAML_INSTALL_DIR:-/opt/ou-yaml}"
DATA_DIR="${OU_YAML_DATA_DIR:-${INSTALL_DIR}/data}"
REQUEST_FILE="${DATA_DIR}/web-update-request.json"
STATUS_FILE="${DATA_DIR}/web-update-status.json"
LOG_FILE="${OU_YAML_UPDATE_LOG:-/var/log/ou-yaml/web-update.log}"
LOCK_FILE="/run/ou-yaml-web-update.lock"

[ ! -L "${INSTALL_DIR}" ] || { echo "安装目录不能是符号链接" >&2; exit 1; }
[ ! -L "${DATA_DIR}" ] || { echo "数据目录不能是符号链接" >&2; exit 1; }
install -d -m 0700 "${DATA_DIR}"
install -d -m 0750 -o root -g 1001 "$(dirname -- "${LOG_FILE}")"
if [ -e "${LOG_FILE}" ] && [ -L "${LOG_FILE}" ]; then echo "更新日志不能是符号链接" >&2; exit 1; fi
touch "${LOG_FILE}"
chown root:1001 "${LOG_FILE}" 2>/dev/null || true
chmod 0640 "${LOG_FILE}"
exec 9>"${LOCK_FILE}"
flock -n 9 || exit 0

write_status() {
  local status="$1" message="$2" progress="${3:-0}" staging payload escaped_message
  staging="$(mktemp -d "${DATA_DIR}/.update-status.XXXXXX")"
  payload="${staging}/status.json"
  escaped_message="$(printf '%s' "${message}" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  printf '{"status":"%s","message":"%s","progress":%s,"updatedAt":"%s"}\n' "${status}" "${escaped_message}" "${progress}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "${payload}"
  chown 1001:1001 "${payload}" 2>/dev/null || true
  mv -f -- "${payload}" "${STATUS_FILE}"
  rmdir -- "${staging}"
}

[ -e "${REQUEST_FILE}" ] || exit 0
[ ! -L "${REQUEST_FILE}" ] || { rm -f -- "${REQUEST_FILE}"; exit 1; }

write_status running "正在准备更新" 5
{
  printf '[%s] web update requested\n' "$(date -Is)" >>"${LOG_FILE}"
  write_status running "正在备份数据" 15
  "${INSTALL_DIR}/backup.sh" >>"${LOG_FILE}" 2>&1
  write_status running "正在拉取最新版本" 35
  cd "${INSTALL_DIR}"
  git pull --ff-only >>"${LOG_FILE}" 2>&1
  write_status running "正在重建 Docker 服务" 65
  export OU_YAML_BUILD_COMMIT="$(git rev-parse HEAD)"
  "${INSTALL_DIR}/update.sh" >>"${LOG_FILE}" 2>&1
  write_status running "正在等待服务健康检查" 90
  for _ in $(seq 1 30); do
    if command -v docker >/dev/null 2>&1 && [ "$(docker inspect -f '{{.State.Health.Status}}' ou-yaml 2>/dev/null || true)" = "healthy" ]; then
      write_status completed "更新完成，服务已恢复" 100
      rm -f -- "${REQUEST_FILE}"
      exit 0
    fi
    sleep 2
  done
  write_status failed "服务重启后健康检查超时" 90
  rm -f -- "${REQUEST_FILE}"
  exit 1
} || {
  code=$?
  write_status failed "更新失败，请查看 web-update.log" 0 || true
  printf '[%s] update failed with exit code %s\n' "$(date -Is)" "${code}" >>"${LOG_FILE}"
  rm -f -- "${REQUEST_FILE}"
  exit "${code}"
}
