FROM node:20-bookworm-slim AS build
WORKDIR /app
ENV npm_config_jobs=1 MAKEFLAGS=-j1
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM debian:bookworm-slim AS kernels
ARG TARGETARCH
ARG MIHOMO_VERSION=1.19.28
ARG SING_BOX_VERSION=1.13.12
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gzip tar && rm -rf /var/lib/apt/lists/*
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) \
        mihomo_asset="mihomo-linux-amd64-compatible-v${MIHOMO_VERSION}.gz"; \
        mihomo_sha="70d01cfb8cb7bf7a92fd1af16cb4b9553d90bb4eecde3b5c4849103e27c80ddb"; \
        sing_arch="amd64"; \
        sing_sha="1540533adb3df24f5ad5f14b5c7ca3dbc2401b10a1c1eb278fcadcada47ec6c4" ;; \
      arm64) \
        mihomo_asset="mihomo-linux-arm64-v${MIHOMO_VERSION}.gz"; \
        mihomo_sha="2474450cd1c41dfa53036a54a4e85579f493d3af524d86c3d4b8e2b240b56cd2"; \
        sing_arch="arm64"; \
        sing_sha="1ffa3b48ad6fa98f9fd810482e39bdd5b6157782ef11ce37d67bdcfd9338547a" ;; \
      *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    sing_asset="sing-box-${SING_BOX_VERSION}-linux-${sing_arch}.tar.gz"; \
    mkdir -p /out /licenses /tmp/sing-box; \
    curl -fL --retry 3 -o /tmp/mihomo.gz "https://github.com/MetaCubeX/mihomo/releases/download/v${MIHOMO_VERSION}/${mihomo_asset}"; \
    echo "${mihomo_sha}  /tmp/mihomo.gz" | sha256sum -c -; \
    gzip -dc /tmp/mihomo.gz > /out/mihomo; \
    curl -fL --retry 3 -o /tmp/sing-box.tar.gz "https://github.com/SagerNet/sing-box/releases/download/v${SING_BOX_VERSION}/${sing_asset}"; \
    echo "${sing_sha}  /tmp/sing-box.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/sing-box.tar.gz -C /tmp/sing-box --strip-components=1; \
    cp /tmp/sing-box/sing-box /out/sing-box; \
    curl -fL --retry 3 -o /licenses/mihomo-LICENSE "https://raw.githubusercontent.com/MetaCubeX/mihomo/v${MIHOMO_VERSION}/LICENSE"; \
    curl -fL --retry 3 -o /licenses/sing-box-LICENSE "https://raw.githubusercontent.com/SagerNet/sing-box/v${SING_BOX_VERSION}/LICENSE"; \
    chmod 0755 /out/mihomo /out/sing-box

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATA_DIR=/app/data
RUN groupadd --system --gid 1001 ouyaml && useradd --system --uid 1001 --gid ouyaml --home-dir /app ouyaml
COPY --from=build --chown=ouyaml:ouyaml /app/dist ./dist
COPY --from=build --chown=ouyaml:ouyaml /app/dist-server ./dist-server
COPY --from=build --chown=ouyaml:ouyaml /app/node_modules ./node_modules
COPY --from=build --chown=ouyaml:ouyaml /app/package.json ./package.json
COPY --from=kernels /out/mihomo /usr/local/bin/mihomo
COPY --from=kernels /out/sing-box /usr/local/bin/sing-box
COPY --from=kernels /licenses /usr/share/licenses/ou-yaml-kernels
RUN mkdir -p /app/data && chown ouyaml:ouyaml /app/data
USER ouyaml
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/api/auth/me').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist-server/index.js"]
