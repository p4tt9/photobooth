#!/usr/bin/env bash
# Läuft beim Containerstart als root (webdevops-Entrypoint-Hook, nur Dev-Image).
# Bind-Mounts vom Laptop/CI gehören sonst root, der Simulator läuft aber als `application`.
mkdir -p "${FAKE_PRINTER_SPOOL:-/var/spool/fake-printer}" "${FAKE_DEVICE_STATE:-/var/lib/fake-devices}"
chown application:application "${FAKE_PRINTER_SPOOL:-/var/spool/fake-printer}" "${FAKE_DEVICE_STATE:-/var/lib/fake-devices}"
