'use strict';

// All data access for the tracker. Every function takes the db handle first,
// so the HTTP layer stays thin and everything here is unit-testable.

const STATUSES = ['applied', 'assessment', 'interview', 'offer', 'rejected', 'archived'];

const EDITABLE_TEXT = ['company', 'role', 'location', 'url', 'source', 'stipend', 'notes'];
const EDITABLE_DATES = ['applied_date', 'deadline'];

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

function validate(input, { partial = false } = {}) {
  const errors = [];
  const values = {};
  const has = (k) => input[k] !== undefined;

  for (const key of ['company', 'role']) {
    if (!partial || has(key)) {
      if (typeof input[key] !== 'string' || !input[key].trim()) {
        errors.push(`${key} is required and must be a non-empty string`);
      } else {
        values[key] = input[key].trim();
      }
    }
  }

  for (const key of EDITABLE_TEXT) {
    if (values[key] !== undefined || !has(key)) continue;
    const v = input[key];
    if (v === null || v === '') {
      values[key] = null;
    } else if (typeof v !== 'string') {
      errors.push(`${key} must be a string`);
    } else if (key === 'url' && v.trim() && !/^https?:\/\/.+/.test(v.trim())) {
      errors.push('url must start with http:// or https://');
    } else {
      values[key] = v.trim() || null;
    }
  }

  if (has('status')) {
    if (!STATUSES.includes(input.status)) {
      errors.push(`status must be one of: ${STATUSES.join(', ')}`);
    } else {
      values.status = input.status;
    }
  }

  for (const key of EDITABLE_DATES) {
    if (!has(key)) continue;
    const v = input[key];
    if (v === null || v === '') {
      values[key] = null;
    } else if (!isValidDate(v)) {
      errors.push(`${key} must be a YYYY-MM-DD date`);
    } else {
      values[key] = v;
    }
  }

  return { errors, values };
}

async function listApplications(db, { status, q } = {}) {
  const where = [];
  const params = [];
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`(company ILIKE $${params.length} OR role ILIKE $${params.length} OR location ILIKE $${params.length})`);
  }
  const sql = `
    SELECT * FROM applications
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC`;
  const { rows } = await db.query(sql, params);
  return rows;
}

async function createApplication(db, input) {
  const { errors, values } = validate(input);
  if (errors.length) {
    const err = new Error(errors.join('; '));
    err.status = 400;
    throw err;
  }
  // applied_date is NOT NULL in the schema: default to today when omitted.
  if (values.applied_date == null) {
    values.applied_date = new Date().toISOString().slice(0, 10);
  }
  const cols = Object.keys(values);
  const params = Object.values(values);
  const sql = `
    INSERT INTO applications (${cols.join(', ')})
    VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
    RETURNING *`;
  const { rows } = await db.query(sql, params);
  const app = rows[0];
  await db.query(
    'INSERT INTO status_history (application_id, from_status, to_status) VALUES ($1, NULL, $2)',
    [app.id, app.status]
  );
  return app;
}

async function getApplication(db, id) {
  const { rows } = await db.query('SELECT * FROM applications WHERE id = $1', [id]);
  if (!rows[0]) return null;
  const history = await db.query(
    'SELECT from_status, to_status, changed_at FROM status_history WHERE application_id = $1 ORDER BY changed_at, id',
    [id]
  );
  return { ...rows[0], history: history.rows };
}

async function updateApplication(db, id, input) {
  const current = await db.query('SELECT * FROM applications WHERE id = $1', [id]);
  if (!current.rows[0]) return null;

  const { errors, values } = validate(input, { partial: true });
  if (errors.length) {
    const err = new Error(errors.join('; '));
    err.status = 400;
    throw err;
  }
  // applied_date is NOT NULL: a null in a partial update means "leave unchanged".
  if (values.applied_date === null) delete values.applied_date;
  const keys = Object.keys(values);
  if (keys.length === 0) return getApplication(db, id);

  const setSql = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const params = [...keys.map((k) => values[k]), id];
  await db.query(
    `UPDATE applications SET ${setSql}, updated_at = now() WHERE id = $${params.length}`,
    params
  );

  if (values.status && values.status !== current.rows[0].status) {
    await db.query(
      'INSERT INTO status_history (application_id, from_status, to_status) VALUES ($1, $2, $3)',
      [id, current.rows[0].status, values.status]
    );
  }
  return getApplication(db, id);
}

async function deleteApplication(db, id) {
  const { rows } = await db.query('DELETE FROM applications WHERE id = $1 RETURNING id', [id]);
  return rows.length > 0;
}

async function getStats(db) {
  const byStatus = {};
  for (const s of STATUSES) byStatus[s] = 0;
  const counts = await db.query('SELECT status, count(*)::int AS n FROM applications GROUP BY status');
  for (const r of counts.rows) byStatus[r.status] = r.n;

  const responded = await db.query(
    `SELECT count(DISTINCT application_id)::int AS n FROM status_history
     WHERE to_status IN ('assessment', 'interview', 'offer')`
  );
  const active = await db.query(
    `SELECT count(*)::int AS n FROM applications WHERE status NOT IN ('rejected', 'archived')`
  );
  const upcoming = await db.query(
    `SELECT id, company, role, status, deadline FROM applications
     WHERE deadline IS NOT NULL AND status NOT IN ('rejected', 'archived') AND deadline >= CURRENT_DATE
     ORDER BY deadline LIMIT 10`
  );

  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  return {
    total,
    byStatus,
    active: active.rows[0].n,
    responded: responded.rows[0].n,
    responseRate: total ? Math.round((responded.rows[0].n / Math.max(1, active.rows[0].n)) * 100) : 0,
    upcomingDeadlines: upcoming.rows
  };
}

module.exports = {
  STATUSES,
  validate,
  listApplications,
  createApplication,
  getApplication,
  updateApplication,
  deleteApplication,
  getStats
};
