#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
INSTALL_DIR="${OU_YAML_INSTALL_DIR:-/opt/ou-yaml}"
DATA_DIR="${OU_YAML_DATA_DIR:-${INSTALL_DIR}/data}"
BACKUP_DIR="${OU_YAML_BACKUP_DIR:-${INSTALL_DIR}/backups}"
LOCK_FILE="/run/ou-yaml-backup.lock"

[ -d "${INSTALL_DIR}" ] || { echo "安装目录不存在：${INSTALL_DIR}" >&2; exit 1; }
[ ! -L "${INSTALL_DIR}" ] || { echo "安装目录不能是符号链接" >&2; exit 1; }
[ ! -L "${DATA_DIR}" ] || { echo "数据目录不能是符号链接" >&2; exit 1; }
install -d -m 0700 "${BACKUP_DIR}"
exec 9>"${LOCK_FILE}"
flock -n 9 || { echo "已有备份任务正在运行" >&2; exit 1; }
cd "${INSTALL_DIR}"

archive="${BACKUP_DIR}/ou-yaml-$(date -u +%Y%m%d-%H%M%S)-$$.tar.gz"
staging="$(mktemp -d "${BACKUP_DIR}/.staging.XXXXXX")"
cleanup() { rm -rf -- "${staging}"; }
trap cleanup EXIT
mkdir -p "${staging}/data"
copy_data_state() {
  find "${DATA_DIR}" -maxdepth 1 -type f ! -name 'ou-yaml.db*' -exec cp -p -- {} "${staging}/data/" \;
}

if command -v sqlite3 >/dev/null 2>&1 && [ -f "${DATA_DIR}/ou-yaml.db" ]; then
  sqlite3 "${DATA_DIR}/ou-yaml.db" ".backup '${staging}/data/ou-yaml.db'"
  copy_data_state
else
  compose_files=(-f docker-compose.yml -f docker-compose.ip.yml)
  if grep -q '^DOMAIN=' "${INSTALL_DIR}/.env" 2>/dev/null; then compose_files=(-f docker-compose.yml -f docker-compose.caddy.yml); fi
  if command -v docker >/dev/null 2>&1 && docker compose "${compose_files[@]}" ps --status running -q ou-yaml 2>/dev/null | grep -q .; then
    snapshot_name=".ou-yaml-backup-$$.db"
    docker compose "${compose_files[@]}" exec -T -e "BACKUP_NAME=${snapshot_name}" ou-yaml node --input-type=module -e 'import Database from "better-sqlite3"; const db = new Database("/app/data/ou-yaml.db", { readonly: true }); await db.backup(`/app/data/${process.env.BACKUP_NAME}`); db.close();'
    cp -p "${DATA_DIR}/${snapshot_name}" "${staging}/data/ou-yaml.db"
    rm -f -- "${DATA_DIR}/${snapshot_name}"
    copy_data_state
  elif [ -f "${DATA_DIR}/ou-yaml.db" ]; then
    echo "OU-YAML 服务未运行，直接复制 SQLite 文件" >&2
    cp -p "${DATA_DIR}/ou-yaml.db" "${staging}/data/ou-yaml.db"
    copy_data_state
  else
    echo "数据库文件不存在：${DATA_DIR}/ou-yaml.db" >&2
    exit 1
  fi
fi
[ -f "${INSTALL_DIR}/.env" ] && cp -p "${INSTALL_DIR}/.env" "${staging}/.env"
tar_items=(data)
[ -f "${staging}/.env" ] && tar_items+=(.env)
tar -C "${staging}" -czf "${archive}" "${tar_items[@]}"
chmod 0600 "${archive}"
echo "备份已创建：${archive}"
