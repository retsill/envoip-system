import { useState } from 'react';
import { api, fmtNum } from '../../api.js';
import { Card, Drawer, Empty, Field, Toggle, useAction, useLoad } from '../../components/ui.jsx';
import { AdminHead, CLASSIC } from './Overview.jsx';
import { useT } from '../../i18n.js';
import { useConfirm } from '../../components/Modal.jsx';


const METHOD_HELP = {
  MANUAL: 'El agente marca cada número (o pulsa «siguiente lead»).',
  RATIO: 'Marcador automático: marca «nivel» llamadas por agente disponible.',
  ADAPT_AVERAGE: 'Predictivo: ajusta el nivel solo para mantener el % de abandono.',
  ADAPT_HARD_LIMIT: 'Predictivo con límite estricto de abandono.',
  ADAPT_TAPERED: 'Predictivo que se vuelve más conservador con el día.',
  INBOUND_MAN: 'Entrantes + marcación manual.',
};

export default function Campaigns() {
  const t = useT();
  const { data, error, reload } = useLoad('/admin/campaigns');
  const meta = useLoad('/admin/meta').data;
  const [editing, setEditing] = useState(null);

  return (
    <div className="page">
      <AdminHead title={t('Campañas')} subtitle={t('Controla cómo y a quién marca cada campaña')}>
        <a className="btn btn-primary" href={CLASSIC.newCampaign} target="_blank" rel="noreferrer">＋ {t('Nueva campaña')} ↗</a>
      </AdminHead>
      {error && <div className="alert alert-error">{error}</div>}
      {!data ? <div className="muted">{t('Cargando…')}</div> : data.campaigns.length === 0 ? (
        <Card><Empty icon="📣" title={t('No hay campañas')}>{t('Crea la primera en el admin clásico con el botón «Nueva campaña».')}</Empty></Card>
      ) : (
        <div className="camp-grid">
          {data.campaigns.map((c) => (
            <button key={c.campaign_id} className={`camp ${c.active === 'Y' ? '' : 'camp-off'}`} onClick={() => setEditing(c)}>
              <div className="camp-top">
                <span className="mono strong">{c.campaign_id}</span>
                <span className={`chip ${c.active === 'Y' ? 'chip-green' : ''}`}>{c.active === 'Y' ? t('Activa') : t('Inactiva')}</span>
              </div>
              <div className="camp-name">{c.campaign_name}</div>
              <div className="camp-method">{c.dial_method}{c.dial_method !== 'MANUAL' && ` · ${t('nivel {level}', { level: c.auto_dial_level })}`}</div>
              <div className="camp-stats">
                <span><b>{c.agents}</b> {t('agentes')}</span>
                <span><b>{fmtNum(c.hopper)}</b> {t('en hopper')}</span>
                <span><b>{c.active_lists}</b>/{c.lists} {t('listas')}</span>
                <span><b>{fmtNum(c.calls_today)}</b> {t('llamadas hoy')}</span>
              </div>
              {!Number(c.active_lists) && c.active === 'Y' && <div className="camp-warn">⚠ {t('Sin listas activas')}</div>}
            </button>
          ))}
        </div>
      )}
      {editing && <CampaignDrawer c={editing} statuses={data.statuses} meta={meta} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function CampaignDrawer({ c, statuses, meta, onClose, onSaved }) {
  const t = useT();
  const confirm = useConfirm();
  const initial = {
    campaign_name: c.campaign_name, active: c.active === 'Y', dial_method: c.dial_method, auto_dial_level: c.auto_dial_level,
    hopper_level: c.hopper_level, dial_timeout: c.dial_timeout, lead_order: c.lead_order, lead_order_randomize: c.lead_order_randomize === 'Y',
    campaign_cid: c.campaign_cid, dial_statuses: c.dial_statuses,
  };
  const [f, setF] = useState(initial);
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const changed = Object.keys(f).filter((k) => JSON.stringify(f[k]) !== JSON.stringify(initial[k]));
  const toggleStatus = (s) =>
    setF({ ...f, dial_statuses: f.dial_statuses.includes(s) ? f.dial_statuses.filter((x) => x !== s) : [...f.dial_statuses, s] });

  const patch = (body, msg) => run('save', () => api(`/admin/campaigns/${encodeURIComponent(c.campaign_id)}`, { method: 'PATCH', body }), msg);
  const save = async () => {
    const ok = await patch(Object.fromEntries(changed.map((k) => [k, f[k]])), t('Campaña actualizada'));
    if (ok) onSaved();
  };
  const resetHopper = async () => {
    if (await confirm({ title: t('Reiniciar hopper'), message: t('¿Vaciar el hopper? Se volverá a llenar con los leads marcables en el próximo minuto.'), okText: t('Reiniciar hopper'), icon: '↻' })) await patch({ reset_hopper: true }, t('Hopper reiniciado'));
  };
  const orders = meta?.leadOrders || [c.lead_order];

  return (
    <Drawer
      open
      onClose={onClose}
      title={t('Campaña {id}', { id: c.campaign_id })}
      subtitle={c.campaign_name}
      footer={<>
        <button className="btn btn-ghost" style={{ marginRight: 'auto' }} disabled={!!busy} onClick={resetHopper}>{t('Reiniciar hopper')}</button>
        <button className="btn btn-ghost" onClick={onClose}>{t('Cancelar')}</button>
        <button className="btn btn-primary" disabled={!!busy || !changed.length} onClick={save}>{t('Guardar')}{changed.length ? ` (${changed.length})` : ''}</button>
      </>}
    >
      <div className="stack">
        <Toggle checked={f.active} onChange={set('active')} label={f.active ? t('Campaña activa') : t('Campaña inactiva (los agentes no pueden entrar)')} />
        <Field label={t('Nombre')} dirty={changed.includes('campaign_name')}><input value={f.campaign_name} onChange={set('campaign_name')} /></Field>

        <fieldset className="fgroup"><legend>{t('Marcación')}</legend>
          <div className="stack">
            <Field label={t('Método')} dirty={changed.includes('dial_method')} hint={METHOD_HELP[f.dial_method] && t(METHOD_HELP[f.dial_method])}>
              <select value={f.dial_method} onChange={set('dial_method')}>
                {(meta?.dialMethods || [f.dial_method]).map((m) => <option key={m}>{m}</option>)}
              </select>
            </Field>
            <div className="fgrid">
              <Field label={t('Nivel de marcación')} dirty={changed.includes('auto_dial_level')} hint={t('Llamadas por agente (RATIO)')}>
                <input type="number" min="0" max="20" step="0.5" value={f.auto_dial_level} onChange={set('auto_dial_level')} disabled={f.dial_method === 'MANUAL'} />
              </Field>
              <Field label={t('Timbrado (s)')} dirty={changed.includes('dial_timeout')}><input type="number" min="1" max="120" value={f.dial_timeout} onChange={set('dial_timeout')} /></Field>
              <Field label={t('Tamaño del hopper')} dirty={changed.includes('hopper_level')} hint={t('Ahora: {n}', { n: c.hopper })}><input type="number" min="1" max="2000" value={f.hopper_level} onChange={set('hopper_level')} /></Field>
              <Field label={t('Caller ID saliente')} dirty={changed.includes('campaign_cid')}><input inputMode="numeric" value={f.campaign_cid} onChange={(e) => setF({ ...f, campaign_cid: e.target.value.replace(/\D/g, '') })} /></Field>
            </div>
          </div>
        </fieldset>

        <fieldset className="fgroup"><legend>{t('Orden de los leads')}</legend>
          <div className="stack">
            <Field label={t('Orden')} dirty={changed.includes('lead_order')}>
              <select value={f.lead_order} onChange={set('lead_order')}>
                {(orders.includes(f.lead_order) ? orders : [f.lead_order, ...orders]).map((o) => <option key={o}>{o}</option>)}
              </select>
            </Field>
            <Toggle checked={f.lead_order_randomize} onChange={set('lead_order_randomize')} label={t('Aleatorizar dentro del orden')} />
          </div>
        </fieldset>

        <fieldset className="fgroup"><legend>{t('Estados que se vuelven a marcar')}</legend>
          <p className="muted small">{t('Los leads con estos estados entran en el hopper. «NEW» son los que nunca se han llamado.')}</p>
          <div className="status-picks">
            {statuses.map((s) => (
              <button type="button" key={s.status} className={`pick ${f.dial_statuses.includes(s.status) ? 'on' : ''}`} onClick={() => toggleStatus(s.status)} title={s.status_name}>
                {s.status}
              </button>
            ))}
          </div>
        </fieldset>

        <dl className="dl">
          <dt>{t('Horario de llamadas')}</dt><dd>{c.local_call_time}</dd>
          <dt>{t('Grabación')}</dt><dd>{c.campaign_recording}</dd>
          <dt>{t('Entrar sin leads')}</dt><dd>{c.no_hopper_leads_logins === 'Y' ? t('Permitido') : t('No')}</dd>
        </dl>
        <a className="small" href={CLASSIC.campaign(c.campaign_id)} target="_blank" rel="noreferrer">{t('Horario, grabación y resto de opciones en el admin clásico')} ↗</a>
      </div>
    </Drawer>
  );
}
