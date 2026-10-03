import { Link } from 'react-router-dom';
import { fmtNum } from '../../api.js';
import { Card, Kpi, useLoad } from '../../components/ui.jsx';
import { useT } from '../../i18n.js';

// Accesos al admin clásico para lo que la API de Vicidial no permite gestionar
export const CLASSIC = {
  newCampaign: '/vicidial/admin.php?ADD=11',
  campaign: (id) => `/vicidial/admin.php?ADD=31&campaign_id=${encodeURIComponent(id)}`,
  ingroups: '/vicidial/admin.php?ADD=1000',
  carriers: '/vicidial/admin.php?ADD=140000000000',
  scripts: '/vicidial/admin.php?ADD=1000000',
  callTimes: '/vicidial/admin.php?ADD=100000000',
  userGroups: '/vicidial/admin.php?ADD=100000',
  statuses: '/vicidial/admin.php?ADD=321111111111111',
  settings: '/vicidial/admin.php?ADD=311111111111111',
  reports: '/vicidial/admin.php?ADD=999999',
  home: '/vicidial/admin.php',
};

const MODULES = [
  ['/admin/usuarios', '👤', 'Usuarios', 'Agentes, supervisores y administradores'],
  ['/admin/telefonos', '☎', 'Teléfonos', 'Extensiones y webphones'],
  ['/admin/campanas', '📣', 'Campañas', 'Marcación, hopper y estados'],
  ['/admin/dids', '📞', 'Números entrantes', 'DIDs y a dónde van las llamadas'],
  ['/admin/remotos', '📱', 'Agentes remotos', 'Atienden desde un teléfono externo'],
  ['/leads', '☰', 'Listas y leads', 'Crear, importar y buscar'],
  ['/admin/grabaciones', '🎙', 'Grabaciones', 'Buscar y escuchar llamadas'],
  ['/admin/reportes', '📊', 'Reportes', 'Rendimiento y resultados'],
  ['/admin/dnc', '⛔', 'Lista negra', 'Números que no se deben llamar'],
];

export function AdminHead({ title, subtitle, children }) {
  const t = useT();
  return (
    <div className="page-head">
      <div>
        <div className="crumbs"><Link to="/admin">{t('Administración')}</Link>{title !== t('Administración') && <> / {title}</>}</div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      <div className="page-actions">{children}</div>
    </div>
  );
}

export default function Overview() {
  const t = useT();
  const { data, error, reload, loading } = useLoad('/admin/summary');

  return (
    <div className="page">
      <AdminHead title={t('Administración')} subtitle={t('Estado del sistema y acceso a todos los módulos')}>
        <button className="btn btn-sm" onClick={reload} disabled={loading}>↻ {t('Actualizar')}</button>
        <a className="btn btn-sm" href={CLASSIC.home} target="_blank" rel="noreferrer">{t('Admin clásico')} ↗</a>
      </AdminHead>
      {error && <div className="alert alert-error">{error}</div>}

      {data && (
        <>
          {data.warnings.length === 0 ? (
            <div className="alert alert-ok">✓ {t('Todo en orden: Vicidial está conectado con Asterisk y no hay avisos.')}</div>
          ) : (
            <div className="warnings">
              {data.warnings.map((w, i) => (
                <div key={i} className={`alert alert-${{ error: 'error', warn: 'warn', info: 'info' }[w.level]}`}>
                  <span aria-hidden>{{ error: '⛔', warn: '⚠', info: 'ℹ' }[w.level]}</span> {w.text}
                  {w.link && <> <a href={w.link} target="_blank" rel="noreferrer">{t('Configurar')} ↗</a></>}
                </div>
              ))}
            </div>
          )}

          <div className="kpis">
            <Kpi label={t('Usuarios activos')} value={fmtNum(data.counts.users)} hint={t('{n} agentes', { n: fmtNum(data.counts.agents) })} />
            <Kpi label={t('Conectados ahora')} value={fmtNum(data.counts.logged)} tone="green" />
            <Kpi label={t('Campañas activas')} value={fmtNum(data.counts.campaigns)} tone="blue" />
            <Kpi label={t('Listas activas')} value={fmtNum(data.counts.lists)} hint={t('{n} leads en total', { n: fmtNum(data.counts.leads) })} />
            <Kpi label={t('Teléfonos')} value={fmtNum(data.counts.phones)} />
            <Kpi label={t('Llamadas hoy')} value={fmtNum(data.counts.calls_today)} tone="violet" hint={t('{n} grabaciones', { n: fmtNum(data.counts.recordings_today) })} />
          </div>

          <div className="modules">
            {MODULES.map(([to, icon, title, text]) => (
              <Link key={to} to={to} className="module">
                <span className="module-icon" aria-hidden>{icon}</span>
                <span><b>{t(title)}</b><span className="sub">{t(text)}</span></span>
              </Link>
            ))}
          </div>

          <div className="grid-2">
            {/* El servidor y los carriers son comunes a todas las empresas: solo los ve un administrador general */}
            {data.server && <Card title={t('Servidor')}>
              <dl className="dl">
                <dt>IP</dt><dd className="mono">{data.server?.server_ip}</dd>
                <dt>Asterisk</dt><dd>{data.server?.asterisk_version}</dd>
                <dt>{t('Sincronización')}</dt>
                <dd>{data.sync && data.sync.lag <= 30
                  ? <span className="chip chip-green">{t('OK · hace {n} s', { n: data.sync.lag })}</span>
                  : <span className="chip chip-red">{t('Sin conexión con Asterisk')}</span>}</dd>
                <dt>{t('Troncales máx.')}</dt><dd>{data.server?.max_vicidial_trunks}</dd>
              </dl>
              <h3 className="h3">{t('Carriers (troncales SIP)')}</h3>
              {data.carriers.length === 0 ? <p className="muted">{t('No hay carriers.')}</p> : (
                <ul className="plain">
                  {data.carriers.map((c) => (
                    <li key={c.carrier_id}>
                      <span className={`chip ${c.active === 'Y' ? 'chip-green' : ''}`}>{c.active === 'Y' ? t('Activo') : t('Inactivo')}</span> {c.carrier_id} <span className="muted">· {c.protocol}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>}
            <Card title={t('En el admin clásico')}>
              <p className="muted small">{t('La API de Vicidial no permite gestionar estas secciones; se abren en una pestaña nueva.')}</p>
              <div className="link-grid">
                <a href={CLASSIC.newCampaign} target="_blank" rel="noreferrer">＋ {t('Crear campaña')} ↗</a>
                <a href={CLASSIC.carriers} target="_blank" rel="noreferrer">{t('Carriers / troncales')} ↗</a>
                <a href={CLASSIC.ingroups} target="_blank" rel="noreferrer">{t('In-groups (entrantes)')} ↗</a>
                <a href={CLASSIC.scripts} target="_blank" rel="noreferrer">{t('Guiones')} ↗</a>
                <a href={CLASSIC.statuses} target="_blank" rel="noreferrer">{t('Estados del sistema')} ↗</a>
                <a href={CLASSIC.callTimes} target="_blank" rel="noreferrer">{t('Horarios de llamada')} ↗</a>
                <a href={CLASSIC.userGroups} target="_blank" rel="noreferrer">{t('Grupos de usuarios')} ↗</a>
                <a href={CLASSIC.settings} target="_blank" rel="noreferrer">{t('Ajustes del sistema')} ↗</a>
                <a href={CLASSIC.reports} target="_blank" rel="noreferrer">{t('Todos los reportes')} ↗</a>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
