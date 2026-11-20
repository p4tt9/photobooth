#!/usr/bin/env bash
#
# Führt die libvips-Vergleichsmessung in einem Linux-Container aus – einmal mit allen Kernen,
# einmal mit nur einem Kern (wie die heutige GD-Verarbeitung, die nur einen Kern nutzt).
#
#   tests/bench/run-sharp.sh
#
# Voraussetzung: Dev-Umgebung läuft (für die Beispielfotos aus dem Kamera-Simulator).

set -euo pipefail
cd "$(dirname "$0")/../.."

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

docker compose cp photobooth:/opt/fake-camera/images "${work}/images" >/dev/null
cp resources/img/frames/frame.png "${work}/frame.png"
cp tests/bench/sharp-pipeline.mjs "${work}/"

docker run --rm -v "${work}:/bench" -w /bench node:20.15-bookworm-slim sh -c '
    npm install --silent --no-audit --no-fund sharp@0.34.4 qrcode@1.5.4 >/dev/null 2>&1
    node sharp-pipeline.mjs
    THREADS=1 node sharp-pipeline.mjs
'
