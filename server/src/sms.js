import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { aall, aone, appEnabled, arun, getSettings, setSettings } from './appdb.js';
import { all, one } from './db.js';
import { nonAgentApi } from './vici.js';
import { HttpError } from './util.js';

// Centro de mensajes SMS/MMS de EnVoip System.
// Envío y recepción con la API de VoIP.ms; cada mensaje se une al lead de Vicidial por su teléfono.

export const MEDIA_DIR = process.env.SMS_MEDIA_DIR || path.resolve('/opt/vicimodern/data/sms-media');
const SETTING_KEYS = ['voipms_user', 'voipms_pass', 'dids', 'default_did', 'webhook_token', 'stop_reply', 'enabled'];
const STOP_WORDS = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|baja|alto|cancelar|parar)\s*[.!]*\s*$/i;

/** Números norteamericanos a 10 dígitos; extensiones y otros se dejan en dígitos. */
export function normalize(n) {
  const d = String(n ?? '').replace(/\D/g, '');
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
}

// ---------------------------------------------------------------- Configuración
export async function getConfig({ withSecrets = false } = {}) {
  if (!appEnabled) return { available: false };
  const s = await getSettings(SETTING_KEYS);
  if (!s.webhook_token) {
    s.webhook_token = crypto.randomBytes(18).toString('hex');
    await setSettings({ webhook_token: s.webhook_token });
  }
  const dids = s.dids.split(/[\s,;]+/).map(normalize).filter(Boolean);
  return {
    available: true,
    enabled: s.enabled === '1' && Boolean(s.voipms_user && s.voipms_pass && dids.length),
    voipmsUser: s.voipms_user,
    hasPassword: Boolean(s.voipms_pass),
    voipmsPass: withSecrets ? s.voipms_pass : undefined,
    dids,
    defaultDid: normalize(s.default_did) || dids[0] || '',
    webhookToken: s.webhook_token,
    stopReply: s.stop_reply || 'Te has dado de baja. No recibirás más mensajes. / You have been unsubscribed.',
  };
}

export async function saveConfig(b) {
  const upd = {};
  if (b.voipmsUser !== undefined) upd.voipms_user = String(b.voipmsUser).trim();
  if (b.voipmsPass) upd.voipms_pass = String(b.voipmsPass);
  if (b.dids !== undefined) upd.dids = (Array.isArray(b.dids) ? b.dids : String(b.dids).split(/[\s,;]+/)).map(normalize).filter(Boolean).join(',');
  if (b.defaultDid !== undefined) upd.default_did = normalize(b.defaultDid);
  if (b.stopReply !== undefined) upd.stop_reply = String(b.stopReply).slice(0, 300);
  if (b.enabled !== undefined) upd.enabled = b.enabled ? '1' : '0';
  if (b.regenerateToken) upd.webhook_token = crypto.randomBytes(18).toString('hex');
  await setSettings(upd);
}

// ---------------------------------------------------------------- Cliente VoIP.ms
const VOIPMS = 'https://voip.ms/api/v1/rest.php';

async function voipms(cfg, method, params, post = false) {
  const all = { api_username: cfg.voipmsUser, api_password: cfg.voipmsPass, method, ...params };
  const res = post
    ? await fetch(VOIPMS, { method: 'POST', body: new URLSearchParams(all), signal: AbortSignal.timeout(30000) })
    : await fetch(`${VOIPMS}?${new URLSearchParams(all)}`, { signal: AbortSignal.timeout(20000) });
  const data = await res.json().catch(() => ({ status: `http_${res.status}` }));
  if (data.status !== 'success') {
    const err = new HttpError(502, voipmsError(data.status), { code: data.status });
    err.code = data.status;
    throw err;
  }
  return data;
}

function voipmsError(code) {
  return (
    {
      invalid_credentials: 'VoIP.ms: usuario o contraseña de API incorrectos',
      ip_not_enabled: 'VoIP.ms: la IP de este servidor no está autorizada en la API',
      invalid_ip: 'VoIP.ms: la IP de este servidor no está autorizada en la API',
      api_not_enabled: 'VoIP.ms: la API no está activada en la cuenta',
      invalid_did: 'VoIP.ms: el DID no existe o no tiene SMS activado',
      sms_not_enabled: 'VoIP.ms: el DID no tiene SMS activado',
      mms_not_enabled: 'VoIP.ms: el DID no tiene MMS activado',
      invalid_dst: 'VoIP.ms: número de destino no válido',
      limit_reached: 'VoIP.ms: límite de mensajes alcanzado',
    }[code] || 'VoIP.ms: {code}'
  );
}

/** Texto del error con el código de VoIP.ms ya puesto (se guarda en el mensaje y en el registro). */
const errText = (e) => String(e.message || e).replace(/\{(\w+)\}/g, (m, k) => e.vars?.[k] ?? m);

export async function testConfig() {
  const cfg = await getConfig({ withSecrets: true });
  if (!cfg.voipmsUser || !cfg.voipmsPass) throw new HttpError(400, 'Falta el usuario o la contraseña de API');
  const r = await voipms(cfg, 'getDIDsInfo', cfg.defaultDid ? { did: cfg.defaultDid } : {});
  return (r.dids || []).map((d) => ({ did: d.did, sms: d.sms_enabled === '1' || d.sms_available === '1' }));
}

// ---------------------------------------------------------------- Empresas
// Cada DID es de una empresa: su «Admin User Group» (vicidial_inbound_dids.user_group). Un usuario solo ve y usa
// los DIDs de los grupos que puede ver (scope.js); el administrador general, todos.
const NO_DID = ['-'];
export async function didsFor(scope, cfg) {
  if (scope.all) return cfg.dids;
  const rows = await all('SELECT did_pattern FROM vicidial_inbound_dids WHERE user_group IN (?)', [scope.groups.length ? scope.groups : ['-']]);
  const mine = new Set(rows.map((r) => normalize(r.did_pattern)));
  return cfg.dids.filter((d) => mine.has(d));
}
const didList = (dids) => (dids && dids.length ? dids : NO_DID);

// ---------------------------------------------------------------- Consultas
export async function findLead(peer) {
  if (normalize(peer).length < 7) return null;
  const r = await one(
    'SELECT lead_id FROM vicidial_list WHERE phone_number = ? OR alt_phone = ? ORDER BY modify_date DESC LIMIT 1',
    [normalize(peer), normalize(peer)]
  );
  return r?.lead_id ?? null;
}

async function isDnc(peer) {
  const p = normalize(peer);
  const r = await one(
    `SELECT (SELECT COUNT(*) FROM vicidial_dnc WHERE phone_number = ?) + (SELECT COUNT(*) FROM vicidial_campaign_dnc WHERE phone_number = ?) n`,
    [p, p]
  );
  return Number(r.n) > 0;
}

export async function conversations({ q = '', unreadOnly = false, limit = 200, dids } = {}) {
  const d = didList(dids);
  const rows = await aall(
    `SELECT m.peer, m.did, m.body, m.media, m.direction, m.status, m.created_at, m.lead_id, m.user,
            (SELECT COUNT(*) FROM sms_messages u WHERE u.peer = m.peer AND u.did IN (?) AND u.direction = 'in' AND u.read_at IS NULL AND u.deleted_at IS NULL) unread
     FROM sms_messages m
     JOIN (SELECT peer, MAX(id) id FROM sms_messages WHERE did IN (?) AND deleted_at IS NULL GROUP BY peer) last ON last.id = m.id
     ORDER BY m.id DESC LIMIT ?`,
    [d, d, limit]
  );
  // Nombres de los leads (base de Vicidial, solo lectura)
  const ids = [...new Set(rows.map((r) => r.lead_id).filter(Boolean))];
  const names = ids.length
    ? Object.fromEntries(
        (await all(
          "SELECT lead_id, TRIM(CONCAT(IFNULL(first_name,''),' ',IFNULL(last_name,''))) name FROM vicidial_list WHERE lead_id IN (?)",
          [ids]
        )).map((r) => [r.lead_id, r.name])
      )
    : {};
  const t = q.trim().toLowerCase();
  return rows
    .map((r) => ({ ...r, unread: Number(r.unread), name: names[r.lead_id] || '', media: r.media ? JSON.parse(r.media) : [] }))
    .filter((r) => (!unreadOnly || r.unread > 0) && (!t || `${r.peer} ${r.name} ${r.body}`.toLowerCase().includes(t)));
}

export async function thread(peer, { afterId = 0, dids } = {}) {
  const rows = await aall('SELECT * FROM sms_messages WHERE peer = ? AND did IN (?) AND id > ? AND deleted_at IS NULL ORDER BY id LIMIT 1000', [
    normalize(peer),
    didList(dids),
    afterId,
  ]);
  return rows.map((r) => ({ ...r, media: r.media ? JSON.parse(r.media) : [] }));
}

/** Mensajes nuevos de todas las conversaciones (sincronización de la app EnVoIP Phone). */
export async function feed(afterId, { limit = 500, dids } = {}) {
  const rows = await aall('SELECT * FROM sms_messages WHERE id > ? AND did IN (?) AND deleted_at IS NULL ORDER BY id LIMIT ?', [afterId, didList(dids), limit]);
  return rows.map((r) => ({ ...r, media: r.media ? JSON.parse(r.media) : [] }));
}

/** La imagen pertenece a un mensaje de alguno de estos DIDs. */
export async function mediaVisible(file, dids) {
  const r = await aone('SELECT id FROM sms_messages WHERE media LIKE ? AND did IN (?) AND deleted_at IS NULL LIMIT 1', [`%media:${file}%`, didList(dids)]);
  return Boolean(r);
}

export async function unreadCount(dids) {
  const r = await aone("SELECT COUNT(*) n FROM sms_messages WHERE direction = 'in' AND read_at IS NULL AND deleted_at IS NULL AND did IN (?)", [didList(dids)]);
  return Number(r.n);
}

/**
 * Borra mensajes (por id) y conversaciones enteras (por número) de los DIDs de la empresa. Quedan marcados como
 * borrados: no se muestran, no se sincronizan y la consulta a VoIP.ms no los vuelve a traer.
 */
export async function remove({ ids = [], peers = [], dids, user }) {
  const d = didList(dids);
  let n = 0;
  const idList = ids.map(Number).filter((x) => Number.isInteger(x) && x > 0).slice(0, 5000);
  const peerList = peers.map(normalize).filter(Boolean).slice(0, 1000);
  if (idList.length) {
    n += (await arun('UPDATE sms_messages SET deleted_at = NOW(), deleted_by = ? WHERE id IN (?) AND did IN (?) AND deleted_at IS NULL', [user, idList, d])).affectedRows;
  }
  if (peerList.length) {
    n += (await arun('UPDATE sms_messages SET deleted_at = NOW(), deleted_by = ? WHERE peer IN (?) AND did IN (?) AND deleted_at IS NULL', [user, peerList, d])).affectedRows;
  }
  return n;
}

/** Ids borrados desde [since] (para que la app los quite también en los demás equipos). */
export async function deletedSince(since, dids) {
  const now = (await aone('SELECT NOW() now')).now;
  const rows = await aall('SELECT id FROM sms_messages WHERE deleted_at >= ? AND did IN (?) ORDER BY id LIMIT 5000', [since, didList(dids)]);
  return { now, ids: rows.map((r) => Number(r.id)) };
}

export async function markRead(peer, dids) {
  await arun("UPDATE sms_messages SET read_at = NOW() WHERE peer = ? AND did IN (?) AND direction = 'in' AND read_at IS NULL", [
    normalize(peer),
    didList(dids),
  ]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Texto apto para SMS: VoIP.ms admite 160 caracteres solo en texto simple; con tildes, «ñ» o emojis el límite baja a 70
 * y rechaza el trozo (sms_toolong). Se quitan tildes (campaña → campana) como es habitual en SMS.
 */
export function smsText(text) {
  return String(text)
    .replace(/[¿¡]/g, '')
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’´`]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const isPlain = (t) => /^[\x20-\x7e\r\n]*$/.test(t);

/** Trozos de hasta 160 caracteres (70 los que lleven algún carácter especial, p. ej. emojis) sin partir palabras. */
export function splitSms(text) {
  const parts = [];
  let cur = '';
  for (const w of String(text).trim().split(/\s+/).filter(Boolean)) {
    const cand = cur ? `${cur} ${w}` : w;
    if (cand.length <= (isPlain(cand) ? 160 : 70)) {
      cur = cand;
      continue;
    }
    if (cur) parts.push(cur);
    let rest = w;
    const lim = isPlain(w) ? 160 : 70;
    while (rest.length > lim) {
      parts.push(rest.slice(0, lim));
      rest = rest.slice(lim);
    }
    cur = rest;
  }
  if (cur) parts.push(cur);
  return parts;
}

/** sendSMS con un reintento si VoIP.ms tarda o falla en su lado (timeout, 5xx de Cloudflare/servidor). */
async function sendWithRetry(cfg, params) {
  try {
    return await voipms(cfg, 'sendSMS', params);
  } catch (e) {
    const transient = e.name === 'TimeoutError' || /timeout|aborted/i.test(String(e.message)) || /^http_5/.test(e.code || '');
    if (!transient) throw e;
    await sleep(3000);
    return voipms(cfg, 'sendSMS', params);
  }
}

// ---------------------------------------------------------------- Envío
/**
 * media: [{ name, data }] con data en base64 (sin prefijo data:).
 * Devuelve el mensaje guardado (con estado sent o failed).
 */
export async function send({ peer, body, media = [], user, leadId, did, allowed, preferred, source = 'web' }) {
  const cfg = await getConfig({ withSecrets: true });
  if (!cfg.available || !cfg.enabled) throw new HttpError(400, 'La mensajería SMS no está configurada (Administración → Mensajería SMS)');
  const to = normalize(peer);
  if (to.length < 10) throw new HttpError(400, 'Número de destino no válido (10 dígitos)');
  const text = String(body ?? '').trim();
  if (!text && !media.length) throw new HttpError(400, 'El mensaje está vacío');
  if (text.length > 1000) throw new HttpError(400, 'Mensaje demasiado largo (máx. 1000 caracteres)');
  if (media.length > 3) throw new HttpError(400, 'Máximo 3 imágenes por mensaje');
  if (await isDnc(to)) throw new HttpError(409, 'Este número está en la lista negra (DNC): no se le pueden enviar mensajes');
  // Número de envío: el elegido, el de la campaña del agente o el primero de su empresa
  const mine = allowed ?? cfg.dids;
  if (!mine.length) throw new HttpError(400, 'Tu empresa no tiene ningún número con SMS configurado');
  const wanted = normalize(did) || (mine.includes(normalize(preferred)) ? normalize(preferred) : '');
  const from = wanted || (mine.includes(cfg.defaultDid) ? cfg.defaultDid : mine[0]);
  if (!mine.includes(from)) throw new HttpError(400, 'El DID de envío no está configurado');

  // Guardar adjuntos para poder mostrarlos después
  const saved = [];
  for (const m of media) {
    const ext = (String(m.name || '').match(/\.(png|jpe?g|gif|webp)$/i)?.[1] || 'jpg').toLowerCase();
    const buf = Buffer.from(String(m.data || ''), 'base64');
    if (!buf.length || buf.length > 3_500_000) throw new HttpError(400, 'Imagen vacía o mayor de 3,5 MB');
    await fs.mkdir(MEDIA_DIR, { recursive: true });
    const file = `${crypto.randomUUID()}.${ext}`;
    await fs.writeFile(path.join(MEDIA_DIR, file), buf);
    saved.push({ file, data: m.data });
  }

  const lead = leadId || (await findLead(to));
  const res = await arun(
    `INSERT INTO sms_messages (direction, did, peer, body, media, status, lead_id, user, source, read_at)
     VALUES ('out', ?, ?, ?, ?, 'queued', ?, ?, ?, NOW())`,
    [from, to, text, saved.length ? JSON.stringify(saved.map((s) => `media:${s.file}`)) : null, lead, user || null, source]
  );
  const id = res.insertId;
  try {
    let providerId;
    if (saved.length) {
      const params = { did: from, dst: to, message: text };
      saved.forEach((s, i) => (params[`media${i + 1}`] = s.data));
      providerId = (await voipms(cfg, 'sendMMS', params, true)).mms;
    } else {
      // Texto: SMS de hasta 160 caracteres (cortados por palabras), uno tras otro con una pausa. Los MMS de solo texto
      // los aceptaba VoIP.ms pero los operadores no los entregaban («undelivered»); los SMS sí llegan.
      const parts = splitSms(smsText(text));
      for (const [i, part] of parts.entries()) {
        if (i > 0) await sleep(1500);
        try {
          providerId = (await sendWithRetry(cfg, { did: from, dst: to, message: part })).sms;
        } catch (e) {
          if (i > 0) e.message = `${errText(e)} (enviadas ${i} de ${parts.length} partes)`;
          throw e;
        }
      }
    }
    await arun("UPDATE sms_messages SET status = 'sent', provider_id = ? WHERE id = ?", [providerId ? `out-${providerId}` : null, id]);
  } catch (e) {
    console.error(`VoIP.ms envío ${from} → ${to}:`, e.code || errText(e));
    await arun("UPDATE sms_messages SET status = 'failed', error = ? WHERE id = ?", [errText(e).slice(0, 250), id]);
  }
  const row = await aone('SELECT * FROM sms_messages WHERE id = ?', [id]);
  return { ...row, media: row.media ? JSON.parse(row.media) : [] };
}

// ---------------------------------------------------------------- Recepción
/** Guarda un mensaje entrante (webhook o consulta). Ignora duplicados por provider_id. */
export async function storeInbound({ from, to, body, media = [], providerId, date, source }) {
  const peer = normalize(from);
  if (!peer) return null;
  const lead = await findLead(peer);
  const res = await arun(
    `INSERT IGNORE INTO sms_messages (direction, did, peer, body, media, status, provider_id, lead_id, source, created_at)
     VALUES ('in', ?, ?, ?, ?, 'received', ?, ?, ?, COALESCE(?, NOW()))`,
    [normalize(to), peer, String(body ?? ''), media.length ? JSON.stringify(media) : null, providerId || null, lead, source, date || null]
  );
  if (!res.affectedRows) return null; // ya estaba
  if (STOP_WORDS.test(String(body ?? ''))) await handleStop(peer, normalize(to));
  return res.insertId;
}

// Baja: el número entra en la lista negra del sistema y se confirma una vez
async function handleStop(peer, did) {
  try {
    await nonAgentApi('add_dnc_phone', { phone_number: peer, campaign_id: 'SYSTEM_INTERNAL' });
  } catch (e) {
    if (!/already|exists|duplicate/i.test(e.message)) console.error('No se pudo añadir a DNC', peer, e.message);
  }
  const cfg = await getConfig({ withSecrets: true });
  if (cfg.enabled && cfg.stopReply) {
    try {
      await voipms(cfg, 'sendSMS', { did: did || cfg.defaultDid, dst: peer, message: cfg.stopReply.slice(0, 160) });
      await arun(
        "INSERT INTO sms_messages (direction, did, peer, body, status, source, read_at) VALUES ('out', ?, ?, ?, 'sent', 'stop', NOW())",
        [did || cfg.defaultDid, peer, cfg.stopReply.slice(0, 160)]
      );
    } catch {
      /* la baja ya está hecha aunque falle la confirmación */
    }
  }
}

/** Webhook de VoIP.ms: acepta parámetros en la URL ({FROM}, {TO}...) o el JSON del «URL Callback». */
export async function handleWebhook(query, body) {
  const p = body?.data?.payload;
  if (p) {
    return storeInbound({
      from: p.from?.phone_number,
      to: Array.isArray(p.to) ? p.to[0]?.phone_number : p.to?.phone_number,
      body: p.text,
      media: (p.media || []).map((m) => m.url).filter(Boolean),
      providerId: p.id ? `in-${p.id}` : undefined,
      date: p.received_at ? p.received_at.replace('T', ' ').slice(0, 19) : undefined,
      source: 'webhook',
    });
  }
  const q = { ...query, ...(body && typeof body === 'object' ? body : {}) };
  return storeInbound({
    from: q.from,
    to: q.to,
    body: q.message,
    media: String(q.media || '').split(',').map((s) => s.trim()).filter((s) => s.startsWith('http')),
    providerId: q.id ? `in-${q.id}` : undefined,
    date: q.date || undefined,
    source: 'webhook',
  });
}

/** Consulta periódica a VoIP.ms: recoge lo que no llegó por webhook (p. ej. servidor sin acceso público). */
export async function poll() {
  const cfg = await getConfig({ withSecrets: true });
  if (!cfg.available || !cfg.enabled) return 0;
  const fmt = (d) => d.toISOString().slice(0, 10);
  const from = fmt(new Date(Date.now() - 2 * 86400000));
  const to = fmt(new Date(Date.now() + 86400000));
  let added = 0;
  for (const did of cfg.dids) {
    for (const [method, prefix, key] of [['getSMS', 'in-', 'sms'], ['getMMS', 'in-', 'sms']]) {
      try {
        const r = await voipms(cfg, method, { did, from, to, type: '1', limit: '200', ...(method === 'getMMS' ? { all_messages: '1' } : {}) });
        for (const m of r[key] || r.mms || []) {
          const id = await storeInbound({
            from: m.contact,
            to: m.did || did,
            body: m.message,
            media: (m.media || []).map(String).filter((u) => u.startsWith('http')),
            providerId: `${prefix}${m.id}`,
            date: m.date,
            source: 'poll',
          });
          if (id) added++;
        }
      } catch (e) {
        if (!['no_sms', 'no_mms'].includes(e.code)) console.error(`VoIP.ms ${method} ${did}:`, e.code || errText(e));
      }
    }
  }
  return added;
}

export function startPolling() {
  if (!appEnabled) return;
  const run = () => poll().catch((e) => console.error('Consulta SMS:', e.message));
  setTimeout(run, 10_000);
  // Los mensajes llegan al momento por el webhook; la consulta solo recoge los que se hubieran perdido
  setInterval(run, 5 * 60_000);
}
