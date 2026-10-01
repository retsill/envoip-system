import { useState } from 'react';
import { api, post } from '../../api.js';
import { Card, Drawer, Empty, Field, Toggle, useAction, useLoad } from '../../components/ui.jsx';
import { AdminHead } from './Overview.jsx';
import { useT } from '../../i18n.js';
import { useConfirm } from '../../components/Modal.jsx';


// Lo calcula el servidor mirando si la plantilla usa WebSocket seguro (sirve para plantillas con cualquier nombre)
const isWebrtc = (p) => Boolean(p.webrtc);

export default function Phones() {
  const t = useT();
  const { data, error, reload } = useLoad('/admin/phones');
  const [editing, setEditing] = useState(null);

  return (
    <div className="page">
      <AdminHead title={t('Teléfonos')} subtitle={t('Cada agente necesita un teléfono. Los webphones funcionan en el navegador, sin instalar nada.')}>
        <button className="btn btn-primary" onClick={() => setEditing({})}>＋ {t('Nuevo teléfono')}</button>
      </AdminHead>
      {error && <div className="alert alert-error">{error}</div>}
      <Card pad={false}>
        {!data ? <div className="card-body muted">{t('Cargando…')}</div> : data.length === 0 ? <Empty icon="☎" title={t('No hay teléfonos')} /> : (
          <div className="table-wrap">
            <table className="table table-click">
              <thead><tr><th>{t('Extensión')}</th><th>{t('Nombre')}</th><th>{t('Tipo')}</th><th>{t('Asignado a')}</th><th>{t('Estado')}</th></tr></thead>
              <tbody>
                {data.map((p) => (
                  <tr key={`${p.extension}-${p.server_ip}`} onClick={() => setEditing(p)} className={p.active === 'Y' ? '' : 'row-muted'}>
                    <td className="mono strong">{p.extension}</td>
                    <td>{p.fullname}</td>
                    <td>
                      {p.is_webphone !== 'N' ? (
                        isWebrtc(p) ? <span className="chip chip-green">Webphone</span> : <span className="chip chip-red" title={t('Sin plantilla WebRTC')}>{t('Webphone sin WebRTC')}</span>
                      ) : isWebrtc(p) ? <span className="chip chip-violet" title={t('WebRTC sin navegador: EnVoIP Phone')}>App</span> : <span className="chip">{p.protocol}</span>}
                    </td>
                    <td className="mono">{p.assigned_users || <span className="muted">—</span>}</td>
                    <td>{p.logged_user ? <span className="chip chip-green">{t('En uso')} · {p.logged_user}</span> : p.active === 'Y' ? <span className="chip chip-outline">{t('Libre')}</span> : <span className="chip">{t('Inactivo')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <PhoneDrawer phone={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function PhoneDrawer({ phone, onClose, onSaved }) {
  const t = useT();
  const confirm = useConfirm();
  const creating = !phone.extension;
  const [f, setF] = useState({ extension: '', fullname: phone.fullname || '', pass: '', webphone: creating ? true : phone.is_webphone !== 'N' });
  const [run, busy] = useAction();

  const save = async () => {
    let body = f;
    if (!creating) {
      body = {};
      if (f.fullname !== phone.fullname) body.fullname = f.fullname;
      if (f.pass) body.pass = f.pass;
      // Volver a guardar como webphone también repara la plantilla WebRTC si faltaba
      if (f.webphone !== (phone.is_webphone !== 'N') || (f.webphone && !isWebrtc(phone))) body.webphone = f.webphone;
    }
    const ok = await run('save', () => (creating ? post('/admin/phones', body) : api(`/admin/phones/${encodeURIComponent(phone.extension)}`, { method: 'PATCH', body })), creating ? t('Teléfono creado') : t('Teléfono actualizado'));
    if (ok) onSaved();
  };
  const remove = async () => {
    if (!(await confirm({ title: t('Teléfono {ext}', { ext: phone.extension }), message: t('¿Borrar el teléfono {ext}? Esta acción no se puede deshacer.', { ext: phone.extension }), okText: t('Borrar'), danger: true }))) return;
    const ok = await run('del', () => api(`/admin/phones/${encodeURIComponent(phone.extension)}`, { method: 'DELETE' }), t('Teléfono borrado'));
    if (ok) onSaved();
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={creating ? t('Nuevo teléfono') : t('Teléfono {ext}', { ext: phone.extension })}
      subtitle={creating ? t('Queda listo para usar en 1 minuto') : phone.fullname}
      footer={<>
        {!creating && <button className="btn btn-danger-ghost" style={{ marginRight: 'auto' }} disabled={!!busy} onClick={remove}>{t('Borrar')}</button>}
        <button className="btn btn-ghost" onClick={onClose}>{t('Cancelar')}</button>
        <button className="btn btn-primary" disabled={!!busy} onClick={save}>{creating ? t('Crear teléfono') : t('Guardar')}</button>
      </>}
    >
      <div className="stack">
        {creating && <Field label={t('Extensión (solo números)')} hint={t('Ej.: 1002. Será también el «Phone Login».')}><input autoFocus inputMode="numeric" value={f.extension} onChange={(e) => setF({ ...f, extension: e.target.value.replace(/\D/g, '') })} /></Field>}
        <Field label={t('Nombre')}><input value={f.fullname} onChange={(e) => setF({ ...f, fullname: e.target.value })} placeholder={t('Ej.: Puesto 2')} /></Field>
        <Field label={creating ? t('Contraseña del teléfono') : t('Nueva contraseña')} hint={creating ? t('La que escribe el agente en «Phone Password». Mínimo 6.') : t('Déjalo vacío para no cambiarla')}>
          <input value={f.pass} onChange={(e) => setF({ ...f, pass: e.target.value })} />
        </Field>
        <Toggle checked={f.webphone} onChange={(v) => setF({ ...f, webphone: v })} label={t('Webphone (audio en el navegador, con WebRTC)')} />
        {!creating && phone.is_webphone !== 'N' && !isWebrtc(phone) && (
          <div className="alert alert-warn">{t('Este webphone no tiene la plantilla WebRTC. Pulsa «Guardar» para repararlo.')}</div>
        )}
        {!creating && <AppConnect phone={phone} onChanged={onSaved} />}
        {!creating && <a className="small" href={`/vicidial/admin.php?ADD=31111111111&extension=${encodeURIComponent(phone.extension)}&server_ip=${encodeURIComponent(phone.server_ip)}`} target="_blank" rel="noreferrer">{t('Más opciones en el admin clásico')} ↗</a>}
      </div>
    </Drawer>
  );
}

/** Datos para conectar este teléfono en la app EnVoIP Phone, y la extensión de la app de un webphone. */
function AppConnect({ phone, onChanged }) {
  const t = useT();
  const { data, error, reload } = useLoad(`/admin/phones/${encodeURIComponent(phone.extension)}/connect`);
  const [show, setShow] = useState(false);
  const [run, busy] = useAction();
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!data) return null;

  const createApp = async () => {
    const r = await run('app', () => post(`/admin/phones/${encodeURIComponent(phone.extension)}/app`, {}), t('Extensión de la app creada'));
    if (r) {
      reload();
      onChanged();
    }
  };

  return (
    <div className="card-sub stack">
      <div className="strong">{t('Conectar en EnVoIP Phone')}</div>
      {data.webphone ? (
        <>
          <p className="muted small">
            {t('Es el teléfono del navegador. Para usar también la app a la vez, el agente necesita su extensión de la app; al conectarse en la web elige dónde recibir las llamadas.')}
          </p>
          {data.app_extension ? (
            <p className="small">{t('Extensión de la app')}: <span className="mono strong">{data.app_extension}</span> {t('(ábrela en la lista para ver su contraseña).')}</p>
          ) : (
            <button className="btn btn-sm" disabled={!!busy} onClick={createApp}>＋ {t('Crear extensión para la app ({ext})', { ext: `5${phone.extension}` })}</button>
          )}
        </>
      ) : (
        <>
          {!data.webrtc && <div className="alert alert-warn">{t('Sin plantilla WebRTC: la app no puede conectarse (usa WSS). Sirve para teléfonos IP de mesa.')}</div>}
          <dl className="kv small">
            <dt>{t('Servidor')}</dt><dd className="mono">{data.server}</dd>
            <dt>{t('Extensión')}</dt><dd className="mono">{data.extension}</dd>
            <dt>{t('Contraseña')}</dt>
            <dd className="mono">
              {show ? data.password : '••••••••'}{' '}
              <button type="button" className="link" onClick={() => setShow(!show)}>{show ? t('Ocultar') : t('Ver')}</button>
              {show && <> · <button type="button" className="link" onClick={() => navigator.clipboard?.writeText(data.password)}>{t('Copiar')}</button></>}
            </dd>
          </dl>
          <p className="muted small">{t('En la app: Líneas → Añadir → Vicidial / ViciBox. Es la contraseña de registro, no la del agente.')}</p>
        </>
      )}
    </div>
  );
}
