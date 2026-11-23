# syntax=docker/dockerfile:1.7
# Snaphora Agent (TypeScript): Registrierung, Konfiguration vom Server, Galerie-Upload

FROM node:20.19-bookworm-slim AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src src
COPY test test
RUN npm run build && npm test && npm prune --omit=dev --no-audit --no-fund

FROM node:20.19-bookworm-slim AS runtime
ENV NODE_ENV=production \
    AGENT_DIR=/agent \
    DATA_DIR=/data \
    CONFIG_DIR=/config \
    PRIVATE_DIR=/private \
    PORT=3001
WORKDIR /app
COPY --from=build /build/dist dist
COPY package.json ./
RUN printf '#!/bin/sh\nexec node /app/dist/src/cli.js "$@"\n' > /usr/local/bin/snaphora-agent \
    && chmod 755 /usr/local/bin/snaphora-agent \
    # Gleiche Benutzer-ID (1000) wie die App: Ebenen und Bilder müssen für beide les- und schreibbar sein.
    # Startet dieser Container zuerst, legt Docker die gemeinsamen Volumes mit diesen Rechten an.
    && mkdir -p /agent /data /config /private \
    && chown node:node /agent /data /config /private \
    && chmod 700 /agent
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3001/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "dist/src/main.js"]
