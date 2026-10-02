# Instalación de EnVoip System 1.0

Esta guía instala EnVoip System sobre un servidor **ViciBox** que ya tiene **Vicidial** funcionando.
EnVoip System **no sustituye a Vicidial**: es una interfaz moderna que se instala a su lado y trabaja
con sus APIs oficiales. Si Vicidial no funciona bien, EnVoip System tampoco.

Tiempo aproximado: 20–30 minutos (sin contar la instalación de ViciBox).

---

## 1. Requisitos

### Servidor

| Requisito | Detalle |
|---|---|
| **ViciBox 12** | Sistema operativo del servidor: openSUSE Leap 15.6 con Vicidial, Asterisk y MariaDB ya integrados. Descarga e instrucciones en [vicibox.com](https://www.vicibox.com/). |
| **Vicidial 2.14** | El que instala ViciBox 12 (probado con `2.14b0.5`, esquema de base de datos 1724). Debe estar **instalado, configurado y funcionando**: el admin clásico (`/vicidial/admin.php`) abre y un agente puede entrar en `/agc/vicidial.php`. |
| **Asterisk 18 (versión «vici»)** | El que trae ViciBox 12 (probado con `18.26.4-vici`), con el servidor HTTPS/WebSocket en el puerto **8089** (activo por defecto en ViciBox). |
| **Instalación en un solo servidor** | Base de datos, web y Asterisk en la misma máquina («express install» de ViciBox). En clústeres de varios servidores, instalar EnVoip System en el servidor web/base de datos. |
| **Memoria RAM** | **Mínimo 4 GB**, recomendado 8 GB. Con menos de 2 GB el servidor se bloquea al cargar listas grandes o al reiniciar. |
| **Disco** | 20 GB libres como mínimo (grabaciones y leads aparte). |
| **Acceso root** | Por SSH o consola. |
| **Salida a Internet** | Para descargar el código, los paquetes de Node.js y ViciPhone (solo durante la instalación). |

### Red y dominio (producción)

| Requisito | Detalle |
|---|---|
| **Dominio** | Por ejemplo `pbx.tuempresa.com`, apuntando a la IP del servidor. En un laboratorio vale la IP. |
| **Certificado SSL válido** | Obligatorio para el audio del navegador (WebRTC): los navegadores no permiten el micrófono sin HTTPS. Let's Encrypt sirve (ver el apartado 3). |
| **Puertos abiertos** | `80/tcp` y `443/tcp` (web y WebSocket SIP de webphones y app en `wss://DOMINIO/ws`), `10000-20000/udp` (audio RTP), `5060/udp` solo hacia tu proveedor SIP, `22/tcp` solo desde tu IP. |
| **Cloudflare (opcional)** | Se puede poner la web detrás del proxy de Cloudflare (nube naranja) para no publicar la IP, con modo SSL **Full (strict)** y certificado válido en el servidor. Para la **señalización de los teléfonos** usa un subdominio **sin proxy** (nube gris), p. ej. `sip.tudominio.com` → IP del servidor, e instala con `WS_HOST=sip.tudominio.com`: a través de Cloudflare las conexiones WebSocket largas se cortan de vez en cuando (llamadas que no salen o se cortan). El audio (RTP) y el proveedor SIP van siempre directos a la IP. El certificado debe incluir los dos nombres. |

### Vicidial

- Un usuario administrador de **nivel 9** (el de la instalación de ViciBox vale).
- **Contraseñas sin cifrar** (`System Settings → Password Encryption = 0`, la opción por defecto).
  EnVoip System 1.0 todavía no admite las contraseñas cifradas de Vicidial.
- Al menos **una campaña** creada en el admin clásico (Campaigns → Add a New Campaign) y **un teléfono**
  por agente (se puede crear después desde EnVoip System).

### Lo que instala el script automáticamente

No hace falta instalarlo a mano:

- **Node.js 20** y npm (paquetes `nodejs20` y `npm20` de openSUSE).
- Los módulos `proxy` y `proxy_http` de Apache.
- **ViciPhone 3.0** (el webphone oficial de Vicidial) alojado en el propio servidor.

---

## 2. Comprobar que Vicidial funciona

> **Servidores VPS sin DHCP (Contabo y similares):** si ViciBox se instaló sin red, el servidor arranca sin IP
> y no hay acceso por SSH. Entra por la consola VNC del proveedor y pon la IP fija que te asignaron:
> ```bash
> cat > /etc/sysconfig/network/ifcfg-eth0 <<EOF
> BOOTPROTO=static
> IPADDR=IP_DEL_SERVIDOR/24
> STARTMODE=auto
> EOF
> echo "default PUERTA_DE_ENLACE - eth0" > /etc/sysconfig/network/routes   # normalmente la .1 de tu red
> sed -i 's/^NETCONFIG_DNS_STATIC_SERVERS=.*/NETCONFIG_DNS_STATIC_SERVERS="1.1.1.1 8.8.8.8"/' /etc/sysconfig/network/config
> netconfig update -f && systemctl restart network
> ```
> Comprueba también que `VARserver_ip` de `/etc/astguiclient.conf` sea esa IP. El script de instalación rellena
> después las tablas de zonas horarias que ViciBox no pudo descargar sin red.

Antes de instalar, en el servidor:

```bash
# Asterisk en marcha y con el WebSocket activo
asterisk -rx "core show version"
asterisk -rx "http show status" | grep 8089        # «HTTPS Server Enabled and Bound to 0.0.0.0:8089»

# Vicidial sincronizado con Asterisk (last_update debe ser de hace pocos segundos)
mysql asterisk -e "SELECT server_ip, last_update, NOW() FROM server_updater"

# La web responde
curl -sk -o /dev/null -w "%{http_code}\n" https://127.0.0.1/vicidial/admin.php   # 401 = pide contraseña, correcto
```

Si `last_update` se queda antiguo, el servidor tiene un problema de hora o de procesos de Vicidial
(`screen -ls` debe mostrar ASTupdate, ASTsend, ASTlisten…). Arréglalo antes de seguir: los agentes
verían «time synchronization problem».

---

## 3. Certificado SSL (producción)

En un laboratorio puedes saltarte este paso y aceptar el certificado autofirmado de ViciBox en el
navegador (abre una vez `https://IP/` y también `https://IP:8089/ws` y acepta el aviso).

En producción, con el dominio ya apuntando al servidor y el puerto 80 abierto:

```bash
vicibox-ssl
```

Es el asistente de ViciBox: pide el dominio, obtiene el certificado de **Let's Encrypt** (con acme.sh),
lo instala en Apache **y en Asterisk** (`/etc/asterisk/http.conf`, WebSocket del puerto 8089) y deja
programada la renovación. Compruébalo abriendo `https://pbx.tuempresa.com/` y
`https://pbx.tuempresa.com:8089/ws` sin avisos de seguridad.

---

## 4. Instalar EnVoip System

Como root en el servidor:

```bash
git clone https://github.com/retsill/envoip-system.git /opt/vicimodern
cd /opt/vicimodern
PUBLIC_HOST=pbx.tuempresa.com bash deploy/provision_vicibox.sh
```

`PUBLIC_HOST` es el dominio (o la IP en un laboratorio) con el que se entra al servidor. Si no se pone,
se usa la IP del servidor.

El script es **idempotente**: se puede ejecutar las veces que haga falta sin duplicar nada ni cambiar
las contraseñas ya generadas. Hace esto:

| Paso | Qué configura |
|---|---|
| 0 | Node.js 20, módulos proxy de Apache y el usuario de sistema `vicimodern`. |
| 1 | ViciPhone 3.0 servido desde el propio servidor (`/viciphone/`), sin depender de phone.viciphone.com. |
| 2 | WebSocket SIP en `wss://PUBLIC_HOST/ws` (Apache lo reenvía a Asterisk; con `WS_PORT=8089` se usa el puerto directo de Asterisk) y plantilla WebRTC `VICIphoneSIP`. |
| 3 | Carrier `INTERNAL_EXT`: los agentes pueden marcar extensiones internas. |
| 4 | Carrier `VOIPMS` (VoIP.ms) **desactivado**, con marcadores para completar (apartado 8). |
| 5–6 | Cola de entrada `SOPORTE` y extensión interna **7000** que llama a esa cola. |
| 7 | Las campañas existentes permiten llamadas entrantes y los agentes reciben la cola. |
| 8 | Usuario de API `apimodern`, usuario MySQL de solo lectura `modern_ro`, base de datos propia `envoip` y el archivo `/opt/vicimodern/.env` con contraseñas aleatorias. |
| 8a | `externaddr` con la IP pública: sin ella los teléfonos que llegan por el proxy `/ws` envían su voz a 127.0.0.1 (audio en un solo sentido). |
| 8b–8c | SMS entre extensiones (SIP MESSAGE) y chat interno de Vicidial. |
| 8d | Completa el asistente de primer inicio de Vicidial **sin** resetear los teléfonos, carga las zonas horarias si faltan, instala el códec **Opus** y desactiva el relleno genérico de pérdidas de Asterisk (ver «Calidad de audio» en el apartado 8). |
| 9 | Regenera la configuración de Asterisk. |
| 10 | Compila la web e instala el servicio `vicimodern` y el proxy de Apache. |

Al terminar debe mostrar `{"ok":true}  <- servicio OK`.

> Variables opcionales: `INGROUP` (nombre de la cola, por defecto `SOPORTE`), `INGROUP_EXT`
> (extensión de la cola, por defecto `7000`), `WS_HOST` (nombre para el WebSocket SIP; ver Cloudflare en Requisitos), `WS_PORT` (`443` por defecto u `8089`) y `SKIP_APP=1` (no compilar la web).

---

## 5. Primer acceso

Abre **`https://pbx.tuempresa.com/modern/`** y entra con tu usuario y contraseña de Vicidial.

- Nivel 1–6: pantalla de agente, mensajes y chat.
- Nivel 7: además, supervisión en tiempo real y leads.
- Nivel 8–9: además, administración.

Arriba a la izquierda, en el menú, se elige el idioma (**ES / EN**) y el tema (claro / oscuro).

En **Administración → Resumen** aparecen avisos si algo no está bien configurado
(Asterisk sin sincronizar, campañas sin listas, webphones sin WebRTC, carriers inactivos…).

---

## 6. Dar de alta el equipo

1. **Teléfonos → Nuevo teléfono**: una extensión por agente (por ejemplo `1002`). Se crea como webphone
   WebRTC, listo para el navegador.
2. **Usuarios → Nuevo usuario**: nivel 1 para agentes, con «Teléfono por defecto» = su extensión.
   Para el resto, abre el primero y pulsa **«Duplicar este usuario»**: hereda nivel, grupo, permisos y cola.
3. **Leads y listas**: crea una lista para cada campaña e importa tus contactos desde CSV.
   Para listas de cientos de miles de leads usa el cargador del servidor (apartado 10).
4. **Campañas**: se crean en el admin clásico (botón «Nueva campaña») y se ajustan desde EnVoip System
   (método de marcación, hopper, estados, orden…).

## 7. El agente se conecta

1. Entra en `https://pbx.tuempresa.com/modern/` con su usuario.
2. **Agente → Conéctate**: elige la campaña y dónde recibir las llamadas (**Navegador** o **App EnVoIP Phone**).
3. Si el navegador pide permiso para el **micrófono**, lo acepta.
4. Para cambiar de campaña sin salir: enlace **«Cambiar campaña»** en la barra superior.

Para llamar a la cola de agentes desde un teléfono interno o desde la app: extensión **7000**.

---

## 8. Llamadas a teléfonos externos (proveedor SIP)

Sin un proveedor SIP, los agentes solo pueden llamarse entre extensiones. EnVoip System viene preparado
para **VoIP.ms** (se puede usar cualquier proveedor SIP configurando el carrier en el admin clásico):

1. En voip.ms → **Sub Accounts → Create Sub Account**: protocolo SIP, usuario/contraseña, tipo
   «Asterisk, IP PBX, Gateway or VoIP Switch». Elige el servidor POP más cercano.
2. En el admin clásico → **Carriers → VOIPMS**: sustituye `VOIPMS_USER`, `VOIPMS_PASS` y
   `VOIPMS_SERVER` y pon **Active = Y**. Comprueba con `asterisk -rx "sip show registry"`.
3. En voip.ms, cada DID → enrutado a la subcuenta. En EnVoip System → **Números entrantes**:
   un DID por número con destino **Cola de agentes → SOPORTE**.
4. En cada campaña, **Caller ID saliente** = uno de tus DIDs.
5. Para que Vicidial **marque solo** los leads, cambia el **Método** de la campaña de `INBOUND_MAN`
   (manual) a `RATIO` (nivel 1–2 para empezar) o `ADAPT_AVERAGE` (predictivo).
   **No lo hagas sin carrier activo**: las llamadas fallarían y los leads quedarían marcados como llamados.

### Varias empresas o números con subcuentas independientes

Cada subcuenta del proveedor se crea como **un carrier propio** con su prefijo de marcación, y cada campaña
elige por cuál sale con su **prefijo** y su **Caller ID**. Ejemplo con voip.ms:

| Subcuenta | Carrier | Prefijo de campaña | Plan de marcación de la app | Grupo de usuarios |
|---|---|---|---|---|
| 123456_empresa1 | `VOIPMS_EMPRESA1` → `_71NXXNXXXXXX` | 7 | `envoip-empresa1` | EMPRESA1 |
| 123456_empresa2 | `VOIPMS_EMPRESA2` → `_81NXXNXXXXXX` | 8 | `envoip-empresa2` | EMPRESA2 |

- En el carrier, la línea `register => usuario:clave@pop.voip.ms:5060/DID` termina en **/DID**: así voip.ms entrega
  las entrantes con el número y Vicidial las enruta por su DID.
- En voip.ms, cada DID → **Routing: SIP/IAX → la subcuenta** (no la cuenta principal: daría «ocupado») y el
  mismo **POP** en el que se registra la subcuenta.
- Un **grupo de usuarios** por empresa con `allowed_campaigns` = sus campañas: sus agentes solo ven esas campañas.
- Para que los teléfonos de la app marquen directo con el número de su empresa: un contexto en
  `extensions.conf` (`Set(CALLERID(num)=DID)` + `Dial(SIP/peer/${EXTEN})`) y una plantilla de teléfono copiada de
  `VICIphoneSIP` con `context=` ese contexto. Copia también al principio del contexto la protección de la sala
  (`exten => _8600XXX` con `envoip-one-leg.sh`, como en `[envoip-phones]`) e `include => default`.
- **Cortafuegos:** el puerto SIP 5060/udp abierto solo a la IP del POP (`firewall-cmd --permanent --zone=public
  --remove-service=asterisk` y una regla rica para la IP del POP). Con el 5060 cerrado al resto, la lista negra
  VoIPBL de ViciBox ya no hace falta y conviene quitarla de cron: bloquea `firewalld` durante horas.

### Llamadas entrantes: cola por empresa, mensaje de espera y buzón

Los números deben ir a una **cola de Vicidial (In-Group)**, no a un teléfono: así el cliente que devuelve la llamada
llega al primer agente libre con su ficha, o espera en la cola si todos están ocupados.

1. Crea una cola por empresa (copia de `SOPORTE`) con `moh_context = envoip`, `welcome_message_filename` y
   `onhold_prompt_filename = envoip_espera_es`, `play_welcome_message = IF_WAIT_ONLY`, `prompt_interval = 60`,
   `drop_call_seconds = 120` y `drop_action = VOICEMAIL` a un buzón de la empresa (saludo `envoip_buzon_es`),
   horario (`call_time_id`) con `after_hours_action = VOICEMAIL` y `queue_priority` mayor que el de las campañas.
2. Cada DID → **Cola de agentes** con `CIDLOOKUPRC` (busca al cliente en las listas de la campaña) y una lista para
   clientes nuevos.
3. Añade la cola a la campaña (`closer_campaigns`) y a los agentes, y activa `inbound_queue_no_dial` para que el
   marcador no lance llamadas mientras haya clientes esperando.
4. Los buzones se escuchan marcando **8500** desde cualquier teléfono (número de buzón y su clave).

### Calidad de audio

- **Opus** (lo instala el script): tolera la pérdida de paquetes; con G.711/ulaw las redes wifi o domésticas
  se oyen cortadas. Tras instalarlo hay que **reiniciar Asterisk** una vez (`asterisk -rx "core restart when convenient"`).
- **Sin relleno genérico de pérdidas** (`genericplc => false` en `codecs.conf`): con Opus, el PLC de Asterisk repetía el
  último trozo de voz («Hola, Hola, Hola» cada vez más bajo). **No fuerces el búfer de jitter** (`jbforce=yes`): agrava ese efecto.
- **App EnVoIP Phone 1.0.8 o superior**: ganancia automática del micrófono (voz baja) y, en Mac, el permiso de red
  que necesita el audio UDP de WebRTC.
- Los agentes conviene que usen cable o buena wifi y auriculares con micrófono.

**SMS/MMS con clientes**: Administración → **Mensajería SMS** (API de VoIP.ms, DIDs con SMS y URL de
aviso). Los detalles están en [PRODUCCION.md](PRODUCCION.md#6-mensajes-smsmms-con-clientes).

---

## 9. App EnVoIP Phone (Windows y Mac)

Softphone para usar las extensiones fuera del navegador, con contactos, historial y SMS.

| Sistema | Descarga |
|---|---|
| **Windows** (instalador) | [EnVoIP-Phone-Setup.exe](https://github.com/retsill/envoip-phone-releases/releases/latest) |
| **Windows** (portable) | [EnVoIP-Phone-Windows.zip](https://github.com/retsill/envoip-phone-releases/releases/latest) |
| **macOS** (Intel y Apple Silicon) | [EnVoIP-Phone.dmg](https://github.com/retsill/envoip-phone-releases/releases/latest) |

Todas las versiones: <https://github.com/retsill/envoip-phone-releases/releases>

Para que un agente use **la web y la app a la vez**, cada agente necesita una segunda extensión solo
para la app (una extensión SIP no puede estar en dos dispositivos a la vez):

1. **Administración → Teléfonos** → abre la extensión del agente → **«Crear extensión para la app»**
   (se crea `5` + su extensión: `1001` → `51001`).
2. Abre la nueva extensión: muestra servidor, extensión y contraseña de registro.
3. En la app: **Líneas → Añadir → Vicidial / ViciBox** con esos datos.
4. Al conectarse en la web, el agente elige **«Recibir las llamadas en: App EnVoIP Phone»**.
   La app contesta sola la llamada con la que Vicidial conecta la sesión.

La primera vez que se abre la app en Mac: clic derecho → **Abrir** (aún no está firmada por Apple).
En Windows, si SmartScreen avisa: **Más información → Ejecutar de todas formas**.

---

## 10. Listas grandes (cientos de miles de leads)

El importador de la web usa la API de Vicidial (un lead por llamada) y es cómodo hasta unos miles de
filas. Para listas grandes, usa el cargador oficial de Vicidial en el servidor:

```bash
# Formato «standard» de Vicidial, campos separados por |:
# vendor_lead_code|source_id|list_id|phone_code|phone_number|title|first_name|middle|last_name|address1|address2|address3|city|state|province|postal_code|country|gender|date_of_birth|alt_phone|email|security_phrase|comments
cp mis_leads.txt /usr/share/astguiclient/LEADS_IN/
/usr/share/astguiclient/VICIDIAL_IN_new_leads_file.pl --forcelistid=2001 --forcephonecode=1 --duplicate-check
```

Carga unos 300–600 leads por segundo y calcula la zona horaria de cada uno. Crea antes la lista en
**Leads y listas**. Después, en **Buscar y ver leads** puedes revisarlos, filtrarlos y descargarlos en CSV.

---

## 11. Actualizar a una versión nueva

```bash
cd /opt/vicimodern
git pull
bash deploy/provision_vicibox.sh      # aplica los cambios de configuración nuevos, si los hay
```

`provision_vicibox.sh` también recompila la web y reinicia el servicio. Si solo cambió el código:
`bash deploy/deploy.sh`.

## 12. Operación diaria

```bash
systemctl status vicimodern            # estado del servicio
journalctl -u vicimodern -f            # registro en vivo
systemctl restart vicimodern           # reiniciar solo EnVoip System
```

El servicio arranca solo con el servidor. Tras un reinicio, ViciBox necesita 2–5 minutos para levantar
Asterisk y los procesos de Vicidial; hasta entonces los agentes pueden ver avisos de sincronización.

---

## 13. Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| La web `/modern/` da error 503 | El servicio no está en marcha: `systemctl restart vicimodern` y mira `journalctl -u vicimodern -n 50`. |
| «Usuario o contraseña incorrectos» con datos correctos | El usuario está inactivo, o Vicidial tiene las contraseñas cifradas activadas (no admitido en 1.0). |
| El agente se oye a sí mismo estando en pausa, se escucha un «pito» (acople) o al colgar el cliente no deja calificar | El webphone está dos veces en la sala del agente (se re-registró y ViciPhone volvió a marcar la sala). `asterisk -rx "meetme list SALA concise"` muestra el mismo teléfono dos veces. La protección `envoip-one-leg.sh` del contexto `envoip-phones` cuelga la conexión anterior; revisa que la plantilla del teléfono use ese contexto (o uno que la incluya). |
| El cliente oye la voz del agente repetida y cada vez más baja («Hola, Hola, Hola») | Relleno genérico de pérdidas de Asterisk: `genericplc => false` en `codecs.conf`, `jbforce = no` en `sip.conf` y `asterisk -rx "core reload"`. |
| El agente no puede marcar a mano («not allowed to place manual dial calls») | Permiso «Agent Call Manual» del usuario: `agentcall_manual=1`. EnVoip System lo activa al crear agentes. |
| Cliente oye al agente muy bajo o entrecortado | Comprueba que `asterisk -rx "module show like codec_opus"` diga *Running* (si no, reinicia Asterisk una vez), que el teléfono muestre `Codecs: (opus\|ulaw)` en `sip show peer EXT`, y que el agente use la app 1.0.8+ o el navegador con buena conexión. |
| Voz en un solo sentido con la app (Mac) | App anterior a 1.0.7: le faltaba el permiso de red para el audio UDP. Actualízala. |
| El agente está «Disponible» y no le llegan llamadas automáticas | En `vicidial_live_agents` aparece como `CLOSER`: el agente está solo para entrantes. Los agentes deben tener «blended» (`closer_default_blended=1`, `agent_choose_ingroups=0`); EnVoip System lo pone al crearlos. Tras cambiarlo, el agente debe reconectarse. |
| Se queda en «Cliente colgó» y no deja calificar | Versiones anteriores: vicidial.php esperaba el botón «Finish and Disposition Call». EnVoip System lo pulsa solo desde esta versión; recarga la página. |
| El admin clásico muestra «COPYRIGHT TRADEMARK LICENSE» y no deja crear nada | Asistente de primer inicio pendiente. Ejecuta el script de instalación (paso 8d) en lugar del asistente: el asistente cambia la contraseña de todos los teléfonos. |
| Leads cargados con zona horaria 0 | Faltan las tablas de prefijos: `cd /usr/share/astguiclient && ./ADMIN_area_code_populate.pl` y `./ADMIN_adjust_GMTnow_on_leads.pl --singlelistid=LISTA`. |
| La app no registra la extensión detrás de Cloudflare | La app debe usar `wss://DOMINIO/ws` (443; 1.0.6+ por defecto). El 8089 no pasa por Cloudflare. Mejor aún: en la línea pon como servidor el subdominio sin proxy (`sip.tudominio.com`). |
| Teléfonos que se desconectan cada poco («UNREACHABLE» en el registro), llamadas que no salen o se cortan | Señalización a través de Cloudflare o red inestable (datos móviles). Usa el subdominio sin proxy para el WebSocket y una conexión estable (wifi o cable). |
| El agente conecta pero no oye nada | Falta HTTPS válido o el WebSocket no llega a Asterisk: `curl -i --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H 'Sec-WebSocket-Protocol: sip' https://DOMINIO/ws` debe responder `101 Switching Protocols`. Si hay voz en un solo sentido, revisa que los puertos UDP 10000-20000 estén abiertos. |
| «time synchronization problem» | Vicidial no está sincronizado con Asterisk: revisa la hora del servidor (`chronyc tracking`) y que los procesos de `screen -ls` estén vivos. Tras un reinicio, espera unos minutos. |
| «No hay teléfonos disponibles» / teléfono no válido | El usuario no tiene «Teléfono por defecto» o la extensión no existe o está inactiva (Administración → Usuarios / Teléfonos). |
| «La campaña no tiene leads para marcar» | La campaña no tiene listas activas o el hopper está vacío. Revisa Administración → Resumen. En campañas manuales se puede permitir «entrar sin leads». |
| El agente está «Disponible» pero no entran llamadas | La campaña está en marcación manual (`INBOUND_MAN`): solo recibe llamadas de la cola. Para que marque sola, ver el apartado 8. |
| La app no registra la extensión («Wrong password») | En la app se usa la **contraseña de registro** del teléfono, no la del agente. Está en Administración → Teléfonos → la extensión. |
| La app y la web se «quitan» la extensión | Usan la misma extensión. Crea la extensión de la app (apartado 9). |
| El servidor se queda bloqueado | Falta memoria. Sube la RAM a 4 GB o más. |

Guía de producción más detallada (cortafuegos, VoIP.ms, SMS, chat): [PRODUCCION.md](PRODUCCION.md).

---

## 14. Desinstalar

EnVoip System no modifica los archivos de Vicidial. Para quitarlo:

```bash
systemctl disable --now vicimodern
rm /etc/systemd/system/vicimodern.service /etc/apache2/conf.d/vicimodern.conf
systemctl daemon-reload && systemctl reload apache2
rm -rf /opt/vicimodern
```

La configuración que el script añadió en Vicidial (cola SOPORTE, carriers, usuario `apimodern`, ViciPhone
local) se puede mantener o borrar desde el admin clásico.
