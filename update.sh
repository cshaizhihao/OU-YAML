#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${OU_YAML_INSTALL_DIR:-${SCRIPT_DIR}}"
cd "${INSTALL_DIR}"
git pull --ff-only
if grep -q '^DOMAIN=.' .env; then
  docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d --build
else
  docker compose up -d --build
fi
docker image prune -f --filter "until=168h"
