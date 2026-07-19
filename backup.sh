#!/usr/bin/env bash
set -Eeuo pipefail
INSTALL_DIR="${OU_YAML_INSTALL_DIR:-/opt/ou-yaml}"
BACKUP_DIR="${OU_YAML_BACKUP_DIR:-${INSTALL_DIR}/backups}"
mkdir -p "${BACKUP_DIR}"
archive="${BACKUP_DIR}/ou-yaml-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -C "${INSTALL_DIR}" -czf "${archive}" data .env
chmod 600 "${archive}"
echo "备份已创建：${archive}"
