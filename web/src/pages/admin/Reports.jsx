import { useState } from 'react';
import { fmtDur, fmtNum } from '../../api.js';
import { Card, downloadCsv, Empty, Field, Kpi, useLoad } from '../../components/ui.jsx';
import { AdminHead } from './Overview.jsx';
import { useT } from '../../i18n.js';

const iso = (d) => d.toLocaleDateString('sv');
function preset(key) {
  const now = new Date();
  const d = (n) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);
  return {
    today: [iso(now), iso(now)],
    yesterday: [iso(d(1)), iso(d(1))],
    week: [iso(d(6)), iso(now)],
    month: [iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(now)],
  }[key];
}
const PRESETS = [['today', 'Hoy'], ['yesterday', 'Ayer'], ['week', '7 días'], ['month', 'Este mes']];
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');

export default function Reports() {
  const t = useT();
  const [range, setRange] = useState({ from: preset('today')[0], to: preset('today')[1], campaign: 'ALL' });
  const meta = useLoad('/admin/meta').data;
  const { data, error, loading } = useLoad(`/admin/reports?${new URLSearchParams(range)}`);

  const totals = data && data.agents.reduce((acc, a) => ({ calls: acc.calls + a.calls, sales: acc.sales + a.sales, talk: acc.talk + a.talk, pause: acc.pause + a.pause }), { calls: 0, sales: 0, talk: 0, pause: 0 });
  const callTotal = data ? data.dispos.reduce((s, d) => s + d.n, 0) : 0;
  const answered = data ? data.daily.reduce((s, d) => s + d.answered, 0) : 0;

  return (
    <div className="page">
      <AdminHead title={t('Reportes')} subtitle={t('Rendimiento de agentes y resultado de las llamadas')}>
        <div className="segmented">
          {PRESETS.map(([k, l]) => {
            const [from, to] = preset(k);
            const on = range.from === from && range.to === to;
            return <button key={k} className={on ? 'on' : ''} onClick={() => setRange({ ...range, from, to })}>{t(l)}</button>;
          })}
        </div>
      </AdminHead>
      <Card>
        <div className="filters">
          <Field label={t('Desde')}><input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
          <Field label={t('Hasta')}><input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
          <Field label={t('Campaña')}>
            <select value={range.campaign} onChange={(e) => setRange({ ...range, campaign: e.target.value })}>
              <option value="ALL">{t('Todas')}</option>
              {(meta?.campaigns || []).map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_id} · {c.campaign_name}</option>)}
            </select>
          </Field>
          {loading && <span className="muted">{t('Cargando…')}</span>}
        </div>
      </Card>
      {error && <div className="alert alert-error">{error}</div>}

      {data && (
        <>
          <div className="kpis">
            <Kpi label={t('Llamadas')} value={fmtNum(callTotal)} />
            <Kpi label={t('Contestadas')} value={fmtNum(answered)} tone="blue" hint={pct(answered, callTotal)} />
            <Kpi label={t('Ventas')} value={fmtNum(totals.sales)} tone="violet" hint={t('{pct} de contestadas', { pct: pct(totals.sales, answered) })} />
            <Kpi label={t('Tiempo hablado')} value={fmtDur(totals.talk)} tone="green" />
            <Kpi label={t('Tiempo en pausa')} value={fmtDur(totals.pause)} tone="amber" />
          </div>

          {data.daily.length > 1 && (
            <Card title={t('Llamadas por día')}>
              <div className="bars" style={{ height: 150 }}>
                {data.daily.map((d) => {
                  const max = Math.max(...data.daily.map((x) => x.calls), 1);
                  return (
                    <div className="bar-col" key={d.d} title={t('{day}: {calls} llamadas, {sales} ventas', { day: d.d, calls: d.calls, sales: d.sales })}>
                      <div className="bar-stack"><div className="bar" style={{ height: `${(d.calls / max) * 100}%` }}>{d.sales > 0 && <div className="bar-sales" style={{ height: `${(d.sales / d.calls) * 100}%` }} />}</div></div>
                      <div className="bar-label">{d.d.slice(8)}</div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          <Card
            title={t('Rendimiento por agente')}
            pad={false}
            actions={data.agents.length > 0 && (
              <button className="btn btn-sm" onClick={() => downloadCsv(`${t('agentes')}_${range.from}_${range.to}.csv`, data.agents.map((a) => ({
                [t('usuario')]: a.user, [t('nombre')]: a.full_name, [t('llamadas')]: a.calls, [t('ventas')]: a.sales, [t('hablado_seg')]: a.talk, [t('pausa_seg')]: a.pause,
                [t('espera_seg')]: a.wait, [t('calificando_seg')]: a.dispo, [t('muerto_seg')]: a.dead, [t('total_seg')]: a.total,
              })))}>⬇ CSV</button>
            )}
          >
            {data.agents.length === 0 ? <Empty icon="📊" title={t('Sin actividad de agentes en este periodo')} /> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>{t('Agente')}</th><th className="num">{t('Llamadas')}</th><th className="num">{t('Ventas')}</th><th className="num">{t('Conversión')}</th><th className="num">{t('Hablado')}</th><th className="num">{t('Espera')}</th><th className="num">{t('Pausa')}</th><th className="num">{t('Calificando')}</th><th>{t('Reparto del tiempo')}</th></tr></thead>
                  <tbody>
                    {data.agents.map((a) => (
                      <tr key={a.user}>
                        <td><div className="strong">{a.full_name || a.user}</div><div className="sub mono">{a.user}</div></td>
                        <td className="num">{fmtNum(a.calls)}</td>
                        <td className="num">{fmtNum(a.sales)}</td>
                        <td className="num">{pct(a.sales, a.calls)}</td>
                        <td className="num mono">{fmtDur(a.talk)}</td>
                        <td className="num mono">{fmtDur(a.wait)}</td>
                        <td className="num mono">{fmtDur(a.pause)}</td>
                        <td className="num mono">{fmtDur(a.dispo)}</td>
                        <td style={{ minWidth: 140 }}>
                          <div className="split" title={`${t('Hablado')} ${fmtDur(a.talk)} · ${t('Espera')} ${fmtDur(a.wait)} · ${t('Pausa')} ${fmtDur(a.pause)} · ${t('Calificando')} ${fmtDur(a.dispo)}`}>
                            {a.total > 0 && [['talk', 'green'], ['wait', 'blue'], ['dispo', 'violet'], ['pause', 'amber']].map(([k, c]) => (
                              <i key={k} className={`split-${c}`} style={{ width: `${(a[k] / a.total) * 100}%` }} />
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card
            title={t('Resultados de las llamadas')}
            pad={false}
            actions={data.dispos.length > 0 && (
              <button className="btn btn-sm" onClick={() => downloadCsv(`${t('resultados')}_${range.from}_${range.to}.csv`, data.dispos.map((d) => ({ [t('estado')]: d.status, [t('nombre')]: d.status_name, [t('llamadas')]: d.n, [t('porcentaje')]: pct(d.n, callTotal), [t('segundos')]: d.secs })))}>⬇ CSV</button>
            )}
          >
            {data.dispos.length === 0 ? <Empty icon="📞" title={t('No hay llamadas en este periodo')} /> : (
              <table className="table">
                <thead><tr><th>{t('Estado')}</th><th>{t('Descripción')}</th><th className="num">{t('Llamadas')}</th><th className="num">%</th><th style={{ width: '35%' }} /></tr></thead>
                <tbody>
                  {data.dispos.map((d) => (
                    <tr key={d.status}>
                      <td><span className={`chip ${d.sale === 'Y' ? 'chip-green' : ''}`}>{d.status}</span></td>
                      <td>{d.status_name || '—'}</td>
                      <td className="num">{fmtNum(d.n)}</td>
                      <td className="num">{pct(d.n, callTotal)}</td>
                      <td><div className="hbar-track"><div className="hbar-fill" style={{ width: `${(d.n / data.dispos[0].n) * 100}%` }} /></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
