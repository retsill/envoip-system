import { readFileSync } from 'node:fs';

// Mensajes del servidor en el idioma de la interfaz. Igual que en la web: el texto en español es la clave
// y locales/<idioma>.json lo traduce; si falta, se devuelve el español.
// Las variables {x} que sean a su vez textos conocidos (p. ej. el nombre de un campo) también se traducen.
const DICTS = { en: JSON.parse(readFileSync(new URL('./locales/en.json', import.meta.url), 'utf8')) };
export const LANGS = ['es', ...Object.keys(DICTS)];

/** Idioma de la petición: cabecera X-Lang (web) o Accept-Language; español por defecto. */
export function langOf(req) {
  const x = String(req.headers?.['x-lang'] || '').toLowerCase();
  if (LANGS.includes(x)) return x;
  const al = String(req.headers?.['accept-language'] || '').toLowerCase().slice(0, 2);
  return LANGS.includes(al) ? al : 'es';
}

export function tr(text, vars, lang = 'es') {
  const dict = DICTS[lang];
  const out = dict?.[text] ?? text;
  if (!vars) return out;
  return out.replace(/\{(\w+)\}/g, (m, k) => {
    if (!(k in vars)) return m;
    const v = String(vars[k]);
    return dict?.[v] ?? v;
  });
}

/** Middleware: req.lang y req.t(texto, variables). */
export function i18n(req, res, next) {
  req.lang = langOf(req);
  req.t = (text, vars) => tr(text, vars, req.lang);
  next();
}
