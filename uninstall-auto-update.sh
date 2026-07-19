#!/usr/bin/env bash
set -Eeuo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "请使用 root 权限关闭自动更新。"
  exit 1
fi

systemctl disable --now ou-yaml-update.timer 2>/dev/null || true
rm -f /etc/systemd/system/ou-yaml-update.timer /etc/systemd/system/ou-yaml-update.service
systemctl daemon-reload
echo "OU-YAML 自动更新已关闭。"

