import { all, one } from './db.js';
import { ah, HttpError } from './util.js';

// Separación por empresa, con las mismas reglas que el admin clásico de Vicidial: cada usuario ve lo que permite
// su grupo de usuarios (User Groups):
//  - «Allowed Campaigns»       → campañas, sus listas y leads, llamadas e informes de esas campañas.
//  - «Admin Viewable Groups»   → usuarios, teléfonos, colas de entrada y números (DIDs) de esos grupos.
// Un grupo con -ALL-CAMPAIGNS- y ---ALL--- (p. ej. ADMIN) lo ve todo. El propio grupo siempre es visible.
const NONE = '__envoip_none__'; // valor imposible: «IN (?)» con una lista vacía no es SQL válido
const TTL = 30_000;
const cache = new Map();

async function build(user) {
  const u = await one(
    `SELECT u.user_group, g.allowed_campaigns, g.admin_viewable_groups
     FROM vicidial_users u LEFT JOIN vicidial_user_groups g ON g.user_group = u.user_group
     WHERE u.user = ? AND u.active = 'Y' LIMIT 1`,
    [user]
  );
  if (!u) throw new HttpError(401, 'Usuario inactivo');
  const camps = ` ${u.allowed_campaigns || ''} `;
  const viewable = ` ${u.admin_viewable_groups || ''} `;
  const allCampaigns = camps.includes(' -ALL-CAMPAIGNS- ');
  const allGroups = viewable.includes(' ---ALL--- ');
  if (allCampaigns && allGroups) return { all: true, group: u.user_group };

  const groups = allGroups
    ? (await all('SELECT user_group FROM vicidial_user_groups')).map((r) => r.user_group)
    : [...new Set([u.user_group, ...viewable.trim().split(/\s+/).filter((g) => g && g !== '-')])];
  const campaigns = allCampaigns
    ? (await all('SELECT campaign_id FROM vicidial_campaigns')).map((r) => r.campaign_id)
    : camps.trim().split(/\s+/).filter((c) => c && c !== '-');
  const [lists, users, ingroups] = await Promise.all([
    campaigns.length ? all('SELECT list_id FROM vicidial_lists WHERE campaign_id IN (?)', [campaigns]) : [],
    all('SELECT user FROM vicidial_users WHERE user_group IN (?)', [groups]),
    all('SELECT group_id FROM vicidial_inbound_groups WHERE user_group IN (?)', [groups]),
  ]);
  return {
    all: false,
    group: u.user_group,
    groups,
    campaigns,
    lists: lists.map((r) => String(r.list_id)),
    users: users.map((r) => r.user),
    ingroups: ingroups.map((r) => r.group_id),
  };
}

export async function loadScope(user) {
  const c = cache.get(user);
  if (c && Date.now() - c.at < TTL) return c.scope;
  const scope = await build(user);
  cache.set(user, { at: Date.now(), scope });
  return scope;
}

/** Tras crear campañas, listas o usuarios: que el siguiente acceso los vea ya. */
export const clearScope = () => cache.clear();

export const withScope = ah(async (req, res, next) => {
  req.scope = await loadScope(req.user.user);
  next();
});

const vals = (arr) => (arr.length ? arr : [NONE]);

/**
 * Condición SQL «col IN (…)» para el tipo indicado (campaigns, lists, users, groups, ingroups), o «1=1» si el
 * usuario lo ve todo. Uso: const f = inScope(req.scope, 'campaigns', 'c.campaign_id'); `WHERE ${f.sql}`, [...f.args]
 */
export function inScope(scope, kind, col) {
  if (scope.all) return { sql: '1=1', args: [] };
  return { sql: `${col} IN (?)`, args: [vals(scope[kind])] };
}

/** Llamadas de las campañas (salientes) y colas (entrantes) de la empresa. */
export function callScope(scope, outCol = 'campaign_id', inCol = 'campaign_id') {
  if (scope.all) return { out: { sql: '1=1', args: [] }, in: { sql: '1=1', args: [] } };
  return {
    out: { sql: `${outCol} IN (?)`, args: [vals(scope.campaigns)] },
    in: { sql: `${inCol} IN (?)`, args: [vals([...scope.ingroups, ...scope.campaigns])] },
  };
}

export const allows = (scope, kind, value) => scope.all || scope[kind].includes(String(value));

const NOT_FOUND = {
  campaigns: 'Campaña no encontrada',
  lists: 'Lista no encontrada',
  users: 'Usuario no encontrado',
  groups: 'Grupo no válido',
  ingroups: 'Cola no encontrada',
};

/** Error 404 (no se revela que existe en otra empresa) si el valor no es de la empresa del usuario. */
export function assertScope(scope, kind, value) {
  if (value === undefined || value === null || value === '') return;
  if (!allows(scope, kind, value)) throw new HttpError(404, NOT_FOUND[kind]);
}

/** Solo para quien lo ve todo (ajustes compartidos por todas las empresas). */
export function assertAll(scope) {
  if (!scope.all) throw new HttpError(403, 'Esta opción es común a todas las empresas: solo la puede cambiar un administrador general');
}
