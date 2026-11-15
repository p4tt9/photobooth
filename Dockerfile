# syntax=docker/dockerfile:1.7
#
# Snaphora Fotobox – App-Image
#
# Stages:
#   assets   – baut CSS/JS (Node), wird nicht ausgeliefert
#   php-deps – installiert PHP-Abhängigkeiten (Composer), wird nicht ausgeliefert
#   runtime  – Image für die Box (echte Kamera über gphoto2, Druck über CUPS des Grundsystems)
#   dev      – runtime + Kamera-/Drucker-Simulator für die Entwicklung auf dem Laptop
#
# Gebaut wird alles vorab (CI), auf der Box wird nichts mehr kompiliert.

ARG PHP_IMAGE=webdevops/php-apache:8.4
ARG NODE_IMAGE=node:20.15-bookworm-slim

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS assets
WORKDIR /build

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

COPY gulpfile.mjs ./
COPY config/tailwind.admin.config.mjs config/
COPY assets assets
COPY resources resources
# Von Tailwind nach Klassen durchsuchte Verzeichnisse (config/tailwind.admin.config.mjs)
COPY admin admin
COPY lib lib
COPY src src
COPY login login
COPY manual manual
COPY welcome welcome

RUN npx gulp \
    && npm prune --omit=dev --no-audit --no-fund

# ---------------------------------------------------------------------------
FROM ${PHP_IMAGE} AS php-deps
WORKDIR /build

COPY composer.json composer.lock ./
COPY bin/composer bin/composer
RUN php bin/composer install --no-dev --no-scripts --no-autoloader --no-interaction --no-progress

COPY src src
RUN mkdir -p private/src \
    && php bin/composer dump-autoload --no-dev --optimize --classmap-authoritative --no-interaction

# ---------------------------------------------------------------------------
FROM ${PHP_IMAGE} AS runtime

ARG APP_VERSION=dev

ENV APP_VERSION=${APP_VERSION} \
    TZ=Europe/Berlin \
    PHP_DATE_TIMEZONE=Europe/Berlin \
    PHP_MEMORY_LIMIT=1024M \
    PHP_MAX_EXECUTION_TIME=120 \
    PHP_POST_MAX_SIZE=64M \
    PHP_UPLOAD_MAX_FILESIZE=64M \
    PHP_DISPLAY_ERRORS=0 \
    CUPS_SERVER=/run/cups/cups.sock

# gphoto2:      Kamera (Canon EOS 750D)
# cups-client:  `lp` spricht mit dem CUPS des Grundsystems über den Socket
# exiftool:     EXIF-Daten übernehmen
RUN echo "LimitRequestLine 12000" > /opt/docker/etc/httpd/conf.d/limits.conf \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        gphoto2 \
        cups-client \
        libimage-exiftool-perl \
        curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --chown=application:application . .
COPY --chown=application:application --from=assets /build/resources/css resources/css
COPY --chown=application:application --from=assets /build/resources/js resources/js
COPY --chown=application:application --from=assets /build/resources/revisions.json resources/revisions.json
COPY --chown=application:application --from=assets /build/node_modules node_modules
COPY --chown=application:application --from=php-deps /build/vendor vendor

# Zustand liegt in Volumes (siehe compose). Verzeichnisse vorab anlegen,
# damit neue Volumes mit den richtigen Rechten initialisiert werden.
# PHP-FPM läuft als `application` und startet gphoto2. Die Kamera gehört auf dem Grundsystem
# der Gruppe plugdev (udev-Regel) – `group_add` in compose wirkt nicht für die PHP-Prozesse.
RUN usermod -aG plugdev application \
    && echo "${APP_VERSION}" > HEAD \
    && mkdir -p data config private var \
    && touch welcome/.skip_welcome \
    && chown -R application:application data config private var welcome HEAD

VOLUME ["/app/data", "/app/config", "/app/private", "/app/var"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS -o /dev/null http://127.0.0.1/api/csrf.php || exit 1

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS sample-images
# Erzeugt Testfotos in der Auflösung der Canon EOS 750D (6000x4000),
# damit die Bildverarbeitung auf dem Laptop mit realistischen Datenmengen arbeitet.
RUN apt-get update \
    && apt-get install -y --no-install-recommends imagemagick \
    && rm -rf /var/lib/apt/lists/*
COPY resources/img/demo /demo
RUN mkdir -p /out \
    && for f in /demo/*.jpg; do \
        convert "$f" -resize 6000x4000^ -gravity center -extent 6000x4000 \
            -attenuate 0.4 +noise Gaussian -quality 92 "/out/$(basename "$f")"; \
    done

# ---------------------------------------------------------------------------
FROM runtime AS dev

USER root
COPY deploy/dev/fake-gphoto2 /usr/local/bin/gphoto2
COPY deploy/dev/fake-lp /usr/local/bin/lp
COPY deploy/dev/30-fake-devices.sh /opt/docker/provision/entrypoint.d/30-fake-devices.sh
COPY --from=sample-images /out /opt/fake-camera/images
RUN chmod 0755 /usr/local/bin/gphoto2 /usr/local/bin/lp /opt/docker/provision/entrypoint.d/30-fake-devices.sh \
    && mkdir -p /var/spool/fake-printer /var/lib/fake-devices \
    && chown application:application /var/spool/fake-printer /var/lib/fake-devices

ENV FAKE_CAMERA_IMAGES=/opt/fake-camera/images \
    FAKE_PRINTER_SPOOL=/var/spool/fake-printer \
    FAKE_DEVICE_STATE=/var/lib/fake-devices
