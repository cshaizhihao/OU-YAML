#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${OU_YAML_INSTALL_DIR:-${SCRIPT_DIR}}"
SYSTEMD_DIR="/etc/systemd/system"

if [ "${EUID}" -ne 0 ]; then
  echo "请使用 root 权限启用自动更新。"
  exit 1
fi
command -v systemctl >/dev/null 2>&1 || { echo "当前系统不支持 systemd。"; exit 1; }
command -v flock >/dev/null 2>&1 || { echo "缺少 flock，请先安装 util-linux。"; exit 1; }
[ "${INSTALL_DIR:0:1}" = "/" ] && [[ "${INSTALL_DIR}" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "安装目录必须是只包含字母、数字、点、下划线、短横线和斜杠的绝对路径。"; exit 1; }
[ -f "${INSTALL_DIR}/deploy/ou-yaml-update.service.in" ] || { echo "找不到自动更新服务模板。"; exit 1; }

escaped_install_dir="${INSTALL_DIR//&/\\&}"
sed "s&@INSTALL_DIR@&${escaped_install_dir}&g" \
  "${INSTALL_DIR}/deploy/ou-yaml-update.service.in" \
  > "${SYSTEMD_DIR}/ou-yaml-update.service"
install -m 0644 "${INSTALL_DIR}/deploy/ou-yaml-update.timer" \
  "${SYSTEMD_DIR}/ou-yaml-update.timer"

systemctl daemon-reload
systemctl enable --now ou-yaml-update.timer
echo "OU-YAML 自动更新已启用。可运行 systemctl list-timers ou-yaml-update.timer 查看下次执行时间。"
