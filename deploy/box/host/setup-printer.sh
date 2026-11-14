#!/usr/bin/env bash
#
# Richtet den DNP DS620 in CUPS ein und macht ihn zum Standarddrucker.
# Kann jederzeit erneut ausgeführt werden (z. B. wenn der Drucker bei der Einrichtung aus war).
#
#   sudo ./setup-printer.sh
#
# Rückgabewert: 0 = eingerichtet, 3 = Drucker nicht gefunden

set -euo pipefail

QUEUE="${SNAPHORA_PRINTER_QUEUE:-DNP_DS620}"

if lpstat -p "${QUEUE}" >/dev/null 2>&1; then
    echo "Drucker ${QUEUE} ist bereits eingerichtet."
    lpadmin -d "${QUEUE}"
    exit 0
fi

# USB-Adresse suchen. Bevorzugt das Gutenprint-Backend für Thermosublimationsdrucker
# (gutenprint53+usb://dnp-ds620/…): es meldet Status und verbleibende Drucke an CUPS.
# Sonst das allgemeine USB-Backend (usb://Dai%20Nippon%20Printing/DS620?serial=…).
devices="$(lpinfo -v 2>/dev/null || true)"
uri="$(awk 'tolower($0) ~ /gutenprint[0-9]*\+usb:\/\/dnp-ds620/ { print $2; exit }' <<<"${devices}")"
if [[ -z "${uri}" ]]; then
    uri="$(awk 'tolower($0) ~ /usb:\/\/.*(dai%20nippon|dnp|ds620)/ { print $2; exit }' <<<"${devices}")"
fi
if [[ -z "${uri}" ]]; then
    echo "DNP DS620 nicht gefunden. Ist er eingeschaltet und per USB verbunden?" >&2
    exit 3
fi

# Gutenprint-Treiber für den DS620
model="$(lpinfo -m 2>/dev/null | awk 'tolower($0) ~ /ds620/ && tolower($0) ~ /gutenprint/ { print $1; exit }')"
if [[ -z "${model}" ]]; then
    echo "Kein Gutenprint-Treiber für den DS620 gefunden (Paket printer-driver-gutenprint?)." >&2
    exit 1
fi

echo "Richte ${QUEUE} ein: ${uri} mit ${model}"
lpadmin -p "${QUEUE}" -E -v "${uri}" -m "${model}"
lpadmin -d "${QUEUE}"
cupsenable "${QUEUE}"
cupsaccept "${QUEUE}"
echo "Drucker ${QUEUE} eingerichtet und als Standard gesetzt."
