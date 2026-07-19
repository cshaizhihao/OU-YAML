#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${OU_YAML_REPO_URL:-https://github.com/cshaizhihao/OU-YAML.git}"
INSTALL_DIR="${OU_YAML_INSTALL_DIR:-/opt/ou-yaml}"

if [ "${EUID}" -ne 0 ]; then
  echo "请使用 root 权限运行安装脚本。"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "未检测到 Docker，正在安装..."
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || { echo "需要 Docker Compose v2。"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "请先安装 git。"; exit 1; }

if [ -d "${INSTALL_DIR}/.git" ]; then
  git -C "${INSTALL_DIR}" pull --ff-only
else
  mkdir -p "$(dirname "${INSTALL_DIR}")"
  git clone --depth 1 "${REPO_URL}" "${INSTALL_DIR}"
fi

if [ -f "${INSTALL_DIR}/.env" ]; then
  echo "保留现有账号与数据配置。"
else
  username="${ADMIN_USERNAME:-admin}"
  port="${OU_YAML_PORT:-8787}"
  password="${ADMIN_PASSWORD:-}"
  domain="${DOMAIN:-}"
  if [ -r /dev/tty ]; then
    read -r -p "管理员账号 [admin]: " input </dev/tty || true
    username="${input:-$username}"
    read -r -p "网页端口 [8787]: " input </dev/tty || true
    port="${input:-$port}"
    read -r -p "域名（留空使用 IP+端口）: " input </dev/tty || true
    domain="${input:-$domain}"
    if [ -z "${password}" ]; then
      read -r -s -p "管理员密码（至少 10 位）: " password </dev/tty
      echo
    fi
  fi
  if [ "${#password}" -lt 10 ]; then
    echo "管理员密码至少需要 10 位。"
    exit 1
  fi
  if ! [[ "${port}" =~ ^[0-9]+$ ]] || [ "${port}" -lt 1 ] || [ "${port}" -gt 65535 ]; then
    echo "端口必须在 1-65535 之间。"
    exit 1
  fi
  password_b64="$(printf '%s' "${password}" | base64 | tr -d '\n')"
  umask 077
  {
    printf 'OU_YAML_PORT=%s\n' "${port}"
    printf 'ADMIN_USERNAME=%s\n' "${username}"
    printf 'ADMIN_PASSWORD_B64=%s\n' "${password_b64}"
    printf 'TRUST_PROXY=%s\n' "$([ -n "${domain}" ] && printf 1 || printf 0)"
    printf 'COOKIE_SECURE=%s\n' "$([ -n "${domain}" ] && printf true || printf false)"
    [ -n "${domain}" ] && printf 'DOMAIN=%s\n' "${domain}"
  } > "${INSTALL_DIR}/.env"
fi

mkdir -p "${INSTALL_DIR}/data"
chown -R 1001:1001 "${INSTALL_DIR}/data"
cd "${INSTALL_DIR}"
if grep -q '^DOMAIN=.' .env; then
  docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d --build
  domain="$(sed -n 's/^DOMAIN=//p' .env)"
  echo "OU-YAML 已启动：https://${domain}"
else
  docker compose up -d --build
  port="$(sed -n 's/^OU_YAML_PORT=//p' .env)"
  echo "OU-YAML 已启动：http://<服务器IP>:${port}"
fi
