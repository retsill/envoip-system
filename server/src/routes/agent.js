import { Router } from 'express';
import { all, db, one, saleStatuses } from '../db.js';
import { agentApi } from '../vici.js';
import { ah, digits, HttpError, str } from '../util.js';

// Pantalla de agente. El agente siempre es el usuario de la sesión: nunca se acepta desde el cliente.
const router = Router();

const LEAD_FIELDS = [
  'title', 'first_name', 'middle_initial', 'last_name', 'phone_code', 'phone_number', 'alt_phone',
  'address1', 'address2', 'address3', 'city', 'state', 'province', 'postal_code', 'country_code',
  'email', 'date_of_birth', 'gender', 'vendor_lead_code', 'source_id', 'security_phrase', 'comments',
];

router.get(
  '/state',
  ah(async (req, res) => {
    const me = req.user.user;
    const sales = await saleStatuses();
    const [agent, stats] = await Promise.all([
      one(
        `SELECT la.status, la.lead_id, la.campaign_id, c.campaign_name, la.calls_today, la.pause_code,
                la.comments, la.callerid, la.preview_lead_id,
                TIMESTAMPDIFF(SECOND, la.last_state_change, NOW()) AS state_secs,
                (SELECT COUNT(*) FROM vicidial_auto_calls ac WHERE ac.callerid = la.callerid) AS has_call
         FROM vicidial_live_agents la LEFT JOIN vicidial_campaigns c USING (campaign_id)
         WHERE la.user = ?`,
        [me]
      ),
      one(
        `SELECT COUNT(IF(lead_id > 0, 1, NULL)) calls, IFNULL(SUM(talk_sec),0) talk, IFNULL(SUM(pause_sec),0) pause,
                IFNULL(SUM(wait_sec),0) wait, IFNULL(SUM(dispo_sec),0) dispo, IFNULL(SUM(status IN (?)),0) sales
         FROM vicidial_agent_log WHERE user = ? AND event_time >= CURDATE()`,
        [sales, me]
      ),
    ]);
    const s = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, Number(v)]));
    if (!agent) return res.json({ loggedIn: false, stats: s });

    const leadId = agent.lead_id > 0 ? agent.lead_id : agent.preview_lead_id > 0 ? agent.preview_lead_id : 0;
    let lead = null;
    let history = [];
    if (leadId) {
      [lead, history] = await Promise.all([
        one(`SELECT lead_id, list_id, status, called_count, entry_date, last_local_call_time, ${LEAD_FIELDS.join(',')}
             FROM vicidial_list WHERE lead_id = ?`, [leadId]),
        all(`SELECT call_date, status, length_in_sec, user, campaign_id, 'OUT' dir FROM vicidial_log WHERE lead_id = ?
             UNION ALL
             SELECT call_date, status, length_in_sec, user, campaign_id, 'IN' dir FROM vicidial_closer_log WHERE lead_id = ?
             ORDER BY call_date DESC LIMIT 15`, [leadId, leadId]),
      ]);
    }

    // Estado "visible" igual que el reporte en tiempo real de Vicidial
    let status = agent.status;
    if (status === 'PAUSED' && agent.lead_id > 0) status = 'DISPO';
    else if (status === 'INCALL' && !agent.has_call && !/^M\d/.test(agent.comments || '') && agent.comments !== 'MANUAL') status = 'DEAD';

    res.json({
      loggedIn: true,
      agent: { ...agent, status, raw_status: agent.status, has_call: undefined },
      lead,
      history,
      stats: s,
    });
  })
);

// ¿Está el teléfono del agente dentro de su sala de sesión? Lo usa el navegador para resolver solo
// el aviso «No one is in your session» de la pantalla clásica oculta.
router.get(
  '/phone-status',
  ah(async (req, res) => {
    // extension = «SIP/1001» o «SIP/51001»: el teléfono con el que el agente inició esta sesión (navegador o app)
    const la = await one('SELECT conf_exten, extension FROM vicidial_live_agents WHERE user = ?', [req.user.user]);
    if (!la?.extension) return res.json({ loggedIn: Boolean(la), inSession: false });
    const ch = await one('SELECT COUNT(*) n FROM live_sip_channels WHERE extension = ? AND channel LIKE ?', [
      la.conf_exten,
      `${la.extension}-%`,
    ]);
    res.json({ loggedIn: true, inSession: Number(ch.n) > 0 });
  })
);

// Últimas llamadas del agente (salientes y entrantes), para volver a llamar con un clic
router.get(
  '/recent-calls',
  ah(async (req, res) => {
    const rows = await all(
      `SELECT t.call_date, t.dir, t.status, t.length_in_sec, t.lead_id, t.phone_code, t.phone_number,
              TRIM(CONCAT(IFNULL(vl.first_name,''),' ',IFNULL(vl.last_name,''))) AS name,
              (SELECT status_name FROM vicidial_statuses s WHERE s.status = t.status LIMIT 1) AS status_name
       FROM (
         (SELECT call_date, 'OUT' dir, status, length_in_sec, lead_id, phone_code, phone_number
            FROM vicidial_log WHERE user = ? ORDER BY call_date DESC LIMIT 40)
         UNION ALL
         (SELECT call_date, 'IN' dir, status, length_in_sec, lead_id, phone_code, phone_number
            FROM vicidial_closer_log WHERE user = ? ORDER BY call_date DESC LIMIT 40)
       ) t
       LEFT JOIN vicidial_list vl ON vl.lead_id = t.lead_id
       ORDER BY t.call_date DESC LIMIT 40`,
      [req.user.user, req.user.user]
    );
    res.json(rows);
  })
);

// Campañas en las que el agente puede entrar (activas y permitidas por su grupo)
async function allowedCampaigns(user) {
  const u = await one(
    `SELECT u.phone_login, g.allowed_campaigns FROM vicidial_users u
     LEFT JOIN vicidial_user_groups g ON g.user_group = u.user_group WHERE u.user = ? AND u.active = 'Y'`,
    [user]
  );
  if (!u) throw new HttpError(401, 'Usuario inactivo');
  const allowed = ` ${u.allowed_campaigns || ''} `;
  const camps = await all("SELECT campaign_id, campaign_name FROM vicidial_campaigns WHERE active = 'Y' ORDER BY campaign_id");
  return {
    phoneLogin: u.phone_login || '',
    campaigns: allowed.includes(' -ALL-CAMPAIGNS- ') ? camps : camps.filter((c) => allowed.includes(` ${c.campaign_id} `)),
  };
}

// Teléfono del agente en la app EnVoIP Phone: una segunda extensión «5» + la del navegador (1001 → 51001).
// Así el webphone del navegador y la app pueden estar conectados a la vez sin quitarse el registro,
// y al conectarse el agente elige dónde quiere recibir el audio.
export const appPhoneLogin = (phoneLogin) => `5${phoneLogin}`;

function appPhone(phoneLogin) {
  if (!phoneLogin) return null;
  return one("SELECT login, pass, extension, protocol FROM phones WHERE login = ? AND active = 'Y'", [appPhoneLogin(phoneLogin)]);
}

router.get(
  '/login-options',
  ah(async (req, res) => {
    const { phoneLogin, campaigns } = await allowedCampaigns(req.user.user);
    const phone = phoneLogin ? await one("SELECT login FROM phones WHERE login = ? AND active = 'Y'", [phoneLogin]) : null;
    const app = await appPhone(phoneLogin);
    res.json({ campaigns, phone_login: phoneLogin, phone_ok: Boolean(phone), app_phone: app ? app.extension : null });
  })
);

// Datos para iniciar la sesión clásica oculta sin que el agente la vea.
// La contraseña del usuario no se devuelve nunca: la aporta el navegador del propio agente.
router.post(
  '/classic-login',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { phoneLogin, campaigns } = await allowedCampaigns(req.user.user);
    const campaign = str(req.body?.campaign_id, { max: 8, name: 'campaña' });
    if (!campaigns.some((c) => c.campaign_id === campaign)) throw new HttpError(403, 'No tienes acceso a esa campaña o no está activa');
    if (!phoneLogin) throw new HttpError(400, 'Tu usuario no tiene un teléfono asignado. Pide al administrador que te asigne uno (Admin → Usuarios).');
    const useApp = req.body?.device === 'app';
    const phone = useApp
      ? await appPhone(phoneLogin)
      : await one("SELECT login, pass, extension, protocol FROM phones WHERE login = ? AND active = 'Y'", [phoneLogin]);
    if (!phone) {
      throw new HttpError(
        400,
        useApp
          ? 'No tienes extensión para la app ({ext}). Pide al administrador que la cree en Administración → Teléfonos.'
          : 'El teléfono {phone} asignado a tu usuario no existe o está inactivo.',
        { ext: appPhoneLogin(phoneLogin), phone: phoneLogin }
      );
    }
    // Si el teléfono sigue con una llamada abierta (p. ej. la de una sesión anterior tras recargar la página),
    // Vicidial confundiría ese canal con el del agente y al colgar cortaría el audio del agente.
    // Asterisk lo libera solo en <= 60 s (rtptimeout): el navegador espera y reintenta.
    const busy = await all('SELECT channel FROM live_sip_channels WHERE channel LIKE ? OR channel LIKE ?', [
      `SIP/${phone.extension}-%`,
      `PJSIP/${phone.extension}-%`,
    ]);
    if (busy.length) {
      return res.status(409).json({
        error: req.t('Cerrando la conexión anterior de tu teléfono… (puede tardar hasta un minuto)'),
        retryAfter: 5,
      });
    }
    res.json({ phone_login: phone.login, phone_pass: phone.pass, VD_login: req.user.user, VD_campaign: campaign });
  })
);

// Calificaciones y códigos de pausa de la campaña actual
router.get(
  '/options',
  ah(async (req, res) => {
    const la = await one('SELECT campaign_id FROM vicidial_live_agents WHERE user = ?', [req.user.user]);
    const camp = la?.campaign_id || '';
    const [statuses, pauseCodes] = await Promise.all([
      all(
        `SELECT status, status_name, scheduled_callback, sale FROM vicidial_statuses WHERE selectable = 'Y'
         UNION
         SELECT status, status_name, scheduled_callback, sale FROM vicidial_campaign_statuses
         WHERE selectable = 'Y' AND campaign_id = ?
         ORDER BY status`,
        [camp]
      ),
      all('SELECT pause_code, pause_code_name FROM vicidial_pause_codes WHERE campaign_id = ? ORDER BY pause_code', [camp]),
    ]);
    res.json({ campaign_id: camp, statuses, pauseCodes });
  })
);

const action = (fn, build) =>
  ah(async (req, res) => {
    const params = build(req.body || {});
    const message = await agentApi(req.user.user, fn, params);
    res.json({ ok: true, message });
  });

router.post('/pause', action('external_pause', (b) => ({ value: b.action === 'RESUME' ? 'RESUME' : 'PAUSE' })));

router.post(
  '/pause-code',
  action('pause_code', (b) => ({ value: str(b.code, { max: 6, re: /^[A-Za-z0-9_-]+$/, name: 'código de pausa' }) }))
);

router.post('/hangup', action('external_hangup', () => ({ value: '1' })));

router.post(
  '/dial',
  action('external_dial', (b) => {
    const common = { search: 'YES', preview: 'NO', focus: 'NO' };
    if (b.next) return { ...common, value: 'MANUALNEXT' };
    if (b.lead_id) return { ...common, lead_id: digits(b.lead_id), value: '' };
    const phone = digits(b.phone);
    if (phone.length < 2 || phone.length > 18) throw new HttpError(400, 'Número de teléfono no válido');
    const code = digits(b.phone_code) || '1';
    if (code.length > 4) throw new HttpError(400, 'Código de país no válido');
    return { ...common, value: phone, phone_code: code };
  })
);

router.post(
  '/dispo',
  action('external_status', (b) => {
    const p = { value: str(b.status, { max: 6, re: /^[A-Za-z0-9_-]+$/, name: 'calificación' }) };
    if (b.callback_datetime) {
      const m = String(b.callback_datetime).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?$/);
      if (!m) throw new HttpError(400, 'Fecha de rellamada no válida');
      p.callback_datetime = `${m[1]} ${m[2]}${m[3] || ':00'}`;
      p.callback_type = b.callback_type === 'USERONLY' ? 'USERONLY' : 'ANYONE';
      if (b.callback_comments) p.callback_comments = String(b.callback_comments).slice(0, 199);
    }
    return p;
  })
);

router.post(
  '/fields',
  action('update_fields', (b) => {
    const p = {};
    for (const f of LEAD_FIELDS) if (b.fields && f in b.fields) p[f] = String(b.fields[f] ?? '').slice(0, 255);
    if (!Object.keys(p).length) throw new HttpError(400, 'No hay cambios que guardar');
    return p;
  })
);

router.post('/recording', action('recording', (b) => ({ value: b.action === 'STOP' ? 'STOP' : 'START' })));

router.post('/logout', action('logout', () => ({ value: 'LOGOUT' })));

// ---------------------------------------------------------------- Rellamadas programadas
// Vicidial no marca solas las rellamadas «solo para mí» (USERONLY) en campañas automáticas: las muestra en la
// pantalla clásica, que aquí va oculta. La web las lista y avisa (y marca) cuando llega la hora.
// Una rellamada está hecha si al cliente se le llamó (saliente o entrante) después de programarla, o si ya no
// está marcado para rellamar (otra calificación). Vicidial solo las cierra si se califica con otra rellamada.
const CB_DONE = `(vl.status NOT IN ('CALLBK','CBHOLD')
  OR EXISTS (SELECT 1 FROM vicidial_log l WHERE l.lead_id = cb.lead_id AND l.call_date > cb.entry_time)
  OR EXISTS (SELECT 1 FROM vicidial_closer_log l WHERE l.lead_id = cb.lead_id AND l.call_date > cb.entry_time))`;

router.get(
  '/callbacks',
  ah(async (req, res) => {
    // Cerrar las ya hechas (el usuario MySQL de la app solo puede cambiar status)
    const done = await all(
      `SELECT cb.callback_id FROM vicidial_callbacks cb JOIN vicidial_list vl ON vl.lead_id = cb.lead_id
       WHERE cb.user = ? AND cb.status IN ('ACTIVE','LIVE') AND ${CB_DONE}`,
      [req.user.user]
    );
    if (done.length) {
      await db
        .query("UPDATE vicidial_callbacks SET status = 'INACTIVE' WHERE callback_id IN (?) AND user = ?", [done.map((r) => r.callback_id), req.user.user])
        .catch((e) => console.error('rellamadas hechas', e.message));
    }
    const rows = await all(
      `SELECT cb.callback_id, cb.lead_id, cb.campaign_id, cb.status, cb.recipient, cb.callback_time, cb.comments,
              cb.callback_time <= NOW() AS due, vl.phone_number, vl.phone_code,
              TRIM(CONCAT(IFNULL(vl.first_name,''),' ',IFNULL(vl.last_name,''))) AS name
       FROM vicidial_callbacks cb LEFT JOIN vicidial_list vl ON vl.lead_id = cb.lead_id
       WHERE cb.user = ? AND cb.status IN ('ACTIVE','LIVE') AND vl.lead_id IS NOT NULL AND NOT ${CB_DONE}
       ORDER BY cb.callback_time LIMIT 200`,
      [req.user.user]
    );
    res.json(rows.map((r) => ({ ...r, due: Boolean(Number(r.due)) })));
  })
);

// Marca la rellamada (con el mismo lead, para conservar su historial) y la da por hecha
router.post(
  '/callbacks/:id/dial',
  ah(async (req, res) => {
    const cb = await one("SELECT callback_id, lead_id FROM vicidial_callbacks WHERE callback_id = ? AND user = ? AND status IN ('ACTIVE','LIVE')", [
      Number(req.params.id) || 0,
      req.user.user,
    ]);
    if (!cb) throw new HttpError(404, 'Rellamada no encontrada');
    const message = await agentApi(req.user.user, 'external_dial', { lead_id: cb.lead_id, value: '', search: 'YES', preview: 'NO', focus: 'NO' });
    // El usuario MySQL de la app solo puede cambiar esta columna (provision_vicibox.sh)
    await db
      .query("UPDATE vicidial_callbacks SET status = 'INACTIVE' WHERE callback_id = ? AND user = ?", [cb.callback_id, req.user.user])
      .catch((e) => console.error('rellamada', e.message));
    res.json({ ok: true, message });
  })
);

export default router;
