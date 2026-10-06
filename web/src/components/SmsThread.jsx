import { useEffect, useRef, useState } from 'react';
import { api, fmtPhone, post } from '../api.js';
import { useToast } from './ui.jsx';
import { useConfirm } from './Modal.jsx';
import { useLongPress } from './useLongPress.js';
import { Modal } from './Modal.jsx';
import { useAuth } from '../App.jsx';
import { locale, t as tr, useT } from '../i18n.js';

const BASE = import.meta.env.BASE_URL;

// Imagen de un mensaje: «media:archivo» = enviada (servida por nuestra API), http… = recibida de VoIP.ms
const mediaUrl = (m) => (m.startsWith('media:') ? `${BASE}api/sms/media/${m.slice(6)}` : m);

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function dayLabel(d) {
  const day = new Date(d.replace(' ', 'T'));
  const today = new Date();
  const y = new Date(Date.now() - 86400000);
  if (day.toDateString() === today.toDateString()) return tr('Hoy');
  if (day.toDateString() === y.toDateString()) return tr('Ayer');
  return day.toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Conversación SMS/MMS con un número. Si se pasa leadId, carga la conversación del lead.
 * compact: versión para la ficha del cliente del agente.
 */
export default function SmsThread({ peer, leadId, leadName = '', compact = false, onPeerResolved }) {
  const t = useT();
  const { user } = useAuth();
  const [tpl, setTpl] = useState({ templates: [], canEdit: false });
  const [editTpl, setEditTpl] = useState(false);
  const loadTpl = () => api('/sms/templates').then(setTpl, () => {});
  useEffect(() => {
    loadTpl();
  }, []);
  // {nombre} → nombre del cliente; {agente} → nombre del agente
  const applyTemplate = (x) => {
    const first = (leadName || data?.lead?.name || '').trim().split(/\s+/)[0] || '';
    const agent = (user?.name || user?.user || '').trim().split(/\s+/)[0] || '';
    setText(x.text.replace(/\{nombre\}/gi, first).replace(/\{agente\}/gi, agent).replace(/\s+([,.!?])/g, '$1').replace(/ {2,}/g, ' '));
  };
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const fileRef = useRef(null);
  const confirm = useConfirm();
  // Selección de mensajes para borrar (mantener pulsado, o el botón que aparece al pasar el ratón)
  const [sel, setSel] = useState(() => new Set());
  const selecting = sel.size > 0;
  const toggle = (id) => setSel((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const press = useLongPress((id) => toggle(id));
  const removeMsgs = async (ids) => {
    const ok = await confirm({
      title: ids.length === 1 ? t('Borrar mensaje') : t('Borrar {n} mensajes', { n: ids.length }),
      message: t('Se borrará para todos los usuarios de tu empresa (web y app). No se puede deshacer.'),
      okText: t('Borrar'),
      danger: true,
    });
    if (!ok) return;
    try {
      await post('/sms/delete', { ids });
      setData((d) => ({ ...d, messages: d.messages.filter((m) => !ids.includes(m.id)) }));
      setSel(new Set());
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const path = leadId ? `/sms/lead/${leadId}` : `/sms/thread?peer=${encodeURIComponent(peer || '')}`;

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const d = await api(path);
        if (!alive) return;
        setData(d);
        setError('');
        onPeerResolved?.(d.peer);
        if (d.messages.some((m) => m.direction === 'in' && !m.read_at)) post('/sms/read', { peer: d.peer }).catch(() => {});
      } catch (e) {
        if (alive) setError(e.message);
      }
    };
    load();
    const id = setInterval(() => !document.hidden && load(), 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [path]);

  // Bajar al último mensaje cuando llegan nuevos
  const count = data?.messages.length || 0;
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [count]);

  const send = async (e) => {
    e?.preventDefault();
    if (sending || (!text.trim() && !files.length) || !data) return;
    setSending(true);
    try {
      const media = await Promise.all(files.map(async (f) => ({ name: f.name, data: await readAsBase64(f) })));
      const msg = await post('/sms/send', { peer: data.peer, body: text, media, lead_id: leadId || data.lead?.lead_id });
      setData((d) => ({ ...d, messages: [...d.messages, msg] }));
      setText('');
      setFiles([]);
    } catch (err) {
      toast(err.message, 'error');
      if (err.data?.message) setData((d) => ({ ...d, messages: [...d.messages, err.data.message] }));
    } finally {
      setSending(false);
    }
  };

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!data) return <div className="muted" style={{ padding: 16 }}>{t('Cargando mensajes…')}</div>;

  const items = [];
  let lastDay = '';
  for (const m of data.messages) {
    const day = dayLabel(m.created_at);
    if (day !== lastDay) {
      lastDay = day;
      items.push(<div key={`d-${m.id}`} className="sms-day"><span>{day}</span></div>);
    }
    const mine = m.direction === 'out';
    items.push(
      <div
        key={m.id}
        className={`sms-row ${mine ? 'mine' : ''} ${selecting ? 'selecting' : ''} ${sel.has(m.id) ? 'picked' : ''}`}
        {...press.handlers(m.id)}
        onClick={() => {
          if (press.consumed()) return;
          if (selecting) toggle(m.id);
        }}
      >
        {!selecting && (
          <button type="button" className="icon-btn danger sms-del" title={t('Borrar mensaje')} onClick={(e) => { e.stopPropagation(); removeMsgs([m.id]); }}>🗑</button>
        )}
        <div className={`sms-bubble ${mine ? 'mine' : ''} ${m.status === 'failed' ? 'failed' : ''}`}>
          {m.media.map((u) => (
            <a key={u} href={mediaUrl(u)} target="_blank" rel="noreferrer"><img src={mediaUrl(u)} alt={t('Imagen')} className="sms-img" /></a>
          ))}
          {m.body && <div className="sms-text">{m.body}</div>}
        </div>
        <div className="sms-meta">
          {m.created_at.slice(11, 16)}
          {mine && m.user && <> · {m.user}</>}
          {mine && m.source === 'app' && <> · app</>}
          {mine && m.source === 'stop' && <> · {t('respuesta automática')}</>}
          {mine && (m.status === 'sent' ? ' ✓' : m.status === 'queued' ? ' …' : '')}
          {m.status === 'failed' && <span className="warn"> · {t('No enviado: {error}', { error: m.error })}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className={`sms-thread ${compact ? 'compact' : ''}`}>
      {data.dnc && <div className="alert alert-warn">⛔ {t('Este número está en la lista negra (se dio de baja): no se le pueden enviar mensajes.')}</div>}
      {selecting && (
        <div className="select-bar">
          <span className="strong">{t('{n} seleccionados', { n: sel.size })}</span>
          <span className="select-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSel(new Set(data.messages.map((m) => m.id)))}>{t('Todos')}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSel(new Set())}>{t('Cancelar')}</button>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => removeMsgs([...sel])}>🗑 {t('Borrar')}</button>
          </span>
        </div>
      )}
      <div className="sms-list" ref={listRef}>
        {items.length ? items : <div className="empty"><div className="empty-icon">💬</div><div className="empty-title">{t('Sin mensajes con {phone}', { phone: fmtPhone(data.peer) })}</div><div className="empty-text">{t('Escribe el primero abajo.')}</div></div>}
      </div>
      {!data.dnc && (
        <form className="sms-compose" onSubmit={send}>
          {files.length > 0 && (
            <div className="sms-files">
              {files.map((f, i) => (
                <span key={i} className="chip">
                  🖼 {f.name}{' '}
                  <button type="button" className="link" onClick={() => setFiles(files.filter((_, j) => j !== i))}>✕</button>
                </span>
              ))}
            </div>
          )}
          <div className="sms-compose-row">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { setFiles([...files, ...e.target.files].slice(0, 3)); e.target.value = ''; }} />
            <button type="button" className="btn btn-ghost btn-sm" title={t('Adjuntar imagen (MMS)')} onClick={() => fileRef.current?.click()}>🖼</button>
            {(tpl.templates.length > 0 || tpl.canEdit) && (
              <select
                className="sms-tpl"
                aria-label={t('Plantillas')}
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '__edit') setEditTpl(true);
                  else if (v !== '') applyTemplate(tpl.templates[Number(v)]);
                }}
              >
                <option value="">{t('Plantillas…')}</option>
                {tpl.templates.map((x, i) => <option key={i} value={i}>{x.name}</option>)}
                {tpl.canEdit && <option value="__edit">✎ {t('Editar plantillas…')}</option>}
              </select>
            )}
            <textarea
              rows={1}
              value={text}
              placeholder={t('Escribe un mensaje…  (Enter envía, Mayús+Enter salto de línea)')}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) send(e);
              }}
            />
            <button className="btn btn-primary" disabled={sending || (!text.trim() && !files.length)}>{sending ? t('Enviando…') : t('Enviar')}</button>
          </div>
          {editTpl && <TemplatesEditor initial={tpl.own || tpl.templates} onClose={() => setEditTpl(false)} onSaved={() => { loadTpl(); setEditTpl(false); }} />}
          <div className="sms-count muted small">{t('{n} caracteres', { n: text.length })}{text.length > 160 && ` · ${Math.ceil(text.length / 160)} SMS`}</div>
        </form>
      )}
    </div>
  );
}

// Plantillas de la empresa: las edita el gerente (nivel 8+)
function TemplatesEditor({ initial, onClose, onSaved }) {
  const t = useT();
  const toast = useToast();
  const [list, setList] = useState(initial.length ? initial : [{ name: '', text: '' }]);
  const [saving, setSaving] = useState(false);
  const set = (i, k, v) => setList((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const save = async () => {
    setSaving(true);
    try {
      const r = await api('/sms/templates', { method: 'PUT', body: { templates: list } });
      toast(t('Plantillas guardadas'));
      onSaved(r.templates);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      title={t('Plantillas de mensajes')}
      icon="✎"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>{t('Cancelar')}</button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>{t('Guardar')}</button>
        </>
      }
    >
      <p className="muted small">{t('Las usan todos los agentes de tu empresa. {nombre} se cambia por el nombre del cliente y {agente} por el del agente.')}</p>
      <div className="stack">
        {list.map((x, i) => (
          <fieldset className="fgroup" key={i}>
            <div className="tpl-row">
              <input placeholder={t('Nombre (ej.: Saludo de la mañana)')} value={x.name} onChange={(e) => set(i, 'name', e.target.value)} />
              <button type="button" className="btn btn-ghost btn-sm" title={t('Quitar')} onClick={() => setList((l) => l.filter((_, j) => j !== i))}>✕</button>
            </div>
            <textarea rows={3} placeholder={t('Hola {nombre}, soy {agente} de…')} value={x.text} onChange={(e) => set(i, 'text', e.target.value)} />
          </fieldset>
        ))}
        <button type="button" className="btn btn-sm" onClick={() => setList((l) => [...l, { name: '', text: '' }])}>＋ {t('Añadir plantilla')}</button>
      </div>
    </Modal>
  );
}
