# Paso a producción — EnVoip System + VoIP.ms

> Instalación paso a paso, requisitos y solución de problemas: **[INSTALACION.md](INSTALACION.md)**.

Todo lo configurado en el laboratorio se reproduce con **un solo script**
(`deploy/provision_vicibox.sh`). Esta guía cubre lo que el script no puede hacer por ti.

## 1. Servidor
1. Instalar **ViciBox 12** (igual que en el laboratorio) y completar su asistente.
2. Apuntar un dominio al servidor, p. ej. `pbx.tudominio.com`.
3. Certificado válido (Let's Encrypt) para ese dominio:
   - Apache: el que genera ViciBox (`vicibox-ssl` o certbot).
   - Asterisk (`/etc/asterisk/http.conf`, puerto 8089): `tlscertfile` y `tlsprivatekey` apuntando al mismo certificado.
     Sin esto el audio WebRTC de los navegadores y de la app no conectará.
4. Cortafuegos:
   | Puerto | Para qué | Abierto a |
   |---|---|---|
   | 443/tcp | Web (EnVoip System y Vicidial) | Todos |
   | 8089/tcp | SIP por WebSocket (webphones y EnVoIP Phone) | Todos |
   | 10000-20000/udp | Audio (RTP) | Todos |
   | 5060/udp | SIP con el proveedor | **Solo servidores de voip.ms** |
   | 22/tcp | SSH | Solo tu IP |

## 2. Instalar EnVoip System y toda la configuración
```bash
# En el servidor, como root
git clone https://github.com/retsill/envoip-system.git /opt/vicimodern
cd /opt/vicimodern
PUBLIC_HOST=pbx.tudominio.com bash deploy/provision_vicibox.sh
```
El script deja listo:
- ViciPhone 3.0 servido desde el propio servidor (`/viciphone/`), sin depender de phone.viciphone.com.
- URL WebSocket `wss://pbx.tudominio.com:8089/ws` y plantilla `VICIphoneSIP` con `context=default`.
- Carrier `INTERNAL_EXT`: el agente marca extensiones internas (9 + 1 + ext.).
- Carrier `VOIPMS` **desactivado**, con marcadores.
- Cola `SOPORTE` y extensión interna **7000** → SOPORTE.
- Campañas en `INBOUND_MAN` con entrada permitida (marcan a mano y reciben la cola).
- Agentes con la cola SOPORTE asignada (sin ventana de selección).
- Usuario de API `apimodern`, usuario MySQL de solo lectura y la app web en `https://pbx.tudominio.com/modern/`.

Se puede volver a ejecutar cuando quieras: no duplica nada ni cambia contraseñas ya generadas.

## 3. VoIP.ms
1. En voip.ms → **Sub Accounts → Create Sub Account**:
   - Protocol: SIP · Authentication Type: User/Password · Device Type: *Asterisk, IP PBX, Gateway or VoIP Switch*.
   - Anota el usuario (tipo `123456_envoip`) y la contraseña.
   - Elige el servidor POP más cercano (p. ej. `atlanta1.voip.ms`).
2. En EnVoip System (o Admin clásico) → **Carriers → VOIPMS**: sustituye `VOIPMS_USER`, `VOIPMS_PASS`
   y `VOIPMS_SERVER` en *Registration String* y *Account Entry*, y pon **Active = Y**.
   Comprueba el registro con `asterisk -rx "sip show registry"`.
3. Marcación saliente ya preparada en el carrier:
   - EE. UU./Canadá: el agente marca el número de 10 dígitos (la campaña añade 9 + 1).
   - Internacional: 9 + 011 + número.
4. **Números entrantes (DIDs)**: en voip.ms, cada DID → *Routing: SIP/IAX* a la subcuenta.
   En EnVoip System → **Administración → Números entrantes**: crea un DID por número (tal como llega,
   p. ej. `13055551234`) con destino **Cola de agentes → SOPORTE**.
   Si una llamada de prueba no llega, mira en `/var/log/asterisk/messages` qué número usa voip.ms como destino
   (a veces llega la subcuenta en lugar del DID) y crea el DID con ese valor.
5. **Caller ID**: en cada campaña, *Caller ID saliente* = uno de tus DIDs de voip.ms (voip.ms rechaza IDs que no son tuyos).

## 4. Dar de alta el equipo
Desde **Administración** en EnVoip System:
1. **Teléfonos → Nuevo**: una extensión por agente (se crea como webphone WebRTC).
2. **Usuarios**: crea el primer agente y el resto con **«Duplicar este usuario»** (hereda cola, permisos y opciones).
3. **Campañas**: crea la campaña en el admin clásico (botón «Nueva campaña») y ajústala desde aquí;
   vuelve a ejecutar el script para que reciba la cola SOPORTE.

## 5. EnVoIP Phone (app de escritorio y móvil)
Una extensión SIP solo puede estar registrada en **un** dispositivo: si el webphone del navegador y la app usan
la misma (p. ej. 1001), se quitan el registro entre ellos y las llamadas llegan a uno u otro al azar.
Por eso cada agente que quiera usar la app tiene **dos extensiones**: la del navegador (1001) y la de la app,
que es **5 + la suya** (51001).
1. EnVoip System → **Administración → Teléfonos** → abre la extensión del agente → **Crear extensión para la app**.
2. Abre la nueva (51001): muestra servidor, extensión y contraseña de registro para la app.
3. En la app: Líneas → Añadir → *Vicidial / ViciBox* con esos datos. Con certificado válido, desactiva
   «Aceptar certificados autofirmados» (opciones avanzadas).
4. Al conectarse en la web, el agente elige **Recibir las llamadas en: Navegador / App EnVoIP Phone**.
   Con «App», Vicidial llama a la 51001 y la app contesta sola esa llamada de sesión (no hace falta activar
   «Contestar automáticamente»); las demás llamadas suenan normal.
- Llamar a la cola de agentes desde la app: marcar **7000**.

## 6. Mensajes SMS/MMS con clientes
El servidor es el **centro de mensajes**: la web (bandeja «Mensajes» y pestaña «Mensajes» en la ficha del
cliente) y la app EnVoIP Phone (modo «Servidor EnVoip System») comparten las mismas conversaciones.
1. voip.ms → Main Menu → **SOAP and REST/JSON API**: activar la API, poner una contraseña de API y autorizar la
   **IP pública del servidor**.
2. voip.ms → DID Numbers → cada DID: activar **SMS/MMS**. (EE. UU./Canadá: registro 10DLC y consentimiento del cliente.)
3. EnVoip System → **Administración → Mensajería SMS**: usuario y contraseña de API, DIDs, «Probar conexión», activar.
4. En el mismo DID de voip.ms → **SMS/MMS URL Callback**: pegar la URL que muestra esa pantalla (llegada instantánea).
   Sin acceso desde Internet, el servidor consulta voip.ms cada minuto igualmente.
- Cada mensaje se une al lead de Vicidial por su teléfono. Si el cliente responde **STOP / BAJA**, el número pasa
  a la lista negra del sistema y recibe una confirmación.
- Los mensajes se guardan en la base de datos propia `envoip` (el script la crea); las imágenes enviadas, en
  `/opt/vicimodern/data/sms-media`.

## 7. Chat interno
Activado por el script (`allow_chats`). En EnVoip System → **Chat interno** los agentes y supervisores chatean entre
sí; es el mismo chat de Vicidial (se ve también en la pestaña «CHAT INTERNAL» de la pantalla clásica).
Vicidial solo permite abrir chats con agentes **conectados**.

## Cómo funciona una llamada (referencia rápida)
- **Cliente o app → cola**: DID o 7000 → `trunkinbound` → cola SOPORTE → agente disponible (estado *CLOSER*).
  El agente la ve en su pantalla con la ficha del cliente.
- **Agente → número**: botón llamar → Vicidial marca 9 + 1 + número → carrier (VOIPMS o INTERNAL_EXT).
- **No llamar directamente a la extensión de un agente conectado**: su teléfono está dentro de su sesión;
  las llamadas para agentes deben entrar por una cola.
