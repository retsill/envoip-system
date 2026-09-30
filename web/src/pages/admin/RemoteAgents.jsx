import { useState } from 'react';
import { api } from '../../api.js';
import { Card, Drawer, Empty, Field, Toggle, useAction, useLoad } from '../../components/ui.jsx';
import { AdminHead } from './Overview.jsx';
import { useT } from '../../i18n.js';

const NEW_REMOTE = '/vicidial/admin.php?ADD=11111';

export default function RemoteAgents() {
  const t = useT();
  const { data, error, reload } = useLoad('/admin/remote-agents');
  const meta = useLoad('/admin/meta').data;
  const [editing, setEditing] = useState(null);

  return (
    <div className="page">
      <AdminHead title={t('Agentes remotos')} subtitle={t('Agentes que atienden desde un teléfono externo (móvil, fijo) sin pantalla de agente')}>
        <a className="btn btn-primary" href={NEW_REMOTE} target="_blank" rel="noreferrer">＋ {t('Nuevo agente remoto')} ↗</a>
      </AdminHead>
      {error && <div className="alert alert-error">{error}</div>}
      <Card pad={false}>
        {!data ? <div className="card-body muted">{t('Cargando…')}</div> : data.length === 0 ? (
          <Empty icon="📱" title={t('No hay agentes remotos')}>
            {t('Un agente remoto recibe las llamadas de la campaña directamente en un número externo. Se crean en el admin clásico; aquí puedes activarlos, cambiar su campaña y sus líneas.')}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table table-click">
              <thead><tr><th>{t('Usuario inicial')}</th><th>{t('Destino')}</th><th>{t('Campaña')}</th><th className="num">{t('Líneas')}</th><th>{t('Estado')}</th></tr></thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.remote_agent_id} onClick={() => setEditing(r)} className={r.status === 'ACTIVE' ? '' : 'row-muted'}>
                    <td><div className="strong">{r.full_name || r.user_start}</div><div className="sub mono">{r.user_start}</div></td>
                    <td className="mono">{r.conf_exten}</td>
                    <td>{r.campaign_id}</td>
                    <td className="num">{r.number_of_lines}</td>
                    <td>
                      {r.status === 'ACTIVE' ? <span className="chip chip-green">{t('Activo')}</span> : <span className="chip">{t('Inactivo')}</span>}
                      {r.logged && <span className="chip chip-blue">{t('En línea')}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && (
        <RemoteDrawer r={editing} campaigns={meta?.campaigns || []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      )}
    </div>
  );
}

function RemoteDrawer({ r, campaigns, onClose, onSaved }) {
  const t = useT();
  const [f, setF] = useState({ status: r.status === 'ACTIVE', campaign_id: r.campaign_id, number_of_lines: r.number_of_lines });
  const [run, busy] = useAction();
  const save = async () => {
    const body = { status: f.status ? 'ACTIVE' : 'INACTIVE', campaign_id: f.campaign_id, number_of_lines: f.number_of_lines };
    const ok = await run('save', () => api(`/admin/remote-agents/${encodeURIComponent(r.user_start)}`, { method: 'PATCH', body }), t('Agente remoto actualizado'));
    if (ok) onSaved();
  };
  return (
    <Drawer
      open
      onClose={onClose}
      title={t('Agente remoto {user}', { user: r.user_start })}
      subtitle={t('Llama a {number}', { number: r.conf_exten })}
      footer={<><button className="btn btn-ghost" onClick={onClose}>{t('Cancelar')}</button><button className="btn btn-primary" disabled={!!busy} onClick={save}>{t('Guardar')}</button></>}
    >
      <div className="stack">
        <Toggle checked={f.status} onChange={(v) => setF({ ...f, status: v })} label={f.status ? t('Activo: recibe llamadas') : t('Inactivo')} />
        <Field label={t('Campaña')}>
          <select value={f.campaign_id} onChange={(e) => setF({ ...f, campaign_id: e.target.value })}>
            {!campaigns.some((c) => c.campaign_id === f.campaign_id) && <option value={f.campaign_id}>{f.campaign_id}</option>}
            {campaigns.map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_id} · {c.campaign_name}</option>)}
          </select>
        </Field>
        <Field label={t('Líneas simultáneas')} hint={t('Cuántas llamadas a la vez puede recibir')}>
          <input type="number" min="1" max="99" value={f.number_of_lines} onChange={(e) => setF({ ...f, number_of_lines: e.target.value })} />
        </Field>
        <a className="small" href={`/vicidial/admin.php?ADD=31111&remote_agent_id=${r.remote_agent_id}`} target="_blank" rel="noreferrer">{t('Más opciones en el admin clásico')} ↗</a>
      </div>
    </Drawer>
  );
}
