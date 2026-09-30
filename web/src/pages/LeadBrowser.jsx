import { useEffect, useMemo, useState } from 'react';
import { api, fmtDur, fmtNum, fmtPhone } from '../api.js';
import { Card, Drawer, Empty, Field, useAction, useLoad } from '../components/ui.jsx';
import { useT } from '../i18n.js';

const BASE = import.meta.env.BASE_URL;
const EMPTY = {
  phone: '', lead_id: '', first_name: '', last_name: '', campaign_id: '', list_id: '', status: '',
  email: '', city: '', state: '', postal_code: '', vendor: '', user: '', owner: '', comments: '', called: '',
  date_field: 'entry', from: '', to: '',
};
const ADVANCED = ['email', 'city', 'state', 'postal_code', 'vendor', 'user', 'owner', 'comments', 'called', 'from', 'to'];

export const leadsQuery = (f, extra = {}) =>
  new URLSearchParams(Object.entries({ ...f, ...extra }).filter(([k, v]) => v !== '' && v !== undefined && !(k === 'date_field' && !f.from && !f.to)));

export const exportUrl = (f) => `${BASE}api/leads/leads/export?${leadsQuery(f)}`;

/**
 * Buscador y explorador de leads (equivale a «Lead Search Options» del admin clásico):
 * sin filtros muestra todos los leads; con lista o campaña, todos sus números. Descarga en CSV.
 */
export default function LeadBrowser({ lists, campaigns, initial }) {
  const t = useT();
  const [form, setForm] = useState({ ...EMPTY, ...initial });
  const [applied, setApplied] = useState({ ...EMPTY, ...initial });
  const [more, setMore] = useState(ADVANCED.some((k) => initial?.[k]));
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(50);
  const [sort, setSort] = useState({ by: 'lead_id', dir: 'desc' });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(null);
  const statuses = useLoad('/leads/statuses').data || [];

  useEffect(() => {
    setForm({ ...EMPTY, ...initial });
    setApplied({ ...EMPTY, ...initial });
    setPage(1);
  }, [initial]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api(`/leads/leads?${leadsQuery(applied, { page, size, sort: sort.by, dir: sort.dir })}`)
      .then((d) => alive && (setData(d), setError('')))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [applied, page, size, sort]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const search = (e) => {
    e?.preventDefault();
    setPage(1);
    setApplied({ ...form });
  };
  const clear = () => {
    setForm(EMPTY);
    setApplied(EMPTY);
    setPage(1);
  };
  const shownLists = useMemo(() => (lists || []).filter((l) => !form.campaign_id || l.campaign_id === form.campaign_id), [lists, form.campaign_id]);
  const pages = data ? Math.max(1, Math.ceil(data.total / size)) : 1;
  const sortBy = (by) => setSort((s) => ({ by, dir: s.by === by && s.dir === 'desc' ? 'asc' : 'desc' }));
  const Th = ({ by, children, num }) => (
    <th className={`sortable${num ? ' num' : ''}`} onClick={() => sortBy(by)} aria-sort={sort.by === by ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      {children}
      {sort.by === by && <span aria-hidden> {sort.dir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );
  const scope = applied.list_id
    ? t('Lista {id}', { id: applied.list_id })
    : applied.campaign_id
      ? t('Campaña {id}', { id: applied.campaign_id })
      : t('Todos los leads');

  return (
    <div className="stack">
      <Card>
        <form className="stack" onSubmit={search}>
          <div className="lead-filters">
            <Field label={t('Teléfono')}><input inputMode="tel" value={form.phone} onChange={set('phone')} placeholder={t('10 dígitos o el principio')} /></Field>
            <Field label="Lead ID"><input inputMode="numeric" value={form.lead_id} onChange={set('lead_id')} /></Field>
            <Field label={t('Nombre')}><input value={form.first_name} onChange={set('first_name')} /></Field>
            <Field label={t('Apellidos')}><input value={form.last_name} onChange={set('last_name')} /></Field>
            <Field label={t('Campaña')}>
              <select value={form.campaign_id} onChange={(e) => setForm({ ...form, campaign_id: e.target.value, list_id: '' })}>
                <option value="">{t('Todas')}</option>
                {(campaigns || []).map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_id} · {c.campaign_name}</option>)}
              </select>
            </Field>
            <Field label={t('Lista')}>
              <select value={form.list_id} onChange={set('list_id')}>
                <option value="">{t('Todas')}</option>
                {shownLists.map((l) => <option key={l.list_id} value={l.list_id}>{l.list_id} · {l.list_name}</option>)}
              </select>
            </Field>
            <Field label={t('Estado')}>
              <select value={form.status} onChange={set('status')}>
                <option value="">{t('Todos')}</option>
                {statuses.map((s) => <option key={s.status} value={s.status}>{s.status} · {s.status_name}</option>)}
              </select>
            </Field>
            {more && (
              <>
                <Field label="Email"><input value={form.email} onChange={set('email')} /></Field>
                <Field label={t('Ciudad')}><input value={form.city} onChange={set('city')} /></Field>
                <Field label={t('Estado/Prov.')}><input maxLength={2} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })} placeholder="FL" /></Field>
                <Field label={t('C. postal')}><input value={form.postal_code} onChange={set('postal_code')} /></Field>
                <Field label={t('Cód. proveedor')}><input value={form.vendor} onChange={set('vendor')} /></Field>
                <Field label={t('Agente (usuario)')}><input value={form.user} onChange={set('user')} /></Field>
                <Field label={t('Propietario')}><input value={form.owner} onChange={set('owner')} /></Field>
                <Field label={t('Comentarios contienen')}><input value={form.comments} onChange={set('comments')} /></Field>
                <Field label={t('Llamado desde el último reinicio')}>
                  <select value={form.called} onChange={set('called')}>
                    <option value="">{t('Todos')}</option>
                    <option value="N">{t('No (pendientes)')}</option>
                    <option value="Y">{t('Sí')}</option>
                  </select>
                </Field>
                <Field label={t('Fecha de')}>
                  <select value={form.date_field} onChange={set('date_field')}>
                    <option value="entry">{t('Alta')}</option>
                    <option value="modify">{t('Modificación')}</option>
                    <option value="last_call">{t('Última llamada')}</option>
                  </select>
                </Field>
                <Field label={t('Desde')}><input type="date" value={form.from} onChange={set('from')} /></Field>
                <Field label={t('Hasta')}><input type="date" value={form.to} onChange={set('to')} /></Field>
              </>
            )}
          </div>
          <div className="row-gap" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
            <button className="btn btn-primary">🔍 {t('Buscar')}</button>
            <button type="button" className="btn btn-ghost" onClick={clear}>{t('Limpiar')}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setMore(!more)}>{more ? t('Menos filtros') : t('Más filtros')}</button>
          </div>
        </form>
      </Card>

      {error && <div className="alert alert-error">{error}</div>}

      <Card
        pad={false}
        title={<span>{scope} · {data ? t('{n} leads', { n: fmtNum(data.total) }) : '…'}{loading && <span className="muted small"> · {t('Cargando…')}</span>}</span>}
        actions={
          data?.total > 0 && (
            <a className="btn btn-sm" href={exportUrl(applied)} download>
              ⬇ {t('Descargar CSV ({n})', { n: fmtNum(data.total) })}
            </a>
          )
        }
      >
        {data && data.total === 0 ? (
          <Empty icon="🔍" title={t('Sin resultados')} />
        ) : (
          <div className="table-wrap">
            <table className="table table-click table-compact">
              <thead>
                <tr>
                  <Th by="lead_id">Lead</Th>
                  <Th by="name">{t('Nombre')}</Th>
                  <Th by="phone">{t('Teléfono')}</Th>
                  <th>{t('Ciudad')}</th>
                  <th>{t('Lista')}</th>
                  <Th by="status">{t('Estado')}</Th>
                  <Th by="called" num>{t('Llamadas')}</Th>
                  <Th by="last_call">{t('Última llamada')}</Th>
                  <Th by="entry">{t('Alta')}</Th>
                </tr>
              </thead>
              <tbody>
                {(data?.rows || []).map((r) => (
                  <tr key={r.lead_id} onClick={() => setOpen(r.lead_id)}>
                    <td className="mono">{r.lead_id}</td>
                    <td>{`${r.first_name || ''} ${r.last_name || ''}`.trim() || '—'}</td>
                    <td className="mono">{fmtPhone(r.phone_number)}</td>
                    <td>{[r.city, r.state].filter(Boolean).join(', ')}</td>
                    <td className="mono">{r.list_id}</td>
                    <td><span className="chip">{r.status}</span></td>
                    <td className="num">{r.called_count}</td>
                    <td className="mono small">{r.last_local_call_time?.startsWith('2008') ? '—' : r.last_local_call_time?.slice(0, 16)}</td>
                    <td className="mono small">{r.entry_date?.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > 0 && (
          <div className="pager">
            <span className="muted small">
              {t('{from}–{to} de {total}', { from: fmtNum((page - 1) * size + 1), to: fmtNum(Math.min(page * size, data.total)), total: fmtNum(data.total) })}
            </span>
            <select value={size} onChange={(e) => (setSize(Number(e.target.value)), setPage(1))} aria-label={t('Por página')}>
              {[50, 100, 250, 500].map((n) => <option key={n} value={n}>{t('{n} por página', { n })}</option>)}
            </select>
            <div className="row-gap">
              <button className="btn btn-sm btn-ghost" disabled={page <= 1} onClick={() => setPage(1)}>«</button>
              <button className="btn btn-sm btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
              <span className="small">{t('Página {page} de {pages}', { page: fmtNum(page), pages: fmtNum(pages) })}</span>
              <button className="btn btn-sm btn-ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>›</button>
              <button className="btn btn-sm btn-ghost" disabled={page >= pages} onClick={() => setPage(pages)}>»</button>
            </div>
          </div>
        )}
      </Card>
      {open && <LeadDrawer id={open} lists={lists} statuses={statuses} onClose={() => setOpen(null)} onSaved={() => setApplied((a) => ({ ...a }))} />}
    </div>
  );
}

const EDIT_GROUPS = [
  ['Nombre', [['title', 'Título', 4], ['first_name', 'Nombre', 30], ['middle_initial', 'Inicial', 1], ['last_name', 'Apellidos', 30]]],
  ['Contacto', [['phone_code', 'Código de país', 4], ['phone_number', 'Teléfono', 18], ['alt_phone', 'Tel. alternativo', 12], ['address3', 'Tel. 3 (address3)', 100], ['email', 'Email', 70]]],
  ['Dirección', [['address1', 'Dirección', 100], ['address2', 'Dirección 2', 100], ['city', 'Ciudad', 50], ['state', 'Estado/Prov.', 2], ['province', 'Provincia / condado', 50], ['postal_code', 'C. postal', 10], ['country_code', 'País', 3]]],
  ['Otros', [['vendor_lead_code', 'Cód. proveedor', 20], ['source_id', 'Origen', 50], ['owner', 'Propietario', 20], ['rank', 'Rango', 5], ['security_phrase', 'Frase de seguridad', 100], ['date_of_birth', 'Nacimiento', 10], ['gender', 'Sexo', 1]]],
];

function LeadDrawer({ id, lists, statuses, onClose, onSaved }) {
  const t = useT();
  const { data, error, reload } = useLoad(`/leads/lead/${id}`);
  const [f, setF] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => {
    if (data) setF({ ...data.lead });
  }, [data]);
  const lead = data?.lead;
  const changed = lead && f ? Object.keys(f).filter((k) => String(f[k] ?? '') !== String(lead[k] ?? '')) : [];
  const save = async () => {
    const ok = await run('save', () => api(`/leads/lead/${id}`, { method: 'PATCH', body: Object.fromEntries(changed.map((k) => [k, f[k] ?? ''])) }), t('Lead actualizado'));
    if (ok) {
      reload();
      onSaved();
    }
  };
  const name = lead ? `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || t('Cliente sin nombre') : '';

  return (
    <Drawer
      open
      onClose={onClose}
      title={lead ? name : `Lead ${id}`}
      subtitle={lead && `Lead #${lead.lead_id} · ${t('lista {list}', { list: `${lead.list_id}${data.list ? ` (${data.list.list_name} · ${data.list.campaign_id})` : ''}` })}`}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>{t('Cerrar')}</button>
        <button className="btn btn-primary" disabled={!!busy || !changed.length} onClick={save}>{changed.length ? t('Guardar ({n})', { n: changed.length }) : t('Guardar')}</button>
      </>}
    >
      {error && <div className="alert alert-error">{error}</div>}
      {!f ? <div className="muted">{t('Cargando…')}</div> : (
        <div className="stack">
          <dl className="kv small">
            <dt>{t('Alta')}</dt><dd className="mono">{lead.entry_date}</dd>
            <dt>{t('Modificación')}</dt><dd className="mono">{lead.modify_date}</dd>
            <dt>{t('Llamadas')}</dt><dd>{lead.called_count} · {t('última: {date}', { date: lead.last_local_call_time?.startsWith('2008') ? '—' : lead.last_local_call_time })}</dd>
            <dt>{t('Agente')}</dt><dd className="mono">{lead.user || '—'}</dd>
            <dt>{t('Zona horaria (GMT)')}</dt><dd className="mono">{lead.gmt_offset_now}</dd>
          </dl>
          <div className="fgrid">
            <Field label={t('Estado')} dirty={changed.includes('status')}>
              <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                {!statuses.some((s) => s.status === f.status) && <option value={f.status}>{f.status}</option>}
                {statuses.map((s) => <option key={s.status} value={s.status}>{s.status} · {s.status_name}</option>)}
              </select>
            </Field>
            <Field label={t('Lista')} dirty={changed.includes('list_id')}>
              <select value={f.list_id} onChange={(e) => setF({ ...f, list_id: e.target.value })}>
                {!(lists || []).some((l) => String(l.list_id) === String(f.list_id)) && <option value={f.list_id}>{f.list_id}</option>}
                {(lists || []).map((l) => <option key={l.list_id} value={l.list_id}>{l.list_id} · {l.list_name}</option>)}
              </select>
            </Field>
          </div>
          {EDIT_GROUPS.map(([group, fields]) => (
            <fieldset className="fgroup" key={group}>
              <legend>{t(group)}</legend>
              <div className="fgrid">
                {fields.map(([k, label, max]) => (
                  <Field key={k} label={t(label)} dirty={changed.includes(k)}>
                    <input maxLength={max} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
                  </Field>
                ))}
              </div>
            </fieldset>
          ))}
          <Field label={t('Comentarios')} dirty={changed.includes('comments')}>
            <textarea rows={3} maxLength={255} value={f.comments ?? ''} onChange={(e) => setF({ ...f, comments: e.target.value })} />
          </Field>

          <h3 className="h3">{t('Historial de llamadas')}</h3>
          {data.calls.length === 0 ? <p className="muted small">{t('Todavía no se ha llamado a este lead.')}</p> : (
            <div className="table-wrap">
              <table className="table table-compact">
                <thead><tr><th>{t('Fecha')}</th><th>{t('Tipo')}</th><th>{t('Campaña')}</th><th>{t('Resultado')}</th><th>{t('Agente')}</th><th className="num">{t('Duración')}</th></tr></thead>
                <tbody>
                  {data.calls.map((c, i) => (
                    <tr key={i}>
                      <td className="mono small">{c.call_date?.slice(0, 16)}</td>
                      <td>{c.dir === 'IN' ? t('Entrante') : t('Saliente')}</td>
                      <td>{c.campaign_id}</td>
                      <td><span className="chip">{c.status}</span></td>
                      <td className="mono">{c.user}</td>
                      <td className="num mono">{fmtDur(c.length_in_sec)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.recordings.length > 0 && (
            <>
              <h3 className="h3">{t('Grabaciones')}</h3>
              {data.recordings.map((r) => (
                <div key={r.recording_id} className="rec">
                  <span className="mono small">{r.start_time?.slice(0, 16)} · {r.user} · {fmtDur(r.length_in_sec)}</span>
                  {r.location ? <audio controls preload="none" src={r.location} /> : <span className="muted small">{t('En proceso…')}</span>}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}
