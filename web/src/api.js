import { useCallback, useEffect, useRef, useState } from 'react';
import { getLang, locale, t } from './i18n.js';

const BASE = `${import.meta.env.BASE_URL}api`;

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'same-origin',
    // El servidor devuelve sus mensajes de error en el idioma de la interfaz
    headers: { 'X-Lang': getLang(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* respuesta sin JSON */
  }
  if (res.status === 401 && !path.startsWith('/auth')) window.dispatchEvent(new Event('vm:unauthorized'));
  if (!res.ok) {
    const err = new Error(data?.error || t('Error {status}', { status: res.status }));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const post = (path, body = {}) => api(path, { method: 'POST', body });

// Consulta periódica; se detiene con la pestaña oculta
export function usePoll(path, ms) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const busy = useRef(false);
  const failures = useRef(0);
  const hasData = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      setData(await api(path));
      setFetchedAt(Date.now());
      setError(null);
      failures.current = 0;
      hasData.current = true;
    } catch (e) {
      // Un fallo suelto (p. ej. el servicio reiniciándose un segundo) no se muestra si ya hay datos
      failures.current += 1;
      if (!hasData.current || failures.current >= 3) setError(e.message);
    } finally {
      busy.current = false;
    }
  }, [path]);

  useEffect(() => {
    refresh();
    const id = setInterval(() => !document.hidden && refresh(), ms);
    return () => clearInterval(id);
  }, [refresh, ms]);

  return { data, error, refresh, fetchedAt };
}

// Reloj que avanza cada segundo, para los temporizadores
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function fmtDur(secs) {
  secs = Math.max(0, Math.floor(Number(secs) || 0));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export const fmtNum = (n) => new Intl.NumberFormat(locale()).format(Number(n) || 0);

export function fmtPhone(p) {
  const d = String(p || '');
  if (d.length === 10) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  return d.replace(/(\d{3})(?=\d)/g, '$1 ');
}
