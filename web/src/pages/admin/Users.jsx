import { useMemo, useState } from 'react';
import { api, post } from '../../api.js';
import { useAuth } from '../../App.jsx';
import { Card, Drawer, Empty, Field, levelName, Toggle, useAction, useLoad } from '../../components/ui.jsx';
import { useT } from '../../i18n.js';
import { AdminHead } from './Overview.jsx';

const FILTERS = [['all', 'Todos'], ['agents', 'Agentes'], ['sup', 'Supervisores y admins'], ['inactive', 'Inactivos']];

export default function Users() {
  const t = useT();
  const { data, error, reload } = useLoad('/admin/users');
  const meta = useLoad('/admin/meta').data;
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null);

  const rows = useMemo(() => {
    let r = data || [];
    if (filter === 'agents') r = r.filter((u) => u.user_level < 7 && u.active === 'Y');
    if (filter === 'sup') r = r.filter((u) => u.user_level >= 7 && u.active === 'Y');
    if (filter === 'inactive') r = r.filter((u) => u.active !== 'Y');
    const s = q.trim().toLowerCase();
    if (s) r = r.filter((u) => `${u.user} ${u.full_name} ${u.email || ''} ${u.phone_login || ''}`.toLowerCase().includes(s));
    return r;
  }, [data, q, filter]);

  return (
    <div className="page">
      <AdminHead title={t('Usuarios')} subtitle={t('Crea y edita agentes, supervisores y administradores')}>
        <button className="btn btn-primary" onClick={() => setEditing({})}>＋ {t('Nuevo usuario')}</button>
      </AdminHead>
      {error && <div className="alert alert-error">{error}</div>}
      <Card
        pad={false}
        title={<input className="search search-sm" placeholder={t('Buscar por usuario, nombre, email o teléfono…')} value={q} onChange={(e) => setQ(e.target.value)} />}
        actions={
          <div className="segmented">
            {FILTERS.map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{t(l)}</button>)}
          </div>
        }
      >
        {!data ? <div className="card-body muted">{t('Cargando…')}</div> : rows.length === 0 ? <Empty icon="👤" title={t('Sin resultados')} /> : (
          <div className="table-wrap">
            <table className="table table-click">
              <thead><tr><th>{t('Usuario')}</th><th>{t('Nivel')}</th><th>{t('Grupo')}</th><th>{t('Teléfono')}</th><th>{t('Estado')}</th><th>{t('Último acceso')}</th></tr></thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.user} onClick={() => !u.protected && setEditing(u)} className={u.active === 'Y' ? '' : 'row-muted'} title={u.protected ? t('Usuario del sistema') : t('Editar')}>
                    <td><div className="strong">{u.full_name}</div><div className="sub mono">{u.user}</div></td>
                    <td><span className={`chip ${u.user_level >= 8 ? 'chip-violet' : u.user_level === 7 ? 'chip-blue' : ''}`}>{u.user_level} · {levelName(u.user_level)}</span></td>
                    <td>{u.user_group}</td>
                    <td className="mono">{u.phone_login || '—'}</td>
                    <td>
                      {u.protected ? <span className="chip">{t('Sistema / API')}</span>
                        : u.active !== 'Y' ? <span className="chip">{t('Inactivo')}</span>
                        : u.logged_in ? <span className="chip chip-green">{t('Conectado')} · {u.campaign_id}</span>
                        : <span className="chip chip-outline">{t('Activo')}</span>}
                      {u.failed_login_count >= 5 && <span className="chip chip-red" title={t('Intentos fallidos')}>{t('{n} fallos', { n: u.failed_login_count })}</span>}
                    </td>
                    <td className="mono small">{u.last_login_date?.startsWith('2001') ? t('Nunca') : u.last_login_date?.slice(0, 16)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <UserDrawer user={editing} meta={meta} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function UserDrawer({ user, meta, onClose, onSaved }) {
  const t = useT();
  const { user: me } = useAuth();
  const creating = !user.user;
  const [f, setF] = useState({
    user: '', full_name: user.full_name || '', pass: '', user_level: user.user_level || 1,
    user_group: user.user_group || meta?.groups?.[0]?.user_group || '', phone_login: user.phone_login || '',
    phone_pass: '', email: user.email || '', active: user.active !== 'N',
  });
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const myLevel = Number(meta?.perms?.user_level || me.level);
  const levels = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((l) => myLevel === 9 || l < myLevel || (l === myLevel && meta?.perms?.modify_same_user_level === '1'));

  const save = async () => {
    const body = creating ? f : Object.fromEntries(Object.entries(f).filter(([k, v]) => {
      if (k === 'user') return false;
      if (k === 'pass' || k === 'phone_pass') return v !== '';
      if (k === 'active') return v !== (user.active === 'Y');
      return String(v ?? '') !== String(user[k] ?? '');
    }));
    const ok = await run('save', () => (creating ? post('/admin/users', body) : api(`/admin/users/${encodeURIComponent(user.user)}`, { method: 'PATCH', body })), creating ? t('Usuario creado') : t('Usuario actualizado'));
    if (ok) onSaved();
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={creating ? t('Nuevo usuario') : user.full_name}
      subtitle={creating ? t('Se crea con la API oficial de Vicidial') : t('Usuario {user}', { user: user.user })}
      footer={<><button className="btn btn-ghost" onClick={onClose}>{t('Cancelar')}</button><button className="btn btn-primary" disabled={!!busy} onClick={save}>{creating ? t('Crear usuario') : t('Guardar cambios')}</button></>}
    >
      <div className="stack">
        {creating && <Field label={t('Usuario (número o texto, 2-20)')} hint={t('Es el que usará para entrar. Ej.: 1002')}><input autoFocus value={f.user} onChange={set('user')} /></Field>}
        <Field label={t('Nombre completo')}><input value={f.full_name} onChange={set('full_name')} /></Field>
        <Field label={creating ? t('Contraseña') : t('Nueva contraseña')} hint={creating ? t('Mínimo 6 caracteres') : t('Déjalo vacío para no cambiarla')}>
          <input type="text" autoComplete="new-password" value={f.pass} onChange={set('pass')} />
        </Field>
        <div className="fgrid">
          <Field label={t('Nivel')}>
            <select value={f.user_level} onChange={(e) => setF({ ...f, user_level: Number(e.target.value) })}>
              {levels.map((l) => <option key={l} value={l}>{l} · {levelName(l)}</option>)}
            </select>
          </Field>
          <Field label={t('Grupo')}>
            <select value={f.user_group} onChange={set('user_group')}>
              {(meta?.groups || []).map((g) => <option key={g.user_group} value={g.user_group}>{g.user_group}</option>)}
            </select>
          </Field>
        </div>
        <p className="muted small">{t('Nivel 1-6: agente · 7: supervisor (panel en tiempo real y leads) · 8-9: administración.')}</p>
        <div className="fgrid">
          <Field label={t('Teléfono por defecto')} hint={t('Extensión que usará al entrar')}><input value={f.phone_login} onChange={set('phone_login')} /></Field>
          <Field label={t('Contraseña del teléfono')} hint={t('Opcional')}><input value={f.phone_pass} onChange={set('phone_pass')} /></Field>
        </div>
        <Field label="Email"><input type="email" value={f.email} onChange={set('email')} /></Field>
        {!creating && <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label={f.active ? t('Usuario activo') : t('Usuario desactivado (no puede entrar)')} />}
        {!creating && <CopyUser source={user} onDone={onSaved} />}
        {!creating && <a className="small" href={`/vicidial/admin.php?ADD=3&user=${encodeURIComponent(user.user)}`} target="_blank" rel="noreferrer">{t('Más opciones en el admin clásico')} ↗</a>}
      </div>
    </Drawer>
  );
}

// Crea un usuario nuevo con los mismos permisos y opciones que este (función copy_user)
function CopyUser({ source, onDone }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ user: '', full_name: '', pass: '', phone_login: '' });
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const copy = async () => {
    const ok = await run('copy', () => post(`/admin/users/${encodeURIComponent(source.user)}/copy`, f), t('Usuario {user} creado como copia de {source}', { user: f.user, source: source.user }));
    if (ok) onDone();
  };
  if (!open) return <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>⧉ {t('Duplicar este usuario')}</button>;
  return (
    <fieldset className="fgroup"><legend>{t('Duplicar {user}', { user: source.user })}</legend>
      <p className="muted small">{t('El nuevo usuario tendrá el mismo nivel, grupo, permisos y opciones de agente.')}</p>
      <div className="stack">
        <div className="fgrid">
          <Field label={t('Nuevo usuario')}><input value={f.user} onChange={set('user')} /></Field>
          <Field label={t('Contraseña')} hint={t('Mínimo 6')}><input value={f.pass} onChange={set('pass')} autoComplete="new-password" /></Field>
        </div>
        <Field label={t('Nombre completo')}><input value={f.full_name} onChange={set('full_name')} /></Field>
        <Field label={t('Teléfono por defecto')} hint={t('Opcional')}><input value={f.phone_login} onChange={set('phone_login')} /></Field>
        <div className="row-gap">
          <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>{t('Cancelar')}</button>
          <button className="btn btn-primary btn-sm" disabled={!!busy || !f.user || !f.pass || !f.full_name} onClick={copy}>{t('Crear copia')}</button>
        </div>
      </div>
    </fieldset>
  );
}
