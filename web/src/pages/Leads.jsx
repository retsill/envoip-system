import { useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import { api, fmtNum, post } from '../api.js';
import { Card, Drawer, Empty, Field, Toggle, useAction } from '../components/ui.jsx';
import { useT } from '../i18n.js';
import LeadBrowser, { exportUrl } from './LeadBrowser.jsx';
import { useConfirm } from '../components/Modal.jsx';


const TABS = [['lists', 'Listas'], ['search', 'Buscar y ver leads'], ['import', 'Importar CSV']];

export default function Leads() {
  const t = useT();
  const [tab, setTab] = useState('lists');
  const [lists, setLists] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [browse, setBrowse] = useState({});
  // «Ver leads» de una lista o campaña: abre el buscador ya filtrado
  const openLeads = (filter) => {
    setBrowse(filter);
    setTab('search');
  };
  const reload = () => api('/leads/lists').then(setLists, () => setLists([]));
  useEffect(() => {
    reload();
    api('/leads/campaigns').then(setCampaigns, () => {});
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{t('Leads y listas')}</h1><p className="muted">{t('Crea listas, importa contactos y busca clientes.')}</p></div>
        <div className="segmented" role="tablist">
          {TABS.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t(l)}</button>
          ))}
        </div>
      </div>
      {tab === 'lists' && <Lists lists={lists} campaigns={campaigns} reload={reload} openLeads={openLeads} />}
      {tab === 'import' && <Import lists={lists || []} onDone={reload} />}
      {tab === 'search' && <LeadBrowser lists={lists} campaigns={campaigns} initial={browse} />}
    </div>
  );
}

function Lists({ lists, campaigns, reload, openLeads }) {
  const t = useT();
  const [run, busy] = useAction();
  const [f, setF] = useState({ list_id: '', list_name: '', campaign_id: '', active: true });
  const [editing, setEditing] = useState(null);
  const create = async (e) => {
    e.preventDefault();
    const ok = await run('create', () => post('/leads/lists', f), t('Lista {id} creada', { id: f.list_id }));
    if (ok) {
      setF({ list_id: '', list_name: '', campaign_id: f.campaign_id, active: true });
      reload();
    }
  };

  return (
    <div className="stack">
      <Card title={t('Listas')} pad={false}>
        {!lists ? <div className="card-body muted">{t('Cargando…')}</div> : lists.length === 0 ? (
          <Empty icon="☰" title={t('No hay listas')} />
        ) : (
          <div className="table-wrap">
          <table className="table table-click">
            <thead><tr><th>ID</th><th>{t('Nombre')}</th><th>{t('Campaña')}</th><th>{t('Activa')}</th><th className="num">Leads</th><th className="num">{t('Nuevos')}</th><th className="num">{t('Sin llamar')}</th><th /></tr></thead>
            <tbody>
              {lists.map((l) => (
                <tr key={l.list_id} className={l.active === 'Y' ? '' : 'row-muted'} onClick={() => setEditing(l)} title={t('Editar lista')}>
                  <td className="mono">{l.list_id}</td>
                  <td>{l.list_name}</td>
                  <td>{l.campaign_id}</td>
                  <td>{l.active === 'Y' ? <span className="chip chip-green">{t('Sí')}</span> : <span className="chip">{t('No')}</span>}</td>
                  <td className="num">{fmtNum(l.leads)}</td>
                  <td className="num">{fmtNum(l.new_leads)}</td>
                  <td className="num">{fmtNum(l.not_called)}</td>
                  <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-sm" onClick={() => openLeads({ list_id: String(l.list_id) })}>{t('Ver leads')}</button>
                    {l.leads > 0 && <a className="btn btn-sm btn-ghost" href={exportUrl({ list_id: l.list_id })} download title={t('Descargar la lista en CSV')}>⬇ CSV</a>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>
      {editing && <ListDrawer list={editing} campaigns={campaigns} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      <Card title={t('Nueva lista')}>
        {campaigns.length === 0 ? (
          <p className="muted">{t('Primero crea una campaña en el panel de administración de Vicidial (Campaigns → Add a New Campaign).')}</p>
        ) : (
          <form onSubmit={create} className="new-list">
            <label className="field"><span>{t('ID de lista (solo números)')}</span>
              <input required inputMode="numeric" value={f.list_id} onChange={(e) => setF({ ...f, list_id: e.target.value.replace(/\D/g, '') })} />
            </label>
            <label className="field"><span>{t('Nombre')}</span>
              <input required maxLength={30} value={f.list_name} onChange={(e) => setF({ ...f, list_name: e.target.value })} />
            </label>
            <label className="field"><span>{t('Campaña')}</span>
              <select required value={f.campaign_id} onChange={(e) => setF({ ...f, campaign_id: e.target.value })}>
                <option value="">{t('Elige…')}</option>
                {campaigns.map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_id} · {c.campaign_name}</option>)}
              </select>
            </label>
            <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> {t('Activa')}</label>
            <button className="btn btn-primary" disabled={!!busy}>{t('Crear lista')}</button>
          </form>
        )}
      </Card>
    </div>
  );
}

function ListDrawer({ list, campaigns, onClose, onSaved }) {
  const t = useT();
  const confirm = useConfirm();
  const initial = { list_name: list.list_name, campaign_id: list.campaign_id, active: list.active === 'Y', list_description: list.list_description || '' };
  const [f, setF] = useState(initial);
  const [run, busy] = useAction();
  const changed = Object.keys(f).filter((k) => f[k] !== initial[k]);
  const path = `/leads/lists/${list.list_id}`;
  const done = (ok) => ok && onSaved();

  const save = async () => done(await run('save', () => api(path, { method: 'PATCH', body: Object.fromEntries(changed.map((k) => [k, f[k]])) }), t('Lista actualizada')));
  const reset = async () => {
    if (await confirm({ title: t('Reiniciar lista'), message: t('¿Reiniciar la lista {id}? Todos sus leads se podrán volver a marcar hoy.', { id: list.list_id }), okText: t('Reiniciar lista'), icon: '↻' }))
      done(await run('reset', () => api(path, { method: 'PATCH', body: { reset_list: true } }), t('Lista reiniciada')));
  };
  const remove = async () => {
    let withLeads = false;
    if (list.leads > 0) {
      const v = await confirm({
        title: t('Borrar la lista {id}', { id: list.list_id }),
        message: t('La lista tiene {n} leads. ¿Qué quieres borrar? No se puede deshacer.', { n: fmtNum(list.leads) }),
        danger: true,
        choices: [{ value: 'list', label: t('Solo la lista') }, { value: 'all', label: t('La lista y sus leads'), danger: true }],
      });
      if (!v) return;
      withLeads = v === 'all';
    } else if (!(await confirm({ title: t('Borrar la lista {id}', { id: list.list_id }), message: t('¿Seguro que quieres borrar la lista {id}? No se puede deshacer.', { id: list.list_id }), okText: t('Borrar'), danger: true }))) return;
    done(await run('del', () => api(`${path}${withLeads ? '?leads=Y' : ''}`, { method: 'DELETE' }), t('Lista borrada')));
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={t('Lista {id}', { id: list.list_id })}
      subtitle={t('{n} leads · {m} sin llamar desde el último reinicio', { n: fmtNum(list.leads), m: fmtNum(list.not_called) })}
      footer={<>
        <button className="btn btn-danger-ghost" style={{ marginRight: 'auto' }} disabled={!!busy} onClick={remove}>{t('Borrar')}</button>
        <button className="btn btn-ghost" onClick={onClose}>{t('Cancelar')}</button>
        <button className="btn btn-primary" disabled={!!busy || !changed.length} onClick={save}>{t('Guardar')}</button>
      </>}
    >
      <div className="stack">
        <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label={f.active ? t('Activa: sus leads se marcan') : t('Inactiva: no se marca')} />
        <Field label={t('Nombre')} dirty={changed.includes('list_name')} hint={t('6 a 30 caracteres')}><input value={f.list_name} onChange={(e) => setF({ ...f, list_name: e.target.value })} /></Field>
        <Field label={t('Campaña')} dirty={changed.includes('campaign_id')}>
          <select value={f.campaign_id} onChange={(e) => setF({ ...f, campaign_id: e.target.value })}>
            {!campaigns.some((c) => c.campaign_id === f.campaign_id) && <option value={f.campaign_id}>{f.campaign_id} ({t('no existe')})</option>}
            {campaigns.map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_id} · {c.campaign_name}</option>)}
          </select>
        </Field>
        <Field label={t('Descripción')} dirty={changed.includes('list_description')}><textarea rows={2} value={f.list_description} onChange={(e) => setF({ ...f, list_description: e.target.value })} /></Field>
        <div className="alert alert-info">
          <b>{t('Reiniciar lista')}</b> {t('hace que los leads ya llamados hoy puedan volver a marcarse (según los estados configurados en la campaña).')}
          <div style={{ marginTop: 8 }}><button className="btn btn-sm" disabled={!!busy} onClick={reset}>{t('Reiniciar lista')}</button></div>
        </div>
      </div>
    </Drawer>
  );
}

const TARGETS = [
  ['phone_number', 'Teléfono *', ['phone_number', 'phone', 'telefono', 'tel', 'movil', 'celular', 'numero', 'mobile']],
  ['first_name', 'Nombre', ['first_name', 'nombre', 'name', 'firstname']],
  ['last_name', 'Apellidos', ['last_name', 'apellido', 'apellidos', 'lastname', 'surname']],
  ['email', 'Email', ['email', 'correo', 'mail', 'e_mail']],
  ['alt_phone', 'Tel. alternativo', ['alt_phone', 'telefono2', 'telefono_2', 'phone2', 'otro_telefono']],
  ['address1', 'Dirección', ['address1', 'address', 'direccion', 'domicilio']],
  ['city', 'Ciudad', ['city', 'ciudad', 'localidad', 'municipio']],
  ['state', 'Estado/Prov. (2 letras)', ['state', 'estado', 'provincia']],
  ['postal_code', 'Código postal', ['postal_code', 'cp', 'codigo_postal', 'zip', 'zipcode']],
  ['vendor_lead_code', 'Cód. proveedor / ID', ['vendor_lead_code', 'id', 'codigo', 'cliente_id', 'id_cliente']],
  ['comments', 'Comentarios', ['comments', 'comentarios', 'notas', 'observaciones']],
];
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/[\s.-]+/g, '_');
const CHUNK = 500;

function Import({ lists, onDone }) {
  const t = useT();
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [map, setMap] = useState({});
  const [opt, setOpt] = useState({ list_id: '', phone_code: '1', duplicate_check: 'DUPLIST' });
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);

  const onFile = (f) => {
    setFile(f);
    setResult(null);
    if (!f) return setParsed(null);
    Papa.parse(f, {
      header: true,
      skipEmptyLines: true,
      complete: (r) => {
        const cols = r.meta.fields || [];
        const auto = {};
        for (const [key, , aliases] of TARGETS) {
          const hit = cols.find((c) => aliases.includes(norm(c)));
          if (hit) auto[key] = hit;
        }
        setMap(auto);
        setParsed({ cols, rows: r.data });
      },
    });
  };

  const mapped = useMemo(() => {
    if (!parsed) return [];
    return parsed.rows.map((row) => Object.fromEntries(TARGETS.filter(([k]) => map[k]).map(([k]) => [k, row[map[k]] ?? ''])));
  }, [parsed, map]);

  const start = async () => {
    const total = { added: 0, duplicates: 0, errors: [] };
    setResult(null);
    for (let i = 0; i < mapped.length; i += CHUNK) {
      setProgress({ done: i, total: mapped.length });
      try {
        const r = await post('/leads/import', { ...opt, rows: mapped.slice(i, i + CHUNK) });
        total.added += r.added;
        total.duplicates += r.duplicates;
        total.errors.push(...r.errors.map((e) => ({ ...e, row: e.row + i })));
      } catch (e) {
        total.errors.push({ row: `${i + 1}–${Math.min(i + CHUNK, mapped.length)}`, error: e.message });
      }
    }
    setProgress(null);
    setResult(total);
    onDone();
  };

  return (
    <div className="grid-2 grid-2-wide">
      <Card title={t('1. Archivo y columnas')}>
        <label className="dropzone">
          <input type="file" accept=".csv,.txt,text/csv" onChange={(e) => onFile(e.target.files[0])} />
          <span className="dropzone-icon" aria-hidden>⬆</span>
          <span>{file ? file.name : t('Elige un archivo CSV (con cabecera en la primera fila)')}</span>
          {parsed && <span className="muted">{t('{rows} filas · {cols} columnas', { rows: fmtNum(parsed.rows.length), cols: parsed.cols.length })}</span>}
        </label>

        {parsed && (
          <>
            <div className="map-grid">
              {TARGETS.map(([k, label]) => (
                <label className="field" key={k}>
                  <span>{t(label)}</span>
                  <select value={map[k] || ''} onChange={(e) => setMap({ ...map, [k]: e.target.value || undefined })}>
                    <option value="">{t('— no importar —')}</option>
                    {parsed.cols.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <h3 className="h3">{t('Vista previa')}</h3>
            <div className="table-wrap">
              <table className="table table-compact">
                <thead><tr>{TARGETS.filter(([k]) => map[k]).map(([k, l]) => <th key={k}>{t(l).replace(' *', '')}</th>)}</tr></thead>
                <tbody>
                  {mapped.slice(0, 5).map((r, i) => (
                    <tr key={i}>{TARGETS.filter(([k]) => map[k]).map(([k]) => <td key={k}>{r[k]}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <Card title={t('2. Destino e importación')}>
        <div className="stack">
          <label className="field"><span>{t('Lista de destino')}</span>
            <select value={opt.list_id} onChange={(e) => setOpt({ ...opt, list_id: e.target.value })}>
              <option value="">{t('Elige una lista…')}</option>
              {lists.map((l) => <option key={l.list_id} value={l.list_id}>{l.list_id} · {l.list_name} ({l.campaign_id})</option>)}
            </select>
          </label>
          <label className="field"><span>{t('Código de país por defecto')}</span>
            <input value={opt.phone_code} onChange={(e) => setOpt({ ...opt, phone_code: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
          </label>
          <label className="field"><span>{t('Duplicados')}</span>
            <select value={opt.duplicate_check} onChange={(e) => setOpt({ ...opt, duplicate_check: e.target.value })}>
              <option value="DUPLIST">{t('Omitir si el teléfono ya está en la lista')}</option>
              <option value="DUPCAMP">{t('Omitir si ya está en la campaña')}</option>
              <option value="DUPSYS">{t('Omitir si ya está en todo el sistema')}</option>
              <option value="">{t('Importar siempre')}</option>
            </select>
          </label>
          <button className="btn btn-primary btn-lg" disabled={!parsed || !map.phone_number || !opt.list_id || !!progress} onClick={start}>
            {progress ? t('Importando…') : parsed ? t('Importar {n} leads', { n: fmtNum(mapped.length) }) : t('Importar leads')}
          </button>
          {progress && (
            <div className="progress" role="progressbar" aria-valuenow={progress.done} aria-valuemax={progress.total}>
              <div style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              <span>{fmtNum(progress.done)} / {fmtNum(progress.total)}</span>
            </div>
          )}
          {result && (
            <div className="result">
              <div className="kpis kpis-sm">
                <div className="kpi kpi-green"><div className="kpi-label">{t('Añadidos')}</div><div className="kpi-value">{fmtNum(result.added)}</div></div>
                <div className="kpi kpi-amber"><div className="kpi-label">{t('Duplicados')}</div><div className="kpi-value">{fmtNum(result.duplicates)}</div></div>
                <div className="kpi kpi-red"><div className="kpi-label">{t('Errores')}</div><div className="kpi-value">{fmtNum(result.errors.length)}</div></div>
              </div>
              {result.errors.length > 0 && (
                <ul className="errors">
                  {result.errors.slice(0, 50).map((e, i) => <li key={i}>{t('Fila {row}: {error}', { row: e.row, error: e.error })}</li>)}
                  {result.errors.length > 50 && <li>{t('…y {n} más', { n: result.errors.length - 50 })}</li>}
                </ul>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
