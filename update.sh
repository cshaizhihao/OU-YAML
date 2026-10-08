#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${OU_YAML_INSTALL_DIR:-${SCRIPT_DIR}}"
export OU_YAML_INSTALL_DIR="${INSTALL_DIR}"
cd "${INSTALL_DIR}"
if [ "${OU_YAML_SKIP_PULL:-0}" != "1" ]; then
  DATA_DIR="${OU_YAML_DATA_DIR:-${INSTALL_DIR}/data}"
  mkdir -p "${DATA_DIR}"
  temporary="$(mktemp "${DATA_DIR}/.update-request.XXXXXX")"
  trap 'rm -f -- "${temporary}"' EXIT
  printf '{"channel":"stable"}\n' > "${temporary}"
  if ! ln -T -- "${temporary}" "${DATA_DIR}/web-update-request.json"; then echo "已有更新任务排队中"; exit 1; fi
  rm -f -- "${temporary}"
  trap - EXIT
  exec bash "${INSTALL_DIR}/deploy/ou-yaml-web-update-agent.sh"
fi
source "${INSTALL_DIR}/deploy/release.sh"
export OU_YAML_BUILD_COMMIT="$(git rev-parse HEAD)"
if grep -q '^DOMAIN=.' .env; then
  deploy_service -f docker-compose.yml -f docker-compose.caddy.yml
else
  deploy_service -f docker-compose.yml -f docker-compose.ip.yml
fi
