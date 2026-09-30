import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../api.js';
import { t, useT } from '../i18n.js';

// Estados del agente, con los mismos criterios que el Real-Time Report de Vicidial
export const STATUS = {
  READY: { label: 'Disponible', tone: 'blue' },
  CLOSER: { label: 'Disponible', tone: 'blue' },
  QUEUE: { label: 'Recibiendo', tone: 'blue' },
  INCALL: { label: 'En llamada', tone: 'green' },
  PAUSED: { label: 'En pausa', tone: 'amber' },
  DISPO: { label: 'Calificando', tone: 'violet' },
  DEAD: { label: 'Cliente colgó', tone: 'red' },
};
export const statusMeta = (s) => (STATUS[s] ? { ...STATUS[s], label: t(STATUS[s].label) } : { label: s || '—', tone: 'gray' });

export function StatusBadge({ status, big }) {
  useT();
  const m = statusMeta(status);
  return (
    <span className={`badge tone-${m.tone}${big ? ' badge-big' : ''}`}>
      <span className="dot" />
      {m.label}
    </span>
  );
}

export function Kpi({ label, value, hint, tone }) {
  return (
    <div className={`kpi${tone ? ` kpi-${tone}` : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {hint && <div className="kpi-hint">{hint}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '', pad = true }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <h2>{title}</h2>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

export function Empty({ icon = '○', title, children }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden>{icon}</div>
      <div className="empty-title">{title}</div>
      {children && <div className="empty-text">{children}</div>}
    </div>
  );
}

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, kind = 'ok') => {
    const id = Math.random();
    setItems((xs) => [...xs, { id, text, kind }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// Ejecuta una acción mostrando éxito o error
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const run = useCallback(
    async (key, fn, okText) => {
      setBusy(key);
      try {
        const r = await fn();
        if (okText) toast(okText);
        return r;
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        setBusy(null);
      }
    },
    [toast]
  );
  return [run, busy];
}

// Panel lateral para formularios de edición
export function Drawer({ open, title, subtitle, onClose, children, footer }) {
  const t = useT();
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header className="drawer-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <div className="sub">{subtitle}</div>}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label={t('Cerrar')}>✕</button>
        </header>
        <div className="drawer-body">{children}</div>
        {footer && <footer className="drawer-foot">{footer}</footer>}
      </aside>
    </div>
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track"><span className="toggle-thumb" /></span>
      {label && <span>{label}</span>}
    </label>
  );
}

export function Field({ label, hint, children, dirty }) {
  return (
    <label className={`field${dirty ? ' is-dirty' : ''}`}>
      <span>{label}</span>
      {children}
      {hint && <small className="hint">{hint}</small>}
    </label>
  );
}

// Carga de datos con recarga manual
export function useLoad(path) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const reload = useCallback(async () => {
    if (!path) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      setState({ data: await api(path), error: null, loading: false });
    } catch (e) {
      setState({ data: null, error: e.message, loading: false });
    }
  }, [path]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { ...state, reload };
}

export function downloadCsv(filename, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

const LEVEL_NAMES = { 1: 'Agente', 2: 'Agente', 3: 'Agente', 4: 'Agente', 5: 'Agente', 6: 'Agente', 7: 'Supervisor', 8: 'Gerente', 9: 'Administrador' };
/** Nombre del nivel de usuario de Vicidial en el idioma actual. */
export const levelName = (level) => (LEVEL_NAMES[level] ? t(LEVEL_NAMES[level]) : String(level ?? ''));
