#!/usr/bin/env bash

select_update_target() {
  local channel="${1:-stable}" tag payload current target
  case "${channel}" in
    stable)
      payload="$(curl -fsSL --connect-timeout 10 --max-time 30 https://api.github.com/repos/cshaizhihao/OU-YAML/releases/latest)" || return 1
      tag="$(printf '%s' "${payload}" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\(v[0-9]*\.[0-9]*\.[0-9]*\)".*/\1/p' | head -n 1)"
      [[ "${tag}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "无法确认稳定版本，请稍后重试" >&2; return 1; }
      git fetch origin "refs/tags/${tag}:refs/tags/${tag}" || return 1
      UPDATE_TARGET="$(git rev-parse "refs/tags/${tag}^{commit}")"
      ;;
    preview)
      git fetch origin main || return 1
      UPDATE_TARGET="$(git rev-parse FETCH_HEAD)"
      ;;
    *) echo "更新渠道无效" >&2; return 1 ;;
  esac
  [[ "${UPDATE_TARGET}" =~ ^[0-9a-f]{40}$ ]] || return 1
  current="$(sed -n 's/.*"version": "\([0-9.]*\)".*/\1/p' package.json | head -n 1)"
  target="$(git show "${UPDATE_TARGET}:package.json" | sed -n 's/.*"version": "\([0-9.]*\)".*/\1/p' | head -n 1)"
  [[ "${target}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
  if [ "${OU_YAML_FRESH_INSTALL:-0}" != "1" ] && [ "$(printf '%s\n%s\n' "${current}" "${target}" | sort -V | tail -n 1)" != "${target}" ]; then echo "目标版本低于当前版本，已阻止自动降级" >&2; return 1; fi
  export UPDATE_TARGET
}

deploy_service() {
  local revision
  export OU_YAML_BUILD_COMMIT OU_YAML_IMAGE
  OU_YAML_BUILD_COMMIT="$(git rev-parse HEAD)"
  OU_YAML_IMAGE="ghcr.io/cshaizhihao/ou-yaml:sha-${OU_YAML_BUILD_COMMIT}"
  if docker pull "${OU_YAML_IMAGE}"; then
    revision="$(docker image inspect -f '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "${OU_YAML_IMAGE}")"
    [ "${revision}" = "${OU_YAML_BUILD_COMMIT}" ] || { echo "镜像构建提交与目标版本不一致" >&2; return 1; }
    docker compose "$@" up -d --no-build --wait --wait-timeout 120
  else
    echo "预构建镜像暂不可用，正在从已确认的版本源码构建。" >&2
    OU_YAML_IMAGE="ou-yaml:${OU_YAML_BUILD_COMMIT}"
    docker compose "$@" up -d --build --wait --wait-timeout 180
  fi
}
