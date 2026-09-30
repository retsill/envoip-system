import { useSyncExternalStore } from 'react';
import en from './locales/en.json';

// Idiomas de la interfaz. El texto en español del código es la clave: t('Conectar') → «Connect» en inglés.
// Si falta una traducción se muestra el español, así nada se rompe mientras se traduce.
// Variables: t('Hola {name}', { name }) — se sustituyen después de traducir.
export const LANGS = [
  { code: 'es', label: 'Español', short: 'ES' },
  { code: 'en', label: 'English', short: 'EN' },
];
const DICTS = { en };
const KEY = 'envoip.lang';

function detect() {
  try {
    const saved = localStorage.getItem(KEY);
    if (LANGS.some((l) => l.code === saved)) return saved;
  } catch {
    /* sin almacenamiento */
  }
  return (navigator.language || 'es').toLowerCase().startsWith('es') ? 'es' : 'en';
}

let lang = detect();
document.documentElement.lang = lang;
const listeners = new Set();

export const getLang = () => lang;

export function setLang(code) {
  if (code === lang || !LANGS.some((l) => l.code === code)) return;
  lang = code;
  document.documentElement.lang = code;
  try {
    localStorage.setItem(KEY, code);
  } catch {
    /* sin almacenamiento */
  }
  listeners.forEach((fn) => fn());
}

const missing = new Set();

export function t(text, vars) {
  let out = text;
  const dict = DICTS[lang];
  if (dict) {
    if (text in dict) out = dict[text];
    else if (import.meta.env.DEV && !missing.has(text)) {
      missing.add(text);
      console.warn(`[i18n:${lang}] sin traducir:`, text);
    }
  }
  return vars ? out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : out;
}

const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Suscribe el componente al idioma (se vuelve a pintar al cambiarlo) y devuelve t. */
export function useT() {
  useSyncExternalStore(subscribe, getLang);
  return t;
}

export function useLang() {
  return [useSyncExternalStore(subscribe, getLang), setLang];
}

/** Locale para fechas y números del idioma actual. */
export const locale = () => (lang === 'en' ? 'en-US' : 'es');
