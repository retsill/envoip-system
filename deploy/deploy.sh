#!/bin/bash
# Compila e instala/actualiza Vicidial Moderno. Ejecutar como root en el servidor ViciBox.
set -euo pipefail
umask 022
APP=/opt/vicimodern
cd "$APP"

id vicimodern &>/dev/null || useradd --system --home-dir "$APP" --shell /sbin/nologin vicimodern

echo "== Dependencias del servidor"
(cd server && npm ci --omit=dev --no-audit --no-fund 2>/dev/null || npm install --omit=dev --no-audit --no-fund)

echo "== Compilando frontend"
(cd web && (npm ci --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund) && NODE_OPTIONS=--max-old-space-size=768 npm run build)

chown -R root:vicimodern "$APP"
chmod -R g+rX,o-rwx "$APP"
chmod 640 "$APP/.env"; chmod 600 "$APP/.credenciales-prueba" 2>/dev/null || true
# El servicio escribe aquí (imágenes de MMS)
mkdir -p "$APP/data/sms-media" && chown -R vicimodern:vicimodern "$APP/data"

install -m 644 deploy/vicimodern.service /etc/systemd/system/vicimodern.service
install -m 644 deploy/apache-vicimodern.conf /etc/apache2/conf.d/vicimodern.conf
systemctl daemon-reload
systemctl enable --now vicimodern
systemctl restart vicimodern
apachectl configtest && systemctl reload apache2
sleep 1
curl -fsS http://127.0.0.1:3100/modern/api/health && echo "  <- servicio OK"
