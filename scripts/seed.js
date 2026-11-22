'use strict';

// Fictional demo data. These companies are invented - a public demo must never
// carry a real person's private job applications.

const DEMO_APPLICATIONS = [
  {
    company: 'Northwind Systems', role: 'Frontend Developer Intern',
    location: 'Remote', url: 'https://example.com/northwind', source: 'Internshala',
    status: 'interview', stipend: 'Rs 8,000/month',
    applied_date: '2026-11-05', deadline: '2026-11-28',
    notes: 'Second round scheduled. Prepare React fundamentals.'
  },
  {
    company: 'BrightStack', role: 'Full Stack Development Intern',
    location: 'Bengaluru, Hybrid', url: 'https://example.com/brightstack', source: 'Internshala',
    status: 'assessment', stipend: 'Rs 5,000-8,000/month',
    applied_date: '2026-11-12', deadline: '2026-11-25',
    notes: 'Take-home assignment: build a small REST API.'
  },
  {
    company: 'Acme Labs', role: 'React Developer Intern',
    location: 'Remote', url: 'https://example.com/acme', source: 'LinkedIn',
    status: 'applied', stipend: 'Rs 10,000/month',
    applied_date: '2026-11-18', deadline: '2026-12-02',
    notes: null
  },
  {
    company: 'Fableworks', role: 'Backend Intern (Node.js)',
    location: 'Remote', url: 'https://example.com/fableworks', source: 'Referral',
    status: 'applied', stipend: null,
    applied_date: '2026-11-20', deadline: '2026-12-05',
    notes: 'Referred by a college senior.'
  },
  {
    company: 'Quantico Dev', role: 'Web Development Intern',
    location: 'Pune, Onsite', url: 'https://example.com/quantico', source: 'Internshala',
    status: 'offer', stipend: 'Rs 12,000/month',
    applied_date: '2026-10-22', deadline: null,
    notes: 'Offer letter received; decision due next week.'
  },
  {
    company: 'LumenWare', role: 'UI Engineer Intern',
    location: 'Remote', url: 'https://example.com/lumenware', source: 'Company site',
    status: 'rejected', stipend: 'Rs 6,000/month',
    applied_date: '2026-10-30', deadline: null,
    notes: 'Rejected after assessment round.'
  },
  {
    company: 'Craftline', role: 'JavaScript Intern',
    location: 'Remote', url: 'https://example.com/craftline', source: 'Internshala',
    status: 'archived', stipend: null,
    applied_date: '2026-10-15', deadline: null,
    notes: 'Position closed by employer.'
  },
  {
    company: 'Vertex Software', role: 'MERN Stack Intern',
    location: 'Hyderabad, Hybrid', url: 'https://example.com/vertex', source: 'LinkedIn',
    status: 'assessment', stipend: 'Rs 7,500/month',
    applied_date: '2026-11-16', deadline: '2026-11-27',
    notes: 'Online aptitude test pending.'
  }
];

async function seed(db, { onlyIfEmpty = true } = {}) {
  if (onlyIfEmpty) {
    const { rows } = await db.query('SELECT count(*)::int AS n FROM applications');
    if (rows[0].n > 0) return 0;
  }
  const { createApplication, updateApplication } = require('../lib/store');
  let created = 0;
  for (const demo of DEMO_APPLICATIONS) {
    const app = await createApplication(db, { ...demo, status: 'applied' });
    // Walk through intermediate stages so the history looks real.
    const order = ['applied', 'assessment', 'interview', 'offer'];
    const target = order.indexOf(demo.status);
    if (target > 0) {
      for (let i = 1; i <= target; i += 1) {
        await updateApplication(db, app.id, { status: order[i] });
      }
    } else if (['rejected', 'archived'].includes(demo.status)) {
      await updateApplication(db, app.id, { status: demo.status });
    }
    created += 1;
  }
  return created;
}

module.exports = { seed, DEMO_APPLICATIONS };

if (require.main === module) {
  const { createDb } = require('../lib/db');
  (async () => {
    const db = await createDb({ databaseUrl: process.env.DATABASE_URL });
    const n = await seed(db, { onlyIfEmpty: false });
    console.log(`Seeded ${n} demo applications (${db.kind})`);
    await db.end();
  })().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
