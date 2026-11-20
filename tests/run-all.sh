#!/usr/bin/env bash
#
# Baut die Dev-Umgebung neu und führt alle Tests gegen die laufende App aus:
# Smoke-Test, Selbstreparatur, Absturztest, Oberflächentests im Browser.
#
#   tests/run-all.sh             alles
#   tests/run-all.sh --schnell   ohne Absturztest
#
# Lokal nutzen die Oberflächentests das installierte Chrome (PW_CHANNEL=chrome);
# setze PW_CHANNEL= (leer), um Playwrights eigenen Browser zu verwenden.

set -euo pipefail

cd "$(dirname "$0")/.."
QUICK=0
[[ "${1:-}" == "--schnell" ]] && QUICK=1

step() { printf '\n\e[1m==> %s\e[0m\n' "$*"; }

step "Dev-Umgebung bauen und starten"
docker compose up -d --build --wait --wait-timeout 180

step "Smoke-Test"
RUNS=2 node tests/smoke/capture-print.mjs

step "Selbstreparatur beschädigter Dateien"
node tests/crash/damaged-files.mjs

if [[ "${QUICK}" -eq 0 ]]; then
    step "Absturztest"
    ITERATIONS="${ITERATIONS:-6}" node tests/crash/power-cut.mjs
fi

step "Oberflächentests im Browser"
if [[ ! -d tests/e2e/node_modules ]]; then
    (cd tests/e2e && npm install --no-audit --no-fund)
fi
(cd tests/e2e && PW_CHANNEL="${PW_CHANNEL-chrome}" npx playwright test)

printf '\n\e[32mAlle Tests bestanden.\e[0m\n'
