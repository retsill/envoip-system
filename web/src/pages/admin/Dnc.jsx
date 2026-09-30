import { useState } from 'react';
import { api, fmtNum, post } from '../../api.js';
import { Card, Field, useAction, useLoad } from '../../components/ui.jsx';
import { AdminHead } from './Overview.jsx';
import { useT } from '../../i18n.js';
import { useConfirm } from '../../components/Modal.jsx';


export default function Dnc() {
  const t = useT();
  const confirm = useConfirm();
  const [phone, setPhone] = useState('');
  const [checked, setChecked] = useState(null);
  const [target, setTarget] = useState('');
  const totals = useLoad('/admin/dnc');
  const meta = useLoad('/admin/meta').data;
  const [run, busy] = useAction();

  const check = async (e, p = phone) => {
    e?.preventDefault();
    const r = await run('check', () => api(`/admin/dnc?phone=${encodeURIComponent(p)}`));
    if (r) setChecked(r.result);
  };
  const add = async () => {
    const ok = await run('add', () => post('/admin/dnc', { phone, campaign_id: target || undefined }), t('Número añadido a la lista negra'));
    if (ok) { check(null); totals.reload(); }
  };
  const remove = async (campaign_id) => {
    if (!(await confirm({ title: t('Quitar de la lista negra'), message: campaign_id ? t('¿Quitar {phone} de la lista negra de la campaña {c}?', { phone, c: campaign_id }) : t('¿Quitar {phone} de la lista negra del sistema?', { phone }), okText: t('Quitar') }))) return;
    const ok = await run('del', () => post('/admin/dnc/delete', { phone, campaign_id }), t('Número quitado de la lista negra'));
    if (ok) { check(null); totals.reload(); }
  };

  return (
    <div className="page">
      <AdminHead title={t('Lista negra (DNC)')} subtitle={t('Números que Vicidial nunca marcará')} />
      <div className="grid-2">
        <Card title={t('Consultar o añadir un número')}>
          <form className="stack" onSubmit={check}>
            <Field label={t('Teléfono')}>
              <input autoFocus inputMode="tel" value={phone} onChange={(e) => { setPhone(e.target.value.replace(/\D/g, '')); setChecked(null); }} placeholder={t('Número completo')} />
            </Field>
            <button className="btn" disabled={phone.length < 6 || !!busy}>{t('Consultar')}</button>
          </form>

          {checked && (
            <div className="stack" style={{ marginTop: 16 }}>
              {checked.system || checked.campaigns.length ? (
                <div className="alert alert-error">
                  ⛔ <b>{checked.phone}</b> {t('está bloqueado en:')}
                  <ul className="plain" style={{ marginTop: 8 }}>
                    {checked.system && <li>{t('Lista del sistema (todas las campañas)')} <button type="button" className="btn btn-sm btn-ghost" onClick={() => remove(undefined)}>{t('Quitar')}</button></li>}
                    {checked.campaigns.map((c) => <li key={c}>{t('Campaña {id}', { id: c })} <button type="button" className="btn btn-sm btn-ghost" onClick={() => remove(c)}>{t('Quitar')}</button></li>)}
                  </ul>
                </div>
              ) : (
                <div className="alert alert-ok">✓ <b>{checked.phone}</b> {t('no está en ninguna lista negra.')}</div>
              )}
              <div className="row-gap" style={{ justifyContent: 'flex-start', alignItems: 'flex-end' }}>
                <Field label={t('Añadir a')}>
                  <select value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value="">{t('Lista del sistema (todas las campañas)')}</option>
                    {(meta?.campaigns || []).map((c) => <option key={c.campaign_id} value={c.campaign_id}>{t('Solo campaña {id}', { id: c.campaign_id })}</option>)}
                  </select>
                </Field>
                <button type="button" className="btn btn-danger" disabled={!!busy} onClick={add}>{t('Bloquear número')}</button>
              </div>
            </div>
          )}
        </Card>
        <Card title={t('Totales')}>
          <div className="kpis kpis-sm">
            <div className="kpi"><div className="kpi-label">{t('Sistema')}</div><div className="kpi-value">{fmtNum(totals.data?.totals.system)}</div></div>
            <div className="kpi"><div className="kpi-label">{t('Por campaña')}</div><div className="kpi-value">{fmtNum(totals.data?.totals.campaigns)}</div></div>
          </div>
          <p className="muted small" style={{ marginTop: 12 }}>
            {t('Los agentes también añaden números aquí al calificar una llamada como «DNC». Para que una campaña respete la lista, revisa «Use Internal DNC List» en sus opciones del admin clásico.')}
          </p>
        </Card>
      </div>
    </div>
  );
}
