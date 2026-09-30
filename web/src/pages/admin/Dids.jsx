import { useState } from 'react';
import { api, fmtNum, post } from '../../api.js';
import { Card, Drawer, Empty, Field, Toggle, useAction, useLoad } from '../../components/ui.jsx';
import { AdminHead, CLASSIC } from './Overview.jsx';
import { useT } from '../../i18n.js';
import { useConfirm } from '../../components/Modal.jsx';


const ROUTE_LABELS = {
  IN_GROUP: 'Cola de agentes (in-group)',
  CALLMENU: 'Menú IVR',
  PHONE: 'Teléfono / extensión interna',
  VOICEMAIL: 'Buzón de voz',
  VMAIL_NO_INST: 'Buzón de voz (sin instrucciones)',
  EXTEN: 'Extensión del dialplan',
  AGENT: 'Agente concreto',
};

function destination(d) {
  switch (d.did_route) {
    case 'IN_GROUP': return d.group_id;
    case 'CALLMENU': return d.menu_id;
    case 'PHONE': return d.phone;
    case 'VOICEMAIL':
    case 'VMAIL_NO_INST': return d.voicemail_ext;
    case 'EXTEN': return `${d.extension} @ ${d.exten_context}`;
    default: return '';
  }
}

export default function Dids() {
  const t = useT();
  const { data, error, reload } = useLoad('/admin/dids');
  const [editing, setEditing] = useState(null);

  return (
    <div className="page">
      <AdminHead title={t('Números entrantes (DIDs)')} subtitle={t('A dónde va cada llamada que entra por tus números')}>
        <button className="btn btn-primary" onClick={() => setEditing({})}>＋ {t('Nuevo DID')}</button>
      </AdminHead>
      {error && <div className="alert alert-error">{error}</div>}
      <Card pad={false}>
        {!data ? <div className="card-body muted">{t('Cargando…')}</div> : data.dids.length === 0 ? <Empty icon="📞" title={t('No hay DIDs')} /> : (
          <div className="table-wrap">
            <table className="table table-click">
              <thead><tr><th>{t('Número')}</th><th>{t('Descripción')}</th><th>{t('Destino')}</th><th>{t('Grabación')}</th><th className="num">{t('Llamadas hoy')}</th><th>{t('Estado')}</th></tr></thead>
              <tbody>
                {data.dids.map((d) => (
                  <tr key={d.did_pattern} onClick={() => setEditing(d)} className={d.did_active === 'Y' ? '' : 'row-muted'}>
                    <td className="mono strong">{d.did_pattern}</td>
                    <td>{d.did_description}</td>
                    <td>{ROUTE_LABELS[d.did_route] ? t(ROUTE_LABELS[d.did_route]) : d.did_route}<span className="sub mono">{destination(d)}</span></td>
                    <td>{d.record_call === 'N' ? <span className="muted">{t('No')}</span> : <span className="chip chip-blue">{t('Sí')}</span>}</td>
                    <td className="num">{fmtNum(d.calls_today)}</td>
                    <td>{d.did_active === 'Y' ? <span className="chip chip-green">{t('Activo')}</span> : <span className="chip">{t('Inactivo')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {data && data.ingroups.length <= 2 && (
        <p className="muted small">
          {t('Para repartir llamadas entrantes entre agentes necesitas un in-group (cola).')}{' '}
          <a href={CLASSIC.ingroups} target="_blank" rel="noreferrer">{t('Créalo en el admin clásico')} ↗</a>
        </p>
      )}
      {editing && data && <DidDrawer did={editing} opts={data} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function DidDrawer({ did, opts, onClose, onSaved }) {
  const t = useT();
  const confirm = useConfirm();
  const creating = !did.did_pattern;
  const initial = {
    did_pattern: '', did_description: did.did_description || '', active: did.did_active !== 'N',
    did_route: did.did_route && opts.routes.includes(did.did_route) ? did.did_route : 'IN_GROUP',
    record_call: did.record_call || 'N', group_id: did.group_id || opts.ingroups[0]?.group_id || '',
    call_handle_method: did.call_handle_method || 'CID', menu_id: did.menu_id || opts.menus[0]?.menu_id || '',
    phone: did.phone || opts.phones[0]?.extension || '', voicemail_ext: did.voicemail_ext || '',
    extension: did.extension || '', exten_context: did.exten_context || 'default',
  };
  const [f, setF] = useState(initial);
  const [copy, setCopy] = useState('');
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const path = `/admin/dids/${encodeURIComponent(did.did_pattern || '')}`;
  const unsupportedRoute = !creating && !opts.routes.includes(did.did_route);

  const save = async () => {
    let body = f;
    if (!creating) {
      body = {};
      if (f.did_description !== initial.did_description) body.did_description = f.did_description;
      if (f.active !== initial.active) body.active = f.active;
      if (f.record_call !== initial.record_call) body.record_call = f.record_call;
      const routeKeys = ['did_route', 'group_id', 'call_handle_method', 'menu_id', 'phone', 'voicemail_ext', 'extension', 'exten_context'];
      // El destino se envía completo si cambia cualquiera de sus campos
      if (routeKeys.some((k) => f[k] !== initial[k])) routeKeys.forEach((k) => (body[k] = f[k]));
    }
    const ok = await run('save', () => (creating ? post('/admin/dids', body) : api(path, { method: 'PATCH', body })), creating ? t('DID creado') : t('DID actualizado'));
    if (ok) onSaved();
  };
  const doCopy = async () => {
    const ok = await run('copy', () => post(`${path}/copy`, { new_dids: copy }), t('DIDs copiados con la misma configuración'));
    if (ok) onSaved();
  };
  const remove = async () => {
    if (!(await confirm({ title: `DID ${did.did_pattern}`, message: t('¿Borrar el DID {did}? Las llamadas a ese número dejarán de enrutarse.', { did: did.did_pattern }), okText: t('Borrar'), danger: true }))) return;
    const ok = await run('del', () => api(path, { method: 'DELETE' }), t('DID borrado'));
    if (ok) onSaved();
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={creating ? t('Nuevo DID') : `DID ${did.did_pattern}`}
      subtitle={creating ? t('Número de teléfono entrante y a dónde enviarlo') : did.did_description}
      footer={<>
        {!creating && did.did_pattern !== 'default' && <button className="btn btn-danger-ghost" style={{ marginRight: 'auto' }} disabled={!!busy} onClick={remove}>{t('Borrar')}</button>}
        <button className="btn btn-ghost" onClick={onClose}>{t('Cancelar')}</button>
        <button className="btn btn-primary" disabled={!!busy || unsupportedRoute} onClick={save}>{creating ? t('Crear DID') : t('Guardar')}</button>
      </>}
    >
      <div className="stack">
        {creating && <Field label={t('Número (DID)')} hint={t('Tal como llega del proveedor. Ej.: 13055551234')}><input autoFocus className="mono" value={f.did_pattern} onChange={set('did_pattern')} /></Field>}
        <Field label={t('Descripción')} hint={t('6 a 50 caracteres')}><input value={f.did_description} onChange={set('did_description')} /></Field>
        <Toggle checked={f.active} onChange={set('active')} label={f.active ? t('Activo') : t('Inactivo')} />
        <Field label={t('Grabar llamadas')}>
          <select value={f.record_call} onChange={set('record_call')}>
            <option value="N">{t('No')}</option>
            <option value="Y">{t('Sí, toda la llamada')}</option>
            <option value="Y_QUEUESTOP">{t('Sí, hasta que la atiende un agente')}</option>
          </select>
        </Field>

        {unsupportedRoute ? (
          <div className="alert alert-warn">
            {t('Este DID va a «{route}», que solo se puede editar en el admin clásico.', { route: ROUTE_LABELS[did.did_route] ? t(ROUTE_LABELS[did.did_route]) : did.did_route })}{' '}
            <a href={`/vicidial/admin.php?ADD=3311&did_id=${did.did_id}`} target="_blank" rel="noreferrer">{t('Abrir')} ↗</a>
          </div>
        ) : (
          <fieldset className="fgroup"><legend>{t('Destino')}</legend>
            <div className="stack">
              <Field label={t('Enviar las llamadas a')}>
                <select value={f.did_route} onChange={set('did_route')}>
                  {opts.routes.map((r) => <option key={r} value={r}>{t(ROUTE_LABELS[r] || r)}</option>)}
                </select>
              </Field>
              {f.did_route === 'IN_GROUP' && (
                <>
                  <Field label={t('In-group (cola)')}>
                    <select value={f.group_id} onChange={set('group_id')}>
                      {opts.ingroups.map((g) => <option key={g.group_id} value={g.group_id}>{g.group_id} · {g.group_name}</option>)}
                    </select>
                  </Field>
                  <Field label={t('Buscar cliente por')} hint={t('CID: crea un lead nuevo con el número · CIDLOOKUP: busca si el número ya existe')}>
                    <select value={f.call_handle_method} onChange={set('call_handle_method')}>
                      <option value="CID">{t('CID (lead nuevo)')}</option>
                      <option value="CIDLOOKUP">{t('CIDLOOKUP (buscar número existente)')}</option>
                      <option value="CLOSER">CLOSER</option>
                    </select>
                  </Field>
                </>
              )}
              {f.did_route === 'CALLMENU' && (
                <Field label={t('Menú IVR')}>
                  <select value={f.menu_id} onChange={set('menu_id')}>
                    {opts.menus.map((m) => <option key={m.menu_id} value={m.menu_id}>{m.menu_id} · {m.menu_name}</option>)}
                  </select>
                </Field>
              )}
              {f.did_route === 'PHONE' && (
                <Field label={t('Teléfono')}>
                  <select value={f.phone} onChange={set('phone')}>
                    {opts.phones.map((p) => <option key={p.extension} value={p.extension}>{p.extension} · {p.fullname}</option>)}
                  </select>
                </Field>
              )}
              {(f.did_route === 'VOICEMAIL' || f.did_route === 'VMAIL_NO_INST') && (
                <Field label={t('Buzón de voz (número)')}><input inputMode="numeric" value={f.voicemail_ext} onChange={set('voicemail_ext')} /></Field>
              )}
              {f.did_route === 'EXTEN' && (
                <div className="fgrid">
                  <Field label={t('Extensión')}><input inputMode="numeric" value={f.extension} onChange={set('extension')} /></Field>
                  <Field label={t('Contexto')}><input value={f.exten_context} onChange={set('exten_context')} /></Field>
                </div>
              )}
            </div>
          </fieldset>
        )}

        {!creating && (
          <fieldset className="fgroup"><legend>{t('Copiar configuración a otros números')}</legend>
            <div className="stack">
              <Field label={t('Números nuevos')} hint={t('Separados por comas o espacios. Tendrán el mismo destino y opciones.')}>
                <textarea rows={2} className="mono" value={copy} onChange={(e) => setCopy(e.target.value)} />
              </Field>
              <button className="btn" disabled={!copy.trim() || !!busy} onClick={doCopy}>{t('Copiar')}</button>
            </div>
          </fieldset>
        )}
      </div>
    </Drawer>
  );
}
