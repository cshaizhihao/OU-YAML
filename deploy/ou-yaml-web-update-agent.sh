#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

INSTALL_DIR="${OU_YAML_INSTALL_DIR:-/opt/ou-yaml}"
DATA_DIR="${OU_YAML_DATA_DIR:-${INSTALL_DIR}/data}"
REQUEST_FILE="${DATA_DIR}/web-update-request.json"
STATUS_FILE="${DATA_DIR}/web-update-status.json"
LOG_FILE="${OU_YAML_UPDATE_LOG:-/var/log/ou-yaml/web-update.log}"
LOCK_FILE="/run/ou-yaml-web-update.lock"
PREVIOUS_COMMIT=""
UPDATE_STARTED=0
ROLLBACK_RUNNING=0

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

wait_for_health() {
  local attempts="${1:-45}"
  for _ in $(seq 1 "${attempts}"); do
    if [ "$(docker inspect -f '{{.State.Health.Status}}' ou-yaml 2>/dev/null || true)" = "healthy" ]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

deploy_checkout() {
  cd "${INSTALL_DIR}"
  export OU_YAML_BUILD_COMMIT
  OU_YAML_BUILD_COMMIT="$(git rev-parse HEAD)"
  if grep -q '^DOMAIN=.' .env; then
    docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d --build
  else
    docker compose -f docker-compose.yml -f docker-compose.ip.yml up -d --build
  fi
}

rollback_update() {
  local code=$?
  trap - ERR
  if [ "${ROLLBACK_RUNNING}" -eq 1 ]; then exit "${code}"; fi
  ROLLBACK_RUNNING=1
  set +e
  printf '[%s] update failed with exit code %s\n' "$(date -Is)" "${code}" >>"${LOG_FILE}"
  if [ "${UPDATE_STARTED}" -eq 1 ] && [ -n "${PREVIOUS_COMMIT}" ]; then
    write_status running "新版未通过检查，正在自动回滚" 92 || true
    printf '[%s] rolling back to %s\n' "$(date -Is)" "${PREVIOUS_COMMIT}" >>"${LOG_FILE}"
    git -C "${INSTALL_DIR}" reset --hard "${PREVIOUS_COMMIT}" >>"${LOG_FILE}" 2>&1
    deploy_checkout >>"${LOG_FILE}" 2>&1
    if wait_for_health 45; then
      write_status failed "更新失败，已自动恢复更新前版本" 100 || true
      printf '[%s] rollback completed successfully\n' "$(date -Is)" >>"${LOG_FILE}"
    else
      write_status failed "更新和自动回滚均未通过健康检查，请登录主机处理" 100 || true
      printf '[%s] rollback health check failed\n' "$(date -Is)" >>"${LOG_FILE}"
    fi
  else
    write_status failed "更新预检失败，现有版本未被修改" 0 || true
  fi
  rm -f -- "${REQUEST_FILE}"
  exit "${code}"
}

[ -e "${REQUEST_FILE}" ] || exit 0
[ ! -L "${REQUEST_FILE}" ] || { rm -f -- "${REQUEST_FILE}"; exit 1; }
trap rollback_update ERR

{
  printf '\n[%s] web update requested\n' "$(date -Is)" >>"${LOG_FILE}"
  write_status running "正在执行环境预检" 5
  command -v git >/dev/null
  command -v docker >/dev/null
  docker compose version >/dev/null
  [ -d "${INSTALL_DIR}/.git" ]
  [ -f "${INSTALL_DIR}/.env" ]
  [ -x "${INSTALL_DIR}/backup.sh" ]
  [ -x "${INSTALL_DIR}/update.sh" ]
  available_kb="$(df -Pk "${INSTALL_DIR}" | awk 'NR == 2 { print $4 }')"
  [ "${available_kb:-0}" -ge "${OU_YAML_UPDATE_MIN_FREE_KB:-1048576}" ]
  cd "${INSTALL_DIR}"
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "安装目录存在未提交的受管文件修改，拒绝自动覆盖" >>"${LOG_FILE}"
    false
  fi

  PREVIOUS_COMMIT="$(git rev-parse HEAD)"
  printf '[%s] current commit: %s, free disk: %s KB\n' "$(date -Is)" "${PREVIOUS_COMMIT}" "${available_kb}" >>"${LOG_FILE}"
  write_status running "正在备份完整数据" 15
  "${INSTALL_DIR}/backup.sh" >>"${LOG_FILE}" 2>&1

  write_status running "正在拉取最新版本" 35
  git fetch --prune origin main >>"${LOG_FILE}" 2>&1
  git merge --ff-only origin/main >>"${LOG_FILE}" 2>&1
  next_commit="$(git rev-parse HEAD)"
  printf '[%s] target commit: %s\n' "$(date -Is)" "${next_commit}" >>"${LOG_FILE}"
  if [ "${next_commit}" = "${PREVIOUS_COMMIT}" ]; then
    write_status completed "当前已经是最新构建" 100
    rm -f -- "${REQUEST_FILE}"
    trap - ERR
    exit 0
  fi

  UPDATE_STARTED=1
  write_status running "正在构建并切换新版服务" 62
  deploy_checkout >>"${LOG_FILE}" 2>&1
  write_status running "正在执行新版健康检查" 90
  wait_for_health 60

  write_status completed "更新完成，新版服务运行正常" 100
  printf '[%s] update completed: %s\n' "$(date -Is)" "${next_commit}" >>"${LOG_FILE}"
  docker image prune -f --filter "until=168h" >>"${LOG_FILE}" 2>&1 || true
  rm -f -- "${REQUEST_FILE}"
  trap - ERR
}
