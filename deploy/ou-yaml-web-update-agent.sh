#!/usr/bin/env bash
set -euo pipefail
umask 077

INSTALL_DIR="${OU_YAML_INSTALL_DIR:-/opt/ou-yaml}"
DATA_DIR="${OU_YAML_DATA_DIR:-${INSTALL_DIR}/data}"
REQUEST_FILE="${DATA_DIR}/web-update-request.json"
STATUS_FILE="${DATA_DIR}/web-update-status.json"
LOG_FILE="${OU_YAML_UPDATE_LOG:-/var/log/ou-yaml/web-update.log}"
LOCK_FILE="${OU_YAML_UPDATE_LOCK:-/run/ou-yaml-web-update.lock}"
PREVIOUS_COMMIT=""
UPDATE_STARTED=0
ROLLBACK_RUNNING=0
PREVIOUS_IMAGE=""
BACKUP_ARCHIVE=""
DEPLOY_STARTED=0
compose_files=(-f docker-compose.yml -f docker-compose.ip.yml)

[ ! -L "${INSTALL_DIR}" ] || { echo "安装目录不能是符号链接" >&2; exit 1; }
[ ! -L "${DATA_DIR}" ] || { echo "数据目录不能是符号链接" >&2; exit 1; }
install -d -m 0700 "${DATA_DIR}"
install -d -m 0750 -o root -g 1001 "$(dirname -- "${LOG_FILE}")"
if [ -L "${LOG_FILE}" ]; then echo "更新日志不能是符号链接" >&2; exit 1; fi
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
  local attempts="${1:-45}" expected_image="${2:-}" container image attempt
  for attempt in $(seq 1 "${attempts}"); do
    container="$(docker compose "${compose_files[@]}" ps -q ou-yaml)" || return 1
    if [ -n "$container" ] && [ "$(docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null || true)" = healthy ]; then
      image="$(docker inspect -f '{{.Image}}' "$container")" || return 1
      if [ -z "$expected_image" ] || [ "$image" = "$expected_image" ]; then return 0; fi
    fi
    sleep 2
  done
  return 1
}

deploy_checkout() {
  cd "${INSTALL_DIR}"
  export OU_YAML_BUILD_COMMIT
  OU_YAML_BUILD_COMMIT="$(git rev-parse HEAD)"
  source "${INSTALL_DIR}/deploy/release.sh"
  if grep -q '^DOMAIN=.' .env; then
    deploy_service -f docker-compose.yml -f docker-compose.caddy.yml
  else
    deploy_service -f docker-compose.yml -f docker-compose.ip.yml
  fi
}

rollback_update() {
  local code="${1:-$?}"
  trap - EXIT INT TERM HUP
  if [ "${ROLLBACK_RUNNING}" -eq 1 ]; then exit "${code}"; fi
  ROLLBACK_RUNNING=1
  set +e
  printf '[%s] update failed with exit code %s\n' "$(date -Is)" "${code}" >>"${LOG_FILE}"
  if [ "${UPDATE_STARTED}" -eq 1 ] && [ -n "${PREVIOUS_COMMIT}" ]; then
    write_status running "新版未通过检查，正在自动回滚" 92 || true
    printf '[%s] rolling back to %s\n' "$(date -Is)" "${PREVIOUS_COMMIT}" >>"${LOG_FILE}"
    local restored=1
    if [ "${DEPLOY_STARTED}" -eq 1 ]; then
      docker compose "${compose_files[@]}" stop ou-yaml >>"${LOG_FILE}" 2>&1 || restored=0
    fi
    git -C "${INSTALL_DIR}" reset --hard "${PREVIOUS_COMMIT}" >>"${LOG_FILE}" 2>&1 || restored=0
    if [ "$restored" -eq 1 ] && [ "${DEPLOY_STARTED}" -eq 1 ]; then
      restore_data >>"${LOG_FILE}" 2>&1 || restored=0
    fi
    if [ "$restored" -eq 1 ]; then
      docker tag "${PREVIOUS_IMAGE}" ou-yaml:rollback >>"${LOG_FILE}" 2>&1 || restored=0
    fi
    export OU_YAML_IMAGE=ou-yaml:rollback
    if [ "$restored" -eq 1 ]; then
      docker compose "${compose_files[@]}" up -d --no-build --pull never --wait --wait-timeout 120 >>"${LOG_FILE}" 2>&1 || restored=0
    fi
    if [ "$restored" -eq 1 ] && wait_for_health 45 "${PREVIOUS_IMAGE}"; then
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

restore_data() {
  local staging entry
  staging="$(mktemp -d "$(dirname -- "${BACKUP_ARCHIVE}")/restore.XXXXXX")" || return 1
  tar -xzf "${BACKUP_ARCHIVE}" -C "${staging}" || return 1
  [ -f "${staging}/data/ou-yaml.db" ] || return 1
  shopt -s dotglob nullglob
  for entry in "${DATA_DIR}"/*; do
    case "${entry##*/}" in web-update-*|.update-*) continue;; esac
    rm -rf -- "$entry" || return 1
  done
  cp -a "${staging}/data/." "${DATA_DIR}/" || return 1
  chown -R 1001:1001 "${DATA_DIR}" || return 1
  if [ -f "${staging}/.env" ]; then cp -p "${staging}/.env" "${INSTALL_DIR}/.env" || return 1; fi
  rm -rf -- "${staging}"
}

[ ! -L "${REQUEST_FILE}" ] || { rm -f -- "${REQUEST_FILE}"; exit 1; }
[ -e "${REQUEST_FILE}" ] || exit 0
trap 'exit 130' INT
trap 'exit 143' TERM HUP
finish_update() {
  local code="$1"
  if [ "$code" -ne 0 ] && [ "$ROLLBACK_RUNNING" -eq 0 ]; then rollback_update "$code"; fi
}
trap 'finish_update "$?"' EXIT

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
  if grep -q '^DOMAIN=.' .env; then compose_files=(-f docker-compose.yml -f docker-compose.caddy.yml); fi
  previous_container="$(docker compose "${compose_files[@]}" ps -q ou-yaml)"
  [ -n "${previous_container}" ]
  PREVIOUS_IMAGE="$(docker inspect -f '{{.Image}}' "${previous_container}")"
  [[ "${PREVIOUS_IMAGE}" =~ ^sha256:[0-9a-f]{64}$ ]]
  printf '[%s] current commit: %s, free disk: %s KB\n' "$(date -Is)" "${PREVIOUS_COMMIT}" "${available_kb}" >>"${LOG_FILE}"
  write_status running "正在拉取最新版本" 35
  source "${INSTALL_DIR}/deploy/release.sh"
  channel="$(sed -n 's/.*"channel"[[:space:]]*:[[:space:]]*"\(stable\|preview\)".*/\1/p' "${REQUEST_FILE}")"
  select_update_target "${channel:-stable}" >>"${LOG_FILE}" 2>&1
  requested_commit="$(sed -n 's/.*"targetCommit"[[:space:]]*:[[:space:]]*"\([0-9a-f]\{40\}\)".*/\1/p' "${REQUEST_FILE}")"
  if [ -n "${requested_commit}" ] && [ "${requested_commit}" != "${UPDATE_TARGET}" ]; then echo "目标版本已变化，请在网页重新检查更新" >>"${LOG_FILE}"; false; fi
  next_commit="${UPDATE_TARGET}"
  printf '[%s] target commit: %s\n' "$(date -Is)" "${next_commit}" >>"${LOG_FILE}"
  if [ "${next_commit}" = "${PREVIOUS_COMMIT}" ]; then
    write_status completed "当前已经是最新构建" 100
    rm -f -- "${REQUEST_FILE}"
    trap - EXIT INT TERM HUP
    exit 0
  fi

  write_status running "正在暂停服务并备份完整数据" 45
  [ ! -L "${INSTALL_DIR}/backups" ]
  install -d -m 0700 "${INSTALL_DIR}/backups"
  backup_directory="$(mktemp -d "${INSTALL_DIR}/backups/update.XXXXXX")"
  UPDATE_STARTED=1
  docker compose "${compose_files[@]}" stop ou-yaml >>"${LOG_FILE}" 2>&1
  OU_YAML_INSTALL_DIR="${INSTALL_DIR}" OU_YAML_DATA_DIR="${DATA_DIR}" OU_YAML_BACKUP_DIR="${backup_directory}" "${INSTALL_DIR}/backup.sh" >>"${LOG_FILE}" 2>&1
  archives=("${backup_directory}"/ou-yaml-*.tar.gz)
  [ "${#archives[@]}" -eq 1 ] && [ -f "${archives[0]}" ]
  BACKUP_ARCHIVE="${archives[0]}"
  tar -tzf "${BACKUP_ARCHIVE}" >/dev/null
  git checkout --detach "${UPDATE_TARGET}" >>"${LOG_FILE}" 2>&1
  write_status running "正在构建并切换新版服务" 62
  DEPLOY_STARTED=1
  deploy_checkout >>"${LOG_FILE}" 2>&1
  write_status running "正在执行新版健康检查" 90
  expected_image="$(docker image inspect -f '{{.Id}}' "${OU_YAML_IMAGE}")"
  wait_for_health 60 "${expected_image}"

  write_status completed "更新完成，新版服务运行正常" 100
  printf '[%s] update completed: %s\n' "$(date -Is)" "${next_commit}" >>"${LOG_FILE}"
  rm -f -- "${REQUEST_FILE}"
  trap - EXIT INT TERM HUP
}
