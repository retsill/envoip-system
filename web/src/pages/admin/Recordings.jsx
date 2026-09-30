import { useState } from 'react';
import { api, fmtDur, fmtPhone } from '../../api.js';
import { Card, Empty, Field } from '../../components/ui.jsx';
import { AdminHead } from './Overview.jsx';
import { useT } from '../../i18n.js';

const today = () => new Date().toLocaleDateString('sv');

export default function Recordings() {
  const t = useT();
  const [f, setF] = useState({ date: today(), user: '', phone: '' });
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const search = async (e) => {
    e?.preventDefault();
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
      setRows(await api(`/admin/recordings?${qs}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <AdminHead title={t('Grabaciones')} subtitle={t('Busca llamadas grabadas y escúchalas aquí mismo')} />
      <Card>
        <form className="filters" onSubmit={search}>
          <Field label={t('Fecha')}><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label={t('Agente (usuario)')}><input value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })} placeholder={t('Ej.: 1001')} /></Field>
          <Field label={t('Teléfono del cliente')}><input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder={t('Últimos dígitos')} /></Field>
          <button className="btn btn-primary" disabled={loading}>{loading ? t('Buscando…') : t('Buscar')}</button>
        </form>
      </Card>
      {error && <div className="alert alert-error">{error}</div>}
      {rows && (
        <Card title={t('{n} grabaciones', { n: rows.length }) + (rows.length === 300 ? ` ${t('(máximo mostrado)')}` : '')} pad={false}>
          {rows.length === 0 ? (
            <Empty icon="🎙" title={t('No hay grabaciones con esos filtros')}>
              {t('Las llamadas solo se graban si la campaña tiene la grabación activada (ALLCALLS) o si el agente pulsa «grabar».')}
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>{t('Fecha')}</th><th>{t('Agente')}</th><th>{t('Cliente')}</th><th className="num">{t('Duración')}</th><th>{t('Escuchar')}</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.recording_id}>
                      <td className="mono small">{r.start_time?.slice(0, 16)}</td>
                      <td>{r.full_name || r.user}<span className="sub mono">{r.user}</span></td>
                      <td>{r.lead_name || '—'}<span className="sub mono">{fmtPhone(r.phone_number)}</span></td>
                      <td className="num mono">{fmtDur(r.length_in_sec)}</td>
                      <td>
                        {r.url ? (
                          <div className="rec">
                            <audio controls preload="none" src={r.url} />
                            <a className="btn btn-sm btn-ghost" href={r.url} download title={t('Descargar')}>⬇</a>
                          </div>
                        ) : <span className="muted small">{t('En proceso…')}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
