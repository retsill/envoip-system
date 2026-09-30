import { useMemo, useState } from 'react';
import { fmtDur, fmtNum, fmtPhone, post, useNow, usePoll } from '../api.js';
import { Card, Empty, Kpi, StatusBadge, statusMeta, useAction } from '../components/ui.jsx';
import { useT } from '../i18n.js';
import { useConfirm } from '../components/Modal.jsx';


const FILTERS = [
  ['ALL', 'Todos'],
  ['INCALL', 'En llamada'],
  ['READY', 'Disponibles'],
  ['PAUSED', 'En pausa'],
  ['DISPO', 'Calificando'],
];

export default function Supervisor() {
  const t = useT();
  const confirm = useConfirm();
  const { data, error, refresh, fetchedAt } = usePoll('/sup/overview', 2000);
  const now = useNow();
  const [campaign, setCampaign] = useState('ALL');
  const [filter, setFilter] = useState('ALL');
  const [run, busy] = useAction();
  const drift = fetchedAt ? Math.floor((now - fetchedAt) / 1000) : 0;

  const agents = useMemo(() => {
    let a = data?.agents || [];
    if (campaign !== 'ALL') a = a.filter((x) => x.campaign_id === campaign);
    if (filter === 'READY') a = a.filter((x) => ['READY', 'CLOSER', 'QUEUE'].includes(x.status));
    else if (filter === 'INCALL') a = a.filter((x) => ['INCALL', 'DEAD'].includes(x.status));
    else if (filter !== 'ALL') a = a.filter((x) => x.status === filter);
    return a;
  }, [data, campaign, filter]);

  if (!data) return <div className="page"><PageHead />{error ? <div className="alert alert-error">{error}</div> : <div className="muted">{t('Cargando…')}</div>}</div>;

  const all = data.agents;
  const count = (fn) => all.filter(fn).length;
  const inCall = count((a) => ['INCALL', 'DEAD'].includes(a.status));
  const ready = count((a) => ['READY', 'CLOSER', 'QUEUE'].includes(a.status));
  const paused = count((a) => ['PAUSED', 'DISPO'].includes(a.status));
  const waiting = data.queue.filter((q) => q.status === 'LIVE').length;
  const conv = data.totals.answered ? ((data.totals.sales / data.totals.answered) * 100).toFixed(1) : '0.0';

  const monitor = (a, stage) =>
    run(`${a.user}-${stage}`, () => post('/sup/monitor', { agent_user: a.user, stage }), t('Llamando a tu teléfono… contesta para escuchar'));
  const agentAction = async (a, action, label) => {
    if (action === 'logout' && !(await confirm({ title: t('Desconectar'), message: t('¿Desconectar a {name}?', { name: a.full_name }), okText: t('Desconectar'), danger: true }))) return;
    run(`${a.user}-${action}`, () => post('/sup/agent-action', { agent_user: a.user, action }), label).then(refresh);
  };

  return (
    <div className="page">
      <PageHead live={!error}>
        <select value={campaign} onChange={(e) => setCampaign(e.target.value)} aria-label={t('Campaña')}>
          <option value="ALL">{t('Todas las campañas')}</option>
          {data.campaigns.map((c) => (
            <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_id} · {c.campaign_name}</option>
          ))}
        </select>
      </PageHead>
      {error && <div className="alert alert-error">{t('Sin conexión: {error}', { error })}</div>}

      <div className="kpis">
        <Kpi label={t('Agentes conectados')} value={all.length} />
        <Kpi label={t('En llamada')} value={inCall} tone="green" />
        <Kpi label={t('Disponibles')} value={ready} tone="blue" />
        <Kpi label={t('En pausa')} value={paused} tone="amber" />
        <Kpi label={t('Llamadas en cola')} value={waiting} tone={waiting ? 'red' : undefined} hint={waiting ? t('máx. {time}', { time: fmtDur(Math.max(...data.queue.map((q) => q.wait_secs))) }) : t('nadie esperando')} />
        <Kpi label={t('Llamadas hoy')} value={fmtNum(data.totals.calls)} hint={t('{time} hablado', { time: fmtDur(data.totals.talk_secs) })} />
        <Kpi label={t('Ventas hoy')} value={fmtNum(data.totals.sales)} tone="violet" hint={t('{pct}% de contestadas', { pct: conv })} />
      </div>

      <Card
        title={t('Agentes ({n})', { n: agents.length })}
        pad={false}
        actions={
          <div className="segmented" role="tablist">
            {FILTERS.map(([k, l]) => (
              <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{t(l)}</button>
            ))}
          </div>
        }
      >
        {agents.length === 0 ? (
          <Empty icon="🎧" title={t('No hay agentes conectados')}>
            {t('Cuando un agente inicie sesión en una campaña aparecerá aquí en tiempo real.')}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('Agente')}</th><th>{t('Estado')}</th><th>{t('Tiempo')}</th><th>{t('Campaña')}</th><th>{t('Cliente')}</th><th className="num">{t('Llamadas')}</th><th />
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => {
                  const secs = a.state_secs + drift;
                  const long = (a.status === 'PAUSED' && secs > 600) || (a.status === 'DISPO' && secs > 120) || a.status === 'DEAD';
                  return (
                    <tr key={a.user} className={`row-${statusMeta(a.status).tone}`}>
                      <td>
                        <div className="strong">{a.full_name}</div>
                        <div className="sub">{a.user} · {a.extension}</div>
                      </td>
                      <td>
                        <StatusBadge status={a.status} />
                        {a.pause_code && a.status === 'PAUSED' && <span className="chip">{a.pause_code}</span>}
                      </td>
                      <td className={`mono${long ? ' warn' : ''}`}>{fmtDur(secs)}</td>
                      <td>{a.campaign_id}</td>
                      <td>
                        {a.lead_id > 0 ? (
                          <>
                            <div>{a.lead_name || '—'}</div>
                            <div className="sub mono">{fmtPhone(a.phone_number)}</div>
                          </>
                        ) : <span className="muted">—</span>}
                      </td>
                      <td className="num">{a.calls_today}</td>
                      <td className="row-actions">
                        {['INCALL', 'DEAD'].includes(a.status) && data.canMonitor && (
                          <>
                            <button className="btn btn-sm" disabled={!!busy} onClick={() => monitor(a, 'MONITOR')} title={t('Escuchar sin que te oigan')}>{t('Escuchar')}</button>
                            <button className="btn btn-sm" disabled={!!busy} onClick={() => monitor(a, 'WHISPER')} title={t('Hablar solo con el agente')}>{t('Susurrar')}</button>
                            <button className="btn btn-sm" disabled={!!busy} onClick={() => monitor(a, 'BARGE')} title={t('Entrar en la llamada')}>{t('Intervenir')}</button>
                          </>
                        )}
                        {a.status === 'PAUSED' ? (
                          <button className="btn btn-sm" disabled={!!busy} onClick={() => agentAction(a, 'resume', t('Agente reanudado'))}>{t('Reanudar')}</button>
                        ) : (
                          <button className="btn btn-sm" disabled={!!busy} onClick={() => agentAction(a, 'pause', t('Se pausará al terminar la llamada'))}>{t('Pausar')}</button>
                        )}
                        <button className="btn btn-sm btn-danger-ghost" disabled={!!busy} onClick={() => agentAction(a, 'logout', t('Agente desconectado'))}>{t('Desconectar')}</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!data.canMonitor && all.some((a) => a.status === 'INCALL') && (
          <div className="card-note">{t('Para escuchar llamadas, asigna un «Phone Login» a tu usuario en Vicidial (Admin → Users → tu usuario).')}</div>
        )}
      </Card>

      <div className="grid-2">
        <Card title={t('Llamadas por hora (hoy)')}>
          <HourlyChart rows={data.hourly} />
        </Card>
        <Card title={t('Resultados de hoy')}>
          {data.dispos.length === 0 ? (
            <Empty icon="📊" title={t('Aún no hay llamadas hoy')} />
          ) : (
            <HBars rows={data.dispos} />
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card title={t('Cola de llamadas ({n})', { n: data.queue.length })} pad={false}>
          {data.queue.length === 0 ? (
            <Empty icon="✓" title={t('Sin llamadas en espera')} />
          ) : (
<div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('Estado')}</th><th>{t('Campaña / grupo')}</th><th>{t('Teléfono')}</th><th>{t('Tipo')}</th><th className="num">{t('Espera')}</th></tr></thead>
              <tbody>
                {data.queue.map((q) => (
                  <tr key={q.auto_call_id}>
                    <td><span className={`chip ${q.status === 'LIVE' ? 'chip-red' : ''}`}>{q.status === 'LIVE' ? t('En espera') : q.status}</span></td>
                    <td>{q.campaign_id}</td>
                    <td className="mono">{fmtPhone(q.phone_number)}</td>
                    <td>{q.call_type === 'IN' ? t('Entrante') : t('Saliente')}</td>
                    <td className={`num mono${q.wait_secs > 30 ? ' warn' : ''}`}>{fmtDur(q.wait_secs + drift)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
</div>
          )}
        </Card>
        <Card title={t('Campañas')} pad={false}>
          {data.campaigns.length === 0 ? (
            <Empty icon="📣" title={t('No hay campañas')}>{t('Crea una campaña en el panel de administración de Vicidial.')}</Empty>
          ) : (
<div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('Campaña')}</th><th>{t('Marcación')}</th><th className="num">Hopper</th><th className="num">{t('Llamadas')}</th><th className="num">{t('Contestadas')}</th><th className="num">Drop %</th></tr></thead>
              <tbody>
                {data.campaigns.map((c) => (
                  <tr key={c.campaign_id} className={c.active === 'Y' ? '' : 'row-muted'}>
                    <td><div className="strong">{c.campaign_id}</div><div className="sub">{c.campaign_name}</div></td>
                    <td>{c.dial_method}{c.dial_method !== 'MANUAL' && ` · ${c.auto_dial_level}`}</td>
                    <td className="num">{fmtNum(c.hopper)}</td>
                    <td className="num">{fmtNum(c.calls_today)}</td>
                    <td className="num">{fmtNum(c.answers_today)}</td>
                    <td className={`num${Number(c.drop_pct) > 3 ? ' warn' : ''}`}>{Number(c.drop_pct).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
</div>
          )}
        </Card>
      </div>
    </div>
  );
}

function PageHead({ children, live }) {
  const t = useT();
  return (
    <div className="page-head">
      <div>
        <h1>{t('Supervisión en tiempo real')}</h1>
        <p className="muted">{live ? <><span className="live-dot" /> {t('Actualizando cada 2 segundos')}</> : t('Estado de agentes, colas y campañas')}</p>
      </div>
      <div className="page-actions">{children}</div>
    </div>
  );
}

function HourlyChart({ rows }) {
  const t = useT();
  const hours = [];
  const from = Math.min(8, ...rows.map((r) => r.h));
  const to = Math.max(new Date().getHours(), 18, ...rows.map((r) => r.h));
  for (let h = from; h <= to; h++) hours.push(rows.find((r) => r.h === h) || { h, calls: 0, sales: 0 });
  const max = Math.max(1, ...hours.map((r) => r.calls));
  return (
    <div>
      <div className="bars" role="img" aria-label={t('Llamadas y ventas por hora')}>
        {hours.map((r) => (
          <div className="bar-col" key={r.h} title={t('{h}:00 · {calls} llamadas · {sales} ventas', { h: r.h, calls: r.calls, sales: r.sales })}>
            <div className="bar-stack">
              <div className="bar" style={{ height: `${(r.calls / max) * 100}%` }}>
                {r.sales > 0 && <div className="bar-sales" style={{ height: `${(r.sales / r.calls) * 100}%` }} />}
              </div>
            </div>
            <div className="bar-label">{r.h}</div>
          </div>
        ))}
      </div>
      <div className="legend">
        <span><i className="sw sw-calls" />{t('Llamadas')}</span>
        <span><i className="sw sw-sales" />{t('Ventas')}</span>
      </div>
    </div>
  );
}

function HBars({ rows }) {
  const max = Math.max(...rows.map((r) => r.n));
  return (
    <div className="hbars">
      {rows.map((r) => (
        <div className="hbar" key={r.status}>
          <div className="hbar-label" title={r.status_name}>{r.status_name || r.status}</div>
          <div className="hbar-track"><div className="hbar-fill" style={{ width: `${(r.n / max) * 100}%` }} /></div>
          <div className="hbar-val">{fmtNum(r.n)}</div>
        </div>
      ))}
    </div>
  );
}
