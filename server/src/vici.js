import { HttpError } from './util.js';

// Cliente de las APIs de Vicidial. Las credenciales solo viven en el servidor.
const BASE = process.env.VICI_BASE || 'http://127.0.0.1';
const SOURCE = 'modern';

const TRANSLATIONS = [
  [/agent_user is not logged in/i, 'El agente no tiene sesión abierta en Vicidial'],
  [/not allowed to place manual dial calls/i, 'El agente no tiene permitida la marcación manual'],
  [/agent is not paused/i, 'El agente debe estar en pausa'],
  [/phone number is not valid/i, 'Número de teléfono no válido'],
  [/already in this agents manual dial queue/i, 'Ese número ya está en la cola de marcación del agente'],
  [/DUPLICATE/i, 'Duplicado'],
  [/INVALID PHONE LOGIN/i, 'Tu usuario no tiene un teléfono válido para escuchar llamadas'],
  [/USER DOES NOT HAVE PERMISSION/i, 'El usuario de API no tiene permiso para esta función'],
];

export class ViciError extends HttpError {
  constructor(raw) {
    const hit = TRANSLATIONS.find(([re]) => re.test(raw));
    super(400, hit ? hit[1] : raw.replace(/^ERROR:\s*/, ''));
    this.raw = raw;
  }
}

async function call(path, params) {
  const qs = new URLSearchParams({
    source: SOURCE,
    user: process.env.VICI_API_USER,
    pass: process.env.VICI_API_PASS,
  });
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) qs.set(k, String(v));
  const res = await fetch(`${BASE}${path}?${qs}`, { signal: AbortSignal.timeout(15_000) });
  const text = (await res.text()).trim();
  if (!res.ok) throw new HttpError(502, 'Vicidial respondió {status}', { status: res.status });
  // Algunas funciones responden «NOTICE» (no «ERROR») cuando falta un permiso y no hacen nada
  if (/^ERROR/i.test(text) || (/^NOTICE/i.test(text) && /PERMISSION/i.test(text))) throw new ViciError(text);
  return text;
}

export const agentApi = (agentUser, fn, params = {}) =>
  call('/agc/api.php', { agent_user: agentUser, function: fn, ...params });

export const nonAgentApi = (fn, params = {}) => call('/vicidial/non_agent_api.php', { function: fn, ...params });
