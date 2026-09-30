import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtPhone, usePoll } from '../api.js';
import SmsThread from '../components/SmsThread.jsx';
import { Empty } from '../components/ui.jsx';
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
  const { data: convs } = usePoll(`/sms/conversations?q=${encodeURIComponent(q)}${onlyUnread ? '&unread=1' : ''}`, 4000);
  const [peer, setPeer] = useState(null);
  const [newNumber, setNewNumber] = useState('');

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
          <div className="inbox-tools">
            <input className="search search-sm" placeholder={t('Buscar número, nombre o texto…')} value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="check"><input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} /> {t('Solo sin leer')}</label>
          </div>
          {!convs ? <div className="muted" style={{ padding: 16 }}>{t('Cargando…')}</div> : convs.length === 0 ? (
            <Empty icon="💬" title={t('Sin conversaciones')}>{t('Los mensajes que envíes o recibas aparecerán aquí.')}</Empty>
          ) : (
            <ul className="conv-list">
              {convs.map((c) => (
                <li key={c.peer}>
                  <button className={`conv ${peer === c.peer ? 'on' : ''} ${c.unread ? 'unread' : ''}`} onClick={() => setPeer(c.peer)}>
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
