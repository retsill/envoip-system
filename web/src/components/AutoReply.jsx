import { useEffect, useState } from 'react';
import { api, fmtPhone } from '../api.js';
import { Drawer, Field, useAction, useLoad } from './ui.jsx';
import { useT } from '../i18n.js';

const DAYS = [
  [1, 'Lun'],
  [2, 'Mar'],
  [3, 'Mié'],
  [4, 'Jue'],
  [5, 'Vie'],
  [6, 'Sáb'],
  [0, 'Dom'],
];

/** Respuesta automática de cada número de la empresa: bienvenida al primer mensaje y aviso fuera de horario. */
export default function AutoReply({ open, onClose }) {
  const t = useT();
  const { data, error, reload } = useLoad(open ? '/sms/autoreply' : null);
  const [did, setDid] = useState('');
  const [f, setF] = useState(null);
  const [run, busy] = useAction();

  const numbers = data?.numbers || [];
  useEffect(() => {
    if (!numbers.length) return;
    const cur = numbers.find((n) => n.did === did) || numbers[0];
    setDid(cur.did);
    setF({ ...cur });
  }, [data, did]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const toggleDay = (d) => set('days', f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d]);
  const save = () => run('save', () => api('/sms/autoreply', { method: 'PUT', body: f }), t('Respuesta automática guardada')).then(reload);
  const parts = (s) => (s ? Math.ceil(s.length / 160) : 0);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t('Respuesta automática')}
      subtitle={t('Se envía sola cuando un cliente escribe a tu número')}
      footer={f && <button className="btn btn-primary" disabled={!!busy} onClick={save}>{t('Guardar')}</button>}
    >
      {error && <div className="alert alert-error">{error}</div>}
      {data && !numbers.length && <div className="alert alert-info">{t('Tu empresa no tiene ningún número con SMS configurado.')}</div>}
      {f && (
        <div className="stack">
          {numbers.length > 1 && (
            <Field label={t('Número')}>
              <select value={did} onChange={(e) => setDid(e.target.value)}>
                {numbers.map((n) => <option key={n.did} value={n.did}>{fmtPhone(n.did)}</option>)}
              </select>
            </Field>
          )}
          {numbers.length === 1 && <p className="muted">{t('Número')}: <b>{fmtPhone(f.did)}</b></p>}
          <Field
            label={t('Bienvenida (primer mensaje del cliente)')}
            hint={t('Vacío = sin bienvenida. {n} SMS. Se vuelve a enviar si el cliente no escribía desde hace {d} días.', { n: parts(f.welcome), d: f.resendDays })}
          >
            <textarea rows={4} maxLength={480} value={f.welcome} onChange={(e) => set('welcome', e.target.value)} placeholder={t('Gracias por escribirnos. Un asesor le responderá en breve.')} />
          </Field>
          <Field label={t('Fuera de horario')} hint={t('Vacío = sin aviso. {n} SMS. Como mucho uno cada 12 horas por cliente.', { n: parts(f.afterHours) })}>
            <textarea rows={3} maxLength={480} value={f.afterHours} onChange={(e) => set('afterHours', e.target.value)} placeholder={t('Ahora estamos cerrados; le contestaremos mañana a primera hora.')} />
          </Field>
          <Field label={t('Días de atención')}>
            <div className="row-gap" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
              {DAYS.map(([d, name]) => (
                <button key={d} type="button" className={`btn btn-sm ${f.days.includes(d) ? 'btn-primary' : 'btn-ghost'}`} onClick={() => toggleDay(d)}>{t(name)}</button>
              ))}
            </div>
          </Field>
          <div className="grid-2">
            <Field label={t('Desde')}><input type="time" value={f.start} onChange={(e) => set('start', e.target.value)} /></Field>
            <Field label={t('Hasta')}><input type="time" value={f.end} onChange={(e) => set('end', e.target.value)} /></Field>
          </div>
          <Field label={t('Repetir la bienvenida tras (días sin escribir)')}>
            <input type="number" min={1} max={365} value={f.resendDays} onChange={(e) => set('resendDays', e.target.value)} />
          </Field>
          <p className="small muted">{t('Horario de Nueva York (hora del servidor). Las respuestas cuentan en el límite diario de SMS del número.')}</p>
        </div>
      )}
    </Drawer>
  );
}
