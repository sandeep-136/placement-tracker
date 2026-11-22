'use strict';

const STAGES = ['applied', 'assessment', 'interview', 'offer', 'rejected', 'archived'];
const STAGE_LABEL = {
  applied: 'Applied', assessment: 'Assessment', interview: 'Interview',
  offer: 'Offer', rejected: 'Rejected', archived: 'Archived'
};

const board = document.getElementById('board');
const statsEl = document.getElementById('stats');
const searchEl = document.getElementById('search');
const modal = document.getElementById('modal');
const form = document.getElementById('app-form');
const formError = document.getElementById('form-error');
let applications = [];
let editingId = null;

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function fmtDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function deadlinePill(app) {
  if (!app.deadline || ['rejected', 'archived'].includes(app.status)) return '';
  const days = Math.ceil((new Date(app.deadline) - Date.now()) / 86400000);
  const cls = days < 0 ? 'deadline-over' : days <= 7 ? 'deadline-soon' : '';
  const txt = days < 0 ? `${-days}d overdue` : days === 0 ? 'due today' : `${days}d left`;
  return `<span class="pill deadline ${cls}" title="Deadline ${fmtDate(app.deadline)}">${txt}</span>`;
}

function cardHtml(app) {
  const idx = STAGES.indexOf(app.status);
  const move = [];
  if (idx > 0 && !['rejected', 'archived'].includes(app.status)) {
    move.push(`<button data-act="back" title="Move back">&larr;</button>`);
  }
  if (idx < 3) move.push(`<button data-act="fwd" title="Advance stage">&rarr;</button>`);
  move.push('<button data-act="edit">Edit</button>');
  move.push('<button data-act="del" class="del">Delete</button>');
  return `
  <article class="card" draggable="true" data-id="${app.id}">
    <h3>${esc(app.company)}</h3>
    <p class="role">${esc(app.role)}</p>
    <div class="meta">
      ${app.location ? `<span class="pill">${esc(app.location)}</span>` : ''}
      ${app.stipend ? `<span class="pill">${esc(app.stipend)}</span>` : ''}
      ${app.applied_date ? `<span class="pill">applied ${fmtDate(app.applied_date)}</span>` : ''}
      ${deadlinePill(app)}
    </div>
    ${app.notes ? `<p class="notes">${esc(app.notes)}</p>` : ''}
    <div class="card-actions">${move.join('')}</div>
  </article>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function render() {
  const q = searchEl.value.trim().toLowerCase();
  const visible = q
    ? applications.filter((a) => [a.company, a.role, a.location, a.notes, a.source]
        .filter(Boolean).some((v) => v.toLowerCase().includes(q)))
    : applications;

  board.innerHTML = STAGES.map((stage) => {
    const cards = visible.filter((a) => a.status === stage);
    return `
    <section class="column" data-stage="${stage}">
      <div class="column-head">
        <span><span class="dot" style="background:var(--${stage})"></span>${STAGE_LABEL[stage]}</span>
        <span class="count">${cards.length}</span>
      </div>
      <div class="cards">
        ${cards.map(cardHtml).join('') || '<p class="empty-col">Nothing here yet</p>'}
      </div>
    </section>`;
  }).join('');
}

function renderStats(stats) {
  const chips = [
    [stats.total, 'tracked'],
    [stats.active, 'active'],
    [`${stats.responseRate}%`, 'response rate'],
    [stats.byStatus.interview, 'interviews'],
    [stats.byStatus.offer, 'offers'],
    [stats.upcomingDeadlines.length, 'deadlines < 30d']
  ];
  statsEl.innerHTML = chips.map(([v, l]) =>
    `<div class="stat-chip"><b>${v}</b><span>${l}</span></div>`).join('');
}

async function refresh() {
  const [{ applications: apps }, stats] = await Promise.all([
    api('/applications'), api('/stats')
  ]);
  applications = apps;
  renderStats(stats);
  render();
}

async function moveStage(id, dir) {
  const app = applications.find((a) => a.id === id);
  const idx = STAGES.indexOf(app.status);
  const next = STAGES[idx + dir];
  if (!next) return;
  await api(`/applications/${id}`, { method: 'PATCH', body: JSON.stringify({ status: next }) });
  await refresh();
}

board.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('.card').dataset.id;
  const act = btn.dataset.act;
  try {
    if (act === 'fwd') await moveStage(id, 1);
    if (act === 'back') await moveStage(id, -1);
    if (act === 'edit') openModal(applications.find((a) => a.id === id));
    if (act === 'del' && confirm('Delete this application?')) {
      await api(`/applications/${id}`, { method: 'DELETE' });
      await refresh();
    }
  } catch (err) { alert(err.message); }
});

// Drag and drop between columns.
let draggedId = null;
board.addEventListener('dragstart', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  draggedId = card.dataset.id;
  card.classList.add('dragging');
});
board.addEventListener('dragend', () => {
  draggedId = null;
  board.querySelectorAll('.dragging').forEach((c) => c.classList.remove('dragging'));
});
board.addEventListener('dragover', (e) => {
  if (e.target.closest('.column')) e.preventDefault();
});
board.addEventListener('drop', async (e) => {
  const col = e.target.closest('.column');
  if (!col || !draggedId) return;
  e.preventDefault();
  const stage = col.dataset.stage;
  const app = applications.find((a) => a.id === draggedId);
  if (app.status === stage) return;
  try {
    await api(`/applications/${draggedId}`, { method: 'PATCH', body: JSON.stringify({ status: stage }) });
    await refresh();
  } catch (err) { alert(err.message); }
});

searchEl.addEventListener('input', render);

function openModal(app) {
  editingId = app ? app.id : null;
  document.getElementById('modal-title').textContent = app ? 'Edit application' : 'Add application';
  formError.textContent = '';
  form.reset();
  if (app) {
    for (const key of ['company', 'role', 'location', 'source', 'stipend', 'status', 'url', 'notes']) {
      form.elements[key].value = app[key] || '';
    }
    form.elements.applied_date.value = app.applied_date ? app.applied_date.slice(0, 10) : '';
    form.elements.deadline.value = app.deadline ? app.deadline.slice(0, 10) : '';
  }
  modal.classList.remove('hidden');
  form.elements.company.focus();
}

document.getElementById('add-btn').addEventListener('click', () => openModal(null));
document.getElementById('cancel-btn').addEventListener('click', () => modal.classList.add('hidden'));
modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {};
  for (const key of ['company', 'role', 'location', 'source', 'stipend', 'status', 'url', 'notes', 'applied_date', 'deadline']) {
    const v = form.elements[key].value.trim();
    body[key] = v === '' ? null : v;
  }
  try {
    if (editingId) {
      await api(`/applications/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) });
    } else {
      await api('/applications', { method: 'POST', body: JSON.stringify(body) });
    }
    modal.classList.add('hidden');
    await refresh();
  } catch (err) {
    formError.textContent = err.message;
  }
});

refresh().catch((err) => {
  board.innerHTML = `<p class="empty-col">Could not load applications: ${esc(err.message)}</p>`;
});
