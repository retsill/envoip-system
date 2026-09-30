import { one } from './db.js';
import { ah, HttpError } from './util.js';

// Permisos de Vicidial del usuario conectado (no solo su nivel).
// La API se ejecuta con un usuario de nivel 9, así que la app debe aplicar las restricciones.
const PERM_COLUMNS = new Set([
  'modify_users', 'delete_users', 'ast_admin_access', 'ast_delete_phones', 'modify_campaigns',
  'modify_lists', 'delete_lists', 'modify_leads', 'view_reports', 'access_recordings', 'delete_from_dnc',
  'modify_same_user_level', 'modify_inbound_dids', 'delete_inbound_dids', 'modify_remoteagents', 'download_lists',
]);

const PERM_LABELS = {
  modify_users: 'Modify Users', delete_users: 'Delete Users', ast_admin_access: 'AST admin access',
  ast_delete_phones: 'AST delete phones', modify_campaigns: 'Modify Campaigns', modify_lists: 'Modify Lists',
  delete_lists: 'Delete Lists', modify_leads: 'Modify Leads', view_reports: 'View Reports',
  access_recordings: 'Access Recordings', delete_from_dnc: 'Delete From DNC Lists',
  modify_inbound_dids: 'Modify DIDs', delete_inbound_dids: 'Delete DIDs', modify_remoteagents: 'Modify Remote Agents',
  download_lists: 'Download Lists',
};

export async function loadPerms(user) {
  const cols = [...PERM_COLUMNS].join(',');
  return one(`SELECT user_level, ${cols} FROM vicidial_users WHERE user = ? AND active = 'Y'`, [user]);
}

export const requirePerm = (...perms) =>
  ah(async (req, res, next) => {
    for (const p of perms) if (!PERM_COLUMNS.has(p)) throw new Error(`permiso desconocido ${p}`);
    const u = await loadPerms(req.user.user);
    if (!u) throw new HttpError(401, 'Usuario inactivo');
    const missing = perms.filter((p) => u[p] !== '1');
    if (missing.length)
      throw new HttpError(403, 'Tu usuario no tiene el permiso «{perms}» en Vicidial', {
        perms: missing.map((m) => PERM_LABELS[m] || m).join('», «'),
      });
    req.perms = u;
    next();
  });

// Misma regla que Vicidial: nivel 9 gestiona a todos; el resto, solo niveles inferiores
// (o iguales si tiene «modify_same_user_level»).
export function assertCanManageLevel(perms, targetLevel) {
  const mine = Number(perms.user_level);
  const t = Number(targetLevel);
  if (mine === 9) return;
  if (t < mine || (t === mine && perms.modify_same_user_level === '1')) return;
  throw new HttpError(403, 'No puedes gestionar usuarios de nivel {level} con tu nivel {mine}', { level: t, mine });
}
