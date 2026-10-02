import { Router } from 'express';
import crypto from 'node:crypto';
import { one } from '../db.js';
import { ah, HttpError } from '../util.js';
import { APP_TOKEN_TTL_MS, COOKIE, cookieOptions, requireAuth, sign, TTL_MS } from '../auth.js';
import { closeGate, openGate } from '../gate.js';

const router = Router();

// Límite simple de intentos fallidos por IP: 8 cada 10 minutos
const fails = new Map();
const WINDOW = 10 * 60 * 1000;
function blocked(ip) {
  const f = fails.get(ip);
  if (!f || Date.now() - f.first > WINDOW) return false;
  return f.count >= 8;
}
function registerFail(ip) {
  const f = fails.get(ip);
  if (!f || Date.now() - f.first > WINDOW) fails.set(ip, { first: Date.now(), count: 1 });
  else f.count++;
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

async function checkCredentials(req) {
  if (blocked(req.ip)) throw new HttpError(429, 'Demasiados intentos. Espera unos minutos.');
  const user = String(req.body?.user ?? '').slice(0, 20);
  const pass = String(req.body?.pass ?? '').slice(0, 100);
  if (!user || !pass) throw new HttpError(400, 'Introduce usuario y contraseña');
  const ss = await one('SELECT pass_hash_enabled FROM system_settings LIMIT 1');
  if (ss?.pass_hash_enabled === '1')
    throw new HttpError(500, 'Vicidial tiene contraseñas cifradas activadas; esta versión aún no lo soporta (ver README).');
  const u = await one(
    "SELECT user, pass, full_name, user_level, user_group FROM vicidial_users WHERE user=? AND active='Y' AND api_only_user<>'1'",
    [user]
  );
  if (!u || !u.pass || !safeEqual(u.pass, pass)) {
    registerFail(req.ip);
    throw new HttpError(401, 'Usuario o contraseña incorrectos');
  }
  fails.delete(req.ip);
  return { user: u.user, name: u.full_name, level: Number(u.user_level), group: u.user_group };
}

// Token para la app EnVoIP Phone (se envía como «Authorization: Bearer»)
router.post(
  '/token',
  ah(async (req, res) => {
    const session = await checkCredentials(req);
    res.json({ token: sign(session, APP_TOKEN_TTL_MS), expiresIn: APP_TOKEN_TTL_MS / 1000, user: session });
  })
);

router.post(
  '/login',
  ah(async (req, res) => {
    const session = await checkCredentials(req);
    const token = sign(session);
    res.cookie(COOKIE, token, { ...cookieOptions, maxAge: TTL_MS });
    await openGate(req, res, token, session.level, { secure: cookieOptions.secure, maxAge: TTL_MS });
    res.json(session);
  })
);

router.post('/logout', ah(async (req, res) => {
  await closeGate(res, req.cookies[COOKIE], { secure: cookieOptions.secure });
  res.clearCookie(COOKIE, cookieOptions);
  res.json({ ok: true });
}));

router.get('/me', requireAuth, (req, res) => res.json(req.user));

export default router;
