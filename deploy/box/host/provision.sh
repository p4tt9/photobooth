#!/usr/bin/env bash
#
# Richtet das Grundsystem der Fotobox ein (Debian 13, ThinkCentre).
# Idempotent: darf beliebig oft laufen, z. B. nach Änderungen an diesem Skript.
#
#   sudo ./provision.sh              normale Einrichtung / Aktualisierung
#   sudo ./provision.sh --firstboot  beim ersten Start nach der USB-Installation (startet danach neu)
#
# Einstellungen stehen in /etc/snaphora/box.env (wird beim ersten Lauf angelegt):
#   SNAPHORA_IMAGE      Container-Image (Standard ghcr.io/p4tt9/photobooth)
#   SNAPHORA_VERSION    Image-Tag (Standard dev)
#   SNAPHORA_SERVER_URL, SNAPHORA_REGISTRATION_TOKEN   Verbindung zum Backend (optional, siehe deploy/box/compose.yml)
#   SNAPHORA_COMMAND_*  Abweichende Befehle für Kamera/Drucker (optional)
# Not-PIN für die Verwaltung: `sudo snaphora-set-pin` (Hash in /etc/snaphora/admin-pin.hash)
#
# Für Tests:
#   SNAPHORA_SKIP_PULL=1    Image nicht herunterladen

set -euo pipefail

HOST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_BOX_DIR="$(dirname "${HOST_DIR}")"
INSTALL_DIR=/opt/snaphora
BOX_DIR="${INSTALL_DIR}/box"
CONFIG_DIR=/etc/snaphora
STATE_DIR=/var/lib/snaphora
LOG_FILE=/var/log/snaphora-provision.log
KIOSK_USER=kiosk
FIRSTBOOT=0

for arg in "$@"; do
    case "${arg}" in
        --firstboot) FIRSTBOOT=1 ;;
        *) echo "Unbekannte Option: ${arg}" >&2; exit 2 ;;
    esac
done

log() { printf '\n==> %s\n' "$*"; }
warn() { printf '\n!!  %s\n' "$*" >&2; }
has_systemd() { [[ -d /run/systemd/system ]]; }

if [[ "$(id -u)" -ne 0 ]]; then
    echo "Bitte als root ausführen (sudo)." >&2
    exit 1
fi

mkdir -p "$(dirname "${LOG_FILE}")"
exec > >(tee -a "${LOG_FILE}") 2>&1
echo "Snaphora-Provisionierung gestartet: $(date --iso-8601=seconds)"

# shellcheck source=/dev/null
. /etc/os-release
if [[ "${ID:-}" != "debian" ]]; then
    warn "Getestet ist nur Debian 13 – gefunden: ${PRETTY_NAME:-unbekannt}"
fi

# ---------------------------------------------------------------------------
log "Pakete installieren"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
    ca-certificates curl sudo openssh-server rsync usbutils iproute2 \
    docker.io docker-cli docker-compose \
    cups cups-client printer-driver-gutenprint \
    cage chromium fonts-dejavu-core dbus-user-session \
    pipewire-audio wireplumber \
    wireguard-tools

# ---------------------------------------------------------------------------
log "Dateien der Box nach ${BOX_DIR} übernehmen"
mkdir -p "${INSTALL_DIR}" "${CONFIG_DIR}" "${STATE_DIR}"
if [[ "$(realpath "${SOURCE_BOX_DIR}")" != "$(realpath -m "${BOX_DIR}")" ]]; then
    rsync -a --delete "${SOURCE_BOX_DIR}/" "${BOX_DIR}/"
fi

log "Systemdateien installieren"
# Alles unter host/files/ wird 1:1 ins System kopiert.
while IFS= read -r -d '' source; do
    target="/${source#"${BOX_DIR}/host/files/"}"
    mode=0644
    [[ -x "${source}" ]] && mode=0755
    install -D -m "${mode}" "${source}" "${target}"
done < <(find "${BOX_DIR}/host/files" -type f -print0)

if [[ ! -f "${CONFIG_DIR}/box.env" ]]; then
    cat > "${CONFIG_DIR}/box.env" <<'EOF'
# Snaphora Fotobox – Einstellungen des Grundsystems
SNAPHORA_IMAGE=ghcr.io/p4tt9/photobooth
SNAPHORA_VERSION=dev
# Verbindung zum Backend (leer = Box läuft nur mit lokalen Einstellungen)
SNAPHORA_SERVER_URL=
# Einmal-Token aus dem Management-Frontend; nach der Registrierung wird es nicht mehr gebraucht
SNAPHORA_REGISTRATION_TOKEN=
EOF
fi
chmod 600 "${CONFIG_DIR}/box.env"
# Not-PIN (nur Hash). Leer, bis `snaphora-set-pin` sie setzt; app liest sie als Benutzer 1000.
if [[ ! -f "${CONFIG_DIR}/admin-pin.hash" ]]; then
    : > "${CONFIG_DIR}/admin-pin.hash"
fi
chown 1000:1000 "${CONFIG_DIR}/admin-pin.hash"
chmod 400 "${CONFIG_DIR}/admin-pin.hash"

# ---------------------------------------------------------------------------
log "Kiosk-Benutzer einrichten"
if ! id "${KIOSK_USER}" >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash "${KIOSK_USER}"
fi
for group in audio video render input; do
    if getent group "${group}" >/dev/null; then
        usermod -aG "${group}" "${KIOSK_USER}"
    fi
done
install -m 0644 -o "${KIOSK_USER}" -g "${KIOSK_USER}" \
    "${BOX_DIR}/host/kiosk/bash_profile" "/home/${KIOSK_USER}/.bash_profile"

# ---------------------------------------------------------------------------
log "Robustheit: Ruhezustand aus, automatische Dateisystemreparatur"
for target in sleep.target suspend.target hibernate.target hybrid-sleep.target; do
    ln -sf /dev/null "/etc/systemd/system/${target}"
done

if [[ -f /etc/default/grub ]]; then
    if ! grep -q 'fsck.repair=yes' /etc/default/grub; then
        sed -i 's/^GRUB_CMDLINE_LINUX_DEFAULT="\(.*\)"/GRUB_CMDLINE_LINUX_DEFAULT="\1 fsck.mode=auto fsck.repair=yes"/' /etc/default/grub
    fi
    if command -v update-grub >/dev/null && has_systemd; then
        update-grub
    fi
fi

# ---------------------------------------------------------------------------
log "Dienste aktivieren"
systemctl enable docker.service cups.service ssh.service snaphora-app.service >/dev/null 2>&1 \
    || systemctl enable docker.service cups.service ssh.service snaphora-app.service

if has_systemd; then
    systemctl daemon-reload
    systemctl restart systemd-journald
    sysctl --system >/dev/null
    udevadm control --reload
    udevadm trigger --subsystem-match=usb
    systemctl reload ssh.service || true
    systemctl start cups.service docker.service

    log "Drucker einrichten"
    "${BOX_DIR}/host/setup-printer.sh" || warn "Drucker nicht eingerichtet – später erneut: ${BOX_DIR}/host/setup-printer.sh"

    if [[ "${SNAPHORA_SKIP_PULL:-0}" != "1" ]]; then
        log "App-Image laden"
        set -a
        # shellcheck source=/dev/null
        . "${CONFIG_DIR}/box.env"
        set +a
        docker compose -f "${BOX_DIR}/compose.yml" pull \
            || warn "Image konnte nicht geladen werden (Internet?) – die Box nutzt beim Start das zuletzt geladene"
    fi

    systemctl restart snaphora-app.service || warn "App konnte nicht gestartet werden"
else
    warn "Kein laufendes systemd (Container/Chroot) – Dienste werden erst beim nächsten Start aktiv"
fi

date --iso-8601=seconds > "${STATE_DIR}/provisioned"
log "Fertig."

if [[ "${FIRSTBOOT}" -eq 1 ]] && has_systemd; then
    echo "Erste Einrichtung abgeschlossen – Neustart in 10 Sekunden."
    sleep 10
    systemctl reboot
fi
