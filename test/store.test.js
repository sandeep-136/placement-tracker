'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDb } = require('../lib/db');
const store = require('../lib/store');
const { seed } = require('../scripts/seed');

let db;

test.before(async () => {
  db = await createDb();
});

test.after(async () => db.end());

test('create requires company and role', async () => {
  await assert.rejects(() => store.createApplication(db, { company: 'X' }), /role is required/);
  await assert.rejects(() => store.createApplication(db, { role: 'Y' }), /company is required/);
});

test('create validates status, dates and url', async () => {
  await assert.rejects(
    () => store.createApplication(db, { company: 'X', role: 'Y', status: 'limbo' }),
    /status must be one of/
  );
  await assert.rejects(
    () => store.createApplication(db, { company: 'X', role: 'Y', deadline: 'next friday' }),
    /deadline must be a YYYY-MM-DD date/
  );
  await assert.rejects(
    () => store.createApplication(db, { company: 'X', role: 'Y', url: 'notaurl' }),
    /url must start with http/
  );
});

test('create stores the application and its initial history entry', async () => {
  const app = await store.createApplication(db, {
    company: 'Test Corp', role: 'Intern', status: 'applied', deadline: '2026-12-01'
  });
  assert.ok(app.id);
  const full = await store.getApplication(db, app.id);
  assert.equal(full.history.length, 1);
  assert.equal(full.history[0].from_status, null);
  assert.equal(full.history[0].to_status, 'applied');
});

test('status changes append history; other edits do not', async () => {
  const app = await store.createApplication(db, { company: 'Hist Co', role: 'Dev' });
  await store.updateApplication(db, app.id, { notes: 'called them' });
  let full = await store.getApplication(db, app.id);
  assert.equal(full.history.length, 1);

  await store.updateApplication(db, app.id, { status: 'interview' });
  full = await store.getApplication(db, app.id);
  assert.equal(full.status, 'interview');
  assert.equal(full.history.length, 2);
  assert.equal(full.history[1].from_status, 'applied');
  assert.equal(full.history[1].to_status, 'interview');
});

test('update returns null for a missing id and 400s on bad input', async () => {
  const missing = await store.updateApplication(db, crypto.randomUUID(), { notes: 'x' });
  assert.equal(missing, null);
  const app = await store.createApplication(db, { company: 'V Co', role: 'Dev' });
  await assert.rejects(
    () => store.updateApplication(db, app.id, { status: 'nope' }),
    /status must be one of/
  );
});

test('list filters by status and free text', async () => {
  const all = await store.listApplications(db);
  assert.ok(all.length >= 3);
  const interviews = await store.listApplications(db, { status: 'interview' });
  assert.ok(interviews.every((a) => a.status === 'interview'));
  const found = await store.listApplications(db, { q: 'hist co' });
  assert.equal(found.length, 1);
});

test('delete removes the application and its history', async () => {
  const app = await store.createApplication(db, { company: 'Gone Co', role: 'Dev' });
  await store.updateApplication(db, app.id, { status: 'rejected' });
  assert.equal(await store.deleteApplication(db, app.id), true);
  assert.equal(await store.getApplication(db, app.id), null);
  const hist = await db.query('SELECT count(*)::int AS n FROM status_history WHERE application_id = $1', [app.id]);
  assert.equal(hist.rows[0].n, 0);
  assert.equal(await store.deleteApplication(db, app.id), false);
});

test('stats count stages, responses and upcoming deadlines', async () => {
  const fresh = await createDb();
  await seed(fresh);
  const stats = await store.getStats(fresh);
  assert.equal(stats.total, 8);
  assert.equal(stats.byStatus.interview, 1);
  assert.equal(stats.byStatus.assessment, 2);
  assert.equal(stats.byStatus.offer, 1);
  // Northwind, BrightStack, Quantico and Vertex all moved past "applied".
  assert.equal(stats.responded, 4);
  assert.ok(stats.responseRate > 0 && stats.responseRate <= 100);
  assert.ok(stats.upcomingDeadlines.every((d) => !['rejected', 'archived'].includes(d.status)));
  await fresh.end();
});

test('seed is idempotent with onlyIfEmpty', async () => {
  const fresh = await createDb();
  assert.equal(await seed(fresh), 8);
  assert.equal(await seed(fresh), 0);
  await fresh.end();
});
