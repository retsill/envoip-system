import mysql from 'mysql2/promise';

// Base de datos PROPIA de EnVoip System (mensajes SMS, ajustes). La de Vicidial se sigue usando
// solo en lectura; aquí sí se escribe.
export const appdb = mysql.createPool({
  socketPath: process.env.DB_SOCKET || undefined,
  host: process.env.DB_SOCKET ? undefined : process.env.DB_HOST || '127.0.0.1',
  user: process.env.ENVOIP_DB_USER,
  password: process.env.ENVOIP_DB_PASS,
  database: process.env.ENVOIP_DB_NAME || 'envoip',
  connectionLimit: 6,
  dateStrings: true,
  charset: 'utf8mb4',
});

export const appEnabled = Boolean(process.env.ENVOIP_DB_USER && process.env.ENVOIP_DB_PASS);

export async function aone(sql, params) {
  const [rows] = await appdb.query(sql, params);
  return rows[0];
}

export async function aall(sql, params) {
  const [rows] = await appdb.query(sql, params);
  return rows;
}

export async function arun(sql, params) {
  const [res] = await appdb.query(sql, params);
  return res;
}

// Crea o actualiza las tablas al arrancar (idempotente)
export async function migrate() {
  if (!appEnabled) {
    console.warn('ENVOIP_DB_* no configurado: la mensajería SMS queda desactivada');
    return;
  }
  await arun(`
    CREATE TABLE IF NOT EXISTS settings (
      k VARCHAR(64) NOT NULL PRIMARY KEY,
      v TEXT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await arun(`
    CREATE TABLE IF NOT EXISTS sms_messages (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      direction ENUM('in','out') NOT NULL,
      did VARCHAR(20) NOT NULL,
      peer VARCHAR(20) NOT NULL,
      body TEXT NOT NULL,
      media TEXT NULL,
      status ENUM('queued','sent','failed','received') NOT NULL,
      error VARCHAR(255) NOT NULL DEFAULT '',
      provider_id VARCHAR(64) NULL,
      lead_id INT UNSIGNED NULL,
      user VARCHAR(20) NULL,
      source VARCHAR(20) NOT NULL DEFAULT 'web',
      read_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_provider (provider_id),
      KEY k_peer (peer, created_at),
      KEY k_lead (lead_id),
      KEY k_unread (direction, read_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  // Borrado: el mensaje se marca (no se elimina) para que la consulta a VoIP.ms no lo vuelva a traer
  await arun('ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL, ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(20) NULL');
  await arun('ALTER TABLE sms_messages ADD INDEX IF NOT EXISTS k_deleted (deleted_at)');
}

// ---------------------------------------------------------------- Ajustes (clave/valor)
export async function getSettings(keys) {
  const rows = await aall('SELECT k, v FROM settings WHERE k IN (?)', [keys.length ? keys : ['__none__']]);
  return Object.fromEntries(keys.map((k) => [k, rows.find((r) => r.k === k)?.v ?? '']));
}

export async function setSettings(obj) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    await arun('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [k, String(v)]);
  }
}
