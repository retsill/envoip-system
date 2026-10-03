# Novedades

## 1.0.2 — 2026-10-02

- **Varias empresas:** administradores y supervisores ven solo su empresa (usuarios, campañas, listas, leads,
  llamadas, grabaciones, informes, teléfonos, DIDs, chat), con las reglas de los grupos de usuarios de Vicidial.
- **Acceso:** la contraseña se acepta como en Vicidial (sin espacios ni los símbolos que Vicidial no admite).
- **Seguridad:** el Vicidial clásico solo se abre desde EnVoip System: la pantalla del agente con cualquier sesión
  abierta y el admin, informes y grabaciones solo con una sesión de administrador. Al cerrar sesión se cierra.
- **Dominio único:** el dominio raíz, la IP u otros nombres redirigen al dominio principal; la raíz abre EnVoip System.
- **Móvil:** menú lateral a pantalla completa, translúcido y animado; ninguna página se sale del ancho.

## 1.0.1 — 2026-10-01

Mejoras aprendidas en la primera instalación de producción.

- **Audio:** WebSocket SIP por HTTPS 443 (`/ws`, compatible con Cloudflare) reenviado a Asterisk por WSS;
  `externaddr` para evitar audio en un solo sentido; comprobación cada 30 s de los teléfonos; códec **Opus** y
  sin relleno genérico de pérdidas de Asterisk (repetía la voz del agente).
- **Instalación:** crea el grupo de sistema, completa el asistente de primer inicio de Vicidial sin resetear los
  teléfonos y carga las zonas horarias si faltan.
- **Agentes:** los nuevos se crean en modo blended (la marcación automática les llama) y con marcación manual; si el cliente cuelga se pasa
  solo a calificar; calificar espera a que Vicidial cuelgue.
- **Interfaz:** calificaciones traducidas al idioma de la web; los errores momentáneos (reinicio del servicio) no se muestran.
- **Guía:** IP fija en VPS sin DHCP, varias empresas con subcuentas independientes, cortafuegos SIP y calidad de audio.

## 1.0.0 — 2026-09-30

Primera versión pública.

**Agentes**
- Inicio de sesión único: la sesión clásica de Vicidial funciona oculta, sin pedir los datos dos veces.
- Elegir campaña y dónde recibir las llamadas (navegador o app EnVoIP Phone); cambiar de campaña sin salir.
- Pausas con motivo, colgar, marcación manual, «siguiente lead», calificaciones y rellamadas.
- Ficha del cliente editable con historial; llamadas recientes para volver a llamar con un clic.

**Supervisión**
- Agentes, cola y campañas en tiempo real; escuchar, susurrar e intervenir llamadas.
- Pausar, reanudar y desconectar agentes; llamadas por hora y resultados del día.

**Leads y listas**
- Crear, editar, reiniciar y borrar listas; importar CSV con mapeo de columnas y control de duplicados.
- Búsqueda avanzada de leads, ver todos los números de una lista o campaña y descarga en CSV.
- Ficha completa del lead con edición, historial de llamadas y grabaciones.

**Administración**
- Usuarios (con duplicado), teléfonos WebRTC y extensiones para la app, campañas, números entrantes,
  agentes remotos, grabaciones, reportes con CSV y lista negra.
- Resumen con la salud del sistema y avisos de configuración.

**Comunicación**
- Centro de SMS/MMS con VoIP.ms, unido a los leads, con baja automática por STOP.
- Chat interno de Vicidial entre agentes y supervisores.

**General**
- Español e inglés (interfaz y mensajes del servidor), tema claro y oscuro, confirmaciones en ventanas modales.
- Script de instalación idempotente para ViciBox 12 (`deploy/provision_vicibox.sh`).
