import { Router } from 'express';
import { all, db, one } from '../db.js';
import { nonAgentApi } from '../vici.js';
import { requirePerm } from '../perms.js';
import { ah, digits, HttpError, str } from '../util.js';

const router = Router();

const IMPORT_FIELDS = {
  first_name: 30, last_name: 30, title: 4, middle_initial: 1, address1: 100, address2: 100, address3: 100,
  city: 50, state: 2, province: 50, postal_code: 10, country_code: 3, email: 70, alt_phone: 12,
  vendor_lead_code: 20, source_id: 50, date_of_birth: 10, gender: 1, comments: 255, security_phrase: 100,
};
const DUP_CHECKS = ['', 'DUPLIST', 'DUPCAMP', 'DUPSYS'];

router.get(
  '/lists',
  ah(async (req, res) => {
    const rows = await all(`
      SELECT l.list_id, l.list_name, l.campaign_id, l.active, l.list_description, l.list_lastcalldate,
             COUNT(v.lead_id) leads, IFNULL(SUM(v.status = 'NEW'),0) new_leads,
             IFNULL(SUM(v.called_since_last_reset = 'N'),0) not_called
      FROM vicidial_lists l LEFT JOIN vicidial_list v ON v.list_id = l.list_id
      GROUP BY l.list_id ORDER BY l.list_id`);
    res.json(rows.map((r) => ({ ...r, leads: Number(r.leads), new_leads: Number(r.new_leads), not_called: Number(r.not_called) })));
  })
);

router.get(
  '/campaigns',
  ah(async (req, res) => {
    res.json(await all('SELECT campaign_id, campaign_name, active FROM vicidial_campaigns ORDER BY campaign_id'));
  })
);

router.post(
  '/lists',
  requirePerm('modify_lists'),
  ah(async (req, res) => {
    const b = req.body || {};
    const message = await nonAgentApi('add_list', {
      list_id: str(b.list_id, { max: 14, re: /^\d{2,14}$/, name: 'ID de lista' }),
      list_name: str(b.list_name, { max: 30, name: 'nombre' }),
      campaign_id: str(b.campaign_id, { max: 8, name: 'campaña' }),
      active: b.active ? 'Y' : 'N',
      list_description: str(b.list_description, { max: 255, required: false, name: 'descripción' }),
    });
    res.json({ ok: true, message });
  })
);

router.patch(
  '/lists/:id',
  requirePerm('modify_lists'),
  ah(async (req, res) => {
    const listId = str(req.params.id, { re: /^\d{2,14}$/, name: 'lista' });
    const b = req.body || {};
    const p = {};
    if (b.list_name !== undefined) p.list_name = str(b.list_name, { max: 30, re: /^[^'"&]{6,30}$/, name: 'nombre (6-30, sin comillas ni &)' });
    if (b.campaign_id !== undefined) p.campaign_id = str(b.campaign_id, { max: 8, name: 'campaña' });
    if (b.active !== undefined) p.active = b.active ? 'Y' : 'N';
    if (b.list_description !== undefined) p.list_description = String(b.list_description).slice(0, 255) || '--BLANK--';
    if (b.reset_list) p.reset_list = 'Y';
    if (!Object.keys(p).length) throw new HttpError(400, 'No hay cambios');
    res.json({ ok: true, message: await nonAgentApi('update_list', { list_id: listId, ...p }) });
  })
);

router.delete(
  '/lists/:id',
  requirePerm('modify_lists', 'delete_lists'),
  ah(async (req, res) => {
    const listId = str(req.params.id, { re: /^\d{2,14}$/, name: 'lista' });
    const p = { list_id: listId, delete_list: 'Y' };
    if (req.query.leads === 'Y') p.delete_leads = 'Y';
    res.json({ ok: true, message: await nonAgentApi('update_list', p) });
  })
);

// ---------------------------------------------------------------- Búsqueda y exploración de leads
// Filtros equivalentes a «Lead Search Options» del admin clásico. Sirven también para ver todos los
// números de una lista o de una campaña (todas sus listas) y para descargarlos en CSV.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_FIELDS = { entry: 'entry_date', modify: 'modify_date', last_call: 'last_local_call_time' };
const SORTS = {
  lead_id: 'lead_id', phone: 'phone_number', name: 'last_name', status: 'status', called: 'called_count',
  last_call: 'last_local_call_time', entry: 'entry_date',
};
const EXPORT_COLUMNS = [
  'lead_id', 'entry_date', 'modify_date', 'status', 'user', 'vendor_lead_code', 'source_id', 'list_id', 'gmt_offset_now',
  'called_since_last_reset', 'phone_code', 'phone_number', 'title', 'first_name', 'middle_initial', 'last_name',
  'address1', 'address2', 'address3', 'city', 'state', 'province', 'postal_code', 'country_code', 'gender',
  'date_of_birth', 'alt_phone', 'email', 'security_phrase', 'comments', 'called_count', 'last_local_call_time',
  'rank', 'owner', 'entry_list_id',
];

function leadFilters(q) {
  const where = [];
  const args = [];
  const opt = (v, max = 50) => String(v ?? '').trim().slice(0, max);
  if (opt(q.lead_id)) {
    where.push('lead_id = ?');
    args.push(Number(digits(q.lead_id)) || 0);
  }
  if (opt(q.list_id)) {
    where.push('list_id = ?');
    args.push(str(q.list_id, { re: /^\d{1,14}$/, name: 'lista' }));
  }
  if (opt(q.campaign_id)) {
    where.push('list_id IN (SELECT list_id FROM vicidial_lists WHERE campaign_id = ?)');
    args.push(str(q.campaign_id, { max: 8, name: 'campaña' }));
  }
  const phone = digits(q.phone).slice(0, 18);
  if (phone) {
    // 10 dígitos o más: número exacto (usa el índice); menos: empieza por
    if (phone.length >= 10) where.push('(phone_number = ? OR alt_phone = ? OR address3 = ?)'), args.push(phone, phone, phone);
    else where.push('(phone_number LIKE ? OR alt_phone LIKE ?)'), args.push(`${phone}%`, `${phone}%`);
  }
  if (opt(q.status)) {
    const sts = opt(q.status, 200).split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_-]{1,6}$/.test(s));
    if (sts.length) where.push(`status IN (${sts.map(() => '?').join(',')})`), args.push(...sts);
  }
  if (opt(q.vendor)) where.push('vendor_lead_code = ?'), args.push(opt(q.vendor, 20));
  if (opt(q.first_name)) where.push('first_name LIKE ?'), args.push(`${opt(q.first_name, 30)}%`);
  if (opt(q.last_name)) where.push('last_name LIKE ?'), args.push(`${opt(q.last_name, 30)}%`);
  if (opt(q.email)) where.push('email LIKE ?'), args.push(`${opt(q.email, 70)}%`);
  if (opt(q.city)) where.push('city LIKE ?'), args.push(`${opt(q.city, 50)}%`);
  if (opt(q.state)) where.push('state = ?'), args.push(opt(q.state, 2));
  if (opt(q.postal_code)) where.push('postal_code LIKE ?'), args.push(`${opt(q.postal_code, 10)}%`);
  if (opt(q.user)) where.push('user = ?'), args.push(opt(q.user, 20));
  if (opt(q.owner)) where.push('owner = ?'), args.push(opt(q.owner, 20));
  if (opt(q.comments)) where.push('comments LIKE ?'), args.push(`%${opt(q.comments, 50)}%`);
  if (q.called === 'Y' || q.called === 'N') where.push('called_since_last_reset ' + (q.called === 'N' ? "= 'N'" : "<> 'N'"));
  const field = DATE_FIELDS[q.date_field] || 'entry_date';
  if (DATE_RE.test(q.from || '')) where.push(`${field} >= ?`), args.push(`${q.from} 00:00:00`);
  if (DATE_RE.test(q.to || '')) where.push(`${field} <= ?`), args.push(`${q.to} 23:59:59`);
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args, empty: !where.length };
}

router.get(
  '/leads',
  ah(async (req, res) => {
    const f = leadFilters(req.query);
    const size = Math.min(Math.max(Number(req.query.size) || 50, 10), 500);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const sort = SORTS[req.query.sort] || 'lead_id';
    const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
    const [rows, total] = await Promise.all([
      all(
        `SELECT lead_id, list_id, status, user, vendor_lead_code, phone_code, phone_number, alt_phone, first_name, last_name,
                city, state, email, called_count, last_local_call_time, entry_date, owner
         FROM vicidial_list ${f.sql} ORDER BY ${sort} ${dir}, lead_id DESC LIMIT ? OFFSET ?`,
        [...f.args, size, (page - 1) * size]
      ),
      one(`SELECT COUNT(*) n FROM vicidial_list ${f.sql}`, f.args),
    ]);
    res.json({ total: Number(total.n), page, size, rows });
  })
);

// Descarga en CSV (todas las columnas, como «Download list» del admin clásico). Se envía por partes: sirve para listas enteras.
router.get(
  '/leads/export',
  requirePerm('download_lists'),
  ah(async (req, res) => {
    const f = leadFilters(req.query);
    const name = req.query.list_id ? `list_${digits(req.query.list_id)}` : req.query.campaign_id ? `campaign_${String(req.query.campaign_id).replace(/\W/g, '')}` : 'leads';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.write('\uFEFF' + EXPORT_COLUMNS.join(',') + '\n');
    const esc = (v) => (v === null || v === undefined ? '' : /[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const stream = db.pool.query(`SELECT ${EXPORT_COLUMNS.join(',')} FROM vicidial_list ${f.sql} ORDER BY lead_id`, f.args).stream({ highWaterMark: 500 });
    req.on('close', () => stream.destroy());
    for await (const r of stream) {
      if (!res.write(EXPORT_COLUMNS.map((c) => esc(r[c])).join(',') + '\n')) await new Promise((ok) => res.once('drain', ok));
    }
    res.end();
  })
);

router.get(
  '/statuses',
  ah(async (req, res) => {
    res.json(
      await all(
        `SELECT status, MAX(status_name) status_name FROM (
           SELECT status, status_name FROM vicidial_statuses
           UNION ALL SELECT status, status_name FROM vicidial_campaign_statuses) s
         GROUP BY status ORDER BY status`
      )
    );
  })
);

// Ficha completa de un lead con su historial de llamadas y grabaciones
router.get(
  '/lead/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id) || 0;
    const lead = await one(`SELECT ${EXPORT_COLUMNS.join(',')} FROM vicidial_list WHERE lead_id = ?`, [id]);
    if (!lead) throw new HttpError(404, 'Lead no encontrado');
    const [calls, recordings, list] = await Promise.all([
      all(
        `(SELECT call_date, 'OUT' dir, campaign_id, status, user, length_in_sec, phone_number FROM vicidial_log WHERE lead_id = ? ORDER BY call_date DESC LIMIT 100)
         UNION ALL
         (SELECT call_date, 'IN' dir, campaign_id, status, user, length_in_sec, phone_number FROM vicidial_closer_log WHERE lead_id = ? ORDER BY call_date DESC LIMIT 100)
         ORDER BY call_date DESC LIMIT 100`,
        [id, id]
      ),
      all('SELECT recording_id, start_time, length_in_sec, user, location FROM recording_log WHERE lead_id = ? ORDER BY start_time DESC LIMIT 50', [id]),
      one('SELECT list_name, campaign_id FROM vicidial_lists WHERE list_id = ?', [lead.list_id]),
    ]);
    res.json({ lead, list, calls, recordings });
  })
);

const EDIT_FIELDS = { ...IMPORT_FIELDS, phone_number: 18, phone_code: 4, owner: 20, rank: 5, status: 6, list_id: 14 };

// Modificar un lead (API oficial update_lead)
router.patch(
  '/lead/:id',
  requirePerm('modify_leads'),
  ah(async (req, res) => {
    const id = Number(req.params.id) || 0;
    const b = req.body || {};
    const p = {};
    for (const [k, max] of Object.entries(EDIT_FIELDS)) {
      if (b[k] === undefined) continue;
      const v = String(b[k] ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
      p[k] = v === '' ? '--BLANK--' : v;
    }
    if (p.phone_number) p.phone_number = digits(p.phone_number);
    if (p.status && !/^[A-Za-z0-9_-]{1,6}$/.test(p.status)) throw new HttpError(400, '{name} no válido', { name: 'estado' });
    if (p.list_id && !/^\d{1,14}$/.test(p.list_id)) throw new HttpError(400, '{name} no válido', { name: 'lista' });
    if (!Object.keys(p).length) throw new HttpError(400, 'No hay cambios');
    // La API cambia la lista con «list_id_field» (list_id sirve para buscar)
    if (p.list_id) {
      p.list_id_field = p.list_id;
      delete p.list_id;
    }
    res.json({ ok: true, message: await nonAgentApi('update_lead', { lead_id: id, search_method: 'LEAD_ID', search_location: 'SYSTEM', ...p }) });
  })
);

router.get(
  '/search',
  ah(async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 50);
    if (q.length < 2) return res.json([]);
    const d = digits(q);
    const where = d.length >= 4 && d.length === q.replace(/[\s()+-]/g, '').length
      ? ['phone_number LIKE ? OR alt_phone LIKE ?', [`%${d}%`, `%${d}%`]]
      : ['first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR vendor_lead_code = ?', [`${q}%`, `${q}%`, `${q}%`, q]];
    const rows = await all(
      `SELECT lead_id, list_id, status, phone_code, phone_number, first_name, last_name, city, email,
              called_count, last_local_call_time, entry_date
       FROM vicidial_list WHERE ${where[0]} ORDER BY lead_id DESC LIMIT 50`,
      where[1]
    );
    res.json(rows);
  })
);

// Importación: una llamada add_lead por fila (la API se encarga de zona horaria, duplicados, DNC...)
router.post(
  '/import',
  requirePerm('modify_leads'),
  ah(async (req, res) => {
    const b = req.body || {};
    const listId = str(b.list_id, { max: 14, re: /^\d{2,14}$/, name: 'lista' });
    const phoneCode = digits(b.phone_code) || '1';
    const dup = DUP_CHECKS.includes(b.duplicate_check) ? b.duplicate_check : '';
    const rows = Array.isArray(b.rows) ? b.rows : [];
    if (!rows.length) throw new HttpError(400, 'No hay filas para importar');
    if (rows.length > 2000) throw new HttpError(400, 'Máximo 2000 filas por envío');

    const result = { added: 0, duplicates: 0, errors: [] };
    let i = 0;
    const worker = async () => {
      while (i < rows.length) {
        const idx = i++;
        const r = rows[idx] || {};
        const phone = digits(r.phone_number);
        if (phone.length < 6 || phone.length > 16) {
          result.errors.push({ row: idx + 1, error: req.t('Teléfono no válido') });
          continue;
        }
        const params = { phone_number: phone, phone_code: digits(r.phone_code) || phoneCode, list_id: listId, list_exists_check: 'Y' };
        if (dup) params.duplicate_check = dup;
        for (const [f, max] of Object.entries(IMPORT_FIELDS))
          if (r[f] !== undefined && r[f] !== '') params[f] = String(r[f]).trim().slice(0, max);
        try {
          await nonAgentApi('add_lead', params);
          result.added++;
        } catch (e) {
          if (/DUPLICATE/i.test(e.raw || '')) result.duplicates++;
          else result.errors.push({ row: idx + 1, error: e.message });
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    result.errors.sort((a, b) => a.row - b.row);
    res.json(result);
  })
);

export default router;
