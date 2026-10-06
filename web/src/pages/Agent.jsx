import { useEffect, useRef, useState } from 'react';
import { api, fmtDur, fmtNum, fmtPhone, post, useNow, usePoll } from '../api.js';
import { useClassic } from '../components/Layout.jsx';
import { Card, Empty, Field, Kpi, StatusBadge, useAction, useLoad } from '../components/ui.jsx';
import { getAgentPass, lastCampaign, setAgentPass } from '../session.js';
import SmsThread from '../components/SmsThread.jsx';
import { t as tr, useT } from '../i18n.js';
import { Modal, useConfirm } from '../components/Modal.jsx';
import { dispoName } from '../dispositions.js';

const FIELD_GROUPS = [
  ['Nombre', ['first_name', 'last_name']],
  ['Contacto', ['phone_number', 'alt_phone', 'email']],
  ['Dirección', ['address1', 'city', 'state', 'postal_code']],
  ['Otros', ['vendor_lead_code', 'date_of_birth']],
];
const LABELS = {
  first_name: 'Nombre', last_name: 'Apellidos', phone_number: 'Teléfono', alt_phone: 'Tel. alternativo',
  email: 'Email', address1: 'Dirección', city: 'Ciudad', state: 'Estado/Prov.', postal_code: 'C. postal',
  vendor_lead_code: 'Cód. proveedor', date_of_birth: 'Nacimiento', comments: 'Comentarios',
};

// Dónde recibe el audio el agente: 'web' (webphone del navegador) o 'app' (EnVoIP Phone, extensión 5 + la suya)
function lastDevice(v) {
  try {
    if (v) localStorage.setItem('envoip.device', v);
    return localStorage.getItem('envoip.device') || 'web';
  } catch {
    return v || 'web';
  }
}

async function connectClassic(classic, campaignId, pass, device = 'web') {
  const started = Date.now();
  for (;;) {
    try {
      const creds = await post('/agent/classic-login', { campaign_id: campaignId, device });
      lastCampaign(campaignId);
      classic.login({ ...creds, VD_pass: pass });
      return;
    } catch (e) {
      // 409: el teléfono aún tiene abierta la conexión de una sesión anterior; esperar y reintentar
      if (e.status !== 409 || Date.now() - started > 90000) {
        classic.setWaiting(null);
        throw e;
      }
      classic.setWaiting(e.message);
      await new Promise((r) => setTimeout(r, (e.data?.retryAfter || 5) * 1000));
    }
  }
}

export default function Agent() {
  const t = useT();
  const classic = useClassic();
  const { data, error, refresh, fetchedAt } = usePoll('/agent/state', 1500);
  const wasLogged = useRef(null);
  const autoTried = useRef(false);
  const loggedIn = data?.loggedIn;

  useEffect(() => {
    if (loggedIn === undefined) return;
    // Conexión automática completada
    if (loggedIn && classic.status.phase === 'connecting') classic.connected();
    // Login manual en la pantalla clásica completado: la ocultamos
    if (loggedIn && wasLogged.current === false && classic.visible) classic.hide();
    wasLogged.current = loggedIn;
  }, [loggedIn, classic]);

  // Tras recargar la página: Vicidial sigue viendo al agente conectado pero esta pestaña
  // perdió la sesión oculta (y el audio). Reconectamos solos a la misma campaña.
  useEffect(() => {
    if (loggedIn && !classic.mounted && !autoTried.current && getAgentPass()) {
      autoTried.current = true;
      connectClassic(classic, data.agent.campaign_id, getAgentPass(), lastDevice()).catch(() => {});
    }
  }, [loggedIn, classic, data]);

  if (!data) return <div className="page">{error ? <div className="alert alert-error">{error}</div> : <div className="muted">{t('Cargando…')}</div>}</div>;
  if (!data.loggedIn) return <Connect stats={data.stats} />;
  // Cambiar de campaña sin salir: la API de Vicidial solo «pide» el logout y lo ejecuta la pantalla clásica oculta,
  // así que hay que mantenerla hasta que Vicidial cierre la sesión; después se conecta a la campaña nueva.
  const changeCampaign = async (campaignId, onStep) => {
    autoTried.current = true; // que no se reconecte sola a la campaña anterior
    onStep?.(tr('Cerrando tu sesión en {id}…', { id: data.agent.campaign_id }));
    await post('/agent/logout');
    const started = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500));
      const st = await api('/agent/state').catch(() => null);
      if (st && !st.loggedIn) break;
      if (Date.now() - started > 30000) {
        throw new Error(tr('Vicidial no cerró la sesión. ¿Está abierta en otra pestaña u otro equipo? Ciérrala allí e inténtalo de nuevo.'));
      }
    }
    classic.unmount();
    const pass = getAgentPass();
    if (!pass) return refresh(); // sin contraseña en esta pestaña: se elige en la pantalla «Conéctate»
    onStep?.(tr('Conectando a {id}…', { id: campaignId }));
    await connectClassic(classic, campaignId, pass, lastDevice());
    refresh();
  };
  return <Console data={data} refresh={refresh} fetchedAt={fetchedAt} error={error} onChangeCampaign={changeCampaign} />;
}

function Connect({ stats }) {
  const t = useT();
  const classic = useClassic();
  const { data: opts, error: optsError } = useLoad('/agent/login-options');
  const [campaign, setCampaign] = useState('');
  const [pass, setPass] = useState(getAgentPass() || '');
  const [askPass] = useState(!getAgentPass());
  const [error, setError] = useState('');
  const [device, setDevice] = useState(lastDevice());
  const [slow, setSlow] = useState(false);
  const insecure = location.protocol !== 'https:';
  const connecting = classic.status.phase === 'connecting' || Boolean(classic.waiting);
  const shownError = error || (classic.status.phase === 'error' ? t(classic.status.error) : '');

  useEffect(() => {
    if (!opts || campaign) return;
    // Cada inicio de sesión el agente elige la campaña (no se preselecciona la anterior),
    // salvo que solo tenga una disponible.
    if (opts.campaigns.length === 1) setCampaign(opts.campaigns[0].campaign_id);
  }, [opts, campaign]);

  useEffect(() => {
    setSlow(false);
    if (!connecting) return;
    const t = setTimeout(() => setSlow(true), 20000);
    return () => clearTimeout(t);
  }, [connecting]);

  const connect = async (e) => {
    e?.preventDefault();
    setError('');
    try {
      if (askPass) setAgentPass(pass);
      const dev = opts?.app_phone ? device : 'web';
      lastDevice(dev);
      await connectClassic(classic, campaign, pass, dev);
    } catch (err) {
      setError(err.message);
    }
  };

  const noPhone = opts && !opts.phone_ok;
  const noCampaigns = opts && opts.campaigns.length === 0;

  return (
    <div className="page">
      <div className="page-head"><div><h1>{t('Pantalla de agente')}</h1><p className="muted">{t('Elige la campaña y conéctate para empezar a recibir y hacer llamadas.')}</p></div></div>
      {insecure && (
        <div className="alert alert-warn">
          {t('El audio del navegador (WebRTC) necesita HTTPS.')} <a href={`https://${location.host}${location.pathname}`}>{t('Abrir la versión segura')}</a>
        </div>
      )}
      <div className="connect">
        <Card className="connect-card">
          <div className="connect-icon" aria-hidden>🎧</div>
          <h2>{connecting ? t('Conectando con Vicidial…') : t('Conéctate')}</h2>
          {optsError && <div className="alert alert-error">{optsError}</div>}
          {noPhone && (
            <div className="alert alert-warn">
              {opts.phone_login
                ? t('El teléfono {phone} asignado a tu usuario no existe o está inactivo.', { phone: opts.phone_login })
                : t('Tu usuario no tiene un teléfono asignado.')}{' '}
              {t('Pide al administrador que lo configure en Administración → Usuarios.')}
            </div>
          )}
          {noCampaigns && <div className="alert alert-warn">{t('No tienes ninguna campaña activa disponible.')}</div>}

          {connecting ? (
            <div className="connecting">
              <div className="spinner" aria-hidden />
              <p className="muted">
                {classic.waiting ||
                  (opts?.app_phone && device === 'app'
                    ? t('Iniciando tu sesión. Vicidial llamará a EnVoIP Phone (ext. {ext}) y la app contestará sola: tenla abierta y conectada.', { ext: opts.app_phone })
                    : t('Iniciando tu sesión y el teléfono. Si el navegador pide permiso para el micrófono, acéptalo.'))}
              </p>
              {slow && (
                <p className="small">
                  {t('Está tardando más de lo normal.')}{' '}
                  <button className="link" onClick={classic.show}>{t('Ver qué pasa en la pantalla clásica')}</button>
                </p>
              )}
            </div>
          ) : (
            <form className="stack" onSubmit={connect}>
              <Field label={t('Campaña')}>
                <select value={campaign} onChange={(e) => setCampaign(e.target.value)} disabled={!opts || noCampaigns}>
                  {(opts?.campaigns?.length || 0) > 1 && <option value="">{t('Elige la campaña…')}</option>}
                  {(opts?.campaigns || []).map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_id} · {c.campaign_name}</option>)}
                </select>
              </Field>
              {opts?.app_phone && (
                <Field label={t('Recibir las llamadas en')} hint={device === 'app' ? t('La app EnVoIP Phone con la extensión {ext}, abierta y conectada.', { ext: opts.app_phone }) : t('Este navegador, con tus auriculares.')}>
                  <div className="segmented device-choice" role="radiogroup">
                    <button type="button" role="radio" aria-checked={device === 'web'} className={device === 'web' ? 'on' : ''} onClick={() => setDevice('web')}>🌐 {t('Navegador')}</button>
                    <button type="button" role="radio" aria-checked={device === 'app'} className={device === 'app' ? 'on' : ''} onClick={() => setDevice('app')}>📱 {t('App EnVoIP Phone')}</button>
                  </div>
                </Field>
              )}
              {askPass && (
                <Field label={t('Tu contraseña')} hint={t('Solo esta vez: la pantalla se abrió en otra pestaña o se cerró la sesión.')}>
                  <input type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} />
                </Field>
              )}
              {shownError && <div className="alert alert-error">{shownError}</div>}
              <button className="btn btn-primary btn-lg" disabled={!opts || noPhone || noCampaigns || !campaign || !pass}>
                {shownError ? t('Reintentar') : t('Conectar')}
              </button>
              {opts?.phone_login && (
                <p className="muted small">
                  {t('Teléfono')}: <span className="mono">{opts.app_phone && device === 'app' ? opts.app_phone : opts.phone_login}</span>
                </p>
              )}
            </form>
          )}
          <p className="small muted" style={{ marginTop: 16 }}>
            {t('¿Problemas?')} <button className="link" onClick={classic.show}>{t('Entrar manualmente con la pantalla clásica')}</button>
          </p>
        </Card>
        <Card title={t('Tu día')}>
          <StatsGrid stats={stats} />
        </Card>
      </div>
    </div>
  );
}

function Console({ data, refresh, fetchedAt, error, onChangeCampaign }) {
  const t = useT();
  const confirm = useConfirm();
  const [campModal, setCampModal] = useState(false);
  const { agent, lead, history, stats } = data;
  const now = useNow();
  const [run, busy] = useAction();
  const [opts, setOpts] = useState({ statuses: [], pauseCodes: [] });
  const secs = agent.state_secs + Math.floor((now - fetchedAt) / 1000);

  useEffect(() => {
    api('/agent/options').then(setOpts, () => {});
  }, [agent.campaign_id]);

  const act = (key, path, body, ok) => run(key, () => post(path, body), ok).then(() => setTimeout(refresh, 400));
  const paused = agent.status === 'PAUSED';
  const onCall = ['INCALL', 'DEAD'].includes(agent.status);
  const hasLead = Boolean(lead);

  return (
    <div className="page">
      {error && <div className="alert alert-error">{t('Sin conexión con el servidor: {error}', { error })}</div>}
      <AudioBanner campaignId={agent.campaign_id} />
      <div className={`agentbar tone-bg-${{ PAUSED: 'amber', INCALL: 'green', DEAD: 'red', DISPO: 'violet' }[agent.status] || 'blue'}`}>
        <div className="agentbar-state">
          <StatusBadge status={agent.status} big />
          <div className="agentbar-timer mono">{fmtDur(secs)}</div>
        </div>
        <div className="agentbar-meta">
          <div><span className="muted">{t('Campaña')}</span> <b>{agent.campaign_id}</b> {agent.campaign_name && <span className="muted">· {agent.campaign_name}</span>}{' '}
            {!onCall && agent.status !== 'DISPO' && (
              <button className="link small" disabled={!!busy} onClick={() => setCampModal(true)}>
                {t('Cambiar campaña')}
              </button>
            )}
          </div>
          <div><span className="muted">{t('Llamadas hoy')}</span> <b>{agent.calls_today}</b></div>
          {paused && agent.pause_code && <div><span className="muted">{t('Motivo')}</span> <b>{agent.pause_code}</b></div>}
        </div>
        <div className="agentbar-actions">
          {paused && opts.pauseCodes.length > 0 && (
            <select
              aria-label={t('Motivo de pausa')}
              value=""
              onChange={(e) => e.target.value && act('code', '/agent/pause-code', { code: e.target.value }, t('Motivo de pausa guardado'))}
            >
              <option value="">{t('Motivo de pausa…')}</option>
              {opts.pauseCodes.map((p) => <option key={p.pause_code} value={p.pause_code}>{p.pause_code_name}</option>)}
            </select>
          )}
          {onCall && (
            <button className="btn btn-danger btn-lg" disabled={!!busy} onClick={() => act('hangup', '/agent/hangup', {}, t('Llamada colgada'))}>
              {t('Colgar')}
            </button>
          )}
          {paused ? (
            <button className="btn btn-success btn-lg" disabled={!!busy} onClick={() => act('resume', '/agent/pause', { action: 'RESUME' }, t('Estás disponible'))}>
              ▶ {t('Estar disponible')}
            </button>
          ) : (
            agent.status !== 'DISPO' && (
              <button className="btn btn-lg" disabled={!!busy} onClick={() => act('pause', '/agent/pause', { action: 'PAUSE' }, onCall ? t('Te pausarás al terminar la llamada') : t('En pausa'))}>
                ❚❚ {t('Pausa')}
              </button>
            )
          )}
        </div>
      </div>

      <div className="agent-grid">
        <div className="col">
          {hasLead ? (
            <LeadCard lead={lead} run={run} busy={busy} />
          ) : (
            <>
              <Card>
                <div className="waiting">
                  <span className="waiting-icon" aria-hidden>{paused ? '☕' : '⏳'}</span>
                  <div>
                    <div className="strong">{paused ? t('Estás en pausa') : t('Esperando la siguiente llamada…')}</div>
                    <div className="muted small">
                      {paused ? t('Pulsa «Estar disponible» para recibir llamadas, marca un número o vuelve a llamar desde tu historial.') : t('La ficha del cliente aparecerá aquí en cuanto conecte una llamada.')}
                    </div>
                  </div>
                </div>
              </Card>
              <RecentCalls act={act} busy={busy} />
            </>
          )}
          {hasLead && <HistoryCard history={history} lead={lead} />}
        </div>
        <div className="col">
          {hasLead ? (
            <DispoCard statuses={opts.statuses} onCall={onCall} run={run} busy={busy} refresh={refresh} />
          ) : (
            <Dialer paused={paused} act={act} busy={busy} />
          )}
          <CallbacksCard act={act} busy={busy} />
          <Card title={t('Tu día')}>
            <StatsGrid stats={stats} />
          </Card>
          <div className="agent-foot">
            <button
              className="btn btn-ghost btn-sm"
              onClick={async () =>
                (await confirm({ title: t('Cerrar sesión de agente'), message: t('¿Cerrar tu sesión de agente?'), okText: t('Cerrar sesión'), icon: '🎧' })) &&
                act('logout', '/agent/logout', {}, t('Sesión cerrada'))
              }
            >
              {t('Cerrar sesión de agente')}
            </button>
          </div>
        </div>
      </div>
      {campModal && <CampaignModal current={agent.campaign_id} onChange={onChangeCampaign} onClose={() => setCampModal(false)} />}
      {!onCall && !hasLead && agent.status !== 'DISPO' && <CallbackPrompt act={act} />}
    </div>
  );
}

// ---------------------------------------------------------------- Rellamadas programadas
const SNOOZE_KEY = 'envoip.cbSnooze';
function snoozed() {
  try {
    return JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}');
  } catch {
    return {};
  }
}
function snooze(id, minutes) {
  try {
    const s = snoozed();
    s[id] = Date.now() + minutes * 60000;
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(s));
  } catch {
    /* sin almacenamiento: solo se pospone en esta pantalla */
  }
}
const fmtWhen = (d) => {
  const x = new Date(String(d).replace(' ', 'T'));
  const today = new Date().toDateString() === x.toDateString();
  return today ? x.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : x.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

function CallbacksCard({ act, busy }) {
  const t = useT();
  const { data, refresh } = usePoll('/agent/callbacks', 30000);
  if (!data || data.length === 0) return null;
  const due = data.filter((c) => c.due).length;
  return (
    <Card title={<>{t('Mis rellamadas')} {due > 0 && <span className="chip chip-red">{t('{n} pendientes ahora', { n: due })}</span>}</>} pad={false}>
      <ul className="recent-list">
        {data.map((c) => (
          <li key={c.callback_id}>
            <button
              className={`recent${c.due ? ' cb-due' : ''}`}
              disabled={!!busy}
              title={t('Llamar ahora')}
              onClick={() => act('cb', `/agent/callbacks/${c.callback_id}/dial`, {}, t('Llamando a {who}…', { who: c.name || fmtPhone(c.phone_number) })).then(refresh)}
            >
              <span className="recent-dir out" aria-hidden>{c.due ? '⏰' : '🕒'}</span>
              <span className="recent-main">
                <span className="strong">{c.name || fmtPhone(c.phone_number)}</span>
                <span className="sub">
                  <span className="mono">{fmtPhone(c.phone_number)}</span> · {c.campaign_id}
                  {c.comments ? ` · ${c.comments}` : ''}
                </span>
              </span>
              <span className="recent-time mono">{fmtWhen(c.callback_time)}</span>
              <span className="recent-call" aria-hidden>📞</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// Cuando llega la hora de una rellamada y el agente no está en llamada: aviso con cuenta atrás que marca solo
function CallbackPrompt({ act }) {
  const t = useT();
  const { data, refresh } = usePoll('/agent/callbacks', 15000);
  const [count, setCount] = useState(10);
  const [hidden, setHidden] = useState(0);
  const sn = snoozed();
  const cb = (data || []).find((c) => c.due && !(sn[c.callback_id] > Date.now()));
  useEffect(() => setCount(10), [cb?.callback_id]);
  useEffect(() => {
    if (!cb) return undefined;
    if (count <= 0) {
      dial();
      return undefined;
    }
    const id = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cb?.callback_id, count]);
  if (!cb) return null;
  const who = cb.name || fmtPhone(cb.phone_number);
  function dial() {
    snooze(cb.callback_id, 2); // evita repetir mientras Vicidial la da por hecha
    act('cb', `/agent/callbacks/${cb.callback_id}/dial`, {}, t('Llamando a {who}…', { who })).then(refresh);
    setHidden((h) => h + 1);
  }
  const later = (m) => {
    snooze(cb.callback_id, m);
    setHidden((h) => h + 1);
  };
  return (
    <Modal
      key={`${cb.callback_id}-${hidden}`}
      title={t('Rellamada programada')}
      icon="⏰"
      onClose={() => later(10)}
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => later(10)}>{t('En 10 minutos')}</button>
          <button className="btn btn-success" data-autofocus="" onClick={dial}>📞 {t('Llamar ahora')}</button>
        </>
      }
    >
      <p className="modal-text">
        {t('Es la hora de volver a llamar a {who} ({phone}), programada para las {time}.', { who, phone: fmtPhone(cb.phone_number), time: fmtWhen(cb.callback_time) })}
      </p>
      {cb.comments && <p className="muted">{cb.comments}</p>}
      <p className="strong">{t('Marcando automáticamente en {n} s…', { n: count })}</p>
    </Modal>
  );
}

// Diálogo para cambiar de campaña sin salir de la pantalla
function CampaignModal({ current, onChange, onClose }) {
  const t = useT();
  const { data: opts, error } = useLoad('/agent/login-options');
  const [campaign, setCampaign] = useState('');
  const [step, setStep] = useState('');
  const [fail, setFail] = useState('');
  const others = (opts?.campaigns || []).filter((c) => c.campaign_id !== current);
  useEffect(() => {
    if (!campaign && others.length) setCampaign(others[0].campaign_id);
  }, [others, campaign]);
  const go = async () => {
    setFail('');
    try {
      await onChange(campaign, setStep);
      onClose();
    } catch (e) {
      setStep('');
      setFail(e.message);
    }
  };
  return (
    <Modal
      title={t('Cambiar campaña')}
      icon="📣"
      onClose={step ? undefined : onClose}
      footer={step ? null : (
        <>
          <button className="btn btn-ghost" onClick={onClose}>{t('Cancelar')}</button>
          <button className="btn btn-primary" data-autofocus="" disabled={!campaign} onClick={go}>{t('Cambiar')}</button>
        </>
      )}
    >
      {step ? (
        <div className="connecting"><div className="spinner" aria-hidden /><p className="muted">{step}</p></div>
      ) : (
        <div className="stack">
          <p className="modal-text">{t('Ahora estás en {id}. Se cerrará esa sesión y entrarás en la campaña que elijas.', { id: current })}</p>
          {error && <div className="alert alert-error">{error}</div>}
          {opts && others.length === 0 && <div className="alert alert-warn">{t('No tienes otras campañas activas disponibles.')}</div>}
          {others.length > 0 && (
            <Field label={t('Campaña')}>
              <select value={campaign} onChange={(e) => setCampaign(e.target.value)}>
                {others.map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_id} · {c.campaign_name}</option>)}
              </select>
            </Field>
          )}
          {fail && <div className="alert alert-error">{fail}</div>}
        </div>
      )}
    </Modal>
  );
}

// Aviso si Vicidial nos ve conectados pero esta pestaña no tiene la sesión oculta (sin audio)
function AudioBanner({ campaignId }) {
  const t = useT();
  const classic = useClassic();
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  if (classic.mounted && classic.status.phase !== 'error') return null;
  const reconnect = async (e) => {
    e.preventDefault();
    setError('');
    const p = getAgentPass() || pass;
    try {
      setAgentPass(p);
      await connectClassic(classic, campaignId, p);
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <form className="alert alert-warn audio-banner" onSubmit={reconnect}>
      <span>{classic.waiting ? `⏳ ${classic.waiting}` : `⚠ ${t(classic.status.error || 'Tu sesión está abierta en Vicidial pero no en esta pestaña: no tienes audio.')}`}</span>
      {!getAgentPass() && <input type="password" placeholder={t('Tu contraseña')} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" />}
      <button className="btn btn-sm btn-primary" disabled={!getAgentPass() && !pass}>{t('Reconectar')}</button>
      {error && <span className="warn">{error}</span>}
    </form>
  );
}

function LeadCard({ lead, run, busy }) {
  const t = useT();
  const [form, setForm] = useState(lead);
  const [tab, setTab] = useState('ficha');
  const sms = usePoll('/sms/status', 60000).data;
  const leadId = useRef(lead.lead_id);
  useEffect(() => {
    // Solo reiniciamos el formulario al cambiar de cliente, para no pisar lo que el agente escribe
    if (leadId.current !== lead.lead_id) {
      leadId.current = lead.lead_id;
      setForm(lead);
      setTab('ficha');
    }
  }, [lead]);

  const changed = Object.keys(LABELS).filter((k) => (form[k] ?? '') !== (lead[k] ?? ''));
  const save = () =>
    run('save', () => post('/agent/fields', { fields: Object.fromEntries(changed.map((k) => [k, form[k] ?? ''])) }), t('Ficha actualizada'));
  const name = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || t('Cliente sin nombre');

  return (
    <Card
      className="lead-card"
      title={
        <span className="lead-title">
          <span className="avatar avatar-lg">{name.slice(0, 1).toUpperCase()}</span>
          <span>
            <span className="lead-name">{name}</span>
            <span className="sub mono">+{lead.phone_code} {fmtPhone(lead.phone_number)} · {t('lead #{id} · lista {list} · {n} llamadas', { id: lead.lead_id, list: lead.list_id, n: lead.called_count })}</span>
            {sms?.enabled && tab !== 'sms' && (
              <button className="btn btn-primary btn-sm lead-sms" onClick={() => setTab('sms')}>💬 {t('Enviar SMS')}</button>
            )}
          </span>
        </span>
      }
      actions={
        <>
          {sms?.enabled && (
            <div className="segmented" role="tablist">
              <button role="tab" aria-selected={tab === 'ficha'} className={tab === 'ficha' ? 'on' : ''} onClick={() => setTab('ficha')}>{t('Ficha')}</button>
              <button role="tab" aria-selected={tab === 'sms'} className={tab === 'sms' ? 'on' : ''} onClick={() => setTab('sms')}>💬 {t('Mensajes')}</button>
            </div>
          )}
          {tab === 'ficha' && changed.length > 0 && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => setForm(lead)}>{t('Descartar')}</button>
              <button className="btn btn-primary btn-sm" disabled={busy === 'save'} onClick={save}>{t('Guardar ({n})', { n: changed.length })}</button>
            </>
          )}
        </>
      }
    >
      {tab === 'sms' ? <SmsThread leadId={lead.lead_id} leadName={lead.first_name || ''} compact /> : <>
      {FIELD_GROUPS.map(([group, fields]) => (
        <fieldset className="fgroup" key={group}>
          <legend>{t(group)}</legend>
          <div className="fgrid">
            {fields.map((f) => (
              <label className={`field${changed.includes(f) ? ' is-dirty' : ''}`} key={f}>
                <span>{t(LABELS[f])}</span>
                <input value={form[f] ?? ''} onChange={(e) => setForm({ ...form, [f]: e.target.value })} />
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <label className={`field${changed.includes('comments') ? ' is-dirty' : ''}`}>
        <span>{t('Comentarios')}</span>
        <textarea rows={3} value={form.comments ?? ''} onChange={(e) => setForm({ ...form, comments: e.target.value })} />
      </label>
      </>}
    </Card>
  );
}

// Historial del agente: un clic vuelve a llamar (por el mismo lead, para conservar su historial)
function RecentCalls({ act, busy }) {
  const t = useT();
  const { data, error } = usePoll('/agent/recent-calls', 10000);
  const redial = (c) =>
    act('redial', '/agent/dial', c.lead_id > 0 ? { lead_id: c.lead_id } : { phone: c.phone_number, phone_code: c.phone_code }, t('Llamando a {who}…', { who: c.name || fmtPhone(c.phone_number) }));

  return (
    <Card title={t('Tus llamadas recientes')} pad={false}>
      {error && <div className="card-body alert alert-error">{error}</div>}
      {!data ? (
        <div className="card-body muted">{t('Cargando…')}</div>
      ) : data.length === 0 ? (
        <Empty icon="📞" title={t('Aún no has hecho llamadas')}>{t('Las llamadas que hagas o recibas aparecerán aquí para volver a llamar con un clic.')}</Empty>
      ) : (
        <ul className="recent-list">
          {data.map((c, i) => (
            <li key={`${c.call_date}-${i}`}>
              <button className="recent" disabled={!!busy} onClick={() => redial(c)} title={t('Volver a llamar')}>
                <span className={`recent-dir ${c.dir === 'IN' ? 'in' : 'out'}`} aria-label={c.dir === 'IN' ? t('Entrante') : t('Saliente')}>
                  {c.dir === 'IN' ? '↙' : '↗'}
                </span>
                <span className="recent-main">
                  <span className="strong">{c.name || fmtPhone(c.phone_number)}</span>
                  <span className="sub">
                    {c.name && <span className="mono">{fmtPhone(c.phone_number)} · </span>}
                    {dispoName(c.status, c.status_name)} · {fmtDur(c.length_in_sec)}
                  </span>
                </span>
                <span className="recent-time mono">{c.call_date.slice(5, 16).replace('-', '/')}</span>
                <span className="recent-call" aria-hidden>📞</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function HistoryCard({ history }) {
  const t = useT();
  return (
    <Card title={t('Historial de llamadas')} pad={false}>
      {history.length === 0 ? (
        <Empty icon="🆕" title={t('Primera llamada a este cliente')} />
      ) : (
        <table className="table">
          <thead><tr><th>{t('Fecha')}</th><th>{t('Tipo')}</th><th>{t('Resultado')}</th><th>{t('Agente')}</th><th className="num">{t('Duración')}</th></tr></thead>
          <tbody>
            {history.map((h, i) => (
              <tr key={i}>
                <td className="mono">{h.call_date.slice(0, 16)}</td>
                <td>{h.dir === 'IN' ? t('Entrante') : t('Saliente')}</td>
                <td><span className="chip" title={dispoName(h.status)}>{h.status}</span></td>
                <td>{h.user}</td>
                <td className="num mono">{fmtDur(h.length_in_sec)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function DispoCard({ statuses, onCall, run, busy, refresh }) {
  const t = useT();
  const [pick, setPick] = useState(null);
  const [pauseAfter, setPauseAfter] = useState(false);
  const [cb, setCb] = useState({ datetime: '', type: 'USERONLY', comments: '' });

  const submit = async (s) => {
    const isCb = s.scheduled_callback === 'Y';
    if (isCb && !cb.datetime) return setPick(s);
    await run('dispo', async () => {
      // Orden recomendado por la documentación: pausar → colgar → calificar.
      // vicidial.php ejecuta las órdenes de la API de una en una (cada segundo) y solo acepta la calificación
      // cuando ya ha colgado: esperamos a que deje de estar en llamada antes de calificar.
      if (pauseAfter) await post('/agent/pause', { action: 'PAUSE' });
      if (onCall) {
        await post('/agent/hangup');
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 500));
          const st = await api('/agent/state').catch(() => null);
          if (!st?.loggedIn || !['INCALL', 'DEAD'].includes(st.agent.status)) break;
        }
      }
      await post('/agent/dispo', {
        status: s.status,
        ...(isCb ? { callback_datetime: cb.datetime, callback_type: cb.type, callback_comments: cb.comments } : {}),
      });
    }, t('Llamada calificada: {status}', { status: dispoName(s.status, s.status_name) }));
    setPick(null);
    setCb({ datetime: '', type: 'USERONLY', comments: '' });
    setTimeout(refresh, 500);
  };

  const sales = statuses.filter((s) => s.sale === 'Y');
  const rest = statuses.filter((s) => s.sale !== 'Y');

  return (
    <Card title={onCall ? t('Calificar y colgar') : t('Calificar llamada')} className="dispo-card">
      {pick ? (
        <div className="cb-form">
          <p><b>{dispoName(pick.status, pick.status_name)}</b>: {t('¿cuándo volvemos a llamar?')}</p>
          <label className="field"><span>{t('Fecha y hora')}</span>
            <input type="datetime-local" value={cb.datetime} onChange={(e) => setCb({ ...cb, datetime: e.target.value })} />
          </label>
          <label className="field"><span>{t('Quién llama')}</span>
            <select value={cb.type} onChange={(e) => setCb({ ...cb, type: e.target.value })}>
              <option value="USERONLY">{t('Solo yo')}</option>
              <option value="ANYONE">{t('Cualquier agente')}</option>
            </select>
          </label>
          <label className="field"><span>{t('Nota')}</span>
            <input maxLength={199} value={cb.comments} onChange={(e) => setCb({ ...cb, comments: e.target.value })} />
          </label>
          <div className="row-gap">
            <button className="btn btn-ghost" onClick={() => setPick(null)}>{t('Cancelar')}</button>
            <button className="btn btn-primary" disabled={!cb.datetime || !!busy} onClick={() => submit(pick)}>{t('Programar rellamada')}</button>
          </div>
        </div>
      ) : (
        <>
          {statuses.length === 0 && <div className="muted">{t('Cargando calificaciones…')}</div>}
          {sales.length > 0 && (
            <div className="dispo-grid">
              {sales.map((s) => (
                <button key={s.status} className="dispo dispo-sale" disabled={!!busy} onClick={() => submit(s)}>
                  <b>{dispoName(s.status, s.status_name)}</b><span>{s.status}</span>
                </button>
              ))}
            </div>
          )}
          <div className="dispo-grid">
            {rest.map((s) => (
              <button key={s.status} className={`dispo${s.scheduled_callback === 'Y' ? ' dispo-cb' : ''}`} disabled={!!busy} onClick={() => submit(s)}>
                <b>{dispoName(s.status, s.status_name)}</b><span>{s.status}{s.scheduled_callback === 'Y' ? ` · ${t('rellamada')}` : ''}</span>
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={pauseAfter} onChange={(e) => setPauseAfter(e.target.checked)} />
            {t('Pausarme después de calificar')}
          </label>
        </>
      )}
    </Card>
  );
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', ''];

function Dialer({ paused, act, busy }) {
  const t = useT();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('1');
  const dial = (e) => {
    e?.preventDefault();
    act('dial', '/agent/dial', { phone, phone_code: code }, t('Marcando…'));
  };
  return (
    <Card title={t('Marcación manual')}>
      <form onSubmit={dial} className="dialer">
        <div className="dial-input">
          <input className="dial-code" aria-label={t('Código de país')} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))} />
          <input className="dial-number mono" aria-label={t('Número')} placeholder={t('Número')} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, ''))} />
          {phone && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPhone(phone.slice(0, -1))} aria-label={t('Borrar')}>⌫</button>}
        </div>
        <div className="keypad">
          {KEYS.map((k, i) =>
            k ? (
              <button type="button" key={k} onClick={() => setPhone((p) => (p + k).slice(0, 18))}>{k}</button>
            ) : (
              <span key={`blank-${i}`} />
            )
          )}
        </div>
        <button className="btn btn-success btn-block btn-lg" disabled={phone.length < 2 || !!busy}>📞 {t('Llamar')}</button>
        <button type="button" className="btn btn-block" disabled={!!busy} onClick={() => act('next', '/agent/dial', { next: true }, t('Buscando el siguiente lead…'))}>
          {t('Siguiente lead de la lista')}
        </button>
        {!paused && <p className="muted small">{t('Si estás disponible, Vicidial te pausará para hacer la llamada.')}</p>}
      </form>
    </Card>
  );
}

function StatsGrid({ stats }) {
  const t = useT();
  return (
    <div className="kpis kpis-sm">
      <Kpi label={t('Llamadas')} value={fmtNum(stats.calls)} />
      <Kpi label={t('Ventas')} value={fmtNum(stats.sales)} tone="violet" />
      <Kpi label={t('Hablado')} value={fmtDur(stats.talk)} tone="green" />
      <Kpi label={t('En pausa')} value={fmtDur(stats.pause)} tone="amber" />
    </div>
  );
}
