'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDb } = require('../lib/db');
const { createApp } = require('../server');
const { seed } = require('../scripts/seed');

let server;
let base;
let db;

test.before(async () => {
  db = await createDb();
  await seed(db);
  await new Promise((resolve) => {
    server = createApp(db).listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  server.close();
  await db.end();
});

test('health reports the embedded backend', async () => {
  const res = await fetch(`${base}/api/health`);
  const data = await res.json();
  assert.equal(data.status, 'ok');
  assert.equal(data.db, 'pglite');
});

test('lists seeded applications, newest first', async () => {
  const res = await fetch(`${base}/api/applications`);
  const { applications } = await res.json();
  assert.equal(applications.length, 8);
  assert.ok(applications.every((a) => a.company && a.role && a.status));
});

test('filters by status and rejects a bad status', async () => {
  const ok = await fetch(`${base}/api/applications?status=assessment`);
  const { applications } = await ok.json();
  assert.equal(applications.length, 2);
  const bad = await fetch(`${base}/api/applications?status=maybe`);
  assert.equal(bad.status, 400);
});

test('searches by free text', async () => {
  const res = await fetch(`${base}/api/applications?q=brightstack`);
  const { applications } = await res.json();
  assert.equal(applications.length, 1);
});

test('creates, reads, updates and deletes an application over HTTP', async () => {
  const create = await fetch(`${base}/api/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ company: 'HTTP Co', role: 'Tester', deadline: '2026-12-10' })
  });
  assert.equal(create.status, 201);
  const created = await create.json();

  const read = await fetch(`${base}/api/applications/${created.id}`);
  assert.equal(read.status, 200);

  const patch = await fetch(`${base}/api/applications/${created.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'interview' })
  });
  assert.equal(patch.status, 200);
  const patched = await patch.json();
  assert.equal(patched.history.length, 2);

  const del = await fetch(`${base}/api/applications/${created.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  const gone = await fetch(`${base}/api/applications/${created.id}`);
  assert.equal(gone.status, 404);
});

test('POST validation errors come back as 400 JSON', async () => {
  const res = await fetch(`${base}/api/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ company: 'No Role Co' })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /role is required/);
});

test('stats endpoint matches the seeded data', async () => {
  const res = await fetch(`${base}/api/stats`);
  const stats = await res.json();
  assert.equal(stats.total, 8);
  assert.equal(stats.byStatus.offer, 1);
  assert.ok(Array.isArray(stats.upcomingDeadlines));
});

test('unknown routes 404 as JSON', async () => {
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.match(data.error, /Unknown route/);
});
