import jwt from 'jsonwebtoken';
import { openGate } from './gate.js';

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) throw new Error('JWT_SECRET no definido (mínimo 32 caracteres)');

export const COOKIE = 'vm_session';
export const BASE_PATH = process.env.BASE_PATH || '/modern';
export const TTL_MS = 12 * 3600 * 1000;

export const cookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.COOKIE_SECURE !== 'false',
  path: BASE_PATH,
};

export const sign = (session, ttlMs = TTL_MS) => jwt.sign(session, SECRET, { expiresIn: Math.floor(ttlMs / 1000) });

/** Duración de los tokens de la app EnVoIP Phone (30 días). */
export const APP_TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;

export function requireAuth(req, res, next) {
  try {
    // Web: cookie de sesión. App EnVoIP Phone: cabecera «Authorization: Bearer <token>».
    const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1];
    const { user, name, level, group } = jwt.verify(bearer || req.cookies[COOKIE] || '', SECRET);
    req.user = { user, name, level, group };
    // Sesión web: mantener abierta la llave del Vicidial clásico mientras se use la app
    if (!bearer) openGate(req, res, req.cookies[COOKIE], level, { secure: cookieOptions.secure, maxAge: TTL_MS });
    next();
  } catch {
    res.status(401).json({ error: req.t('Sesión no válida o caducada') });
  }
}

export const requireLevel = (min) => (req, res, next) =>
  req.user.level >= min ? next() : res.status(403).json({ error: req.t('No tienes permiso para esta sección') });
