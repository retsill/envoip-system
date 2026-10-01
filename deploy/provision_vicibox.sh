#!/bin/bash
# =============================================================================
#  EnVoip System — aprovisionamiento de un ViciBox
#
#  Deja un ViciBox recién instalado con toda la configuración de EnVoip System:
#  webphone local, WebRTC, carriers, cola SOPORTE, usuarios de la app y la app web.
#  Es idempotente: se puede ejecutar varias veces sin duplicar nada ni cambiar
#  contraseñas ya generadas.
#
#  Uso (como root en el servidor, desde /opt/vicimodern):
#     PUBLIC_HOST=pbx.tudominio.com bash deploy/provision_vicibox.sh
#
#  Variables:
#     PUBLIC_HOST    Dominio o IP con el que se accede al servidor (por defecto, su IP).
#                    En producción debe ser un dominio con certificado válido.
#     INGROUP        Cola de entrada para los agentes (por defecto SOPORTE).
#     INGROUP_EXT    Extensión interna que llama a esa cola (por defecto 7000).
#     SKIP_APP=1     No compilar ni desplegar la app web.
#     WS_PORT        Puerto del WebSocket SIP para webphones y app: 443 (por defecto, vía Apache en /ws;
#                    funciona detrás de Cloudflare) u 8089 (directo a Asterisk).
# =============================================================================
set -euo pipefail
umask 022

APP=/opt/vicimodern
SERVER_IP=$(awk -F'=> *' '/^VARserver_ip/{gsub(/ /,"",$2); print $2}' /etc/astguiclient.conf)
PUBLIC_HOST=${PUBLIC_HOST:-$SERVER_IP}
INGROUP=${INGROUP:-SOPORTE}
INGROUP_EXT=${INGROUP_EXT:-7000}
WS_PORT=${WS_PORT:-443}
M="mysql --default-character-set=utf8mb4 asterisk"
step() { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }
q() { $M -N -e "$1"; }

[ -n "$SERVER_IP" ] || { echo "No se encontró VARserver_ip en /etc/astguiclient.conf"; exit 1; }
echo "Servidor: $SERVER_IP · Acceso público: $PUBLIC_HOST · Cola: $INGROUP (ext. $INGROUP_EXT)"

# -----------------------------------------------------------------------------
step "0. Requisitos: Node.js 20 y proxy de Apache"
node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$node_major" -lt 18 ]; then
  zypper -n --gpg-auto-import-keys install nodejs20 npm20
fi
echo "Node.js $(node -v) · npm $(npm -v)"
for m in proxy proxy_http proxy_wstunnel; do a2enmod -q "$m" || a2enmod "$m"; done
getent group vicimodern >/dev/null || groupadd --system vicimodern
id vicimodern &>/dev/null || useradd --system --gid vicimodern --home-dir "$APP" --shell /sbin/nologin vicimodern

# -----------------------------------------------------------------------------
step "1. ViciPhone local (webphone de los agentes servido desde este servidor)"
# Chrome bloquea que una web de Internet (phone.viciphone.com) conecte con IPs de red local,
# y en producción conviene no depender de un tercero: se aloja aquí la versión oficial 3.0.
if [ ! -f /srv/www/htdocs/viciphone/viciphone.php ]; then
  tmp=$(mktemp -d)
  git clone -q --depth 1 --branch v3.0 https://github.com/vicimikec/ViciPhone.git "$tmp/vp"
  mkdir -p /srv/www/htdocs/viciphone
  cp -a "$tmp/vp/src/." /srv/www/htdocs/viciphone/
  cp "$tmp/vp/LICENSE" /srv/www/htdocs/viciphone/
  chmod -R a+rX /srv/www/htdocs/viciphone
  rm -rf "$tmp"
  echo "instalado en /srv/www/htdocs/viciphone"
else
  echo "ya instalado"
fi
q "UPDATE system_settings SET webphone_url='/viciphone/viciphone.php'"

# -----------------------------------------------------------------------------
step "2. WebRTC: URL WebSocket y plantilla de teléfonos"
# WebSocket SIP de Asterisk también por HTTPS 443 (Apache /ws → Asterisk WSS 8089 dentro del servidor).
# Así webphones y app usan el mismo puerto que la web, y funciona detrás de Cloudflare (que no deja pasar el 8089).
# Se reenvía cifrado (WSS, no WS): Asterisk debe ver el mismo transporte que anuncia el teléfono para poder
# enviarle llamadas y comprobaciones (qualify).
cat > /etc/apache2/conf.d/envoip-ws.conf <<'CONF'
# EnVoip System: WebSocket SIP de Asterisk (webphones y app EnVoIP Phone) por HTTPS 443.
SSLProxyEngine on
SSLProxyVerify none
SSLProxyCheckPeerCN off
SSLProxyCheckPeerName off
SSLProxyCheckPeerExpire off
<Location /ws>
    ProxyPass wss://127.0.0.1:8089/ws
    ProxyPassReverse wss://127.0.0.1:8089/ws
</Location>
CONF
if [ "$WS_PORT" = "443" ]; then WS_URL="wss://$PUBLIC_HOST/ws"; else WS_URL="wss://$PUBLIC_HOST:$WS_PORT/ws"; fi
q "UPDATE servers SET web_socket_url='$WS_URL' WHERE server_ip='$SERVER_IP'"
# Sin 'context=default' los teléfonos WebRTC heredan 'trunkinbound' y sus llamadas internas
# acaban en el DID por defecto («número fuera de servicio»).
q "UPDATE vicidial_conf_templates
   SET template_contents = CONCAT(TRIM(TRAILING CHAR(10) FROM template_contents), CHAR(10), 'context=default', CHAR(10))
   WHERE template_id='VICIphoneSIP' AND template_contents NOT LIKE '%context=%'"
# Comprobación cada 30 s: mantiene vivo el WebSocket (Cloudflare y otros proxies cierran conexiones inactivas)
# y Vicidial sabe al momento si el teléfono está conectado.
q "UPDATE vicidial_conf_templates
   SET template_contents = CONCAT(TRIM(TRAILING CHAR(10) FROM TRIM(TRAILING CHAR(13) FROM TRIM(TRAILING CHAR(10) FROM template_contents))),
                                  CHAR(10), 'qualify=yes', CHAR(10), 'qualifyfreq=30', CHAR(10))
   WHERE template_id='VICIphoneSIP' AND template_contents NOT LIKE '%qualify%'"
q "SELECT CONCAT('web_socket_url = ', web_socket_url) FROM servers WHERE server_ip='$SERVER_IP'"

# -----------------------------------------------------------------------------
step "3. Carrier INTERNAL_EXT (el agente marca extensiones internas de 4 dígitos)"
# Las campañas anteponen 9 + código de país: '1990' llega como '911990'.
$M <<'SQL'
INSERT IGNORE INTO vicidial_server_carriers
 (carrier_id, carrier_name, registration_string, template_id, account_entry, protocol, globals_string,
  dialplan_entry, server_ip, active, carrier_description, user_group)
VALUES ('INTERNAL_EXT', 'Extensiones internas', '', '--NONE--', '', 'SIP', '', CONCAT(
 'exten => _91XXXX,1,AGI(agi://127.0.0.1:4577/call_log)', CHAR(10),
 'exten => _91XXXX,2,Dial(SIP/${EXTEN:2},${CAMPDTO},To)', CHAR(10),
 'exten => _91XXXX,3,Hangup', CHAR(10),
 'exten => _9XXXX,1,AGI(agi://127.0.0.1:4577/call_log)', CHAR(10),
 'exten => _9XXXX,2,Dial(SIP/${EXTEN:1},${CAMPDTO},To)', CHAR(10),
 'exten => _9XXXX,3,Hangup'),
 '0.0.0.0', 'Y', 'Llamadas manuales del agente a extensiones internas (EnVoip)', '---ALL---');
SQL
echo "ok"

# -----------------------------------------------------------------------------
step "4. Carrier VOIPMS (VoIP.ms) — se crea DESACTIVADO con marcadores"
# Para activarlo: Admin → Carriers → VOIPMS, sustituir VOIPMS_USER / VOIPMS_PASS / VOIPMS_SERVER
# (usuario de subcuenta SIP de voip.ms, su contraseña y el servidor POP más cercano, p. ej.
# atlanta1.voip.ms) y poner Active = Y. Salida: 9 + 1 + 10 dígitos (EE. UU./Canadá) y 9 + 011 (internacional).
$M <<'SQL'
INSERT IGNORE INTO vicidial_server_carriers
 (carrier_id, carrier_name, registration_string, template_id, account_entry, protocol, globals_string,
  dialplan_entry, server_ip, active, carrier_description, user_group)
VALUES ('VOIPMS', 'VoIP.ms', 'register => VOIPMS_USER:VOIPMS_PASS@VOIPMS_SERVER:5060/VOIPMS_USER', '--NONE--', CONCAT(
 '[voipms]', CHAR(10),
 'type=friend', CHAR(10),
 'host=VOIPMS_SERVER', CHAR(10),
 'username=VOIPMS_USER', CHAR(10),
 'secret=VOIPMS_PASS', CHAR(10),
 'fromuser=VOIPMS_USER', CHAR(10),
 'context=trunkinbound', CHAR(10),
 'insecure=port,invite', CHAR(10),
 'disallow=all', CHAR(10),
 'allow=ulaw', CHAR(10),
 'dtmfmode=rfc2833', CHAR(10),
 'canreinvite=no', CHAR(10),
 'nat=force_rport,comedia', CHAR(10),
 'qualify=yes'),
 'SIP', 'VOIPMS = SIP/voipms', CONCAT(
 'exten => _91NXXNXXXXXX,1,AGI(agi://127.0.0.1:4577/call_log)', CHAR(10),
 'exten => _91NXXNXXXXXX,2,Dial(${VOIPMS}/${EXTEN:1},${CAMPDTO},To)', CHAR(10),
 'exten => _91NXXNXXXXXX,3,Hangup', CHAR(10),
 'exten => _9011.,1,AGI(agi://127.0.0.1:4577/call_log)', CHAR(10),
 'exten => _9011.,2,Dial(${VOIPMS}/${EXTEN:1},${CAMPDTO},To)', CHAR(10),
 'exten => _9011.,3,Hangup'),
 '0.0.0.0', 'N', 'Proveedor de minutos VoIP.ms. Rellenar credenciales y activar en producción.', '---ALL---');
SQL
q "SELECT CONCAT('VOIPMS activo = ', active) FROM vicidial_server_carriers WHERE carrier_id='VOIPMS'"

# -----------------------------------------------------------------------------
step "5. Cola de entrada $INGROUP"
# Mismas inserciones que hace admin.php al crear un in-group
$M <<SQL
INSERT IGNORE INTO vicidial_inbound_groups
 (group_id, group_name, group_color, active, web_form_address, voicemail_ext, next_agent_call, fronter_display,
  ingroup_script, get_call_launch, web_form_address_two, start_call_url, dispo_call_url, add_lead_url, na_call_url,
  user_group, group_handling, web_form_address_three, place_in_line_caller_number_filename,
  place_in_line_you_next_filename, custom_one, custom_two, custom_three, custom_four, custom_five, call_time_id)
VALUES ('$INGROUP', 'Soporte', '#0B5CAB', 'Y', '', '', 'longest_wait_time', 'Y', 'NONE', 'NONE', '', '', '', '', '',
  '---ALL---', 'PHONE', '', '', '', '', '', '', '', '', '24hours');
INSERT IGNORE INTO vicidial_campaign_stats (campaign_id) VALUES ('$INGROUP');
INSERT IGNORE INTO vicidial_campaign_stats_debug (campaign_id) VALUES ('$INGROUP');
SQL
echo "ok"

# -----------------------------------------------------------------------------
step "6. Extensión interna $INGROUP_EXT → DID $INGROUP_EXT → cola $INGROUP"
# Los teléfonos marcan $INGROUP_EXT en el contexto 'default'; se envía al enrutado de DIDs
# (trunkinbound), igual que una llamada que entra por el proveedor.
q "INSERT IGNORE INTO vicidial_inbound_dids
   (did_pattern, did_description, did_active, did_route, extension, exten_context, voicemail_ext, phone, server_ip,
    user, user_unavailable_action, user_route_settings_ingroup, group_id, call_handle_method, agent_search_method,
    list_id, campaign_id, phone_code, menu_id, record_call)
   VALUES ('$INGROUP_EXT', 'Cola $INGROUP (llamadas internas)', 'Y', 'IN_GROUP', '', 'default', '', '', '$SERVER_IP',
    '', 'VOICEMAIL', 'AGENTDIRECT', '$INGROUP', 'CID', 'LB', '999', '', '1', '', 'N')"
DIALPLAN="exten => $INGROUP_EXT,1,Goto(trunkinbound,$INGROUP_EXT,1)"
current=$(q "SELECT IFNULL(custom_dialplan_entry,'') FROM system_settings")
if ! grep -qF "$DIALPLAN" <<<"$current"; then
  $M -e "UPDATE system_settings SET custom_dialplan_entry = TRIM(BOTH CHAR(10) FROM CONCAT(IFNULL(custom_dialplan_entry,''), CHAR(10), '$DIALPLAN'))"
fi
q "SELECT custom_dialplan_entry FROM system_settings"

# -----------------------------------------------------------------------------
step "7. Campañas y agentes reciben la cola $INGROUP"
# Todas las campañas aceptan la cola. Los agentes (nivel < 7) que no tengan colas elegidas reciben
# $INGROUP y no ven la ventana de selección de colas (bloquearía el inicio de sesión automático).
q "UPDATE vicidial_campaigns SET allow_closers='Y',
     closer_campaigns = CONCAT(' ', CONCAT_WS(' ', NULLIF(TRIM(BOTH ' ' FROM REPLACE(IFNULL(closer_campaigns,''), ' -', '')), ''), '$INGROUP'), ' -')
   WHERE IFNULL(closer_campaigns,'') NOT LIKE '% $INGROUP %'"
q "UPDATE vicidial_users SET closer_campaigns=' $INGROUP -', agent_choose_ingroups='0', agent_choose_blended='0',
     closer_default_blended='1'
   WHERE user_level < 7 AND api_only_user <> '1' AND user NOT IN ('VDAD','VDCL') AND IFNULL(TRIM(closer_campaigns),'') IN ('','-')"
# vicidial.php solo carga colas si la campaña permite entrada y NO es 'MANUAL'.
# INBOUND_MAN es el modo de Vicidial para marcar a mano y además recibir llamadas de las colas.
q "UPDATE vicidial_campaigns SET campaign_allow_inbound='Y'"
q "UPDATE vicidial_campaigns SET dial_method='INBOUND_MAN' WHERE dial_method='MANUAL'"
q "SELECT CONCAT('campaña ', campaign_id, ': ', dial_method, ' · colas =', closer_campaigns) FROM vicidial_campaigns"

# -----------------------------------------------------------------------------
step "8. Usuarios de la app: API (apimodern) y MySQL de solo lectura (modern_ro)"
mkdir -p "$APP"
if [ -f "$APP/.env" ]; then
  echo "$APP/.env ya existe: se conservan las credenciales"
else
  APIPASS=$(openssl rand -hex 10)
  ROPASS=$(openssl rand -hex 12)
  q "CREATE USER IF NOT EXISTS 'modern_ro'@'localhost' IDENTIFIED BY '$ROPASS'"
  q "ALTER USER 'modern_ro'@'localhost' IDENTIFIED BY '$ROPASS'"
  q "GRANT SELECT ON asterisk.* TO 'modern_ro'@'localhost'"
  if [ -z "$(q "SELECT user FROM vicidial_users WHERE user='apimodern'")" ]; then
    # Copia del administrador 6666 (el de fábrica de ViciBox), marcada «solo API»
    $M <<SQL
DROP TEMPORARY TABLE IF EXISTS t; CREATE TEMPORARY TABLE t AS SELECT * FROM vicidial_users WHERE user='6666';
UPDATE t SET user_id=(SELECT MAX(user_id)+1 FROM vicidial_users), user='apimodern', pass='$APIPASS',
  full_name='API EnVoip System', user_level=9, api_only_user='1', vdc_agent_api_access='1', api_allowed_functions=' ALL_FUNCTIONS ';
INSERT INTO vicidial_users SELECT * FROM t;
SQL
  else
    q "UPDATE vicidial_users SET pass='$APIPASS' WHERE user='apimodern'"
  fi
  umask 077
  cat > "$APP/.env" <<EOF
PORT=3100
BASE_PATH=/modern
SUPERVISOR_LEVEL=7
ADMIN_LEVEL=8
COOKIE_SECURE=true
JWT_SECRET=$(openssl rand -hex 32)
VICI_BASE=http://127.0.0.1
VICI_API_USER=apimodern
VICI_API_PASS=$APIPASS
DB_SOCKET=$(mysql -N -e 'SELECT @@socket')
DB_NAME=asterisk
DB_USER=modern_ro
DB_PASS=$ROPASS
EOF
  umask 022
  echo "credenciales generadas en $APP/.env"
fi
# Base de datos PROPIA de EnVoip System (mensajes SMS, ajustes): lectura y escritura solo sobre «envoip»
q "CREATE DATABASE IF NOT EXISTS envoip CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
if ! grep -q '^ENVOIP_DB_USER=' "$APP/.env"; then
  APPDBPASS=$(openssl rand -hex 12)
  q "CREATE USER IF NOT EXISTS 'envoip_app'@'localhost' IDENTIFIED BY '$APPDBPASS'"
  q "ALTER USER 'envoip_app'@'localhost' IDENTIFIED BY '$APPDBPASS'"
  printf 'ENVOIP_DB_NAME=envoip\nENVOIP_DB_USER=envoip_app\nENVOIP_DB_PASS=%s\n' "$APPDBPASS" >> "$APP/.env"
  echo "base de datos envoip: credenciales añadidas a $APP/.env"
fi
q "GRANT ALL PRIVILEGES ON envoip.* TO 'envoip_app'@'localhost'"
mkdir -p "$APP/data/sms-media" && chown -R vicimodern:vicimodern "$APP/data" 2>/dev/null || true
# Permisos que usa el admin moderno. Las opciones que OCULTAN datos (hide/block) se dejan en 0.
COLS=$(q "SELECT column_name FROM information_schema.columns WHERE table_schema='asterisk' AND table_name='vicidial_users'
          AND column_type=CONCAT('enum(',CHAR(39),'0',CHAR(39),',',CHAR(39),'1',CHAR(39),')')
          AND column_name NOT REGEXP 'hide|only|restrict|block|api_'")
SET=$(for c in $COLS; do printf "%s='1'," "$c"; done)
q "UPDATE vicidial_users SET ${SET} modify_leads='1', user_level=9, api_only_user='1' WHERE user='apimodern'"
echo "apimodern: $(echo $COLS | wc -w) permisos"

# -----------------------------------------------------------------------------
step "8a. Audio de los teléfonos WebRTC detrás del proxy /ws"
# Los teléfonos llegan a Asterisk a través de Apache (127.0.0.1). Sin externaddr, Asterisk les anuncia
# 127.0.0.1 como dirección del audio y el teléfono no consigue enviar su voz (audio en un solo sentido).
if [[ ! "$SERVER_IP" =~ ^(10\.|127\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.) ]] && ! grep -q '^externaddr=' /etc/asterisk/sip.conf; then
  cp -p /etc/asterisk/sip.conf "/etc/asterisk/sip.conf.bak-$(date +%Y%m%d%H%M%S)"
  sed -i "0,/^\[general\]/s//[general]\n; EnVoip System: IP pública que se anuncia en el audio\nexternaddr=$SERVER_IP/" /etc/asterisk/sip.conf
  asterisk -rx "sip reload" >/dev/null
fi
grep -q "$(hostname)" /etc/hosts || echo "$SERVER_IP   $(hostname)" >> /etc/hosts
grep '^externaddr=' /etc/asterisk/sip.conf || echo "IP privada: sin externaddr (configúralo con vicibox-externip si el servidor está detrás de NAT)"

# -----------------------------------------------------------------------------
step "8b. SMS entre extensiones (SIP MESSAGE) para EnVoIP Phone"
# Acepta mensajes SIP autenticados y los entrega a la extensión de destino si existe en este servidor.
# Los SMS a números externos se envían desde la app con la API de VoIP.ms.
if ! grep -q '^accept_outofcall_message' /etc/asterisk/sip.conf; then
  cp -p /etc/asterisk/sip.conf "/etc/asterisk/sip.conf.bak-$(date +%Y%m%d%H%M%S)"
  sed -i '0,/^\[general\]/s//[general]\naccept_outofcall_message=yes\noutofcall_message_context=messages\nauth_message_requests=yes/' /etc/asterisk/sip.conf
fi
if ! grep -q '^\[messages\]' /etc/asterisk/extensions.conf; then
  cat >> /etc/asterisk/extensions.conf <<'DIALPLAN'

; ---- EnVoip System: SMS entre extensiones (SIP MESSAGE) ----
[messages]
exten => _X.,1,NoOp(Mensaje de ${MESSAGE(from)} para ${EXTEN})
 same => n,GotoIf($["${SIPPEER(${EXTEN},status)}" = ""]?sin_destino)
 same => n,MessageSend(sip:${EXTEN},${MESSAGE(from)})
 same => n,NoOp(Resultado: ${MESSAGE_SEND_STATUS})
 same => n,Hangup()
 same => n(sin_destino),NoOp(${EXTEN} no es una extension de este servidor)
 same => n,Hangup()
DIALPLAN
fi
asterisk -rx "sip reload" >/dev/null
asterisk -rx "dialplan reload" >/dev/null
asterisk -rx "sip show settings" | grep -iE "out-of-call|out of call" || true
asterisk -rx "dialplan show messages" | grep -E "_X\." | head -1

# -----------------------------------------------------------------------------
step "8c. Chat interno de Vicidial (agentes y supervisores)"
q "UPDATE system_settings SET allow_chats='1'"
q "SELECT CONCAT('allow_chats = ', allow_chats) FROM system_settings"

# -----------------------------------------------------------------------------
step "9. Regenerar configuración de Asterisk"
q "UPDATE servers SET rebuild_conf_files='Y' WHERE server_ip='$SERVER_IP'"
for i in $(seq 1 45); do
  asterisk -rx "dialplan show $INGROUP_EXT@default" 2>/dev/null | grep -q trunkinbound && break
  sleep 2
done
asterisk -rx "dialplan show $INGROUP_EXT@default" | grep -E "Goto|=>" || echo "AVISO: el dialplan aún no se ha regenerado (el keepalive lo hace cada minuto)"

# -----------------------------------------------------------------------------
if [ "${SKIP_APP:-0}" != "1" ] && [ -f "$APP/deploy/deploy.sh" ]; then
  step "10. App web EnVoip System"
  bash "$APP/deploy/deploy.sh"
fi

step "Listo"
cat <<EOF
Pendiente en producción:
  - Certificado válido para $PUBLIC_HOST (Let's Encrypt) en Apache y en Asterisk: vicibox-ssl.
  - Carrier VOIPMS: poner credenciales de la subcuenta de voip.ms y activarlo.
  - En voip.ms: apuntar tus DIDs a la subcuenta y crear en Vicidial un DID por número (Administración →
    Números entrantes) con destino la cola $INGROUP.
  - Caller ID de cada campaña = un DID de voip.ms.
EOF
