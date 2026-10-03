import { useEffect, useRef, useState } from 'react';
import { api, fmtPhone, post } from '../api.js';
import { useToast } from './ui.jsx';
import { useConfirm } from './Modal.jsx';
import { useLongPress } from './useLongPress.js';
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
export default function SmsThread({ peer, leadId, compact = false, onPeerResolved }) {
  const t = useT();
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
          <div className="sms-count muted small">{t('{n} caracteres', { n: text.length })}{text.length > 160 && ` · ${Math.ceil(text.length / 160)} SMS`}</div>
        </form>
      )}
    </div>
  );
}
