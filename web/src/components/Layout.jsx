import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { api, post, usePoll } from '../api.js';
import { useAuth } from '../App.jsx';
import { clearAgentPass } from '../session.js';
import { Footer, Logo } from './Brand.jsx';
import { LangSwitch } from './LangSwitch.jsx';
import { useT } from '../i18n.js';

// La sesión real del agente vive en vicidial.php. La cargamos en un iframe oculto que se
// monta una vez y nunca se desmonta al navegar, para no cortar la sesión ni el audio.
const ClassicCtx = createContext(null);
export const useClassic = () => useContext(ClassicCtx);

const FRAME_NAME = 'vicidial-classic';

// Mensajes de vicidial.php que indican que el inicio de sesión automático falló
const CLASSIC_ERRORS = [
  [/phone login and password are not active/i, 'El teléfono asignado a tu usuario o su contraseña no son válidos. Revisa el teléfono en Administración → Usuarios / Teléfonos.'],
  [/Login incorrect|user and password you entered are not active/i, 'Vicidial rechazó tu usuario o contraseña.'],
  [/no leads in the hopper/i, 'La campaña no tiene leads para marcar. Carga leads en una lista activa o permite «entrar sin leads» en la campaña.'],
  [/Campaign not active/i, 'La campaña no está activa.'],
  [/already logged in/i, 'Ya tienes otra sesión de agente abierta. Ciérrala e inténtalo de nuevo.'],
  [/time synchronization problem/i, 'El servidor tiene un problema de sincronización con Asterisk. Avisa al administrador.'],
  [/Too many login attempts/i, 'Demasiados intentos fallidos. Espera 15 minutos.'],
  [/No available phones|No available servers|Too many agents/i, 'No hay teléfonos o servidores disponibles. Avisa al administrador.'],
];

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('vm-theme') || 'auto';
    } catch {
      return 'auto';
    }
  });
  useEffect(() => {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('vm-theme', theme);
    } catch {
      /* sin almacenamiento */
    }
  }, [theme]);
  const next = { auto: 'light', light: 'dark', dark: 'auto' }[theme];
  return [theme, () => setTheme(next)];
}

function submitHidden(fields) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = '/agc/vicidial.php';
  form.target = FRAME_NAME;
  form.style.display = 'none';
  const all = { ...fields, JS_browser_width: 1280, JS_browser_height: 800 };
  for (const [k, v] of Object.entries(all)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = k;
    input.value = v;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

export default function Layout() {
  const t = useT();
  const { user, logout, isSup, isAdmin } = useAuth();
  const [classic, setClassic] = useState({ mounted: false, visible: false, src: 'about:blank' });
  const [status, setStatus] = useState({ phase: 'idle', error: null }); // idle | connecting | error
  const [waiting, setWaiting] = useState(null); // mensaje mientras se libera el teléfono de una sesión anterior
  const pending = useRef(null);
  const frame = useRef(null);
  const [theme, cycleTheme] = useTheme();
  const unread = usePoll('/sms/unread', 10000).data?.count || 0;
  const chatUnread = usePoll('/chat/unread', 5000).data?.count || 0;

  // Envía el login cuando el iframe ya existe en el DOM
  useEffect(() => {
    if (classic.mounted && pending.current && frame.current) {
      submitHidden(pending.current);
      pending.current = null;
    }
  }, [classic]);

  const login = useCallback((fields) => {
    setWaiting(null);
    pending.current = fields;
    setStatus({ phase: 'connecting', error: null });
    // Iframe nuevo en blanco: el formulario POST es lo único que carga en él
    setClassic({ mounted: true, visible: false, src: 'about:blank', key: Date.now() });
  }, []);

  // Vigilante de la pantalla clásica oculta: resuelve los avisos que la dejarían bloqueada sin que el agente los vea.
  //  - «No one is in your session»: si el teléfono ya está en la sala, se cierra; si no, se vuelve a llamar al teléfono.
  //  - Ventana de colas asignadas por el administrador: se envía si sigue abierta más de 6 s.
  useEffect(() => {
    if (!classic.mounted) return undefined;
    let busy = false;
    let closerSince = 0;
    const visible = (el) => el && el.style.visibility !== 'hidden' && el.style.display !== 'none';
    const id = setInterval(async () => {
      if (busy) return;
      let win;
      let doc;
      try {
        win = frame.current?.contentWindow;
        doc = frame.current?.contentDocument;
      } catch {
        return;
      }
      if (!doc || !win) return;
      if (visible(doc.getElementById('NoneInSessionBox')) && typeof win.NoneInSessionOK === 'function') {
        busy = true;
        try {
          const st = await api('/agent/phone-status');
          if (st.inSession) win.NoneInSessionOK();
          else win.NoneInSessionCalL();
        } catch {
          /* se reintenta en la siguiente vuelta */
        } finally {
          setTimeout(() => (busy = false), 6000);
        }
        return;
      }
      if (visible(doc.getElementById('CloserSelectBox')) && typeof win.CloserSelect_submit === 'function') {
        closerSince ||= Date.now();
        if (Date.now() - closerSince > 6000) {
          closerSince = 0;
          win.CloserSelect_submit();
        }
      } else {
        closerSince = 0;
      }
    }, 2000);
    return () => clearInterval(id);
  }, [classic.mounted, classic.key]);

  // Tras cada carga del iframe, buscamos mensajes de error de vicidial.php
  const onFrameLoad = () => {
    let text = '';
    try {
      text = frame.current?.contentDocument?.body?.innerText || '';
    } catch {
      return;
    }
    const hit = CLASSIC_ERRORS.find(([re]) => re.test(text));
    if (hit) setStatus({ phase: 'error', error: hit[1] }); // se traduce al mostrarlo
  };

  const ctx = {
    ...classic,
    status,
    waiting,
    setWaiting,
    login,
    connected: () => setStatus({ phase: 'idle', error: null }),
    show: () => setClassic((c) => (c.mounted ? { ...c, visible: true } : { mounted: true, visible: true, src: `/agc/vicidial.php?relogin=YES&VD_login=${encodeURIComponent(user.user)}` })),
    hide: () => setClassic((c) => ({ ...c, visible: false })),
    unmount: () => {
      setClassic({ mounted: false, visible: false, src: 'about:blank' });
      setStatus({ phase: 'idle', error: null });
    },
  };

  const fullLogout = async () => {
    // Cierra también la sesión de agente en Vicidial para que no quede colgada
    if (classic.mounted) await post('/agent/logout').catch(() => {});
    clearAgentPass();
    logout();
  };

  return (
    <ClassicCtx.Provider value={ctx}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <Logo variant="onDark" height={40} />
          </div>
          <nav className="nav">
            {isSup && <NavLink to="/supervisor"><span aria-hidden>◉</span> {t('Supervisión')}</NavLink>}
            <NavLink to="/agente"><span aria-hidden>🎧</span> {t('Agente')}</NavLink>
            <NavLink to="/mensajes">
              <span aria-hidden>💬</span> {t('Mensajes')} {unread > 0 && <span className="nav-badge">{unread > 99 ? '99+' : unread}</span>}
            </NavLink>
            <NavLink to="/chat">
              <span aria-hidden>🗨️</span> {t('Chat interno')} {chatUnread > 0 && <span className="nav-badge nav-badge-alert">{chatUnread}</span>}
            </NavLink>
            {isSup && <NavLink to="/leads"><span aria-hidden>☰</span> {t('Leads y listas')}</NavLink>}
            {isAdmin && (
              <>
                <div className="nav-section">{t('Administración')}</div>
                <NavLink to="/admin" end><span aria-hidden>⚙</span> {t('Resumen')}</NavLink>
                <NavLink to="/admin/usuarios"><span aria-hidden>👤</span> {t('Usuarios')}</NavLink>
                <NavLink to="/admin/telefonos"><span aria-hidden>☎</span> {t('Teléfonos')}</NavLink>
                <NavLink to="/admin/campanas"><span aria-hidden>📣</span> {t('Campañas')}</NavLink>
                <NavLink to="/admin/dids"><span aria-hidden>📞</span> {t('Números entrantes')}</NavLink>
                <NavLink to="/admin/remotos"><span aria-hidden>📱</span> {t('Agentes remotos')}</NavLink>
                <NavLink to="/admin/grabaciones"><span aria-hidden>🎙</span> {t('Grabaciones')}</NavLink>
                <NavLink to="/admin/reportes"><span aria-hidden>📊</span> {t('Reportes')}</NavLink>
                <NavLink to="/admin/dnc"><span aria-hidden>⛔</span> {t('Lista negra')}</NavLink>
                <NavLink to="/admin/sms"><span aria-hidden>✉️</span> {t('Mensajería SMS')}</NavLink>
              </>
            )}
          </nav>
          <div className="sidebar-foot">
            {classic.mounted && (
              <button className="side-link" onClick={classic.visible ? ctx.hide : ctx.show}>
                {classic.visible ? t('Ocultar pantalla clásica') : t('Ver pantalla clásica')}
              </button>
            )}
            <button className="side-link" onClick={cycleTheme} title={t('Cambiar tema')}>
              {t('Tema')}: {t({ auto: 'automático', light: 'claro', dark: 'oscuro' }[theme])}
            </button>
            <LangSwitch />
            <div className="me">
              <div className="avatar">{(user.name || user.user).slice(0, 1).toUpperCase()}</div>
              <div className="me-text">
                <div className="me-name">{user.name || user.user}</div>
                <div className="me-sub">{user.user} · {t('nivel {level}', { level: user.level })}</div>
              </div>
            </div>
            <button className="side-link" onClick={fullLogout}>{t('Salir')}</button>
          </div>
        </aside>
        <main className="main">
          <Outlet />
          <Footer />
        </main>
      </div>

      {classic.mounted && (
        <div className={`classic ${classic.visible ? 'is-visible' : 'is-hidden'}`} aria-hidden={!classic.visible}>
          <div className="classic-head">
            <span>{t('Pantalla clásica de Vicidial (sesión y audio del agente)')}</span>
            <button className="btn btn-ghost btn-sm" onClick={ctx.hide}>{t('Ocultar')}</button>
          </div>
          {/* «*» delega el micrófono también al webphone (ViciPhone), que vicidial.php carga desde otro dominio */}
          <iframe
            key={classic.key}
            ref={frame}
            name={FRAME_NAME}
            title={t('Vicidial agente')}
            src={classic.src}
            onLoad={onFrameLoad}
            allow="microphone *; autoplay *; camera *; speaker-selection *"
          />
        </div>
      )}
    </ClassicCtx.Provider>
  );
}
