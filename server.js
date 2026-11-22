'use strict';

const express = require('express');
const { createDb } = require('./lib/db');
const store = require('./lib/store');
const { seed } = require('./scripts/seed');

function createApp(db) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  const handle = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  };

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', db: db.kind });
  });

  app.get('/api/applications', handle(async (req, res) => {
    const { status, q } = req.query;
    if (status && !store.STATUSES.includes(status)) {
      res.status(400).json({ error: `status must be one of: ${store.STATUSES.join(', ')}` });
      return;
    }
    res.json({ applications: await store.listApplications(db, { status, q }) });
  }));

  app.post('/api/applications', handle(async (req, res) => {
    const created = await store.createApplication(db, req.body || {});
    res.status(201).json(created);
  }));

  app.get('/api/applications/:id', handle(async (req, res) => {
    const found = await store.getApplication(db, req.params.id);
    if (!found) {
      res.status(404).json({ error: 'Application not found' });
      return;
    }
    res.json(found);
  }));

  app.patch('/api/applications/:id', handle(async (req, res) => {
    const updated = await store.updateApplication(db, req.params.id, req.body || {});
    if (!updated) {
      res.status(404).json({ error: 'Application not found' });
      return;
    }
    res.json(updated);
  }));

  app.delete('/api/applications/:id', handle(async (req, res) => {
    const removed = await store.deleteApplication(db, req.params.id);
    if (!removed) {
      res.status(404).json({ error: 'Application not found' });
      return;
    }
    res.json({ deleted: true, id: req.params.id });
  }));

  app.get('/api/stats', handle(async (req, res) => {
    res.json(await store.getStats(db));
  }));

  app.use((req, res) => {
    res.status(404).json({ error: 'Unknown route' });
  });

  return app;
}

if (require.main === module) {
  (async () => {
    const db = await createDb({ databaseUrl: process.env.DATABASE_URL });
    if (!process.env.DATABASE_URL) {
      // Embedded demo mode: give first-time visitors something to see.
      const seeded = await seed(db);
      if (seeded) console.log(`Demo mode: seeded ${seeded} fictional applications`);
    }
    const app = createApp(db);
    const port = process.env.PORT || 3000;
    app.listen(port, () => console.log(`Placement Tracker API on http://localhost:${port} (${db.kind})`));
  })();
}

module.exports = { createApp };
