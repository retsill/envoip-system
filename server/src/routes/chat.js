import { Router } from 'express';
import { all, one } from '../db.js';
import { ah, HttpError, str } from '../util.js';

// Chat interno de Vicidial (agente ↔ agente y supervisor ↔ agente), compatible con la pantalla clásica.
// - Lecturas: tablas vicidial_manager_chats / vicidial_manager_chat_log (usuario de solo lectura).
// - Escrituras: los propios scripts de Vicidial con las credenciales del usuario, para que todo quede
//   igual que si lo hiciera desde vicidial.php o desde el chat del administrador.
const router = Router();
const BASE = process.env.VICI_BASE || 'http://127.0.0.1';

async function credentials(user) {
  const u = await one("SELECT user, pass FROM vicidial_users WHERE user = ? AND active = 'Y'", [user]);
  if (!u?.pass) throw new HttpError(401, 'Usuario inactivo');
  return u;
}

// Llama a un script PHP de Vicidial por POST. basic = true para los scripts de administración.
async function vici(path, params, { user, pass, basic = false }) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x) => body.append(`${k}[]`, x));
    else if (v !== undefined) body.append(k, String(v));
  }
  if (!basic) {
    body.set('user', user);
    body.set('pass', pass);
  }
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    body,
    headers: basic ? { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` } : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(502, 'Vicidial respondió {status}', { status: res.status });
  const err = text.match(/Error[^<\n]*/i);
  if (err && !/error_msg/i.test(err[0])) throw new HttpError(400, err[0].replace(/\s+/g, ' ').trim());
  return text;
}

// Sala (id + subid) y papel del usuario en ella
async function sessionFor(user, id, sub) {
  const c = await one('SELECT manager_chat_id, internal_chat_type, manager, selected_agents FROM vicidial_manager_chats WHERE manager_chat_id = ?', [id]);
  if (!c) throw new HttpError(404, 'El chat ya no existe (lo cerraron)');
  const isManagerChat = c.internal_chat_type === 'MANAGER';
  const mine = await one('SELECT COUNT(*) n FROM vicidial_manager_chat_log WHERE manager_chat_id = ? AND manager_chat_subid = ? AND user = ?', [id, sub, user]);
  const allowed = Number(mine.n) > 0 || (isManagerChat && c.manager === user);
  if (!allowed) throw new HttpError(403, 'No participas en este chat');
  return { ...c, isManagerChat, iAmManager: c.manager === user };
}

// ---------------------------------------------------------------- Lecturas
router.get(
  '/sessions',
  ah(async (req, res) => {
    const me = req.user.user;
    const rows = await all(
      `SELECT c.manager_chat_id id, l.manager_chat_subid sub, c.internal_chat_type type, c.manager, c.selected_agents,
              c.chat_start_date, MAX(l.message_date) last_at, MAX(l.user) sub_user,
              SUM(l.user = ? AND l.message_viewed_date IS NULL AND l.message_posted_by <> ?) unread
       FROM vicidial_manager_chats c
       JOIN vicidial_manager_chat_log l ON l.manager_chat_id = c.manager_chat_id
       WHERE (c.internal_chat_type = 'AGENT' AND l.user = ?)
          OR (c.internal_chat_type = 'MANAGER' AND (l.user = ? OR c.manager = ?))
       GROUP BY c.manager_chat_id, l.manager_chat_subid
       ORDER BY last_at DESC`,
      [me, me, me, me, me]
    );
    const users = new Set();
    for (const r of rows) {
      users.add(r.manager);
      users.add(r.sub_user);
      for (const u of String(r.selected_agents || '').split('|')) if (u) users.add(u);
    }
    const names = users.size
      ? Object.fromEntries((await all('SELECT user, full_name FROM vicidial_users WHERE user IN (?)', [[...users]])).map((u) => [u.user, u.full_name]))
      : {};
    const out = [];
    for (const r of rows) {
      let others;
      if (r.type === 'MANAGER') others = r.manager === me ? [r.sub_user] : [r.manager];
      else others = [r.manager, ...String(r.selected_agents || '').split('|')].filter((u) => u && u !== me);
      const last = await one(
        `SELECT message, message_posted_by FROM vicidial_manager_chat_log
         WHERE manager_chat_id = ? AND manager_chat_subid = ? ${r.type === 'AGENT' ? 'AND user = ?' : ''}
         ORDER BY message_date DESC, manager_chat_message_id DESC LIMIT 1`,
        r.type === 'AGENT' ? [r.id, r.sub, me] : [r.id, r.sub]
      );
      out.push({
        id: r.id,
        sub: r.sub,
        type: r.type,
        withManager: r.type === 'MANAGER',
        iAmManager: r.manager === me,
        title: [...new Set(others)].map((u) => names[u] || u).join(', ') || 'Chat',
        users: [...new Set(others)],
        lastAt: r.last_at,
        last: last ? { text: last.message, by: last.message_posted_by } : null,
        unread: Number(r.unread),
      });
    }
    res.json(out);
  })
);

router.get(
  '/unread',
  ah(async (req, res) => {
    const me = req.user.user;
    const r = await one(
      "SELECT COUNT(*) n FROM vicidial_manager_chat_log WHERE user = ? AND message_viewed_date IS NULL AND message_posted_by <> ?",
      [me, me]
    );
    res.json({ count: Number(r.n) });
  })
);

router.get(
  '/messages',
  ah(async (req, res) => {
    const me = req.user.user;
    const id = Number(req.query.id);
    const sub = Number(req.query.sub || 1);
    const s = await sessionFor(me, id, sub);
    // En chats entre agentes cada participante tiene su copia; en los del supervisor hay una sola por hilo
    const rows = await all(
      `SELECT l.manager_chat_message_id mid, l.message_posted_by by_user, u.full_name by_name, l.message text, l.message_date at
       FROM vicidial_manager_chat_log l LEFT JOIN vicidial_users u ON u.user = l.message_posted_by
       WHERE l.manager_chat_id = ? AND l.manager_chat_subid = ? ${s.isManagerChat ? '' : 'AND l.user = ?'}
       ORDER BY l.message_date, l.manager_chat_message_id`,
      s.isManagerChat ? [id, sub] : [id, sub, me]
    );
    res.json({ id, sub, type: s.internal_chat_type, iAmManager: s.iAmManager, messages: rows.map((r) => ({ ...r, mine: r.by_user === me })) });
  })
);

// Agentes conectados con los que se puede abrir un chat
router.get(
  '/agents',
  ah(async (req, res) => {
    res.json(
      await all(
        `SELECT la.user, u.full_name, la.status, la.campaign_id FROM vicidial_live_agents la
         JOIN vicidial_users u ON u.user = la.user WHERE la.user <> ? ORDER BY u.full_name`,
        [req.user.user]
      )
    );
  })
);

// ---------------------------------------------------------------- Escrituras (scripts de Vicidial)
router.post(
  '/send',
  ah(async (req, res) => {
    const me = await credentials(req.user.user);
    const id = Number(req.body?.id);
    const sub = Number(req.body?.sub || 1);
    const text = str(req.body?.text, { max: 1000, name: 'mensaje' }).replace(/[\r\n]+/g, ' ');
    const s = await sessionFor(me.user, id, sub);
    if (s.isManagerChat && s.iAmManager) {
      await vici('/vicidial/manager_chat_actions.php', { action: 'SendChatMessage', manager_chat_id: id, chat_sub_id: sub, chat_message: text }, { ...me, basic: true });
    } else {
      await vici('/agc/chat_db_query.php', { action: 'SendMgrChatMessage', manager_chat_id: id, manager_chat_subid: sub, chat_message: text }, me);
    }
    res.json({ ok: true });
  })
);

router.post(
  '/start',
  ah(async (req, res) => {
    const me = await credentials(req.user.user);
    const agent = str(req.body?.agent, { max: 20, re: /^[A-Za-z0-9]+$/, name: 'agente' });
    const text = str(req.body?.text, { max: 1000, name: 'mensaje' }).replace(/[\r\n]+/g, ' ');
    const existing = await one(
      `SELECT manager_chat_id id FROM vicidial_manager_chats
       WHERE internal_chat_type = 'AGENT' AND ((manager = ? AND selected_agents LIKE ?) OR (manager = ? AND selected_agents LIKE ?))
       ORDER BY manager_chat_id DESC LIMIT 1`,
      [me.user, `%|${agent}|%`, agent, `%|${me.user}|%`]
    );
    if (existing) {
      // Ya hay chat abierto: se envía el mensaje en él
      await vici('/agc/chat_db_query.php', { action: 'SendMgrChatMessage', manager_chat_id: existing.id, manager_chat_subid: 1, chat_message: text }, me);
      return res.json({ id: existing.id, sub: 1, existing: true });
    }
    const live = await one('SELECT user FROM vicidial_live_agents WHERE user = ?', [agent]);
    if (!live) throw new HttpError(400, 'Ese agente no está conectado: Vicidial solo permite chatear con agentes conectados');
    await vici('/agc/chat_db_query.php', { action: 'CreateAgentToAgentChat', agent_manager: me.user, agent_user: agent, manager_message: text }, me);
    const created = await one(
      "SELECT manager_chat_id id FROM vicidial_manager_chats WHERE internal_chat_type = 'AGENT' AND manager = ? AND selected_agents LIKE ? ORDER BY manager_chat_id DESC LIMIT 1",
      [me.user, `%|${agent}|%`]
    );
    if (!created) throw new HttpError(502, 'Vicidial no creó el chat');
    res.json({ id: created.id, sub: 1 });
  })
);

router.post(
  '/read',
  ah(async (req, res) => {
    const me = await credentials(req.user.user);
    const id = Number(req.body?.id);
    const sub = Number(req.body?.sub || 1);
    await sessionFor(me.user, id, sub);
    await vici('/agc/chat_db_query.php', { action: 'DisplayMgrAgentChat', manager_chat_id: id, manager_chat_subid: sub }, me);
    res.json({ ok: true });
  })
);

router.post(
  '/end',
  ah(async (req, res) => {
    const me = await credentials(req.user.user);
    const id = Number(req.body?.id);
    const sub = Number(req.body?.sub || 1);
    const s = await sessionFor(me.user, id, sub);
    if (s.isManagerChat) {
      if (!s.iAmManager) throw new HttpError(400, 'Este chat lo abrió un supervisor: solo él puede cerrarlo');
      await vici('/vicidial/manager_chat_actions.php', { action: 'EndAgentChat', manager_chat_id: id, chat_sub_id: sub }, { ...me, basic: true });
    } else {
      await vici('/agc/chat_db_query.php', { action: 'EndAgentToAgentChat', manager_chat_id: id }, me);
    }
    res.json({ ok: true });
  })
);

export default router;
