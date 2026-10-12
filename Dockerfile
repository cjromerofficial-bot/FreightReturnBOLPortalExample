# Freight Returns BOL Portal — single container: UI + API + SQLite (on the /data volume).
# Build:  docker compose up -d --build      Secrets come from .env at run time, never baked in.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.js ./
COPY src ./src
COPY lib ./lib
COPY config ./config
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data STORE=sqlite
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY api ./api
COPY lib ./lib
COPY config ./config
COPY assets ./assets
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
VOLUME /data
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server/index.mjs"]
