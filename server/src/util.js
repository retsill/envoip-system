// Errores HTTP con mensaje visible para el cliente. El mensaje es la clave en español con {variables};
// el manejador de errores lo traduce al idioma de la petición (i18n.js).
export class HttpError extends Error {
  constructor(status, message, vars) {
    super(message);
    this.status = status;
    this.vars = vars;
    this.expose = true;
  }
}

// Express 4 no captura errores de funciones async
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function str(v, { max = 100, re, name = 'campo', required = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, 'Falta {name}', { name });
    return undefined;
  }
  const s = String(v).trim();
  if (s.length > max) throw new HttpError(400, '{name} demasiado largo', { name });
  if (re && !re.test(s)) throw new HttpError(400, '{name} no válido', { name });
  return s;
}

export const digits = (v) => String(v ?? '').replace(/\D/g, '');
