#!/usr/bin/env bash
#
# Baut den Snaphora-USB-Installer: ein Debian-13-Netinstall-Image, das die Fotobox ohne
# Rückfragen installiert und beim ersten Start provision.sh ausführt.
#
#   deploy/box/installer/build-iso.sh
#
# Läuft auf dem Mac/Linux mit Docker; die eigentliche Arbeit passiert in einem Debian-Container.
# Ergebnis: .dev/installer/snaphora-installer.iso  → mit balenaEtcher o. ä. auf einen USB-Stick schreiben.
#
# Einstellungen (Umgebungsvariablen, sonst Rückfrage bzw. Standard):
#   SSH_PUBKEY_FILE    öffentlicher SSH-Schlüssel für den Admin (Standard ~/.ssh/id_ed25519.pub)
#   ADMIN_USER         Admin-Benutzer (Standard snaphora)
#   ADMIN_PASSWORD     Passwort für Konsole/sudo (wird abgefragt, wenn leer)
#   BOX_HOSTNAME       Rechnername (Standard snaphora-box)
#   WIFI_SSID / WIFI_PSK   optional: WLAN statt Kabel für die Installation
#   SNAPHORA_VERSION   Image-Tag der App (Standard dev)
#
# Hinweis: Ein WLAN-Passwort steht im Klartext auf dem Stick. Stick nach der Installation sicher verwahren.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
OUT_DIR="${REPO_DIR}/.dev/installer"
DEBIAN_ISO_BASE="https://cdimage.debian.org/debian-cd/current/amd64/iso-cd"

# ---------------------------------------------------------------------------
# Teil 1: auf dem Rechner des Benutzers – Eingaben sammeln, Container starten
# ---------------------------------------------------------------------------
if [[ "${1:-}" != "--inside" ]]; then
    ADMIN_USER="${ADMIN_USER:-snaphora}"
    BOX_HOSTNAME="${BOX_HOSTNAME:-snaphora-box}"
    SNAPHORA_VERSION="${SNAPHORA_VERSION:-dev}"
    SSH_PUBKEY_FILE="${SSH_PUBKEY_FILE:-${HOME}/.ssh/id_ed25519.pub}"

    if [[ ! -r "${SSH_PUBKEY_FILE}" ]]; then
        echo "SSH-Schlüssel nicht gefunden: ${SSH_PUBKEY_FILE}" >&2
        echo "Erzeugen mit: ssh-keygen -t ed25519   oder SSH_PUBKEY_FILE=… setzen" >&2
        exit 1
    fi
    if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
        read -r -s -p "Passwort für ${ADMIN_USER} (Konsole und sudo auf der Box): " ADMIN_PASSWORD; echo
        read -r -s -p "Passwort wiederholen: " confirm; echo
        if [[ "${ADMIN_PASSWORD}" != "${confirm}" ]]; then
            echo "Passwörter stimmen nicht überein." >&2
            exit 1
        fi
    fi
    if [[ ${#ADMIN_PASSWORD} -lt 10 ]]; then
        echo "Bitte mindestens 10 Zeichen verwenden." >&2
        exit 1
    fi

    mkdir -p "${OUT_DIR}"
    cp "${SSH_PUBKEY_FILE}" "${OUT_DIR}/authorized_keys"

    # Werte nur per Name übergeben, damit das Passwort nicht in der Prozessliste auftaucht.
    export ADMIN_USER ADMIN_PASSWORD BOX_HOSTNAME SNAPHORA_VERSION
    exec docker run --rm \
        --platform linux/amd64 \
        -e ADMIN_USER -e ADMIN_PASSWORD -e BOX_HOSTNAME -e SNAPHORA_VERSION \
        -e WIFI_SSID -e WIFI_PSK \
        -v "${REPO_DIR}/deploy/box:/src/box:ro" \
        -v "${OUT_DIR}:/out" \
        debian:trixie /src/box/installer/build-iso.sh --inside
fi

# ---------------------------------------------------------------------------
# Teil 2: im Container – Debian-Image laden, prüfen, anpassen
# ---------------------------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends xorriso curl ca-certificates openssl rsync >/dev/null

mkdir -p /out/cache
cd /out/cache

echo "==> Aktuelles Debian-Netinstall-Image ermitteln"
curl -fsSL "${DEBIAN_ISO_BASE}/SHA256SUMS" -o SHA256SUMS
iso_line="$(grep -E ' debian-[0-9.]+-amd64-netinst\.iso$' SHA256SUMS | head -n1)"
iso_name="$(awk '{print $2}' <<<"${iso_line}")"
if [[ -z "${iso_name}" ]]; then
    echo "Netinstall-Image nicht in SHA256SUMS gefunden." >&2
    exit 1
fi
echo "    ${iso_name}"

if ! sha256sum --check --status <<<"${iso_line}" 2>/dev/null; then
    echo "==> Lade ${iso_name}"
    curl -fL --progress-bar "${DEBIAN_ISO_BASE}/${iso_name}" -o "${iso_name}"
    sha256sum --check <<<"${iso_line}"
fi

echo "==> Snaphora-Dateien zusammenstellen"
stage="$(mktemp -d)"
mkdir -p "${stage}/snaphora" "${stage}/preseed"
rsync -a --exclude installer/ /src/box/ "${stage}/snaphora/box/"
cp /out/authorized_keys "${stage}/snaphora/authorized_keys"
cat > "${stage}/snaphora/box.env" <<EOF
# Snaphora Fotobox – Einstellungen des Grundsystems
SNAPHORA_IMAGE=ghcr.io/p4tt9/photobooth
SNAPHORA_VERSION=${SNAPHORA_VERSION}
EOF

password_hash="$(openssl passwd -6 "${ADMIN_PASSWORD}")"
wifi_preseed=""
if [[ -n "${WIFI_SSID:-}" ]]; then
    wifi_preseed="d-i netcfg/wireless_essid string ${WIFI_SSID}
d-i netcfg/wireless_essid_again string ${WIFI_SSID}
d-i netcfg/wireless_security_type select wpa
d-i netcfg/wireless_wpa string ${WIFI_PSK:-}"
fi

preseed="$(< /src/box/installer/preseed.cfg)"
preseed="${preseed//@HOSTNAME@/${BOX_HOSTNAME}}"
preseed="${preseed//@ADMIN_USER@/${ADMIN_USER}}"
preseed="${preseed//@ADMIN_PASSWORD_HASH@/${password_hash}}"
preseed="${preseed//@WIFI_PRESEED@/${wifi_preseed}}"
printf '%s\n' "${preseed}" > "${stage}/preseed/snaphora.cfg"

if grep -q '@[A-Z_]*@' "${stage}/preseed/snaphora.cfg"; then
    echo "Nicht ersetzte Platzhalter in preseed.cfg:" >&2
    grep -n '@[A-Z_]*@' "${stage}/preseed/snaphora.cfg" >&2
    exit 1
fi

echo "==> Installer-Image bauen"
output=/out/snaphora-installer.iso
rm -f "${output}"
xorriso -indev "/out/cache/${iso_name}" -outdev "${output}" \
    -map "${stage}/snaphora" /snaphora \
    -map "${stage}/preseed" /preseed \
    -map /src/box/installer/grub.cfg /boot/grub/grub.cfg \
    -map /src/box/installer/isolinux.cfg /isolinux/isolinux.cfg \
    -map /src/box/installer/snaphora.msg /isolinux/snaphora.msg \
    -boot_image any replay \
    2>&1 | grep -vE '^xorriso : (NOTE|UPDATE)' || true

if [[ ! -s "${output}" ]]; then
    echo "Installer-Image wurde nicht erzeugt." >&2
    exit 1
fi

rm -rf "${stage}" /out/authorized_keys
echo
echo "Fertig: .dev/installer/snaphora-installer.iso ($(du -h "${output}" | cut -f1))"
echo "Auf einen USB-Stick schreiben (z. B. mit balenaEtcher) und die Box davon starten."
