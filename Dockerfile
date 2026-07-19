FROM node:20-bookworm-slim AS build
WORKDIR /app
ENV npm_config_jobs=1 MAKEFLAGS=-j1
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATA_DIR=/app/data
RUN groupadd --system --gid 1001 ouyaml && useradd --system --uid 1001 --gid ouyaml --home-dir /app ouyaml
COPY --from=build --chown=ouyaml:ouyaml /app/dist ./dist
COPY --from=build --chown=ouyaml:ouyaml /app/dist-server ./dist-server
COPY --from=build --chown=ouyaml:ouyaml /app/node_modules ./node_modules
COPY --from=build --chown=ouyaml:ouyaml /app/package.json ./package.json
RUN mkdir -p /app/data && chown ouyaml:ouyaml /app/data
USER ouyaml
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/api/auth/me').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist-server/index.js"]
