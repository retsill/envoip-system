#!/bin/bash
# Compila e instala/actualiza Vicidial Moderno. Ejecutar como root en el servidor ViciBox.
set -euo pipefail
umask 022
APP=/opt/vicimodern
cd "$APP"

getent group vicimodern >/dev/null || groupadd --system vicimodern
id vicimodern &>/dev/null || useradd --system --gid vicimodern --home-dir "$APP" --shell /sbin/nologin vicimodern

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

# Acceso: dominio único y Vicidial clásico solo con sesión en EnVoip System (deploy/apache-envoip-gate.conf)
GATE_DIR=/var/lib/envoip-gate
install -d -o vicimodern -g vicimodern -m 0711 "$GATE_DIR" "$GATE_DIR/agent" "$GATE_DIR/admin"
env_get() { sed -nE "s/^$1=[\"']?([^\"']*)[\"']?\$/\1/p" "$APP/.env" | tail -1; }
re() { printf '%s' "$1" | sed 's/[.]/\\\\./g'; }
PUBLIC_HOST=$(env_get PUBLIC_HOST); WS_HOST=$(env_get WS_HOST); WS_HOST=${WS_HOST:-$PUBLIC_HOST}
LOCAL_IPS=$(for ip in 127.0.0.1 ::1 $(hostname -I); do re "$ip"; printf '|'; done | sed 's/|$//')
sed -e "s#@GATE_DIR@#$GATE_DIR#g" -e "s#@LOCAL_IPS@#$LOCAL_IPS#g" -e "s#@PUBLIC_HOST_RAW@#$PUBLIC_HOST#g" \
    -e "s#@PUBLIC_HOST@#$(re "$PUBLIC_HOST")#g" -e "s#@WS_HOST@#$(re "$WS_HOST")#g" \
    -e "$([ -n "$PUBLIC_HOST" ] && echo 's/^#HOST#//' || echo '/^#HOST#/d')" \
    deploy/apache-envoip-gate.conf > /etc/apache2/conf.d/envoip-gate.conf
chmod 644 /etc/apache2/conf.d/envoip-gate.conf
[ -n "$PUBLIC_HOST" ] || echo "  (sin PUBLIC_HOST en .env: no se fuerza un dominio único)"
systemctl daemon-reload
systemctl enable --now vicimodern
systemctl restart vicimodern
apachectl configtest && systemctl reload apache2
sleep 1
curl -fsS http://127.0.0.1:3100/modern/api/health && echo "  <- servicio OK"
