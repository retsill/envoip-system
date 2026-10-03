import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtPhone, post, usePoll } from '../api.js';
import SmsThread from '../components/SmsThread.jsx';
import { Empty, useToast } from '../components/ui.jsx';
import { useConfirm } from '../components/Modal.jsx';
import { useLongPress } from '../components/useLongPress.js';
import { useAuth } from '../App.jsx';
import { locale, useT } from '../i18n.js';

const BASE = import.meta.env.BASE_URL;

function when(d) {
  const t = new Date(d.replace(' ', 'T'));
  const now = new Date();
  if (t.toDateString() === now.toDateString()) return t.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  if (now - t < 6 * 86400000) return t.toLocaleDateString(locale(), { weekday: 'short' });
  return t.toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
}

/** Bandeja compartida de SMS/MMS: conversaciones a la izquierda, chat a la derecha. */
export default function Messages() {
  const t = useT();
  const { isAdmin } = useAuth();
  const status = usePoll('/sms/status', 30000).data;
  const [q, setQ] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const { data: convs, refresh } = usePoll(`/sms/conversations?q=${encodeURIComponent(q)}${onlyUnread ? '&unread=1' : ''}`, 4000);
  const [peer, setPeer] = useState(null);
  const [newNumber, setNewNumber] = useState('');
  const confirm = useConfirm();
  const toast = useToast();
  // Selección para borrar varias conversaciones: se entra manteniendo pulsado o con la casilla
  const [sel, setSel] = useState(() => new Set());
  const selecting = sel.size > 0;
  const toggle = (p) => setSel((s) => {
    const n = new Set(s);
    if (n.has(p)) n.delete(p);
    else n.add(p);
    return n;
  });
  const press = useLongPress((p) => toggle(p));

  const removeConvs = async (peers) => {
    const ok = await confirm({
      title: peers.length === 1 ? t('Borrar conversación') : t('Borrar {n} conversaciones', { n: peers.length }),
      message: t('Se borrarán todos sus mensajes para todos los usuarios de tu empresa (web y app). No se puede deshacer.'),
      okText: t('Borrar'),
      danger: true,
    });
    if (!ok) return;
    try {
      await post('/sms/delete', { peers });
      if (peers.includes(peer)) setPeer(null);
      setSel(new Set());
      refresh();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const startNew = (e) => {
    e.preventDefault();
    const d = newNumber.replace(/\D/g, '');
    if (d.length >= 10) {
      setPeer(d.length === 11 && d.startsWith('1') ? d.slice(1) : d);
      setNewNumber('');
    }
  };

  return (
    <div className="page page-fill">
      <div className="page-head">
        <div><h1>{t('Mensajes')}</h1><p className="muted">{t('SMS y MMS con tus clientes · desde {did}', { did: status?.defaultDid ? fmtPhone(status.defaultDid) : '…' })}</p></div>
        <form className="page-actions" onSubmit={startNew}>
          <input placeholder={t('Nuevo: número de 10 dígitos')} value={newNumber} onChange={(e) => setNewNumber(e.target.value)} inputMode="tel" />
          <button className="btn btn-primary" disabled={newNumber.replace(/\D/g, '').length < 10}>{t('Escribir')}</button>
        </form>
      </div>
      {status && !status.enabled && (
        <div className="alert alert-warn">
          {t('La mensajería SMS aún no está configurada: puedes ver los mensajes, pero no enviar.')}{' '}
          {isAdmin ? <Link to="/admin/sms">{t('Configúrala en Administración → Mensajería SMS')}</Link> : t('Pide al administrador que la configure.')}
        </div>
      )}
      <div className="inbox">
        <aside className="inbox-list card">
          {selecting ? (
            <div className="inbox-tools select-bar">
              <span className="strong">{t('{n} seleccionadas', { n: sel.size })}</span>
              <span className="select-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => setSel(new Set((convs || []).map((c) => c.peer)))}>{t('Todas')}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setSel(new Set())}>{t('Cancelar')}</button>
                <button className="btn btn-danger btn-sm" onClick={() => removeConvs([...sel])}>🗑 {t('Borrar')}</button>
              </span>
            </div>
          ) : (
            <div className="inbox-tools">
              <input className="search search-sm" placeholder={t('Buscar número, nombre o texto…')} value={q} onChange={(e) => setQ(e.target.value)} />
              <label className="check"><input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} /> {t('Solo sin leer')}</label>
            </div>
          )}
          {!convs ? <div className="muted" style={{ padding: 16 }}>{t('Cargando…')}</div> : convs.length === 0 ? (
            <Empty icon="💬" title={t('Sin conversaciones')}>{t('Los mensajes que envíes o recibas aparecerán aquí.')}</Empty>
          ) : (
            <ul className="conv-list">
              {convs.map((c) => (
                <li key={c.peer} className={`conv-item ${selecting ? 'selecting' : ''} ${sel.has(c.peer) ? 'picked' : ''}`}>
                  <button
                    className={`conv ${peer === c.peer && !selecting ? 'on' : ''} ${c.unread ? 'unread' : ''}`}
                    {...press.handlers(c.peer)}
                    onClick={() => {
                      if (press.consumed()) return;
                      if (selecting) toggle(c.peer);
                      else setPeer(c.peer);
                    }}
                  >
                    <span className="conv-check" aria-hidden>{sel.has(c.peer) ? '✓' : ''}</span>
                    <span className="conv-main">
                      <span className="strong">{c.name || fmtPhone(c.peer)}</span>
                      <span className="sub">
                        {c.direction === 'out' ? t('Tú: ') : ''}
                        {c.body || `📷 ${t('Imagen')}`}
                      </span>
                    </span>
                    <span className="conv-side">
                      <span className="sub">{when(c.created_at)}</span>
                      {c.unread > 0 && <span className="conv-badge">{c.unread}</span>}
                    </span>
                  </button>
                  {!selecting && (
                    <span className="row-actions">
                      <button className="icon-btn" title={t('Seleccionar')} onClick={() => toggle(c.peer)}>☐</button>
                      <button className="icon-btn danger" title={t('Borrar conversación')} onClick={() => removeConvs([c.peer])}>🗑</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </aside>
        <section className="inbox-thread card">
          {peer ? (
            <>
              <ThreadHeader peer={peer} />
              <SmsThread key={peer} peer={peer} />
            </>
          ) : (
            <Empty icon="💬" title={t('Elige una conversación')}>{t('O escribe a un número nuevo con el campo de arriba.')}</Empty>
          )}
        </section>
      </div>
    </div>
  );
}

function ThreadHeader({ peer }) {
  const t = useT();
  const { data } = usePoll(`/sms/thread?peer=${encodeURIComponent(peer)}&after=999999999999`, 60000);
  const lead = data?.lead;
  return (
    <header className="thread-head">
      <div className="avatar avatar-lg">{(lead?.name || '#').slice(0, 1).toUpperCase()}</div>
      <div>
        <div className="strong">{lead?.name || fmtPhone(peer)}</div>
        <div className="sub mono">
          {fmtPhone(peer)}
          {lead && <> · {t('lead #{id} · lista {list}', { id: lead.lead_id, list: lead.list_id })} · {lead.status}</>}
          {!lead && data && <> · {t('sin lead en Vicidial')}</>}
        </div>
      </div>
      {lead && <a className="btn btn-sm" style={{ marginLeft: 'auto' }} href={`${BASE}leads`}>{t('Ver en Leads')}</a>}
    </header>
  );
}
