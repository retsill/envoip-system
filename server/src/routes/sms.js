import { Router } from 'express';
import path from 'node:path';
import { one } from '../db.js';
import * as sms from '../sms.js';
import { requireAuth, requireLevel } from '../auth.js';
import { assertAll, loadScope, withScope } from '../scope.js';
import { ah, HttpError } from '../util.js';

// ---------------------------------------------------------------- Público (webhook de VoIP.ms)
export const smsWebhook = Router();
smsWebhook.all(
  '/voipms',
  ah(async (req, res) => {
    const cfg = await sms.getConfig();
    if (!cfg.available || !req.query.token || req.query.token !== cfg.webhookToken) throw new HttpError(403, 'token no válido');
    await sms.handleWebhook(req.query, req.body);
    res.type('text/plain').send('ok'); // VoIP.ms espera exactamente «ok»
  })
);

// ---------------------------------------------------------------- Usuarios conectados
const router = Router();
router.use(requireAuth);

// Números (DIDs) de la empresa del usuario: solo ve, recibe y envía por ellos
router.use(
  ah(async (req, res, next) => {
    req.scope = await loadScope(req.user.user);
    const cfg = await sms.getConfig();
    req.smsDids = cfg.available ? await sms.didsFor(req.scope, cfg) : [];
    next();
  })
);

router.get(
  '/status',
  ah(async (req, res) => {
    const cfg = await sms.getConfig();
    const dids = req.smsDids;
    res.json({
      available: cfg.available,
      enabled: cfg.enabled && dids.length > 0,
      dids,
      defaultDid: dids.includes(cfg.defaultDid) ? cfg.defaultDid : dids[0] || '',
    });
  })
);

router.get('/unread', ah(async (req, res) => res.json({ count: (await sms.getConfig()).available ? await sms.unreadCount(req.smsDids) : 0 })));

router.get(
  '/conversations',
  ah(async (req, res) =>
    res.json(await sms.conversations({ q: String(req.query.q || ''), unreadOnly: req.query.unread === '1', dids: req.smsDids }))
  )
);

router.get(
  '/thread',
  ah(async (req, res) => {
    const peer = sms.normalize(req.query.peer);
    if (!peer) throw new HttpError(400, 'Falta el número');
    const lead = await sms.findLead(peer);
    const info = lead
      ? await one(
          `SELECT lead_id, list_id, status, phone_number, TRIM(CONCAT(IFNULL(first_name,''),' ',IFNULL(last_name,''))) name, city
           FROM vicidial_list WHERE lead_id = ?`,
          [lead]
        )
      : null;
    const dnc = await one(
      'SELECT (SELECT COUNT(*) FROM vicidial_dnc WHERE phone_number = ?) + (SELECT COUNT(*) FROM vicidial_campaign_dnc WHERE phone_number = ?) n',
      [peer, peer]
    );
    res.json({ peer, lead: info, dnc: Number(dnc.n) > 0, messages: await sms.thread(peer, { afterId: Number(req.query.after || 0), dids: req.smsDids }) });
  })
);

// Conversación del lead que el agente tiene en pantalla
router.get(
  '/lead/:leadId',
  ah(async (req, res) => {
    const lead = await one('SELECT lead_id, phone_number, alt_phone FROM vicidial_list WHERE lead_id = ?', [req.params.leadId]);
    if (!lead) throw new HttpError(404, 'Lead no encontrado');
    const peer = sms.normalize(lead.phone_number);
    res.json({ peer, messages: await sms.thread(peer, { dids: req.smsDids }) });
  })
);

router.post(
  '/send',
  ah(async (req, res) => {
    const b = req.body || {};
    // Agente en una campaña: el SMS sale por el número (Caller ID) de esa campaña si es de su empresa
    const camp = await one(
      'SELECT c.campaign_cid FROM vicidial_live_agents la JOIN vicidial_campaigns c ON c.campaign_id = la.campaign_id WHERE la.user = ?',
      [req.user.user]
    );
    const msg = await sms.send({
      allowed: req.smsDids,
      preferred: camp?.campaign_cid,
      peer: b.peer,
      body: b.body,
      media: Array.isArray(b.media) ? b.media : [],
      leadId: b.lead_id ? Number(b.lead_id) : undefined,
      did: b.did,
      user: req.user.user,
      source: b.source === 'app' ? 'app' : 'web',
    });
    res.status(msg.status === 'failed' ? 502 : 200).json(msg.status === 'failed' ? { error: msg.error, message: msg } : msg);
  })
);

router.post(
  '/read',
  ah(async (req, res) => {
    await sms.markRead(req.body?.peer, req.smsDids);
    res.json({ ok: true });
  })
);

// Sincronización incremental para la app EnVoIP Phone
router.get('/feed', ah(async (req, res) => res.json(await sms.feed(Number(req.query.after || 0), { dids: req.smsDids }))));

// Imágenes enviadas (se sirven solo a usuarios conectados)
router.get(
  '/media/:file',
  ah(async (req, res) => {
    const file = path.basename(req.params.file);
    if (!/^[\w-]+\.(png|jpe?g|gif|webp)$/i.test(file)) throw new HttpError(400, 'archivo no válido');
    if (!(await sms.mediaVisible(file, req.smsDids))) throw new HttpError(404, 'Ruta no encontrada');
    res.sendFile(path.join(sms.MEDIA_DIR, file), { maxAge: '7d' });
  })
);

// ---------------------------------------------------------------- Administración
router.get(
  '/settings',
  requireLevel(8),
  withScope,
  ah(async (req, res) => {
    assertAll(req.scope);
    const cfg = await sms.getConfig();
    const base = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers['x-forwarded-host'] || req.headers.host}${process.env.BASE_PATH || '/modern'}`;
    res.json({
      ...cfg,
      // Plantilla para voip.ms → DID → SMS/MMS URL Callback
      webhookUrl: `${base}/api/sms-hook/voipms?token=${cfg.webhookToken}&to={TO}&from={FROM}&message={MESSAGE}&id={ID}&date={TIMESTAMP}&media={MEDIA}`,
    });
  })
);

router.put(
  '/settings',
  requireLevel(8),
  withScope,
  ah(async (req, res) => {
    assertAll(req.scope);
    await sms.saveConfig(req.body || {});
    res.json({ ok: true });
  })
);

router.post('/settings/test', requireLevel(8), withScope, ah(async (req, res) => assertAll(req.scope) || res.json({ ok: true, dids: await sms.testConfig() })));

router.post('/poll', requireLevel(8), withScope, ah(async (req, res) => assertAll(req.scope) || res.json({ added: await sms.poll() })));

export default router;
