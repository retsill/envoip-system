import { Router } from 'express';
import { all, one, saleStatuses } from '../db.js';
import { agentApi, nonAgentApi } from '../vici.js';
import { ah, HttpError, str } from '../util.js';
import { assertScope, callScope, inScope } from '../scope.js';

const router = Router();

// Llamadas de hoy de la empresa del supervisor (salientes de sus campañas y entrantes de sus colas)
function todayCalls(scope) {
  const cs = callScope(scope);
  return {
    sql: `
  SELECT call_date, status, length_in_sec, campaign_id FROM vicidial_log WHERE call_date >= CURDATE() AND ${cs.out.sql}
  UNION ALL
  SELECT call_date, status, length_in_sec, campaign_id FROM vicidial_closer_log WHERE call_date >= CURDATE() AND ${cs.in.sql}`,
    args: [...cs.out.args, ...cs.in.args],
  };
}

// Todo lo que necesita el panel en tiempo real en una sola llamada
router.get(
  '/overview',
  ah(async (req, res) => {
    const sales = await saleStatuses();
    const sc = req.scope;
    const T = todayCalls(sc);
    const ag = inScope(sc, 'groups', 'u.user_group');
    const qf = sc.all ? { sql: '1=1', args: [] } : { sql: 'campaign_id IN (?)', args: [[...sc.campaigns, ...sc.ingroups, '-']] };
    const cf = inScope(sc, 'campaigns', 'c.campaign_id');
    const [agents, queue, campaigns, totals, hourly, dispos, me] = await Promise.all([
      all(`
        SELECT la.user, u.full_name, u.user_group, la.status, la.campaign_id, la.lead_id, la.calls_today,
               la.pause_code, la.comments, la.extension, la.conf_exten,
               TIMESTAMPDIFF(SECOND, la.last_state_change, NOW()) AS state_secs,
               vl.phone_number, TRIM(CONCAT(IFNULL(vl.first_name,''),' ',IFNULL(vl.last_name,''))) AS lead_name,
               (SELECT COUNT(*) FROM vicidial_auto_calls ac WHERE ac.callerid = la.callerid) AS has_call
        FROM vicidial_live_agents la
        JOIN vicidial_users u ON u.user = la.user
        LEFT JOIN vicidial_list vl ON vl.lead_id = la.lead_id AND la.lead_id > 0
        WHERE ${ag.sql}
        ORDER BY la.status, state_secs DESC`, ag.args),
      all(`
        SELECT auto_call_id, status, campaign_id, phone_number, call_type,
               TIMESTAMPDIFF(SECOND, call_time, NOW()) AS wait_secs
        FROM vicidial_auto_calls
        WHERE status IN ('LIVE','IVR','SENT','RING','CLOSER') AND ${qf.sql}
        ORDER BY call_time`, qf.args),
      all(`
        SELECT c.campaign_id, c.campaign_name, c.active, c.dial_method, c.auto_dial_level,
               IFNULL(s.dialable_leads,0) dialable_leads, IFNULL(s.calls_today,0) calls_today,
               IFNULL(s.answers_today,0) answers_today, IFNULL(s.drops_today,0) drops_today,
               IFNULL(s.drops_answers_today_pct,0) drop_pct,
               (SELECT COUNT(*) FROM vicidial_hopper h WHERE h.campaign_id = c.campaign_id) hopper
        FROM vicidial_campaigns c LEFT JOIN vicidial_campaign_stats s USING (campaign_id)
        WHERE ${cf.sql}
        ORDER BY c.active DESC, c.campaign_id`, cf.args),
      one(`SELECT COUNT(*) calls, IFNULL(SUM(status IN (?)),0) sales, IFNULL(SUM(length_in_sec),0) talk_secs,
                  IFNULL(SUM(length_in_sec > 0),0) answered FROM (${T.sql}) t`, [sales, ...T.args]),
      all(`SELECT HOUR(call_date) h, COUNT(*) calls, SUM(status IN (?)) sales FROM (${T.sql}) t GROUP BY h ORDER BY h`, [sales, ...T.args]),
      all(`SELECT t.status, COUNT(*) n, MAX(s.status_name) status_name
           FROM (${T.sql}) t
           LEFT JOIN (SELECT status, status_name FROM vicidial_statuses
                      UNION SELECT status, status_name FROM vicidial_campaign_statuses) s ON s.status = t.status
           GROUP BY t.status ORDER BY n DESC LIMIT 10`, T.args),
      one('SELECT phone_login FROM vicidial_users WHERE user=?', [req.user.user]),
    ]);

    for (const a of agents) {
      // Mismas reglas que el Real-Time Report de Vicidial
      if (a.status === 'PAUSED' && a.lead_id > 0) a.status = 'DISPO';
      else if (a.status === 'INCALL' && !a.has_call && !/^M\d/.test(a.comments || '')) a.status = 'DEAD';
      delete a.has_call;
    }

    res.json({
      now: new Date().toISOString(),
      agents,
      queue,
      campaigns,
      totals: { ...totals, sales: Number(totals.sales), answered: Number(totals.answered), talk_secs: Number(totals.talk_secs) },
      hourly: hourly.map((r) => ({ h: r.h, calls: Number(r.calls), sales: Number(r.sales) })),
      dispos: dispos.map((r) => ({ ...r, n: Number(r.n) })),
      canMonitor: Boolean(me?.phone_login),
    });
  })
);

// Escuchar / intervenir: Vicidial llama al teléfono del supervisor y lo mete en la sala del agente
router.post(
  '/monitor',
  ah(async (req, res) => {
    const agent = str(req.body.agent_user, { max: 20, name: 'agente' });
    assertScope(req.scope, 'users', agent);
    const stage = { MONITOR: 'MONITOR', BARGE: 'BARGE', WHISPER: 'WHISPER' }[req.body.stage] || 'MONITOR';
    const me = await one('SELECT phone_login FROM vicidial_users WHERE user=?', [req.user.user]);
    if (!me?.phone_login) throw new HttpError(400, 'Asigna un teléfono (Phone Login) a tu usuario en Vicidial para poder escuchar');
    const la = await one('SELECT conf_exten, server_ip FROM vicidial_live_agents WHERE user=?', [agent]);
    if (!la) throw new HttpError(404, 'Ese agente ya no está conectado');
    const out = await nonAgentApi('blind_monitor', {
      phone_login: me.phone_login,
      session_id: la.conf_exten,
      server_ip: la.server_ip,
      stage,
    });
    res.json({ ok: true, message: out });
  })
);

// Acciones del supervisor sobre un agente
router.post(
  '/agent-action',
  ah(async (req, res) => {
    const agent = str(req.body.agent_user, { max: 20, name: 'agente' });
    assertScope(req.scope, 'users', agent);
    const actions = {
      pause: ['external_pause', { value: 'PAUSE' }],
      resume: ['external_pause', { value: 'RESUME' }],
      logout: ['logout', { value: 'LOGOUT' }],
    };
    const a = actions[req.body.action];
    if (!a) throw new HttpError(400, 'Acción no válida');
    const out = await agentApi(agent, a[0], a[1]);
    res.json({ ok: true, message: out });
  })
);

export default router;
