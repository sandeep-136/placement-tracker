'use strict';

const fs = require('fs');
const path = require('path');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

// One query interface, two backends: embedded Postgres (PGlite) for tests,
// local development and the free-tier demo deploy; node-postgres against
// DATABASE_URL for a real hosted database.
async function createDb({ databaseUrl } = {}) {
  if (!databaseUrl) {
    const { PGlite } = require('@electric-sql/pglite');
    const client = new PGlite();
    await client.exec(SCHEMA);
    return {
      kind: 'pglite',
      query: (text, params = []) => client.query(text, params),
      end: () => client.close()
    };
  }
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: databaseUrl });
  await pool.query(SCHEMA);
  return {
    kind: 'pg',
    query: (text, params = []) => pool.query(text, params),
    end: () => pool.end()
  };
}

module.exports = { createDb };
