# syntax=docker/dockerfile:1.7
# Alle Dienste der Snaphora-Box aus einem Workspace (planning/ARCHITEKTUR.md).
#
#   docker build --target render -t photobooth-render box
#   docker build --target agent  -t photobooth-agent  box
#   docker build --target app    -t photobooth-app    box
#
# Gebaut und getestet wird einmal für alle (Stufe build). Jedes Ziel bekommt danach nur seine eigenen
# Laufzeit-Abhängigkeiten und seinen eigenen Code.

# Node 24 LTS (Wartung bis 04/2028); Node 20 ist seit 04/2026 ohne Sicherheitsupdates
ARG NODE_IMAGE=node:24.22-bookworm-slim

# Nur die package.json-Dateien: Die Installation bleibt im Cache, solange sich keine Abhängigkeit ändert.
FROM ${NODE_IMAGE} AS manifests
WORKDIR /box
COPY . .
RUN find . -type f ! -name package.json ! -name package-lock.json -delete && find . -type d -empty -delete

FROM ${NODE_IMAGE} AS build
WORKDIR /box
COPY --from=manifests /box ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
RUN npm test

# Laufzeit-Abhängigkeiten je Dienst, ohne Entwicklungswerkzeuge
FROM ${NODE_IMAGE} AS deps-render
WORKDIR /box
COPY --from=manifests /box ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --workspace apps/render --no-audit --no-fund

FROM ${NODE_IMAGE} AS deps-agent
WORKDIR /box
COPY --from=manifests /box ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --workspace apps/agent --no-audit --no-fund

FROM ${NODE_IMAGE} AS deps-app
WORKDIR /box
COPY --from=manifests /box ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --workspace apps/app --no-audit --no-fund

# Gemeinsame Pakete (übersetzt) – jeder Dienst bekommt sie
FROM scratch AS packages
COPY --from=build /box/packages/platform/package.json /box/packages/platform/
COPY --from=build /box/packages/platform/dist/src /box/packages/platform/dist/src
COPY --from=build /box/packages/contracts/package.json /box/packages/contracts/
COPY --from=build /box/packages/contracts/dist/src /box/packages/contracts/dist/src

# ---------------------------------------------------------------------------------------------------
# Render-Dienst: Look, Rahmen, Anzeige-, Galerie- und Druckbilder (libvips/sharp)
FROM ${NODE_IMAGE} AS render
ENV NODE_ENV=production \
    DATA_DIR=/data \
    LOOKS_DIR=/looks \
    PORT=3000
# Schriften für Text auf Fotos/Druck
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-dejavu-core curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps-render /box/node_modules /box/node_modules
COPY --from=packages /box /box
COPY --from=build /box/apps/render/package.json /box/apps/render/
COPY --from=build /box/apps/render/dist/src /box/apps/render/dist/src
WORKDIR /box/apps/render
# Gleiche Benutzer-ID (1000) wie die App, damit beide dieselben Dateien schreiben dürfen.
# /data gehört 1000 – startet dieser Container zuerst, legt Docker das gemeinsame Volume mit diesen Rechten an.
RUN mkdir -p /data /looks && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/src/server.js"]

# ---------------------------------------------------------------------------------------------------
# Agent: Registrierung, Konfiguration vom Server, Galerie-Upload
FROM ${NODE_IMAGE} AS agent
ENV NODE_ENV=production \
    AGENT_DIR=/agent \
    DATA_DIR=/data \
    CONFIG_DIR=/config \
    PRIVATE_DIR=/private \
    PORT=3001
COPY --from=deps-agent /box/node_modules /box/node_modules
COPY --from=packages /box /box
COPY --from=build /box/apps/agent/package.json /box/apps/agent/
COPY --from=build /box/apps/agent/dist/src /box/apps/agent/dist/src
WORKDIR /box/apps/agent
RUN printf '#!/bin/sh\nexec node /box/apps/agent/dist/src/cli.js "$@"\n' > /usr/local/bin/snaphora-agent \
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

# ---------------------------------------------------------------------------------------------------
# app: die Snaphora-Box-Anwendung (Einstellungen, Zugang, Druck, Status; löst photobooth schrittweise ab)
FROM ${NODE_IMAGE} AS app
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    CONFIG_DIR=/config \
    DATA_DIR=/data \
    STATE_DIR=/state \
    PRIVATE_DIR=/private \
    PORT=3002 \
    APP_VERSION=${APP_VERSION}
COPY --from=deps-app /box/node_modules /box/node_modules
COPY --from=packages /box /box
COPY --from=build /box/apps/app/package.json /box/apps/app/
COPY --from=build /box/apps/app/dist/src /box/apps/app/dist/src
# Verwaltungsoberfläche (Angular), ausgeliefert unter /admin/
COPY --from=build /box/apps/admin/dist /box/apps/admin/dist
ENV ADMIN_DIR=/box/apps/admin/dist
WORKDIR /box/apps/app
RUN printf '#!/bin/sh\nexec node /box/apps/app/dist/src/cli.js "$@"\n' > /usr/local/bin/snaphora-app \
    && chmod 755 /usr/local/bin/snaphora-app \
    # Gleiche Benutzer-ID (1000) wie photobooth und agent (gemeinsame Volumes)
    && mkdir -p /config /data /state /private \
    && chown node:node /config /data /state /private \
    && chmod 700 /state
USER node
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3002/api/v1/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "dist/src/main.js"]
