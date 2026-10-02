import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// Llave de paso al Vicidial clásico (/agc, /vicidial…): Apache solo deja entrar si el navegador trae la cookie
// vm_gate y existe el archivo GATE_DIR/<agent|admin>/<llave>. Se crea al iniciar sesión en EnVoip System y se
// borra al cerrarla o tras TTL sin actividad. Ver deploy/apache-envoip-gate.conf.
export const GATE_COOKIE = 'vm_gate';
const DIR = process.env.GATE_DIR || '/var/lib/envoip-gate';
const ADMIN_LEVEL = Number(process.env.ADMIN_LEVEL || 8);
const REFRESH_MS = 5 * 60 * 1000;
const touched = new Map(); // llave -> última renovación

const gateOptions = (secure) => ({ httpOnly: true, sameSite: 'lax', secure, path: '/' });
const key = (sessionToken) => crypto.createHmac('sha256', process.env.JWT_SECRET).update(sessionToken).digest('hex');
const files = (k) => [path.join(DIR, 'agent', k), path.join(DIR, 'admin', k)];

async function write(k, level) {
  const [agent, admin] = files(k);
  await fs.writeFile(agent, '', { mode: 0o600 });
  if (level >= ADMIN_LEVEL) await fs.writeFile(admin, '', { mode: 0o600 });
  else await fs.rm(admin, { force: true });
}

/**
 * Abre (o renueva, como mucho cada 5 min) la llave de la sesión web. La cookie se pone en el acto (antes de
 * responder); el archivo se escribe en segundo plano. Devuelve la promesa de la escritura.
 */
export function openGate(req, res, sessionToken, level, { secure, maxAge }) {
  const k = key(sessionToken);
  const last = touched.get(k);
  if (last && Date.now() - last < REFRESH_MS && req.cookies?.[GATE_COOKIE] === k) return Promise.resolve();
  touched.set(k, Date.now());
  res.cookie(GATE_COOKIE, k, { ...gateOptions(secure), maxAge });
  return write(k, level).catch((e) => {
    touched.delete(k);
    console.error('No se pudo abrir la llave del Vicidial clásico:', e.message);
  });
}

/** Cierra la llave (al cerrar sesión). */
export async function closeGate(res, sessionToken, { secure }) {
  res.clearCookie(GATE_COOKIE, gateOptions(secure));
  if (!sessionToken) return;
  const k = key(sessionToken);
  touched.delete(k);
  await Promise.all(files(k).map((f) => fs.rm(f, { force: true }))).catch(() => {});
}

/** Borra las llaves sin actividad durante más de ttlMs. */
export function startGateCleanup(ttlMs) {
  const sweep = async () => {
    for (const sub of ['agent', 'admin']) {
      const dir = path.join(DIR, sub);
      const names = await fs.readdir(dir).catch(() => []);
      for (const n of names) {
        const f = path.join(dir, n);
        const st = await fs.stat(f).catch(() => null);
        if (st && Date.now() - st.mtimeMs > ttlMs) await fs.rm(f, { force: true }).catch(() => {});
      }
    }
    for (const [k, t] of touched) if (Date.now() - t > ttlMs) touched.delete(k);
  };
  sweep();
  setInterval(sweep, 30 * 60 * 1000).unref();
}
