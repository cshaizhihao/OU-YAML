#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

REPO_URL="${OU_YAML_REPO_URL:-https://github.com/cshaizhihao/OU-YAML.git}"
INSTALL_DIR="${OU_YAML_INSTALL_DIR:-/opt/ou-yaml}"
DEFAULT_PORT="${OU_YAML_PORT:-8787}"
AUTHOR="nodeseek@cshaizhihao"

if [ "${EUID}" -ne 0 ]; then
  echo "请使用 root 权限运行：sudo bash install.sh"
  exit 1
fi

INPUT_FD=0
if ! [ -t 0 ]; then
  if [ -e /dev/tty ] && ( : </dev/tty ) 2>/dev/null; then
    exec 3</dev/tty
    INPUT_FD=3
  else
    echo "安装程序需要交互式终端，请使用 SSH 终端运行，或先下载脚本再执行。" >&2
    exit 1
  fi
fi

c_green='\033[1;32m'; c_cyan='\033[1;36m'; c_yellow='\033[1;33m'; c_red='\033[1;31m'; c_dim='\033[2m'; c_reset='\033[0m'

say() { printf '%b\n' "$*"; }
step() { say "${c_cyan}▶${c_reset} $*"; }
warn() { say "${c_yellow}⚠${c_reset} $*"; }
fail() { say "${c_red}✕${c_reset} $*" >&2; exit 1; }
read_input() {
  if [ "$INPUT_FD" -eq 3 ]; then
    read -r "$@" <&3
  else
    read -r "$@"
  fi
}

ask() { local prompt="$1" default="${2:-}" value; if [ -n "$default" ]; then read_input -p "$prompt [$default]: " value; printf '%s' "${value:-$default}"; else read_input -p "$prompt: " value; printf '%s' "$value"; fi; }

art() {
  clear 2>/dev/null || true
  say "${c_green}"
  cat <<'ART'
   OOO   U   U        -   Y   Y   AAAAA  M   M  L
  O   O  U   U       ---   Y Y    A   A  MM MM  L
  O   O  U   U        -     Y     AAAAA  M M M  L
  O   O  U   U              Y     A   A  M   M  L
   OOO    UUU               Y     A   A  M   M  LLLLL

                 YAML · Nodes · Subscriptions
ART
  say "${c_reset}"
  say "${c_dim}作者：${AUTHOR}${c_reset}"
  say ""
}

show_agreement() {
  art
  say "${c_yellow}使用协议${c_reset}"
  cat <<'NOTICE'
────────────────────────────────────────────────────────────
感谢使用 OU-YAML。

1. 本项目用于管理和生成用户自己的代理节点与配置订阅。
2. 用户必须确保导入、保存和发布的节点、订阅及规则内容合法合规。
3. 请妥善保管管理员账号、密码、订阅地址和服务器凭据。
4. 公开订阅链接一旦泄露，可能被第三方访问，请及时撤销或重新生成。
5. 安装脚本会安装 Docker，并可能启动 Caddy 作为 HTTPS 反向代理。
6. 域名安装需要提前完成 DNS 解析；Cloudflare 代理模式需要按提示设置 SSL/TLS。
7. 本项目按“原样”提供，使用者需自行承担配置和运营风险。
────────────────────────────────────────────────────────────
NOTICE
  say "请输入 ${c_green}YES${c_reset} 表示同意协议，输入其他内容退出。"
  local agreement
  read_input -p "确认: " agreement
  [ "${agreement}" = "YES" ] || fail "未同意使用协议，安装已退出。"
}

detect_reverse_proxy_conflict() {
  local mode="${1:-domain}" app_port="${2:-}" found=() conflicts=() listeners=() service binary port_filter
  local has_port_conflict=0
  for service in nginx nginx.service apache2 httpd caddy traefik haproxy; do
    if [[ "$service" == *.service ]]; then continue; fi
    if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet "$service" 2>/dev/null; then
      found+=("运行中的 ${service}")
      conflicts+=("运行中的 ${service}")
    fi
  done
  for binary in nginx apache2 httpd caddy traefik haproxy; do
    if command -v "$binary" >/dev/null 2>&1 && [[ ! " ${found[*]} " == *" ${binary}"* ]]; then found+=("已安装 ${binary}"); fi
  done
  if [ "$mode" = "domain" ]; then
    port_filter='( sport = :80 or sport = :443 )'
  elif [[ "$app_port" =~ ^[0-9]+$ ]]; then
    port_filter="( sport = :${app_port} )"
  else
    port_filter=''
  fi
  if [ -n "$port_filter" ] && command -v ss >/dev/null 2>&1; then
    while IFS= read -r listener; do
      [ -n "$listener" ] && listeners+=("$listener")
    done < <(ss -ltnH "$port_filter" 2>/dev/null || true)
  elif [ -n "$port_filter" ] && command -v lsof >/dev/null 2>&1; then
    local listen_port
    if [ "$mode" = "domain" ]; then
      for listen_port in 80 443; do
        while IFS= read -r listener; do
          [ -n "$listener" ] && listeners+=("$listener")
        done < <(lsof -nP -iTCP:"$listen_port" -sTCP:LISTEN 2>/dev/null || true)
      done
    else
      while IFS= read -r listener; do
        [ -n "$listener" ] && listeners+=("$listener")
      done < <(lsof -nP -iTCP:"$app_port" -sTCP:LISTEN 2>/dev/null || true)
    fi
  fi
  if [ "${#listeners[@]}" -gt 0 ]; then
    has_port_conflict=1
    if [ "$mode" = "domain" ]; then
      found+=("80/443 端口已有监听")
      conflicts+=("80/443 端口已有监听")
    else
      found+=("${app_port} 端口已有监听")
      conflicts+=("${app_port} 端口已有监听")
    fi
  fi
  if [ "${#found[@]}" -gt 0 ]; then
    warn "检测到可能与 OU-YAML 冲突的反向代理或端口占用：${found[*]}"
    if [ "$mode" = "domain" ]; then
      warn "域名模式需要 Docker Caddy 使用 80/443 端口。"
      if [ "${#conflicts[@]}" -gt 0 ] && [ "${OU_YAML_ALLOW_REVERSE_PROXY_CONFLICT:-0}" != "1" ]; then
        say "请先停止已有反代，或确认它们不占用 80/443 后重新运行。"
        say "如已确认风险，可设置 OU_YAML_ALLOW_REVERSE_PROXY_CONFLICT=1 强制继续。"
        return 1
      fi
      if [ "${#conflicts[@]}" -gt 0 ]; then warn "已设置强制继续，将由用户自行处理反代冲突。"; else warn "检测到相关程序但当前未发现活动冲突，继续安装。"; fi
    elif [ "$has_port_conflict" -eq 1 ]; then
      say "IP + 端口模式需要使用未被占用的 ${app_port} 端口。"
      return 1
    else
      warn "当前为 IP + 端口模式，已有反代只要不占用 ${app_port} 通常可以共存。"
    fi
  fi
}

ensure_dependencies() {
  if ! command -v curl >/dev/null 2>&1; then fail "未检测到 curl，请先安装 curl。"; fi
  if ! command -v git >/dev/null 2>&1; then
    step "正在安装 git..."
    if command -v apt-get >/dev/null 2>&1; then apt-get update -y && apt-get install -y git
    elif command -v dnf >/dev/null 2>&1; then dnf install -y git
    elif command -v yum >/dev/null 2>&1; then yum install -y git
    else fail "无法自动安装 git，请先手动安装。"; fi
  fi
  if ! command -v docker >/dev/null 2>&1; then
    step "未检测到 Docker，正在安装 Docker..."
    curl -fsSL https://get.docker.com | sh
  fi
  docker compose version >/dev/null 2>&1 || fail "需要 Docker Compose v2，请先安装或升级 Docker。"
  systemctl enable --now docker >/dev/null 2>&1 || true
}

prepare_repository() {
  if [ -d "${INSTALL_DIR}/.git" ]; then
    step "发现已有安装，正在安全更新代码..."
    git -C "${INSTALL_DIR}" pull --ff-only
  else
    mkdir -p "$(dirname "${INSTALL_DIR}")"
    step "正在下载 OU-YAML..."
    git clone --depth 1 "${REPO_URL}" "${INSTALL_DIR}"
  fi
}

write_env() {
  local mode="$1" port="$2" domain="${3:-}" admin_user password password_b64
  if [ -f "${INSTALL_DIR}/.env" ]; then
    local temporary_env
    warn "检测到已有 .env，将保留账号密码并更新当前访问模式。"
    temporary_env="$(mktemp "${INSTALL_DIR}/.env.XXXXXX")"
    grep -Ev '^(OU_YAML_PORT|DOMAIN|TRUST_PROXY|COOKIE_SECURE|APP_ORIGIN)=' "${INSTALL_DIR}/.env" > "${temporary_env}" || true
    printf 'OU_YAML_PORT=%s\n' "$port" >> "${temporary_env}"
    if [ "$mode" = "domain" ]; then
      printf 'DOMAIN=%s\nTRUST_PROXY=1\nCOOKIE_SECURE=true\nAPP_ORIGIN=https://%s\n' "$domain" "$domain" >> "${temporary_env}"
    else
      printf 'TRUST_PROXY=0\nCOOKIE_SECURE=false\nAPP_ORIGIN=\n' >> "${temporary_env}"
    fi
    chmod 0600 "${temporary_env}"
    mv -f -- "${temporary_env}" "${INSTALL_DIR}/.env"
    return
  fi
  while :; do
    admin_user="$(ask '管理员账号' 'admin')"
    [[ "$admin_user" =~ ^[A-Za-z0-9._-]{3,64}$ ]] && break
    warn "管理员账号需为 3-64 位，仅可包含字母、数字、点、下划线和短横线。"
  done
  while :; do
    read_input -s -p "管理员密码（至少 10 位）: " password; echo
    [ "${#password}" -ge 10 ] && break
    warn "密码至少需要 10 位。"
  done
  password_b64="$(printf '%s' "$password" | base64 | tr -d '\n')"
  umask 077
  {
    printf 'OU_YAML_PORT=%s\n' "$port"
    printf 'ADMIN_USERNAME=%s\n' "$admin_user"
    printf 'ADMIN_PASSWORD_B64=%s\n' "$password_b64"
    if [ "$mode" = "domain" ]; then
      printf 'DOMAIN=%s\n' "$domain"
      printf 'TRUST_PROXY=1\nCOOKIE_SECURE=true\nAPP_ORIGIN=https://%s\n' "$domain"
    else
      printf 'TRUST_PROXY=0\nCOOKIE_SECURE=false\nAPP_ORIGIN=\n'
    fi
  } > "${INSTALL_DIR}/.env"
}

install_ip_mode() {
  local port
  port="$(ask 'OU-YAML 访问端口' "$DEFAULT_PORT")"
  [[ "$port" =~ ^[0-9]+$ ]] && [ "$port" -ge 1 ] && [ "$port" -le 65535 ] || fail "端口必须是 1-65535 之间的数字。"
  if command -v ss >/dev/null 2>&1 && ss -ltnH "sport = :${port}" 2>/dev/null | grep -q .; then
    fail "端口 ${port} 已被其他程序占用，请更换端口后重试。"
  fi
  detect_reverse_proxy_conflict ip "$port" || fail "检测到端口冲突，已停止安装。"
  write_env ip "$port"
  install -d -m 0750 -o root -g 1001 /var/log/ou-yaml
  cd "${INSTALL_DIR}"
  step "正在构建并启动 OU-YAML..."
  docker compose -f docker-compose.yml -f docker-compose.ip.yml up -d --build
  say "${c_green}✓ 安装完成${c_reset}"
  say "访问地址：${c_green}http://服务器IP:${port}${c_reset}"
}

install_web_update_agent() {
  if ! command -v systemctl >/dev/null 2>&1; then
    warn "当前系统没有 systemd，网页一键更新代理未启用。"
    return 0
  fi
  step "正在启用网页端一键更新代理..."
  sed "s&@INSTALL_DIR@&${INSTALL_DIR}&g" "${INSTALL_DIR}/deploy/ou-yaml-web-update-agent.service" > /etc/systemd/system/ou-yaml-web-update-agent.service
  install -m 0644 "${INSTALL_DIR}/deploy/ou-yaml-web-update-agent.timer" /etc/systemd/system/ou-yaml-web-update-agent.timer
  touch "${INSTALL_DIR}/data/web-update-agent.enabled"
  chown 1001:1001 "${INSTALL_DIR}/data/web-update-agent.enabled" 2>/dev/null || true
  systemctl daemon-reload
  systemctl enable --now ou-yaml-web-update-agent.timer
}

install_domain_mode() {
  local domain cf_mode
  domain="$(ask '请输入已完成 DNS 解析的域名')"
  [[ "$domain" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || fail "域名格式看起来不正确。"
  say ""
  say "Cloudflare 接入方式："
  say "  1. 不开启小黄云（DNS only）"
  say "  2. 开启小黄云（Proxied）"
  cf_mode="$(ask '请选择 1 或 2' '1')"
  case "$cf_mode" in
    1)
      warn "请确认 Cloudflare DNS 已将 ${domain} 解析到本服务器，并保持灰色云朵（DNS only）。"
      warn "Caddy 将直接为该域名申请 HTTPS 证书，服务器需开放 TCP 80/443。"
      ;;
    2)
      warn "请确认 Cloudflare DNS 已将 ${domain} 解析到本服务器，并开启橙色云朵（Proxied）。"
      warn "Cloudflare SSL/TLS 请设置为“完全（严格）”，源站仍需开放 TCP 80/443。"
      ;;
    *) fail "Cloudflare 模式选择无效。";;
  esac
  detect_reverse_proxy_conflict || fail "检测到反代冲突，已停止安装。"
  write_env domain "$DEFAULT_PORT" "$domain"
  install -d -m 0750 -o root -g 1001 /var/log/ou-yaml
  cd "${INSTALL_DIR}"
  step "正在构建 OU-YAML 和 Caddy HTTPS 网关..."
  docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d --build
  say "${c_green}✓ 安装完成${c_reset}"
  say "访问地址：${c_green}https://${domain}${c_reset}"
}

run_install() {
  art
  say "安装方式："
  say "  1. IP + 端口访问"
  say "  2. 域名访问（Caddy HTTPS）"
  local mode
  mode="$(ask '请选择 1 或 2' '1')"
  ensure_dependencies
  prepare_repository
  export OU_YAML_BUILD_COMMIT
  OU_YAML_BUILD_COMMIT="$(git -C "${INSTALL_DIR}" rev-parse HEAD)"
  mkdir -p "${INSTALL_DIR}/data"
  chown -R 1001:1001 "${INSTALL_DIR}/data" 2>/dev/null || true
  chmod 0700 "${INSTALL_DIR}/data"
  case "$mode" in
    1) install_ip_mode;;
    2) install_domain_mode;;
    *) fail "安装方式选择无效。";;
  esac
  install_web_update_agent
  if command -v systemctl >/dev/null 2>&1; then
    local auto_update
    auto_update="$(ask '是否启用每日自动更新？输入 y 启用，其他跳过' 'n')"
    case "${auto_update,,}" in
      y|yes) OU_YAML_INSTALL_DIR="${INSTALL_DIR}" "${INSTALL_DIR}/install-auto-update.sh";;
      *) say "自动更新未启用，可稍后运行 ${INSTALL_DIR}/install-auto-update.sh。";;
    esac
  fi
  say "数据目录：${INSTALL_DIR}/data"
  say "更新命令：${INSTALL_DIR}/update.sh"
}

show_agreement
while :; do
  art
  say "${c_cyan}主菜单${c_reset}"
  say "  ${c_green}1.${c_reset} 安装 OU-YAML"
  say "  ${c_green}2.${c_reset} 退出安装"
  local_choice="$(ask '请选择' '1')"
  case "$local_choice" in
    1) run_install; break;;
    2) say "安装已退出。"; exit 0;;
    *) warn "请输入 1 或 2。";;
  esac
done
