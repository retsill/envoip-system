import { useEffect, useRef, useState } from 'react';
import { api, post, usePoll } from '../api.js';
import { Empty, useAction } from '../components/ui.jsx';
import { locale, useT } from '../i18n.js';
import { useConfirm } from '../components/Modal.jsx';


function when(d) {
  if (!d) return '';
  const t = new Date(d.replace(' ', 'T'));
  const now = new Date();
  return t.toDateString() === now.toDateString()
    ? t.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
    : t.toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
}

/** Chat interno de Vicidial: el mismo que ven los agentes en su pantalla clásica y los supervisores en el admin. */
export default function InternalChat() {
  const t = useT();
  const { data: sessions, refresh } = usePoll('/chat/sessions', 3000);
  const [sel, setSel] = useState(null); // { id, sub }
  const [creating, setCreating] = useState(false);
  const current = sessions?.find((s) => sel && s.id === sel.id && s.sub === sel.sub);

  // Si el chat seleccionado se cierra, volver a la lista
  useEffect(() => {
    if (sel && sessions && !current) setSel(null);
  }, [sessions, sel, current]);

  return (
    <div className="page page-fill">
      <div className="page-head">
        <div>
          <h1>{t('Chat interno')}</h1>
          <p className="muted">{t('Con otros agentes y supervisores · el mismo chat de Vicidial')}</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setCreating(true)}>＋ {t('Nuevo chat')}</button>
        </div>
      </div>
      <div className="inbox">
        <aside className="inbox-list card">
          {!sessions ? (
            <div className="muted" style={{ padding: 16 }}>{t('Cargando…')}</div>
          ) : sessions.length === 0 ? (
            <Empty icon="🗨️" title={t('No tienes chats abiertos')}>{t('Empieza uno con «Nuevo chat». Solo se puede chatear con agentes conectados.')}</Empty>
          ) : (
            <ul className="conv-list">
              {sessions.map((s) => (
                <li key={`${s.id}-${s.sub}`}>
                  <button
                    className={`conv ${current === s ? 'on' : ''} ${s.unread ? 'unread' : ''}`}
                    onClick={() => {
                      setCreating(false);
                      setSel({ id: s.id, sub: s.sub });
                    }}
                  >
                    <span className="avatar">{s.title.slice(0, 1).toUpperCase()}</span>
                    <span className="conv-main">
                      <span className="strong">{s.title}{s.withManager && <span className="chip chip-violet">{t('Supervisor')}</span>}</span>
                      <span className="sub">{s.last ? s.last.text : '—'}</span>
                    </span>
                    <span className="conv-side">
                      <span className="sub">{when(s.lastAt)}</span>
                      {s.unread > 0 && <span className="conv-badge">{s.unread}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <section className="inbox-thread card">
          {creating ? (
            <NewChat
              onCancel={() => setCreating(false)}
              onCreated={(c) => {
                setCreating(false);
                setSel(c);
                refresh();
              }}
            />
          ) : current ? (
            <ChatThread key={`${current.id}-${current.sub}`} session={current} onEnded={() => { setSel(null); refresh(); }} />
          ) : (
            <Empty icon="🗨️" title={t('Elige un chat')}>{t('O abre uno nuevo con un agente conectado.')}</Empty>
          )}
        </section>
      </div>
    </div>
  );
}

function ChatThread({ session, onEnded }) {
  const t = useT();
  const confirm = useConfirm();
  const { data, refresh } = usePoll(`/chat/messages?id=${session.id}&sub=${session.sub}`, 2500);
  const [text, setText] = useState('');
  const [run, busy] = useAction();
  const listRef = useRef(null);
  const count = data?.messages.length || 0;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [count]);

  // Marcar como leído (lo hace Vicidial, igual que al abrir el chat en su pantalla)
  useEffect(() => {
    if (session.unread > 0) post('/chat/read', { id: session.id, sub: session.sub }).catch(() => {});
  }, [session.unread, session.id, session.sub]);

  const send = async (e) => {
    e?.preventDefault();
    if (!text.trim()) return;
    const t = text;
    setText('');
    const ok = await run('send', () => post('/chat/send', { id: session.id, sub: session.sub, text: t }));
    if (!ok) setText(t);
    refresh();
  };

  const end = async () => {
    if (!(await confirm({ title: t('Cerrar chat'), message: t('¿Cerrar el chat con {name}? Se cerrará también para los demás participantes.', { name: session.title }), okText: t('Cerrar chat'), danger: true }))) return;
    const ok = await run('end', () => post('/chat/end', { id: session.id, sub: session.sub }), t('Chat cerrado'));
    if (ok) onEnded();
  };

  const canEnd = !session.withManager || session.iAmManager;

  return (
    <>
      <header className="thread-head">
        <div className="avatar avatar-lg">{session.title.slice(0, 1).toUpperCase()}</div>
        <div>
          <div className="strong">{session.title}</div>
          <div className="sub">{session.withManager ? t('Chat con supervisor') : t('Chat entre agentes')} · Vicidial</div>
        </div>
        {canEnd && <button className="btn btn-sm btn-danger-ghost" style={{ marginLeft: 'auto' }} disabled={!!busy} onClick={end}>{t('Cerrar chat')}</button>}
      </header>
      <div className="sms-thread">
        <div className="sms-list" ref={listRef}>
          {(data?.messages || []).map((m) => (
            <div key={m.mid} className={`sms-row ${m.mine ? 'mine' : ''}`}>
              {!m.mine && session.users.length > 1 && <div className="sms-meta">{m.by_name || m.by_user}</div>}
              <div className={`sms-bubble ${m.mine ? 'mine' : ''}`}><div className="sms-text">{m.text}</div></div>
              <div className="sms-meta">{m.at.slice(11, 16)}</div>
            </div>
          ))}
        </div>
        <form className="sms-compose" onSubmit={send}>
          <div className="sms-compose-row">
            <textarea
              rows={1}
              value={text}
              maxLength={1000}
              placeholder={t('Escribe un mensaje…  (Enter envía)')}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) send(e);
              }}
            />
            <button className="btn btn-primary" disabled={busy === 'send' || !text.trim()}>{t('Enviar')}</button>
          </div>
        </form>
      </div>
    </>
  );
}

function NewChat({ onCancel, onCreated }) {
  const t = useT();
  const { data: agents } = usePoll('/chat/agents', 5000);
  const [agent, setAgent] = useState('');
  const [text, setText] = useState('');
  const [run, busy] = useAction();

  const start = async (e) => {
    e.preventDefault();
    const r = await run('start', () => api('/chat/start', { method: 'POST', body: { agent, text } }));
    if (r) onCreated({ id: r.id, sub: r.sub });
  };

  return (
    <form className="card-body stack" onSubmit={start}>
      <h2>{t('Nuevo chat')}</h2>
      <p className="muted small">{t('Vicidial solo permite chatear con agentes que están conectados ahora.')}</p>
      <label className="field">
        <span>{t('Con')}</span>
        <select value={agent} onChange={(e) => setAgent(e.target.value)} required>
          <option value="">{agents?.length ? t('Elige un agente conectado…') : t('No hay agentes conectados')}</option>
          {(agents || []).map((a) => (
            <option key={a.user} value={a.user}>{a.full_name} ({a.user}) · {a.status} · {a.campaign_id}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t('Mensaje')}</span>
        <textarea rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} required />
      </label>
      <div className="row-gap">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>{t('Cancelar')}</button>
        <button className="btn btn-primary" disabled={!!busy || !agent || !text.trim()}>{t('Empezar chat')}</button>
      </div>
    </form>
  );
}
