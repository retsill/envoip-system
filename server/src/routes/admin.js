import { Router } from 'express';
import crypto from 'node:crypto';
import { all, db, one, saleStatuses } from '../db.js';
import { nonAgentApi } from '../vici.js';
import { assertCanManageLevel, loadPerms, requirePerm } from '../perms.js';
import { ah, digits, HttpError, str } from '../util.js';
import { appPhoneLogin } from './agent.js';

const router = Router();

// Usuarios internos de Vicidial y el usuario de API: no se editan desde aquí
const PROTECTED_USERS = new Set(['VDAD', 'VDCL', process.env.VICI_API_USER]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LEAD_ORDERS = [
  'DOWN', 'UP', 'RANDOM', 'DOWN COUNT', 'UP COUNT', 'DOWN PHONE', 'UP PHONE', 'DOWN LAST NAME', 'UP LAST NAME',
  'DOWN LAST CALL TIME', 'UP LAST CALL TIME', 'DOWN RANK', 'UP RANK', 'DOWN TIMEZONE', 'UP TIMEZONE',
];
const DIAL_METHODS = ['MANUAL', 'RATIO', 'INBOUND_MAN', 'ADAPT_AVERAGE', 'ADAPT_HARD_LIMIT', 'ADAPT_TAPERED'];

async function mainServer() {
  const s = await one("SELECT server_ip, local_gmt FROM servers WHERE active_asterisk_server = 'Y' ORDER BY server_ip LIMIT 1");
  if (!s) throw new HttpError(500, 'No hay servidor Asterisk activo');
  return s;
}

// ---------------------------------------------------------------- Resumen
router.get(
  '/summary',
  ah(async (req, res) => {
    const [counts, updater, server, carriers, campaigns, badPhones, lockedUsers, leads] = await Promise.all([
      one(`SELECT
             (SELECT COUNT(*) FROM vicidial_users WHERE active='Y' AND user NOT IN ('VDAD','VDCL') AND api_only_user<>'1') users,
             (SELECT COUNT(*) FROM vicidial_users WHERE active='Y' AND user_level < 7 AND api_only_user<>'1' AND user NOT IN ('VDAD','VDCL')) agents,
             (SELECT COUNT(*) FROM vicidial_live_agents) logged,
             (SELECT COUNT(*) FROM phones WHERE active='Y') phones,
             (SELECT COUNT(*) FROM vicidial_campaigns WHERE active='Y') campaigns,
             (SELECT COUNT(*) FROM vicidial_lists WHERE active='Y') lists,
             (SELECT COUNT(*) FROM vicidial_log WHERE call_date >= CURDATE()) + (SELECT COUNT(*) FROM vicidial_closer_log WHERE call_date >= CURDATE()) calls_today,
             (SELECT COUNT(*) FROM recording_log WHERE start_time >= CURDATE()) recordings_today`),
      one('SELECT last_update, TIMESTAMPDIFF(SECOND, last_update, NOW()) lag FROM server_updater ORDER BY last_update DESC LIMIT 1'),
      one("SELECT server_ip, server_description, asterisk_version, max_vicidial_trunks FROM servers WHERE active_asterisk_server='Y' LIMIT 1"),
      all("SELECT carrier_id, carrier_name, active, protocol FROM vicidial_server_carriers ORDER BY active DESC, carrier_id"),
      all(`SELECT c.campaign_id, c.campaign_name, c.dial_method,
                  (SELECT COUNT(*) FROM vicidial_lists l WHERE l.campaign_id = c.campaign_id AND l.active = 'Y') active_lists,
                  (SELECT COUNT(*) FROM vicidial_hopper h WHERE h.campaign_id = c.campaign_id) hopper,
                  IFNULL(s.dialable_leads, 0) dialable
           FROM vicidial_campaigns c LEFT JOIN vicidial_campaign_stats s USING (campaign_id)
           WHERE c.active = 'Y'`),
      all("SELECT extension FROM phones WHERE active='Y' AND is_webphone IN ('Y','Y_API_LAUNCH') AND (template_id IS NULL OR template_id = '' OR template_id NOT LIKE '%WebRTC%' AND template_id NOT LIKE 'VICIphone%')"),
      all("SELECT user, full_name, failed_login_count FROM vicidial_users WHERE failed_login_count >= 5 AND active='Y'"),
      one('SELECT COUNT(*) total FROM vicidial_list'),
    ]);

    const warnings = [];
    if (!updater || updater.lag > 30)
      warnings.push({ level: 'error', text: req.t('Vicidial no está sincronizado con Asterisk (última actualización hace {lag} s). Los agentes verán «time synchronization problem» y no se podrán hacer llamadas.', { lag: updater ? updater.lag : '∞' }) });
    if (!carriers.some((c) => c.active === 'Y'))
      warnings.push({ level: 'warn', text: req.t('No hay ningún carrier (troncal SIP) activo: las llamadas no pueden salir a teléfonos externos.'), link: '/vicidial/admin.php?ADD=140000000000' });
    for (const c of campaigns) {
      if (!Number(c.active_lists))
        warnings.push({ level: 'warn', text: req.t('La campaña {id} ({name}) no tiene listas activas.', { id: c.campaign_id, name: c.campaign_name }) });
      else if (c.dial_method !== 'MANUAL' && !Number(c.hopper))
        warnings.push({ level: 'warn', text: req.t('La campaña {id} tiene el hopper vacío: no hay leads para marcar.', { id: c.campaign_id }) });
    }
    for (const p of badPhones)
      warnings.push({ level: 'warn', text: req.t('El teléfono {ext} es webphone pero no tiene plantilla WebRTC: el audio del navegador no funcionará.', { ext: p.extension }) });
    for (const u of lockedUsers)
      warnings.push({ level: 'info', text: req.t('{name} ({user}) tiene {n} intentos fallidos de acceso.', { name: u.full_name, user: u.user, n: u.failed_login_count }) });

    res.json({
      counts: { ...Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v)])), leads: Number(leads.total) },
      sync: updater ? { last_update: updater.last_update, lag: Number(updater.lag) } : null,
      server,
      carriers,
      warnings,
    });
  })
);

// Datos para los formularios
router.get(
  '/meta',
  ah(async (req, res) => {
    const [groups, campaigns, callTimes, templates, perms] = await Promise.all([
      all('SELECT user_group, group_name FROM vicidial_user_groups ORDER BY user_group'),
      all('SELECT campaign_id, campaign_name, active FROM vicidial_campaigns ORDER BY campaign_id'),
      all('SELECT call_time_id, call_time_name FROM vicidial_call_times ORDER BY call_time_id'),
      all('SELECT template_id, template_name FROM vicidial_conf_templates ORDER BY template_id'),
      loadPerms(req.user.user),
    ]);
    res.json({ groups, campaigns, callTimes, templates, leadOrders: LEAD_ORDERS, dialMethods: DIAL_METHODS, perms });
  })
);

// ---------------------------------------------------------------- Usuarios
router.get(
  '/users',
  requirePerm('modify_users'),
  ah(async (req, res) => {
    const rows = await all(`
      SELECT u.user, u.full_name, u.user_level, u.user_group, u.active, u.phone_login, u.email, u.last_login_date,
             u.failed_login_count, u.api_only_user, (la.user IS NOT NULL) logged_in, la.campaign_id
      FROM vicidial_users u LEFT JOIN vicidial_live_agents la ON la.user = u.user
      WHERE u.user NOT IN ('VDAD','VDCL')
      ORDER BY u.active DESC, u.user_level DESC, u.user`);
    res.json(rows.map((r) => ({ ...r, logged_in: Boolean(r.logged_in), protected: PROTECTED_USERS.has(r.user) })));
  })
);

function userFields(b, { creating }) {
  const p = {};
  const pass = str(b.pass, { max: 20, re: /^[A-Za-z0-9_.@#-]+$/, name: 'contraseña', required: creating });
  if (pass) {
    if (pass.length < 6) throw new HttpError(400, 'La contraseña debe tener al menos 6 caracteres');
    p.agent_pass = pass;
  }
  const name = str(b.full_name, { max: 50, name: 'nombre', required: creating });
  if (name) p.agent_full_name = name;
  if (b.user_level !== undefined) {
    const lvl = Number(b.user_level);
    if (!(lvl >= 1 && lvl <= 9)) throw new HttpError(400, 'Nivel no válido');
    p.agent_user_level = lvl;
  } else if (creating) throw new HttpError(400, 'Falta el nivel');
  const group = str(b.user_group, { max: 20, name: 'grupo', required: creating });
  if (group) p.agent_user_group = group;
  if (b.phone_login !== undefined && b.phone_login !== '') p.phone_login = str(b.phone_login, { max: 20, re: /^[A-Za-z0-9]+$/, name: 'teléfono' });
  if (b.phone_pass) p.phone_pass = str(b.phone_pass, { max: 20, re: /^[A-Za-z0-9_.@#-]+$/, name: 'contraseña del teléfono' });
  if (b.email) p.email = str(b.email, { max: 100, re: /^[^\s@]+@[^\s@]+$/, name: 'email' });
  return p;
}

router.post(
  '/users',
  requirePerm('modify_users'),
  ah(async (req, res) => {
    const b = req.body || {};
    const user = str(b.user, { max: 20, re: /^[A-Za-z0-9]{2,20}$/, name: 'usuario (2-20 letras o números)' });
    const p = userFields(b, { creating: true });
    assertCanManageLevel(req.perms, p.agent_user_level);
    const message = await nonAgentApi('add_user', { agent_user: user, ...p });
    // Agentes: sin ventana de elegir colas (bloquearía la conexión automática) y en modo «blended»
    // (entrantes y salientes). Sin esto Vicidial los deja solo para entrantes y la marcación automática no les llama.
    // La API de Vicidial no permite cambiar estas opciones: el usuario MySQL de la app tiene permiso de
    // escritura SOLO sobre estas columnas (lo concede provision_vicibox.sh). agentcall_manual = marcación manual.
    if (Number(p.agent_user_level) < 7) {
      await db
        .query("UPDATE vicidial_users SET agent_choose_ingroups='0', agent_choose_blended='0', closer_default_blended='1', agentcall_manual='1' WHERE user = ?", [user])
        .catch((e) => console.error('blended', e.message));
    }
    res.json({ ok: true, message });
  })
);

router.patch(
  '/users/:user',
  requirePerm('modify_users'),
  ah(async (req, res) => {
    const target = req.params.user;
    if (PROTECTED_USERS.has(target)) throw new HttpError(403, 'Este usuario del sistema no se puede editar aquí');
    const current = await one('SELECT user_level FROM vicidial_users WHERE user = ?', [target]);
    if (!current) throw new HttpError(404, 'Usuario no encontrado');
    assertCanManageLevel(req.perms, current.user_level);

    const b = req.body || {};
    const p = userFields(b, { creating: false });
    if (p.agent_user_level !== undefined) assertCanManageLevel(req.perms, p.agent_user_level);
    if (b.active !== undefined) p.active = b.active ? 'Y' : 'N';
    if (target === req.user.user) {
      if (p.active === 'N') throw new HttpError(400, 'No puedes desactivar tu propio usuario');
      if (p.agent_user_level !== undefined && p.agent_user_level < Number(current.user_level))
        throw new HttpError(400, 'No puedes bajar tu propio nivel desde aquí');
    }
    if (!Object.keys(p).length) throw new HttpError(400, 'No hay cambios');
    const message = await nonAgentApi('update_user', { agent_user: target, ...p });
    res.json({ ok: true, message });
  })
);

// Duplicar un usuario existente (copia todos sus permisos y opciones)
router.post(
  '/users/:user/copy',
  requirePerm('modify_users'),
  ah(async (req, res) => {
    const src = await one('SELECT user, user_level FROM vicidial_users WHERE user = ?', [req.params.user]);
    if (!src || PROTECTED_USERS.has(src.user)) throw new HttpError(404, 'Usuario de origen no válido');
    assertCanManageLevel(req.perms, src.user_level);
    const b = req.body || {};
    const user = str(b.user, { max: 20, re: /^[A-Za-z0-9]{2,20}$/, name: 'usuario (2-20 letras o números)' });
    const pass = str(b.pass, { max: 20, re: /^[A-Za-z0-9_.@#-]{6,20}$/, name: 'contraseña (mín. 6)' });
    const name = str(b.full_name, { max: 50, name: 'nombre' });
    const message = await nonAgentApi('copy_user', { agent_user: user, agent_pass: pass, agent_full_name: name, source_user: src.user });
    // copy_user no copia el teléfono: si se indica, lo asignamos
    if (b.phone_login) await nonAgentApi('update_user', { agent_user: user, phone_login: str(b.phone_login, { max: 20, re: /^[A-Za-z0-9]+$/, name: 'teléfono' }) });
    res.json({ ok: true, message });
  })
);

// ---------------------------------------------------------------- Teléfonos
router.get(
  '/phones',
  requirePerm('ast_admin_access'),
  ah(async (req, res) => {
    const rows = await all(`
      SELECT p.extension, p.login, p.fullname, p.protocol, p.server_ip, p.active, p.is_webphone, p.template_id,
             p.status, p.local_gmt, la.user logged_user,
             (SELECT GROUP_CONCAT(u.user) FROM vicidial_users u WHERE u.phone_login = p.login) assigned_users
      FROM phones p
      LEFT JOIN vicidial_live_agents la ON la.extension = CONCAT(p.protocol, '/', p.extension)
      ORDER BY p.extension`);
    res.json(rows);
  })
);

async function refreshAsterisk() {
  try {
    await nonAgentApi('server_refresh', { stage: 'REFRESH' });
  } catch {
    /* no crítico: el keepalive lo regenera igualmente */
  }
}

router.post(
  '/phones',
  requirePerm('ast_admin_access'),
  ah(async (req, res) => {
    const b = req.body || {};
    const ext = str(b.extension, { max: 20, re: /^\d{2,20}$/, name: 'extensión (solo números)' });
    const pass = str(b.pass, { max: 20, re: /^[A-Za-z0-9_.@#-]{6,20}$/, name: 'contraseña (mín. 6)' });
    const name = str(b.fullname, { max: 50, name: 'nombre', required: false }) || `Extension ${ext}`;
    const web = b.webphone !== false;
    const s = await mainServer();
    const message = await nonAgentApi('add_phone', {
      extension: ext, dialplan_number: ext, voicemail_id: ext, phone_login: ext, phone_pass: pass,
      server_ip: s.server_ip, protocol: 'SIP', registration_password: crypto.randomBytes(8).toString('hex'),
      phone_full_name: name, local_gmt: s.local_gmt, outbound_cid: '0000000000', admin_user_group: '---ALL---',
      is_webphone: web ? 'Y' : 'N', webphone_auto_answer: web ? 'Y' : 'N', ...(web ? { template_id: 'VICIphoneSIP' } : {}),
    });
    await refreshAsterisk();
    res.json({ ok: true, message });
  })
);

router.patch(
  '/phones/:ext',
  requirePerm('ast_admin_access'),
  ah(async (req, res) => {
    const ph = await one('SELECT extension, server_ip FROM phones WHERE extension = ?', [req.params.ext]);
    if (!ph) throw new HttpError(404, 'Teléfono no encontrado');
    const b = req.body || {};
    const p = {};
    if (b.pass) p.phone_pass = str(b.pass, { max: 20, re: /^[A-Za-z0-9_.@#-]{6,20}$/, name: 'contraseña (mín. 6)' });
    if (b.fullname) p.phone_full_name = str(b.fullname, { max: 50, name: 'nombre' });
    if (b.webphone !== undefined) {
      p.is_webphone = b.webphone ? 'Y' : 'N';
      p.webphone_auto_answer = b.webphone ? 'Y' : 'N';
      if (b.webphone) p.template_id = 'VICIphoneSIP';
    }
    if (!Object.keys(p).length) throw new HttpError(400, 'No hay cambios');
    const message = await nonAgentApi('update_phone', { extension: ph.extension, server_ip: ph.server_ip, ...p });
    await refreshAsterisk();
    res.json({ ok: true, message });
  })
);

// Datos para configurar la línea en la app EnVoIP Phone (o en cualquier softphone WebRTC)
router.get(
  '/phones/:ext/connect',
  requirePerm('ast_admin_access'),
  ah(async (req, res) => {
    const ph = await one('SELECT extension, login, conf_secret, is_webphone, template_id FROM phones WHERE extension = ?', [req.params.ext]);
    if (!ph) throw new HttpError(404, 'Teléfono no encontrado');
    const app = await one("SELECT extension FROM phones WHERE login = ? AND active = 'Y'", [appPhoneLogin(ph.login)]);
    res.json({
      server: (req.get('x-forwarded-host') || req.hostname).split(',')[0].trim().replace(/:443$/, ''),
      extension: ph.extension,
      password: ph.conf_secret,
      webrtc: /webrtc|viciphone/i.test(ph.template_id || ''),
      webphone: ph.is_webphone !== 'N',
      app_extension: app?.extension || null,
    });
  })
);

// Crea la extensión de la app de un teléfono del navegador (1001 → 51001): mismo usuario, dos dispositivos a la vez
router.post(
  '/phones/:ext/app',
  requirePerm('ast_admin_access'),
  ah(async (req, res) => {
    const web = await one('SELECT extension, login, fullname, server_ip, local_gmt, outbound_cid FROM phones WHERE extension = ?', [req.params.ext]);
    if (!web) throw new HttpError(404, 'Teléfono no encontrado');
    const ext = appPhoneLogin(web.login);
    if (!/^\d{2,20}$/.test(ext)) throw new HttpError(400, 'La extensión {ext} debe ser numérica para crear la de la app', { ext: web.login });
    if (await one('SELECT extension FROM phones WHERE extension = ? OR login = ?', [ext, ext])) {
      throw new HttpError(409, 'La extensión {ext} ya existe', { ext });
    }
    const message = await nonAgentApi('add_phone', {
      extension: ext, dialplan_number: ext, voicemail_id: ext, phone_login: ext,
      phone_pass: crypto.randomBytes(6).toString('hex'), registration_password: crypto.randomBytes(8).toString('hex'),
      server_ip: web.server_ip, protocol: 'SIP', phone_full_name: `App ${web.fullname || web.extension}`.slice(0, 50),
      local_gmt: web.local_gmt, outbound_cid: web.outbound_cid || '0000000000', admin_user_group: '---ALL---',
      // Sin webphone (la app no carga ViciPhone), pero con la plantilla WebRTC: la app usa WSS
      is_webphone: 'N', webphone_auto_answer: 'N', template_id: 'VICIphoneSIP',
    });
    await refreshAsterisk();
    res.json({ ok: true, extension: ext, message });
  })
);

router.delete(
  '/phones/:ext',
  requirePerm('ast_admin_access', 'ast_delete_phones'),
  ah(async (req, res) => {
    const ph = await one('SELECT extension, server_ip, protocol FROM phones WHERE extension = ?', [req.params.ext]);
    if (!ph) throw new HttpError(404, 'Teléfono no encontrado');
    const inUse = await one('SELECT user FROM vicidial_live_agents WHERE extension = ?', [`${ph.protocol}/${ph.extension}`]);
    if (inUse) throw new HttpError(409, 'El agente {user} está usando este teléfono ahora mismo', { user: inUse.user });
    const message = await nonAgentApi('update_phone', { extension: ph.extension, server_ip: ph.server_ip, delete_phone: 'Y' });
    await refreshAsterisk();
    res.json({ ok: true, message });
  })
);

// ---------------------------------------------------------------- Campañas
router.get(
  '/campaigns',
  requirePerm('modify_campaigns'),
  ah(async (req, res) => {
    const rows = await all(`
      SELECT c.campaign_id, c.campaign_name, c.active, c.dial_method, c.auto_dial_level, c.adaptive_maximum_level,
             c.hopper_level, c.dial_timeout, c.lead_order, c.lead_order_randomize, c.campaign_cid, c.dial_statuses,
             c.local_call_time, c.campaign_recording, c.no_hopper_leads_logins,
             (SELECT COUNT(*) FROM vicidial_lists l WHERE l.campaign_id = c.campaign_id) lists,
             (SELECT COUNT(*) FROM vicidial_lists l WHERE l.campaign_id = c.campaign_id AND l.active = 'Y') active_lists,
             (SELECT COUNT(*) FROM vicidial_hopper h WHERE h.campaign_id = c.campaign_id) hopper,
             (SELECT COUNT(*) FROM vicidial_live_agents la WHERE la.campaign_id = c.campaign_id) agents,
             IFNULL(s.dialable_leads, 0) dialable, IFNULL(s.calls_today, 0) calls_today
      FROM vicidial_campaigns c LEFT JOIN vicidial_campaign_stats s USING (campaign_id)
      ORDER BY c.active DESC, c.campaign_id`);
    const statuses = await all(`
      SELECT status, status_name FROM vicidial_statuses
      UNION SELECT DISTINCT status, status_name FROM vicidial_campaign_statuses ORDER BY status`);
    res.json({
      campaigns: rows.map((r) => ({ ...r, dial_statuses: r.dial_statuses.trim().split(/\s+/).filter((s) => s && s !== '-') })),
      statuses,
    });
  })
);

router.patch(
  '/campaigns/:id',
  requirePerm('modify_campaigns'),
  ah(async (req, res) => {
    const c = await one('SELECT campaign_id, dial_statuses FROM vicidial_campaigns WHERE campaign_id = ?', [req.params.id]);
    if (!c) throw new HttpError(404, 'Campaña no encontrada');
    const b = req.body || {};
    const p = {};
    if (b.campaign_name !== undefined) p.campaign_name = str(b.campaign_name, { max: 40, re: /^[^'"&]{6,40}$/, name: 'nombre (6-40, sin comillas ni &)' });
    if (b.active !== undefined) p.active = b.active ? 'Y' : 'N';
    if (b.dial_method !== undefined) {
      if (!DIAL_METHODS.includes(b.dial_method)) throw new HttpError(400, 'Método de marcación no válido');
      p.dial_method = b.dial_method;
    }
    if (b.auto_dial_level !== undefined) {
      const v = Number(b.auto_dial_level);
      if (!(v >= 0 && v <= 20)) throw new HttpError(400, 'Nivel de marcación no válido (0-20)');
      p.auto_dial_level = v.toFixed(1);
    }
    if (b.hopper_level !== undefined) {
      const v = Number(b.hopper_level);
      if (!(v >= 1 && v <= 2000)) throw new HttpError(400, 'Hopper entre 1 y 2000');
      p.hopper_level = v;
    }
    if (b.dial_timeout !== undefined) {
      const v = Number(b.dial_timeout);
      if (!(v >= 1 && v <= 120)) throw new HttpError(400, 'Tiempo de timbrado entre 1 y 120 s');
      p.dial_timeout = v;
    }
    if (b.lead_order !== undefined) {
      if (!LEAD_ORDERS.includes(b.lead_order)) throw new HttpError(400, 'Orden de leads no válido');
      p.list_order = b.lead_order;
    }
    if (b.lead_order_randomize !== undefined) p.list_order_randomize = b.lead_order_randomize ? 'Y' : 'N';
    if (b.campaign_cid !== undefined) p.outbound_cid = str(b.campaign_cid, { max: 20, re: /^\d{1,20}$/, name: 'Caller ID' });
    if (b.reset_hopper) p.reset_hopper = 'Y';

    // Estados a marcar: la API solo añade o quita uno por llamada
    const current = c.dial_statuses.trim().split(/\s+/).filter((s) => s && s !== '-');
    const wanted = Array.isArray(b.dial_statuses) ? b.dial_statuses.filter((s) => /^[A-Za-z0-9_-]{1,6}$/.test(s)) : null;
    const add = wanted ? wanted.filter((s) => !current.includes(s)) : [];
    const remove = wanted ? current.filter((s) => !wanted.includes(s)) : [];
    if (wanted && !wanted.length) throw new HttpError(400, 'La campaña necesita al menos un estado a marcar');

    if (!Object.keys(p).length && !add.length && !remove.length) throw new HttpError(400, 'No hay cambios');
    const messages = [];
    if (Object.keys(p).length) messages.push(await nonAgentApi('update_campaign', { campaign_id: c.campaign_id, ...p }));
    for (const s of add) messages.push(await nonAgentApi('update_campaign', { campaign_id: c.campaign_id, dial_status_add: s }));
    for (const s of remove) messages.push(await nonAgentApi('update_campaign', { campaign_id: c.campaign_id, dial_status_remove: s }));
    res.json({ ok: true, message: messages.join('\n') });
  })
);

// ---------------------------------------------------------------- Grabaciones
router.get(
  '/recordings',
  requirePerm('access_recordings'),
  ah(async (req, res) => {
    const date = str(req.query.date, { re: DATE_RE, name: 'fecha', required: false });
    const user = str(req.query.user, { max: 20, re: /^[A-Za-z0-9]+$/, name: 'agente', required: false });
    const phone = digits(req.query.phone);
    const leadId = digits(req.query.lead_id);
    const where = [];
    const params = [];
    if (date) { where.push('r.start_time >= ? AND r.start_time < ? + INTERVAL 1 DAY'); params.push(date, date); }
    if (user) { where.push('r.user = ?'); params.push(user); }
    if (leadId) { where.push('r.lead_id = ?'); params.push(leadId); }
    if (phone.length >= 4) { where.push('vl.phone_number LIKE ?'); params.push(`%${phone}`); }
    if (!where.length) throw new HttpError(400, 'Indica al menos una fecha, agente, lead o teléfono');
    const rows = await all(
      `SELECT r.recording_id, r.start_time, r.length_in_sec, r.filename, r.location, r.lead_id, r.user, u.full_name,
              vl.phone_number, TRIM(CONCAT(IFNULL(vl.first_name,''),' ',IFNULL(vl.last_name,''))) lead_name
       FROM recording_log r
       LEFT JOIN vicidial_users u ON u.user = r.user
       LEFT JOIN vicidial_list vl ON vl.lead_id = r.lead_id
       WHERE ${where.join(' AND ')}
       ORDER BY r.start_time DESC LIMIT 300`,
      params
    );
    // Rutas relativas para que el audio cargue por HTTPS desde el mismo servidor
    res.json(rows.map((r) => {
      const m = String(r.location || '').match(/\/RECORDINGS\/.+$/);
      return { ...r, url: m ? m[0] : null, location: undefined };
    }));
  })
);

// ---------------------------------------------------------------- Reportes
function range(q) {
  const today = new Date().toISOString().slice(0, 10);
  const from = str(q.from || today, { re: DATE_RE, name: 'desde' });
  const to = str(q.to || from, { re: DATE_RE, name: 'hasta' });
  if (to < from) throw new HttpError(400, 'La fecha final es anterior a la inicial');
  if ((new Date(to) - new Date(from)) / 86400000 > 93) throw new HttpError(400, 'Rango máximo: 93 días');
  const campaign = q.campaign && q.campaign !== 'ALL' ? str(q.campaign, { max: 8, name: 'campaña' }) : null;
  return { from, to, campaign };
}

router.get(
  '/reports',
  requirePerm('view_reports'),
  ah(async (req, res) => {
    const { from, to, campaign } = range(req.query);
    const sales = await saleStatuses();
    const campAgent = campaign ? 'AND a.campaign_id = ?' : '';
    const campCall = campaign ? 'AND campaign_id = ?' : '';
    const cp = campaign ? [campaign] : [];
    const calls = `
      SELECT call_date, status, length_in_sec, campaign_id FROM vicidial_log WHERE call_date >= ? AND call_date < ? + INTERVAL 1 DAY ${campCall}
      UNION ALL
      SELECT call_date, status, length_in_sec, campaign_id FROM vicidial_closer_log WHERE call_date >= ? AND call_date < ? + INTERVAL 1 DAY ${campCall}`;
    const callParams = [from, to, ...cp, from, to, ...cp];

    const [agents, dispos, daily] = await Promise.all([
      all(
        `SELECT a.user, u.full_name, COUNT(IF(a.lead_id > 0, 1, NULL)) calls,
                IFNULL(SUM(a.talk_sec),0) talk, IFNULL(SUM(a.dead_sec),0) dead, IFNULL(SUM(a.pause_sec),0) pause,
                IFNULL(SUM(a.wait_sec),0) wait, IFNULL(SUM(a.dispo_sec),0) dispo, IFNULL(SUM(a.status IN (?)),0) sales,
                MIN(a.event_time) first_event, MAX(a.event_time) last_event
         FROM vicidial_agent_log a LEFT JOIN vicidial_users u ON u.user = a.user
         WHERE a.event_time >= ? AND a.event_time < ? + INTERVAL 1 DAY ${campAgent}
         GROUP BY a.user, u.full_name ORDER BY calls DESC`,
        [sales, from, to, ...cp]
      ),
      all(
        `SELECT t.status, MAX(s.status_name) status_name, MAX(s.sale) sale, COUNT(*) n, IFNULL(SUM(t.length_in_sec),0) secs
         FROM (${calls}) t
         LEFT JOIN (SELECT status, status_name, sale FROM vicidial_statuses
                    UNION SELECT status, status_name, sale FROM vicidial_campaign_statuses) s ON s.status = t.status
         GROUP BY t.status ORDER BY n DESC`,
        callParams
      ),
      all(
        `SELECT DATE(call_date) d, COUNT(*) calls, SUM(status IN (?)) sales, SUM(length_in_sec > 0) answered
         FROM (${calls}) t GROUP BY d ORDER BY d`,
        [sales, ...callParams]
      ),
    ]);

    res.json({
      from, to, campaign,
      agents: agents.map((a) => {
        const [calls, dead, pause, wait, dispo, sales] = [a.calls, a.dead, a.pause, a.wait, a.dispo, a.sales].map(Number);
        // En vicidial_agent_log el tiempo hablado incluye el tiempo muerto
        const talk = Math.max(0, Number(a.talk) - dead);
        return { ...a, calls, talk, dead, pause, wait, dispo, sales, total: talk + dead + pause + wait + dispo };
      }),
      dispos: dispos.map((d) => ({ ...d, n: Number(d.n), secs: Number(d.secs) })),
      daily: daily.map((d) => ({ d: d.d, calls: Number(d.calls), sales: Number(d.sales), answered: Number(d.answered) })),
    });
  })
);

// ---------------------------------------------------------------- Números entrantes (DIDs)
const DID_ROUTES = ['IN_GROUP', 'CALLMENU', 'PHONE', 'VOICEMAIL', 'VMAIL_NO_INST', 'EXTEN'];
const DID_RE = /^[0-9A-Za-z+*#_-]{2,50}$/;

router.get(
  '/dids',
  requirePerm('modify_inbound_dids'),
  ah(async (req, res) => {
    const [dids, ingroups, menus, phones] = await Promise.all([
      all(`SELECT did_id, did_pattern, did_description, did_active, did_route, extension, exten_context, voicemail_ext,
                  phone, server_ip, group_id, call_handle_method, agent_search_method, list_id, campaign_id, menu_id, record_call,
                  (SELECT COUNT(*) FROM vicidial_did_log l WHERE l.did_id = d.did_id AND l.call_date >= CURDATE()) calls_today
           FROM vicidial_inbound_dids d ORDER BY did_pattern`),
      all('SELECT group_id, group_name, active FROM vicidial_inbound_groups ORDER BY group_id'),
      all('SELECT menu_id, menu_name FROM vicidial_call_menu ORDER BY menu_id'),
      all("SELECT extension, fullname, server_ip FROM phones WHERE active = 'Y' ORDER BY extension"),
    ]);
    res.json({ dids: dids.map((d) => ({ ...d, calls_today: Number(d.calls_today) })), ingroups, menus, phones, routes: DID_ROUTES });
  })
);

async function didParams(b, creating) {
  const p = {};
  if (b.did_description !== undefined) p.did_description = str(b.did_description, { max: 50, re: /^[^'"&]{6,50}$/, name: 'descripción (6-50 caracteres)' });
  else if (creating) throw new HttpError(400, 'Falta la descripción (6-50 caracteres)');
  if (b.active !== undefined) p.active = b.active ? 'Y' : 'N';
  if (b.record_call !== undefined) {
    if (!['Y', 'N', 'Y_QUEUESTOP'].includes(b.record_call)) throw new HttpError(400, 'Opción de grabación no válida');
    p.record_call = b.record_call;
  }
  if (b.did_route !== undefined) {
    if (!DID_ROUTES.includes(b.did_route)) throw new HttpError(400, 'Destino no válido');
    p.did_route = b.did_route;
    if (b.did_route === 'IN_GROUP') {
      p.group = str(b.group_id, { max: 20, name: 'in-group' });
      p.call_handle_method = ['CID', 'CIDLOOKUP', 'CLOSER'].includes(b.call_handle_method) ? b.call_handle_method : 'CID';
      p.agent_search_method = ['LB', 'LO', 'SO'].includes(b.agent_search_method) ? b.agent_search_method : 'LB';
      p.list_id = /^\d{3,12}$/.test(String(b.list_id || '')) ? b.list_id : '999';
      if (b.campaign_id) p.campaign_id = str(b.campaign_id, { max: 8, name: 'campaña' });
    } else if (b.did_route === 'CALLMENU') {
      p.menu_id = str(b.menu_id, { max: 50, name: 'menú IVR' });
    } else if (b.did_route === 'PHONE') {
      const ph = await one("SELECT extension, server_ip FROM phones WHERE extension = ? AND active = 'Y'", [str(b.phone, { max: 100, name: 'teléfono' })]);
      if (!ph) throw new HttpError(400, 'Teléfono no válido');
      p.phone_extension = ph.extension;
      p.server_ip = ph.server_ip;
    } else if (b.did_route === 'VOICEMAIL' || b.did_route === 'VMAIL_NO_INST') {
      p.voicemail_ext = str(b.voicemail_ext, { max: 10, re: /^\d+$/, name: 'buzón de voz' });
    } else if (b.did_route === 'EXTEN') {
      p.extension = str(b.extension, { max: 50, re: /^\d+$/, name: 'extensión' });
      p.exten_context = str(b.exten_context || 'default', { max: 50, name: 'contexto' });
    }
  }
  return p;
}

router.post(
  '/dids',
  requirePerm('modify_inbound_dids'),
  ah(async (req, res) => {
    const b = req.body || {};
    const pattern = str(b.did_pattern, { re: DID_RE, name: 'número (DID)' });
    const p = await didParams({ active: true, record_call: 'N', ...b }, true);
    res.json({ ok: true, message: await nonAgentApi('add_did', { did_pattern: pattern, ...p }) });
  })
);

router.patch(
  '/dids/:pattern',
  requirePerm('modify_inbound_dids'),
  ah(async (req, res) => {
    const pattern = str(req.params.pattern, { re: DID_RE, name: 'DID' });
    const p = await didParams(req.body || {}, false);
    if (!Object.keys(p).length) throw new HttpError(400, 'No hay cambios');
    res.json({ ok: true, message: await nonAgentApi('update_did', { did_pattern: pattern, ...p }) });
  })
);

router.post(
  '/dids/:pattern/copy',
  requirePerm('modify_inbound_dids'),
  ah(async (req, res) => {
    const pattern = str(req.params.pattern, { re: DID_RE, name: 'DID' });
    const list = String(req.body?.new_dids || '').split(/[\s,;]+/).filter(Boolean);
    if (!list.length) throw new HttpError(400, 'Indica al menos un número nuevo');
    if (list.some((d) => !DID_RE.test(d))) throw new HttpError(400, 'Hay números no válidos en la lista');
    const p = { source_did_pattern: pattern, new_dids: list.join(',') };
    if (req.body?.did_description) p.did_description = str(req.body.did_description, { max: 50, re: /^[^'"&]{6,50}$/, name: 'descripción (6-50)' });
    res.json({ ok: true, message: await nonAgentApi('copy_did', p) });
  })
);

router.delete(
  '/dids/:pattern',
  requirePerm('modify_inbound_dids', 'delete_inbound_dids'),
  ah(async (req, res) => {
    const pattern = str(req.params.pattern, { re: DID_RE, name: 'DID' });
    if (pattern === 'default') throw new HttpError(400, 'El DID «default» es del sistema y no se puede borrar');
    res.json({ ok: true, message: await nonAgentApi('update_did', { did_pattern: pattern, delete_did: 'Y' }) });
  })
);

// ---------------------------------------------------------------- Agentes remotos
router.get(
  '/remote-agents',
  requirePerm('modify_remoteagents'),
  ah(async (req, res) => {
    const rows = await all(`
      SELECT r.remote_agent_id, r.user_start, u.full_name, r.number_of_lines, r.conf_exten, r.status, r.campaign_id, r.server_ip,
             (SELECT COUNT(*) FROM vicidial_live_agents la WHERE la.user = r.user_start) logged
      FROM vicidial_remote_agents r LEFT JOIN vicidial_users u ON u.user = r.user_start
      ORDER BY r.user_start`);
    res.json(rows.map((r) => ({ ...r, logged: Number(r.logged) > 0 })));
  })
);

router.patch(
  '/remote-agents/:user',
  requirePerm('modify_remoteagents'),
  ah(async (req, res) => {
    const b = req.body || {};
    const p = { agent_user: str(req.params.user, { max: 20, name: 'agente' }) };
    if (b.status !== undefined) p.status = b.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';
    if (b.campaign_id) p.campaign_id = str(b.campaign_id, { max: 8, name: 'campaña' });
    if (b.number_of_lines !== undefined) {
      const n = Number(b.number_of_lines);
      if (!(n >= 1 && n <= 99)) throw new HttpError(400, 'Número de líneas no válido');
      p.number_of_lines = n;
    }
    res.json({ ok: true, message: await nonAgentApi('update_remote_agent', p) });
  })
);

// ---------------------------------------------------------------- Lista negra (DNC)
router.get(
  '/dnc',
  requirePerm('modify_lists'),
  ah(async (req, res) => {
    const phone = digits(req.query.phone);
    const [sys, camp] = await Promise.all([
      one('SELECT COUNT(*) n FROM vicidial_dnc'),
      one('SELECT COUNT(*) n FROM vicidial_campaign_dnc'),
    ]);
    let result = null;
    if (phone.length >= 6) {
      const [inSys, inCamps] = await Promise.all([
        one('SELECT phone_number FROM vicidial_dnc WHERE phone_number = ?', [phone]),
        all('SELECT campaign_id FROM vicidial_campaign_dnc WHERE phone_number = ?', [phone]),
      ]);
      result = { phone, system: Boolean(inSys), campaigns: inCamps.map((r) => r.campaign_id) };
    }
    res.json({ totals: { system: Number(sys.n), campaigns: Number(camp.n) }, result });
  })
);

function dncParams(b) {
  const phone = digits(b.phone);
  if (phone.length < 6 || phone.length > 20) throw new HttpError(400, 'Teléfono no válido');
  const target = b.campaign_id ? str(b.campaign_id, { max: 30, name: 'campaña' }) : 'SYSTEM_INTERNAL';
  return { phone_number: phone, campaign_id: target };
}

router.post(
  '/dnc',
  requirePerm('modify_lists'),
  ah(async (req, res) => res.json({ ok: true, message: await nonAgentApi('add_dnc_phone', dncParams(req.body || {})) }))
);

router.post(
  '/dnc/delete',
  requirePerm('modify_lists', 'delete_from_dnc'),
  ah(async (req, res) => res.json({ ok: true, message: await nonAgentApi('delete_dnc_phone', dncParams(req.body || {})) }))
);

export default router;
