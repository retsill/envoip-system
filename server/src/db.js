import mysql from 'mysql2/promise';

// Usuario MySQL de SOLO LECTURA. Todas las escrituras pasan por las APIs de Vicidial.
export const db = mysql.createPool({
  socketPath: process.env.DB_SOCKET || undefined,
  host: process.env.DB_SOCKET ? undefined : process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME || 'asterisk',
  connectionLimit: 8,
  dateStrings: true,
});

export async function one(sql, params) {
  const [rows] = await db.query(sql, params);
  return rows[0];
}

export async function all(sql, params) {
  const [rows] = await db.query(sql, params);
  return rows;
}

// Estados marcados como venta (sistema + campaña). Cacheado 60 s.
let saleCache = { at: 0, list: [] };
export async function saleStatuses() {
  if (Date.now() - saleCache.at < 60_000) return saleCache.list;
  const rows = await all(
    "SELECT status FROM vicidial_statuses WHERE sale='Y' UNION SELECT status FROM vicidial_campaign_statuses WHERE sale='Y'"
  );
  const list = rows.map((r) => r.status);
  saleCache = { at: Date.now(), list: list.length ? list : ['__NONE__'] };
  return saleCache.list;
}
