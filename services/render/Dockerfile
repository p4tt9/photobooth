# syntax=docker/dockerfile:1.7
# Snaphora Render-Dienst (TypeScript, libvips/sharp)

FROM node:20.15-bookworm-slim AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src src
COPY test test
COPY tools tools
RUN npm run build && npm test && npm prune --omit=dev --no-audit --no-fund

FROM node:20.15-bookworm-slim AS runtime
ENV NODE_ENV=production \
    DATA_DIR=/data \
    LOOKS_DIR=/looks \
    PORT=3000
# Schriften für Text auf Fotos/Druck
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-dejavu-core curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /build/node_modules node_modules
COPY --from=build /build/dist dist
COPY package.json ./
# Gleiche Benutzer-ID (1000) wie die App, damit beide dieselben Dateien schreiben dürfen.
# /data gehört 1000 – startet dieser Container zuerst, legt Docker das gemeinsame Volume mit diesen Rechten an.
RUN mkdir -p /data /looks && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/src/server.js"]
