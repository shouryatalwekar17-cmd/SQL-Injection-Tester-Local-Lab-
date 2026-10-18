/* Momentum — goals, habits, growth and Google Calendar in one page.
   All data lives in localStorage; Google Calendar is reached directly from the
   browser with an OAuth token from Google Identity Services. */
'use strict';

const STORE_KEY = 'momentum.v1';
const GCAL_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const GCAL_API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/* ---------- helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmtNum = n => Number.isInteger(n) ? String(n) : n.toFixed(1);
const fmtDate = (d, opts = { month: 'short', day: 'numeric' }) => d.toLocaleDateString(undefined, opts);
const fmtTime = d => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2800);
}

/* ---------- state ---------- */
const blankState = () => ({ goals: [], habits: [], events: [], settings: { clientId: '', theme: '' } });
let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(blankState(), JSON.parse(raw));
  } catch { /* storage blocked or corrupt: start fresh */ }
  return blankState();
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { toast('Could not save — browser storage is unavailable'); }
}

/* ---------- metrics ---------- */
function goalPct(g, value = g.current) {
  const span = g.target - g.start;
  if (span === 0) return value >= g.target ? 100 : 0;
  return clamp(((value - g.start) / span) * 100, 0, 100);
}
// Value of a goal as of the end of a given day, from its progress log.
function goalValueAt(g, dayKey) {
  let v = g.start;
  for (const e of g.log) if (e.date <= dayKey) v = e.value;
  return v;
}
// Share of habits completed on one day (habits created later are ignored).
function dayRate(dayKey) {
  const active = state.habits.filter(h => h.created <= dayKey);
  if (!active.length) return null;
  return active.filter(h => h.done[dayKey]).length / active.length;
}
// Weekly score for a 7-day window ending on `end`: each habit counts done/target, capped at 1.
function windowScore(end) {
  const endKey = ymd(end);
  const startKey = ymd(addDays(end, -6));
  const active = state.habits.filter(h => h.created <= endKey);
  if (!active.length) return null;
  let sum = 0;
  for (const h of active) {
    let n = 0;
    for (let i = 0; i < 7; i++) if (h.done[ymd(addDays(end, -i))]) n++;
    // Prorate the target for habits created inside the window.
    const days = h.created > startKey ? Math.round((end - parseYmd(h.created)) / 864e5) + 1 : 7;
    const target = Math.max(1, Math.round(h.target * days / 7));
    sum += Math.min(1, n / target);
  }
  return sum / active.length;
}
function streak(h) {
  let d = today();
  if (!h.done[ymd(d)]) d = addDays(d, -1); // today isn't over yet
  let n = 0;
  while (h.done[ymd(d)]) { n++; d = addDays(d, -1); }
  return n;
}
function bestStreak(h) {
  const keys = Object.keys(h.done).filter(k => h.done[k]).sort();
  let best = 0, run = 0, prev = null;
  for (const k of keys) {
    const d = parseYmd(k);
    run = prev && Math.round((d - prev) / 864e5) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}
function rate30(h) {
  let done = 0, days = 0;
  for (let i = 0; i < 30; i++) {
    const k = ymd(addDays(today(), -i));
    if (k < h.created) break;
    days++;
    if (h.done[k]) done++;
  }
  return days ? Math.min(1, done / (days * h.target / 7)) : 0;
}
function growth(now, before) {
  if (now == null || before == null) return null;
  if (before === 0) return now > 0 ? 100 : 0;
  return ((now - before) / before) * 100;
}

/* ---------- navigation ---------- */
function show(view) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
  try { sessionStorage.setItem('momentum.view', view); } catch { }
  render();
}
$$('.tab').forEach(t => t.addEventListener('click', () => show(t.dataset.view)));
$$('[data-goto]').forEach(b => b.addEventListener('click', () => show(b.dataset.goto)));
const currentView = () => $('.tab.active').dataset.view;

function render() {
  const v = currentView();
  if (v === 'dashboard') renderDashboard();
  if (v === 'goals') renderGoals();
  if (v === 'habits') renderHabits();
  if (v === 'calendar') renderCalendar();
  if (v === 'settings') renderSettings();
}

/* ---------- dashboard ---------- */
function renderDashboard() {
  const h = new Date().getHours();
  $('#greeting').textContent = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  $('#todayLabel').textContent = fmtDate(new Date(), { weekday: 'long', month: 'long', day: 'numeric' });

  const t = today();
  const weekNow = windowScore(t);
  const weekPrev = windowScore(addDays(t, -7));
  const habitGrowth = growth(weekNow, weekPrev);

  const goals = state.goals;
  const avgNow = goals.length ? goals.reduce((s, g) => s + goalPct(g), 0) / goals.length : null;
  const key30 = ymd(addDays(t, -30));
  const avg30 = goals.length ? goals.reduce((s, g) => s + goalPct(g, goalValueAt(g, key30)), 0) / goals.length : null;
  const goalGain = avgNow != null ? avgNow - avg30 : null;

  const best = state.habits.reduce((b, x) => { const s = streak(x); return s > b.n ? { n: s, name: x.name } : b; }, { n: 0, name: '' });
  const completed = goals.filter(g => goalPct(g) >= 100).length;

  const delta = (v, suffix) => v == null ? '<span class="stat-sub">No data yet</span>'
    : `<span class="stat-sub ${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${v > 0 ? '▲' : v < 0 ? '▼' : '•'} ${Math.abs(v).toFixed(1)}${suffix}</span>`;

  $('#statTiles').innerHTML = `
    <div class="stat"><div class="stat-label">Growth (week over week)</div>
      <div class="stat-value ${habitGrowth > 0 ? 'up' : habitGrowth < 0 ? 'down' : ''}">${habitGrowth == null ? '—' : (habitGrowth > 0 ? '+' : '') + habitGrowth.toFixed(0) + '%'}</div>
      <span class="stat-sub">Habit score vs previous 7 days</span></div>
    <div class="stat"><div class="stat-label">Habit score · 7 days</div>
      <div class="stat-value">${weekNow == null ? '—' : Math.round(weekNow * 100) + '%'}</div>
      ${delta(weekNow == null || weekPrev == null ? null : (weekNow - weekPrev) * 100, ' pts')}</div>
    <div class="stat"><div class="stat-label">Average goal progress</div>
      <div class="stat-value">${avgNow == null ? '—' : Math.round(avgNow) + '%'}</div>
      ${delta(goalGain, ' pts in 30 days')}</div>
    <div class="stat"><div class="stat-label">Best active streak</div>
      <div class="stat-value">${best.n}<span class="stat-sub"> days</span></div>
      <span class="stat-sub">${esc(best.name) || 'Start a habit'}</span></div>
    <div class="stat"><div class="stat-label">Goals achieved</div>
      <div class="stat-value">${completed}<span class="stat-sub"> / ${goals.length}</span></div>
      <span class="stat-sub">${goals.length - completed} in progress</span></div>`;

  renderTrend();

  const list = $('#todayHabits');
  const tk = ymd(t);
  list.innerHTML = state.habits.length ? state.habits.map(x => `
    <li style="--hc: var(--c${x.color})">
      <button class="tick ${x.done[tk] ? 'done' : ''}" data-habit="${x.id}" data-day="${tk}" aria-label="Toggle ${esc(x.name)}">${x.done[tk] ? '✓' : ''}</button>
      <span class="grow">${esc(x.name)}</span>
      <span class="muted small">🔥 ${streak(x)}</span>
    </li>`).join('') : '<li class="empty">No habits yet — add one in Habits.</li>';

  const dg = $('#dashGoals');
  dg.innerHTML = goals.length ? goals.slice(0, 5).map(g => {
    const p = goalPct(g);
    return `<div class="dash-goal">
      <div class="goal-nums"><span>${esc(g.title)}</span><strong>${Math.round(p)}%</strong></div>
      <div class="progress ${p >= 100 ? 'done' : ''}"><span style="width:${p}%"></span></div>
    </div>`;
  }).join('') : '<p class="empty">No goals yet — set your first one.</p>';

  renderUpcoming();
}

function renderTrend() {
  const days = 30;
  const pts = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(today(), -i);
    pts.push({ d, r: dayRate(ymd(d)) });
  }
  const box = $('#trendChart');
  if (!state.habits.length) { box.innerHTML = '<p class="empty">Track a habit to see your consistency trend.</p>'; return; }

  const W = 640, H = 220, L = 34, R = 10, T = 10, B = 26;
  const iw = W - L - R, ih = H - T - B, bw = iw / days;
  const y = v => T + ih - v * ih;
  let bars = '', avg = [];
  pts.forEach((p, i) => {
    if (p.r != null) bars += `<rect class="bar" x="${(L + i * bw + 1).toFixed(1)}" y="${y(p.r).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${(p.r * ih).toFixed(1)}" rx="2"><title>${fmtDate(p.d)}: ${Math.round(p.r * 100)}%</title></rect>`;
    const win = pts.slice(Math.max(0, i - 6), i + 1).filter(q => q.r != null);
    if (win.length) avg.push(`${(L + i * bw + bw / 2).toFixed(1)},${y(win.reduce((s, q) => s + q.r, 0) / win.length).toFixed(1)}`);
  });
  const grid = [0, .25, .5, .75, 1].map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v * 100}%</text>`).join('');
  const labels = [0, 7, 14, 21, 29].map(i => `<text x="${L + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${fmtDate(pts[i].d)}</text>`).join('');
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Habit completion over the last 30 days">
    <g class="grid">${grid}</g>${bars}<polyline class="avg" points="${avg.join(' ')}"/>${labels}</svg>
    <div class="legend"><span><i class="bar-key"></i>Daily completion</span><span><i></i>7-day average</span></div>`;
}

/* ---------- goals ---------- */
function renderGoals() {
  const el = $('#goalList');
  if (!state.goals.length) { el.innerHTML = '<div class="card empty">No goals yet. Click “New goal” to set a measurable target.</div>'; return; }
  el.innerHTML = state.goals.map(g => {
    const p = goalPct(g);
    const key30 = ymd(addDays(today(), -30));
    const gain = p - goalPct(g, goalValueAt(g, key30));
    let deadline = '';
    if (g.deadline) {
      const left = Math.round((parseYmd(g.deadline) - today()) / 864e5);
      deadline = left < 0 ? `<span class="down">${-left}d overdue</span>` : `${left}d left`;
      // Pace check: expected progress if spread evenly from creation to deadline.
      const total = (parseYmd(g.deadline) - parseYmd(g.created)) / 864e5;
      if (total > 0 && p < 100) {
        const expected = clamp(((today() - parseYmd(g.created)) / 864e5) / total * 100, 0, 100);
        deadline += p >= expected ? ' · <span class="up">on track</span>' : ` · <span class="down">${Math.round(expected - p)} pts behind pace</span>`;
      }
    }
    return `<div class="card">
      <div class="goal-top">
        <div><div class="goal-title">${esc(g.title)}</div>
          <div class="goal-meta">${esc(g.category)}${deadline ? ' · ' + deadline : ''}</div></div>
        <strong>${Math.round(p)}%</strong>
      </div>
      <div class="progress ${p >= 100 ? 'done' : ''}"><span style="width:${p}%"></span></div>
      <div class="goal-nums"><span>${fmtNum(g.current)} / ${fmtNum(g.target)} ${esc(g.unit)}</span>
        <span class="${gain > 0 ? 'up' : 'muted'}">${gain > 0 ? '+' : ''}${gain.toFixed(1)} pts · 30d</span></div>
      ${sparkline(g)}
      <div class="goal-actions">
        <button class="btn small primary" data-progress="${g.id}">Log progress</button>
        <button class="chip-btn" data-schedule="${g.id}">Schedule work</button>
        <button class="chip-btn" data-edit-goal="${g.id}">Edit</button>
        <button class="chip-btn" data-del-goal="${g.id}">Delete</button>
      </div></div>`;
  }).join('');
}

function sparkline(g) {
  const pts = [{ date: g.created, value: g.start }, ...g.log];
  if (pts.length < 2) return '<p class="muted small">Log progress to build your growth curve.</p>';
  const t0 = parseYmd(pts[0].date).getTime();
  const t1 = Math.max(parseYmd(pts[pts.length - 1].date).getTime(), t0 + 864e5);
  const W = 300, H = 40;
  const xy = pts.map(p => [((parseYmd(p.date) - t0) / (t1 - t0)) * W, H - 3 - (goalPct(g, p.value) / 100) * (H - 6)]);
  const line = xy.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join('');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <path class="area" d="${line}L${W},${H}L0,${H}Z"/><path d="${line}"/></svg>`;
}

let editingGoal = null;
$('#addGoalBtn').addEventListener('click', () => openGoal());
function openGoal(g) {
  editingGoal = g || null;
  const f = $('#goalForm');
  f.reset();
  $('#goalDialogTitle').textContent = g ? 'Edit goal' : 'New goal';
  if (g) {
    f.elements.title.value = g.title; f.elements.category.value = g.category; f.elements.deadline.value = g.deadline || '';
    f.elements.start.value = g.start; f.elements.target.value = g.target; f.elements.unit.value = g.unit;
  }
  $('#goalDialog').showModal();
}
$('#goalDialog').addEventListener('close', () => {
  if ($('#goalDialog').returnValue !== 'save') return;
  const f = $('#goalForm');
  const data = {
    title: f.elements.title.value.trim(), category: f.elements.category.value, deadline: f.elements.deadline.value,
    start: Number(f.elements.start.value), target: Number(f.elements.target.value), unit: f.elements.unit.value.trim(),
  };
  if (data.target === data.start) { toast('Target must differ from the starting value'); return; }
  if (editingGoal) Object.assign(editingGoal, data);
  else state.goals.push({ id: uid(), ...data, current: data.start, created: ymd(today()), log: [] });
  save(); render(); toast('Goal saved');
});

let progressGoal = null;
$('#progressDialog').addEventListener('close', () => {
  if ($('#progressDialog').returnValue !== 'save' || !progressGoal) return;
  const f = $('#progressForm');
  const value = Number(f.elements.value.value);
  const before = goalPct(progressGoal);
  progressGoal.current = value;
  const k = ymd(today());
  progressGoal.log = progressGoal.log.filter(e => e.date !== k); // one entry per day; latest wins
  progressGoal.log.push({ date: k, value, note: f.elements.note.value.trim() });
  progressGoal.log.sort((a, b) => a.date.localeCompare(b.date));
  save(); render();
  const after = goalPct(progressGoal);
  toast(after >= 100 ? '🎉 Goal achieved!' : `Progress ${after >= before ? '+' : ''}${(after - before).toFixed(1)} pts`);
});

$('#goalList').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const find = id => state.goals.find(g => g.id === id);
  if (b.dataset.progress) {
    progressGoal = find(b.dataset.progress);
    const f = $('#progressForm');
    f.reset();
    f.elements.value.value = progressGoal.current;
    $('#progressTitle').textContent = progressGoal.title;
    $('#progressHint').textContent = `Currently ${fmtNum(progressGoal.current)} of ${fmtNum(progressGoal.target)} ${progressGoal.unit}`;
    $('#progressDialog').showModal();
  } else if (b.dataset.editGoal) openGoal(find(b.dataset.editGoal));
  else if (b.dataset.delGoal) {
    const g = find(b.dataset.delGoal);
    if (confirm(`Delete goal “${g.title}”?`)) { state.goals = state.goals.filter(x => x !== g); save(); render(); }
  } else if (b.dataset.schedule) {
    const g = find(b.dataset.schedule);
    openEvent(ymd(addDays(today(), 1)), { title: `Work on: ${g.title}`, goalId: g.id });
  }
});

/* ---------- habits ---------- */
function renderHabits() {
  const el = $('#habitList');
  if (!state.habits.length) { el.innerHTML = '<div class="card empty">No habits yet. Click “New habit” to start building one.</div>'; return; }
  const t = today();
  el.innerHTML = state.habits.map(h => {
    const week = Array.from({ length: 7 }, (_, i) => addDays(t, i - 6)).map(d => {
      const k = ymd(d);
      return `<div class="day-cell"><span>${d.toLocaleDateString(undefined, { weekday: 'narrow' })}</span>
        <button class="tick ${h.done[k] ? 'done' : ''}" data-habit="${h.id}" data-day="${k}" aria-label="${fmtDate(d)}">${h.done[k] ? '✓' : ''}</button></div>`;
    }).join('');
    // 12-week heatmap, columns are Monday-start weeks.
    const offset = (t.getDay() + 6) % 7;
    const start = addDays(t, -(11 * 7 + offset));
    let heat = '';
    for (let i = 0; i < 84; i++) {
      const d = addDays(start, i);
      heat += d > t ? '<span style="visibility:hidden"></span>' : `<span class="${h.done[ymd(d)] ? 'on' : ''}" title="${fmtDate(d)}"></span>`;
    }
    return `<div class="card habit-row" style="--hc: var(--c${h.color})">
      <div><div class="habit-name">${esc(h.name)}</div>
        <div class="habit-sub">${h.target === 7 ? 'Every day' : h.target + '× per week'}${h.time ? ' · ⏰ ' + esc(h.time) : ''}
          · <button class="chip-btn" data-edit-habit="${h.id}">Edit</button><button class="chip-btn" data-del-habit="${h.id}">Delete</button></div></div>
      <div class="week">${week}</div>
      <div class="heat" aria-hidden="true">${heat}</div>
      <div class="habit-stats">🔥 <strong>${streak(h)}</strong> streak<br>Best ${bestStreak(h)} · ${Math.round(rate30(h) * 100)}% / 30d</div>
    </div>`;
  }).join('');
}

document.addEventListener('click', e => {
  const b = e.target.closest('button.tick[data-habit]');
  if (!b) return;
  const h = state.habits.find(x => x.id === b.dataset.habit);
  const k = b.dataset.day;
  if (h.done[k]) delete h.done[k]; else h.done[k] = true;
  if (k < h.created) h.created = k; // backfilling extends the habit's history
  save(); render();
});

let editingHabit = null;
$('#addHabitBtn').addEventListener('click', () => openHabit());
function openHabit(h) {
  editingHabit = h || null;
  const f = $('#habitForm');
  f.reset();
  $('#habitDialogTitle').textContent = h ? 'Edit habit' : 'New habit';
  if (h) { f.elements.name.value = h.name; f.elements.target.value = h.target; f.elements.color.value = h.color; f.elements.time.value = h.time || ''; }
  else f.elements.color.value = String((state.habits.length % 6) + 1);
  $('#habitDialog').showModal();
}
$('#habitDialog').addEventListener('close', async () => {
  if ($('#habitDialog').returnValue !== 'save') return;
  const f = $('#habitForm');
  const data = { name: f.elements.name.value.trim(), target: Number(f.elements.target.value), color: Number(f.elements.color.value), time: f.elements.time.value };
  let h = editingHabit;
  const timeChanged = !h || h.time !== data.time;
  if (h) Object.assign(h, data);
  else { h = { id: uid(), ...data, created: ymd(today()), done: {} }; state.habits.push(h); }
  save(); render(); toast('Habit saved');
  if (data.time && timeChanged) await addHabitReminder(h);
});
$('#habitList').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.editHabit) openHabit(state.habits.find(h => h.id === b.dataset.editHabit));
  if (b.dataset.delHabit) {
    const h = state.habits.find(x => x.id === b.dataset.delHabit);
    if (confirm(`Delete habit “${h.name}” and its history?`)) { state.habits = state.habits.filter(x => x !== h); save(); render(); }
  }
});

async function addHabitReminder(h) {
  if (!gcal.connected()) { toast('Connect Google Calendar to add this habit as a recurring reminder'); return; }
  const [hh, mm] = h.time.split(':').map(Number);
  const end = `${pad(Math.floor((hh * 60 + mm + 15) / 60) % 24)}:${pad((mm + 15) % 60)}`;
  const date = ymd(today());
  const rule = h.target === 5 ? 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' : 'RRULE:FREQ=DAILY';
  try {
    await gcal.create({
      summary: `Habit: ${h.name}`,
      description: 'Added by Momentum habit tracker',
      start: { dateTime: `${date}T${h.time}:00`, timeZone: TZ },
      end: { dateTime: `${date}T${end}:00`, timeZone: TZ },
      recurrence: [rule],
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
    });
    toast('Recurring reminder added to Google Calendar');
  } catch (err) { toast(`Google Calendar: ${err.message}`); }
}

/* ---------- Google Calendar ---------- */
const gcal = {
  token: null, expires: 0, client: null, cache: new Map(),
  connected() { return this.token && Date.now() < this.expires; },
  init() {
    if (!state.settings.clientId || !window.google?.accounts?.oauth2) return false;
    this.client = google.accounts.oauth2.initTokenClient({
      client_id: state.settings.clientId,
      scope: GCAL_SCOPE,
      callback: resp => {
        if (resp.error) { toast(`Google sign-in failed: ${resp.error}`); return; }
        this.token = resp.access_token;
        this.expires = Date.now() + (resp.expires_in - 60) * 1000;
        this.cache.clear();
        updateGcalStatus();
        syncLocalEvents().then(render);
      },
    });
    return true;
  },
  connect() {
    if (!state.settings.clientId) { toast('Add your Google OAuth Client ID in Settings first'); show('settings'); return; }
    if (!this.client && !this.init()) { toast('Google sign-in library is still loading — try again in a moment'); return; }
    this.client.requestAccessToken({ prompt: this.token ? '' : 'consent' });
  },
  disconnect() {
    if (this.token) google.accounts.oauth2.revoke(this.token, () => {});
    this.token = null; this.expires = 0; this.cache.clear();
    updateGcalStatus(); render();
  },
  async req(url, opts = {}) {
    const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', ...opts.headers } });
    if (res.status === 401) { this.token = null; updateGcalStatus(); throw new Error('session expired, reconnect'); }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error?.message || res.statusText);
    return res.status === 204 ? null : res.json();
  },
  async list(from, to) {
    const key = `${ymd(from)}|${ymd(to)}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
    const data = await this.req(`${GCAL_API}?${q}`);
    const events = (data.items || []).filter(e => e.status !== 'cancelled').map(e => ({
      id: e.id, title: e.summary || '(no title)', google: true, link: e.htmlLink,
      allDay: !!e.start.date,
      start: e.start.date ? parseYmd(e.start.date) : new Date(e.start.dateTime),
      end: e.end.date ? parseYmd(e.end.date) : new Date(e.end.dateTime),
    }));
    this.cache.set(key, events);
    return events;
  },
  async create(body) { const r = await this.req(GCAL_API, { method: 'POST', body: JSON.stringify(body) }); this.cache.clear(); return r; },
  async remove(id) { await this.req(`${GCAL_API}/${encodeURIComponent(id)}`, { method: 'DELETE' }); this.cache.clear(); },
};

function updateGcalStatus() {
  const on = gcal.connected();
  $('#gcalStatus').textContent = on ? `Connected to Google Calendar · ${TZ}` : 'Not connected — events are saved locally and sync when you connect';
  $('#gcalConnectBtn').textContent = on ? 'Disconnect Google' : 'Connect Google Calendar';
}
$('#gcalConnectBtn').addEventListener('click', () => gcal.connected() ? gcal.disconnect() : gcal.connect());

const toGoogleBody = ev => ({
  summary: ev.title,
  description: ev.description || undefined,
  start: ev.allDay ? { date: ev.date } : { dateTime: `${ev.date}T${ev.start}:00`, timeZone: TZ },
  end: ev.allDay ? { date: ymd(addDays(parseYmd(ev.date), 1)) } : { dateTime: `${ev.date}T${ev.end}:00`, timeZone: TZ },
});

// Push events created while offline up to Google once connected.
async function syncLocalEvents() {
  const pending = state.events.slice();
  let n = 0;
  for (const ev of pending) {
    try { await gcal.create(toGoogleBody(ev)); state.events = state.events.filter(x => x !== ev); n++; }
    catch (err) { toast(`Sync stopped: ${err.message}`); break; }
  }
  save();
  if (n) toast(`Synced ${n} local event${n > 1 ? 's' : ''} to Google Calendar`);
}

function localEventsAsItems() {
  return state.events.map(ev => ({
    id: ev.id, title: ev.title, google: false, allDay: ev.allDay, goalId: ev.goalId,
    start: ev.allDay ? parseYmd(ev.date) : new Date(`${ev.date}T${ev.start}`),
    end: ev.allDay ? addDays(parseYmd(ev.date), 1) : new Date(`${ev.date}T${ev.end}`),
  }));
}
async function eventsBetween(from, to) {
  let items = localEventsAsItems().filter(e => e.end > from && e.start < to);
  if (gcal.connected()) {
    try { items = items.concat(await gcal.list(from, to)); }
    catch (err) { toast(`Google Calendar: ${err.message}`); }
  }
  return items.sort((a, b) => a.start - b.start);
}

function eventLi(e, showDate) {
  const when = e.allDay ? 'All day' : fmtTime(e.start);
  const date = showDate ? `<div class="muted small">${fmtDate(e.start, { weekday: 'short', month: 'short', day: 'numeric' })}</div>` : '';
  const goal = e.goalId && state.goals.find(g => g.id === e.goalId);
  return `<li><div class="ev-time">${date}${when}</div>
    <div class="ev-body"><div class="ev-title">${esc(e.title)}<span class="badge ${e.google ? 'g' : ''}">${e.google ? 'Google' : 'Local'}</span></div>
    ${goal ? `<div class="muted small">Goal: ${esc(goal.title)}</div>` : ''}</div>
    <button class="chip-btn" data-del-event="${esc(e.id)}" data-google="${e.google ? 1 : ''}" aria-label="Delete event">✕</button></li>`;
}

async function renderUpcoming() {
  const from = new Date();
  const items = await eventsBetween(from, addDays(today(), 14));
  $('#dashEvents').innerHTML = items.length ? items.slice(0, 6).map(e => eventLi(e, true)).join('')
    : `<li class="empty">Nothing in the next two weeks.${gcal.connected() ? '' : ' Connect Google Calendar to see your schedule.'}</li>`;
}

/* ---------- calendar view ---------- */
let calMonth = new Date(today().getFullYear(), today().getMonth(), 1);
let selectedDay = ymd(today());
let calRender = 0;

async function renderCalendar() {
  updateGcalStatus();
  const ticket = ++calRender;
  $('#calTitle').textContent = calMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const gridStart = addDays(calMonth, -((calMonth.getDay() + 6) % 7));
  const gridEnd = addDays(gridStart, 42);
  const items = await eventsBetween(gridStart, gridEnd);
  if (ticket !== calRender) return; // a newer render started while we waited

  const byDay = {};
  for (const e of items) {
    // Spread multi-day events over each day they cover.
    for (let d = new Date(Math.max(e.start, gridStart)); d < e.end && d < gridEnd; d = addDays(d, 1)) {
      const k = ymd(d);
      (byDay[k] ||= []).push(e);
      d.setHours(0, 0, 0, 0);
    }
  }
  const tk = ymd(today());
  let html = '';
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i), k = ymd(d), evs = byDay[k] || [];
    html += `<button class="cal-day ${d.getMonth() !== calMonth.getMonth() ? 'other' : ''} ${k === tk ? 'today' : ''} ${k === selectedDay ? 'selected' : ''}" data-day="${k}">
      <span class="num">${d.getDate()}</span>
      ${evs.slice(0, 3).map(e => `<span class="cal-ev ${e.google ? '' : 'local'}">${e.allDay ? '' : fmtTime(e.start) + ' '}${esc(e.title)}</span>`).join('')}
      ${evs.length > 3 ? `<span class="cal-more">+${evs.length - 3} more</span>` : ''}</button>`;
  }
  $('#calGrid').innerHTML = html;

  const sel = parseYmd(selectedDay);
  $('#dayPanelTitle').innerHTML = `${esc(fmtDate(sel, { weekday: 'long', month: 'long', day: 'numeric' }))}`;
  const dayItems = byDay[selectedDay] || [];
  $('#dayPanel').innerHTML = (dayItems.length ? dayItems.map(e => eventLi(e)).join('') : '<li class="empty">No events.</li>')
    + `<li><button class="btn small" data-new-on="${selectedDay}">+ Add on this day</button></li>`;
}

$('#calPrev').addEventListener('click', () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderCalendar(); });
$('#calNext').addEventListener('click', () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderCalendar(); });
$('#calToday').addEventListener('click', () => { calMonth = new Date(today().getFullYear(), today().getMonth(), 1); selectedDay = ymd(today()); renderCalendar(); });
$('#calGrid').addEventListener('click', e => {
  const b = e.target.closest('.cal-day');
  if (!b) return;
  if (selectedDay === b.dataset.day) openEvent(b.dataset.day); // second click on a day opens the form
  selectedDay = b.dataset.day;
  renderCalendar();
});
$('#addEventBtn').addEventListener('click', () => openEvent(selectedDay));

document.addEventListener('click', async e => {
  const nb = e.target.closest('[data-new-on]');
  if (nb) { openEvent(nb.dataset.newOn); return; }
  const b = e.target.closest('[data-del-event]');
  if (!b || !confirm('Delete this event?')) return;
  if (b.dataset.google) {
    try { await gcal.remove(b.dataset.delEvent); toast('Deleted from Google Calendar'); }
    catch (err) { toast(`Google Calendar: ${err.message}`); return; }
  } else {
    state.events = state.events.filter(x => x.id !== b.dataset.delEvent);
    save();
  }
  render();
});

function openEvent(date, preset = {}) {
  const f = $('#eventForm');
  f.reset();
  f.elements.start.disabled = f.elements.end.disabled = false;
  f.elements.date.value = date || ymd(today());
  f.elements.goalId.innerHTML = '<option value="">—</option>' + state.goals.map(g => `<option value="${g.id}">${esc(g.title)}</option>`).join('');
  if (preset.title) f.elements.title.value = preset.title;
  if (preset.goalId) f.elements.goalId.value = preset.goalId;
  $('#eventDest').textContent = gcal.connected() ? 'Will be added to your Google Calendar.' : 'Saved locally — syncs to Google Calendar once you connect.';
  $('#eventDialog').showModal();
}
$('#eventForm').elements.allDay.addEventListener('change', e => {
  const f = $('#eventForm');
  f.elements.start.disabled = f.elements.end.disabled = e.target.checked;
});
$('#eventDialog').addEventListener('close', async () => {
  if ($('#eventDialog').returnValue !== 'save') return;
  const f = $('#eventForm');
  const goal = state.goals.find(g => g.id === f.elements.goalId.value);
  const ev = {
    id: uid(), title: f.elements.title.value.trim(), date: f.elements.date.value, allDay: f.elements.allDay.checked,
    start: f.elements.start.value || '09:00', end: f.elements.end.value || '10:00', goalId: f.elements.goalId.value,
    description: [f.elements.description.value.trim(), goal ? `Goal: ${goal.title}` : ''].filter(Boolean).join('\n'),
  };
  if (!ev.allDay && ev.end <= ev.start) { toast('End time must be after start time'); return; }
  f.elements.start.disabled = f.elements.end.disabled = false;
  if (gcal.connected()) {
    try { await gcal.create(toGoogleBody(ev)); toast('Added to Google Calendar'); }
    catch (err) { state.events.push(ev); save(); toast(`Saved locally (Google: ${err.message})`); }
  } else { state.events.push(ev); save(); toast('Event saved'); }
  selectedDay = ev.date;
  render();
});

/* ---------- settings ---------- */
function renderSettings() {
  $('#clientIdInput').value = state.settings.clientId || '';
  $('#originHint').textContent = location.origin.startsWith('http') ? location.origin : 'http://localhost:8000';
}
$('#saveClientId').addEventListener('click', () => {
  state.settings.clientId = $('#clientIdInput').value.trim();
  gcal.client = null;
  save();
  toast(state.settings.clientId ? 'Client ID saved — connect from the Calendar tab' : 'Client ID cleared');
});
$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `momentum-${ymd(today())}.json` });
  a.click();
  URL.revokeObjectURL(a.href);
});
$('#importInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.goals) || !Array.isArray(data.habits)) throw new Error('not a Momentum backup');
    state = Object.assign(blankState(), data);
    save(); render(); toast('Data imported');
  } catch (err) { toast(`Import failed: ${err.message}`); }
  e.target.value = '';
});
$('#resetBtn').addEventListener('click', () => {
  if (!confirm('Erase all goals, habits and local events? This cannot be undone.')) return;
  state = Object.assign(blankState(), { settings: state.settings });
  save(); render(); toast('All data erased');
});
$('#demoBtn').addEventListener('click', () => {
  if ((state.goals.length || state.habits.length) && !confirm('Replace your current data with demo data?')) return;
  loadDemo(); save(); render(); toast('Demo data loaded');
});

function loadDemo() {
  const t = today(), k = n => ymd(addDays(t, n));
  // Deterministic pseudo-random so the demo looks the same each time.
  let seed = 7;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const habit = (name, target, color, p0, p1) => {
    const done = {};
    for (let i = 59; i >= 0; i--) if (rnd() < p0 + (p1 - p0) * (1 - i / 59)) done[k(-i)] = true;
    return { id: uid(), name, target, color, time: '', created: k(-59), done };
  };
  const goal = (title, category, start, target, unit, deadline, values) => ({
    id: uid(), title, category, start, target, unit, deadline: k(deadline), created: k(-60),
    current: values[values.length - 1][1], log: values.map(([d, v]) => ({ date: k(d), value: v, note: '' })),
  });
  state.habits = [
    habit('Morning workout', 5, 2, .35, .8),
    habit('Read 20 pages', 7, 1, .4, .75),
    habit('Meditate', 7, 5, .2, .65),
    habit('No phone after 10pm', 7, 3, .3, .55),
  ];
  state.goals = [
    goal('Read 24 books this year', 'Learning', 0, 24, 'books', 75, [[-50, 3], [-35, 5], [-20, 8], [-6, 10], [-1, 11]]),
    goal('Run a half marathon', 'Health', 5, 21, 'km', 40, [[-45, 7], [-30, 10], [-14, 13], [-3, 16]]),
    goal('Save emergency fund', 'Finance', 0, 3000, '$', 120, [[-40, 600], [-25, 1100], [-10, 1500]]),
    goal('Ship portfolio website', 'Career', 0, 10, 'tasks', -2, [[-30, 2], [-12, 5], [-2, 7]]),
  ];
  state.events = [
    { id: uid(), title: 'Long run', date: k(1), start: '07:00', end: '08:30', allDay: false, goalId: state.goals[1].id, description: '' },
    { id: uid(), title: 'Weekly review', date: k(3), start: '18:00', end: '18:30', allDay: false, goalId: '', description: '' },
  ];
}

/* ---------- theme & boot ---------- */
function applyTheme() {
  if (state.settings.theme) document.documentElement.dataset.theme = state.settings.theme;
  else delete document.documentElement.dataset.theme;
}
$('#themeToggle').addEventListener('click', () => {
  const dark = state.settings.theme ? state.settings.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  state.settings.theme = dark ? 'light' : 'dark';
  applyTheme(); save();
});

applyTheme();
let startView = 'dashboard';
try { startView = sessionStorage.getItem('momentum.view') || startView; } catch { }
show($(`.tab[data-view="${startView}"]`) ? startView : 'dashboard');
updateGcalStatus();
window.addEventListener('load', () => gcal.init());
// Re-render at midnight so "today" stays correct for long-open tabs.
let renderDay = ymd(today());
setInterval(() => { if (ymd(today()) !== renderDay) { renderDay = ymd(today()); render(); } }, 60_000);
