/* ==========================================================================
   ExecuFlow — Executive Command Center
   Application logic: state + autosave, CRUD with editing, data-driven charts,
   alerts, backup export/import, theme handling, keyboard shortcuts.
   No network calls: everything lives in localStorage on this device.
   ========================================================================== */
(() => {
  'use strict';

  const APP = {
    name: 'ExecuFlow',
    version: '1.0.0',
    storageKey: 'execuflow.v1',
    legacyKey: 'execuFlowData',      // key used by the original prototype
    safetyKey: 'execuflow.v1.prev',  // copy kept before an import replaces data
    viewKey: 'execuflow.view'
  };

  const PROJECT_TYPES = ['Project', 'Grant', 'Investment', 'Initiative'];
  const PROJECT_STATUSES = ['On Track', 'At Risk', 'On Hold', 'Completed'];
  const PRIORITIES = ['Normal', 'High', 'Critical'];
  const PRIORITY_WEIGHT = { Normal: 1, High: 2, Critical: 3 };
  const TASK_STATUSES = ['Pending', 'In Progress', 'Completed'];
  const EVENT_TYPES = ['Keynote', 'Meeting', 'Panel', 'Conference', 'Travel', 'Other'];

  const VIEWS = {
    dashboard: { title: 'Executive Overview', add: null },
    portfolio: { title: 'Strategic Portfolio', add: 'project' },
    delegation: { title: 'Team Delegation', add: 'task' },
    workload: { title: 'Workload Allocation', add: null },
    engagements: { title: 'Global Engagements', add: 'engagement' }
  };

  /* ---------------------------------------------------------------------
     Utilities
  --------------------------------------------------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const pad = (n) => String(n).padStart(2, '0');
  const plural = (n, word, pl) => `${n} ${n === 1 ? word : (pl || word + 's')}`;

  function localISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function parseDate(s) {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }
  function daysFromToday(s) { const d = parseDate(s); return d ? Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000) : null; }
  function fmtDate(s, opts = { month: 'short', day: 'numeric', year: 'numeric' }) { const d = parseDate(s); return d ? d.toLocaleDateString('en-US', opts) : '—'; }
  function fmtTime(t) {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
    if (!m) return '';
    let h = +m[1]; const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
    return `${h}:${m[2]} ${ap}`;
  }
  function fmtMoney(m) {
    const n = Number(m) || 0;
    if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(2).replace(/\.?0+$/, '')}B`;
    return `$${Number.isInteger(n) ? n : n.toFixed(1)}M`;
  }
  function relDays(s) {
    const n = daysFromToday(s);
    if (n === null) return '';
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n === -1) return '1 day overdue';
    if (n < 0) return `${-n} days overdue`;
    if (n < 14) return `in ${n} days`;
    if (n < 60) return `in ${Math.round(n / 7)} weeks`;
    return `in ${Math.round(n / 30)} months`;
  }
  function initials(name) { return (String(name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase(); }
  function hexToRgba(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  /* ---------------------------------------------------------------------
     State & persistence
  --------------------------------------------------------------------- */
  let state = emptyState();
  let currentView = 'dashboard';
  const charts = {};

  function emptyState() {
    return { version: 1, projects: [], tasks: [], engagements: [], settings: { theme: 'system', name: '', title: '' }, updatedAt: null };
  }

  function sampleData() {
    const d = (n) => localISO(addDays(new Date(), n));
    return {
      projects: [
        { name: 'Global AI Ethics Grant', type: 'Grant', budget: 2.5, progress: 65, status: 'On Track' },
        { name: 'EMEA Expansion Strategy', type: 'Project', budget: 15, progress: 40, status: 'At Risk' },
        { name: 'NextGen Tech Incubator', type: 'Investment', budget: 5, progress: 90, status: 'On Track' }
      ],
      tasks: [
        { task: 'Prepare Q4 Board Deck', assignee: 'Sarah J. (EA)', priority: 'High', deadline: d(10), status: 'In Progress' },
        { task: 'Finalize legal review for Project X', assignee: 'Legal Dept', priority: 'Critical', deadline: d(5), status: 'Pending' },
        { task: 'Investor update letter', assignee: 'Comms Team', priority: 'Normal', deadline: d(-2), status: 'Pending' },
        { task: 'Flight logistics for Dubai keynote', assignee: 'Travel Team', priority: 'Normal', deadline: d(27), status: 'Completed' }
      ],
      engagements: [
        { title: 'World Economic Summit Keynote', type: 'Keynote', location: 'Dubai, UAE', date: d(38), time: '10:00' },
        { title: 'Q4 Global Board Meeting', type: 'Meeting', location: 'London, UK', date: d(15), time: '09:00' },
        { title: 'Tech Innovators Panel', type: 'Panel', location: 'San Francisco, CA', date: d(61), time: '14:00' }
      ]
    };
  }

  const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
  const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
  const oneOf = (v, list, d) => (list.includes(v) ? v : d);
  function dateStr(v) { const d = parseDate(v); return d ? localISO(d) : ''; }
  function timeStr(v) {
    const m = /(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/.exec(String(v || ''));
    if (!m) return '';
    let h = +m[1]; const ap = (m[3] || '').toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return `${pad(clamp(h, 0, 23))}:${m[2]}`;
  }

  const normProject = (p) => ({
    id: String(p.id || uid()),
    name: str(p.name || p.title),
    type: oneOf(p.type, PROJECT_TYPES, 'Project'),
    budget: Math.max(0, num(p.budget)),
    progress: clamp(Math.round(num(p.progress)), 0, 100),
    status: oneOf(p.status, PROJECT_STATUSES, 'On Track'),
    createdAt: p.createdAt || new Date().toISOString()
  });
  const normTask = (t) => ({
    id: String(t.id || uid()),
    task: str(t.task || t.name || t.title),
    assignee: str(t.assignee, 80),
    priority: oneOf(t.priority, PRIORITIES, 'Normal'),
    deadline: dateStr(t.deadline),
    status: oneOf(t.status, TASK_STATUSES, 'Pending'),
    createdAt: t.createdAt || new Date().toISOString()
  });
  const normEvent = (e) => ({
    id: String(e.id || uid()),
    title: str(e.title || e.name),
    type: oneOf(e.type, EVENT_TYPES, 'Meeting'),
    location: str(e.location, 120),
    date: dateStr(e.date),
    time: timeStr(e.time),
    createdAt: e.createdAt || new Date().toISOString()
  });

  function normalize(raw) {
    const s = emptyState();
    const src = raw && typeof raw === 'object' ? raw : {};
    const projects = src.projects || src.portfolio || [];
    const tasks = src.tasks || src.delegation || [];
    const engagements = src.engagements || src.events || [];
    s.projects = (Array.isArray(projects) ? projects : []).map(normProject).filter((p) => p.name);
    s.tasks = (Array.isArray(tasks) ? tasks : []).map(normTask).filter((t) => t.task);
    s.engagements = (Array.isArray(engagements) ? engagements : []).map(normEvent).filter((e) => e.title);
    const st = src.settings && typeof src.settings === 'object' ? src.settings : {};
    s.settings.theme = oneOf(st.theme, ['system', 'light', 'dark'], 'system');
    s.settings.name = str(st.name, 60);
    s.settings.title = str(st.title, 60);
    s.updatedAt = src.updatedAt || null;
    return s;
  }

  function load() {
    try {
      const raw = localStorage.getItem(APP.storageKey);
      if (raw) { state = normalize(JSON.parse(raw)); return; }
      const legacy = localStorage.getItem(APP.legacyKey);
      if (legacy) { state = normalize(JSON.parse(legacy)); save(); return; }
      state = normalize(sampleData());
      save();
    } catch (err) {
      console.error('ExecuFlow: could not load saved data', err);
    }
  }

  function save() {
    state.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(APP.storageKey, JSON.stringify(state));
      const t = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      $('#saved-state span').textContent = `All changes saved · ${t}`;
    } catch (err) {
      console.error(err);
      toast('Could not save — the browser storage is full or blocked.', 'error');
    }
  }

  /** Apply a mutation, persist it and refresh everything that depends on data. */
  function commit(mutator) {
    mutator(state);
    save();
    refresh();
  }

  function refresh() {
    renderView(currentView);
    updateAlerts();
  }

  /* ---------------------------------------------------------------------
     Theme
  --------------------------------------------------------------------- */
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

  function effectiveTheme() {
    const pref = state.settings.theme || 'system';
    return pref === 'system' ? (darkQuery.matches ? 'dark' : 'light') : pref;
  }

  function applyTheme(rerender = true) {
    const eff = effectiveTheme();
    document.documentElement.setAttribute('data-theme', eff);
    $('meta[name="theme-color"]').setAttribute('content', eff === 'dark' ? '#0e0e11' : '#f3f3f3');
    const pref = state.settings.theme;
    $('#theme-icon use').setAttribute('href', pref === 'system' ? '#i-monitor' : pref === 'dark' ? '#i-moon' : '#i-sun');
    $('#theme-btn').title = `Theme: ${pref === 'system' ? 'follows Windows' : pref} — click to switch`;
    if (rerender) renderView(currentView);
  }

  function cycleTheme() {
    const order = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(state.settings.theme) + 1) % order.length];
    state.settings.theme = next;
    save();
    applyTheme();
    toast(`Theme: ${next === 'system' ? 'follows Windows' : next.charAt(0).toUpperCase() + next.slice(1)}`, 'info');
  }

  darkQuery.addEventListener('change', () => { if (state.settings.theme === 'system') applyTheme(); });

  /* ---------------------------------------------------------------------
     Navigation & layout
  --------------------------------------------------------------------- */
  function navigate(view) {
    if (!VIEWS[view]) view = 'dashboard';
    currentView = view;
    $$('.view').forEach((el) => el.classList.toggle('active', el.id === `view-${view}`));
    $$('.nav-item').forEach((b) => {
      const active = b.dataset.view === view;
      b.classList.toggle('active', active);
      b.setAttribute('aria-current', active ? 'page' : 'false');
    });
    $('#page-title').textContent = VIEWS[view].title;
    try { localStorage.setItem(APP.viewKey, view); } catch (e) { /* ignore */ }
    closeSidebar();
    $('#main').scrollTop = 0;
    renderView(view);
  }

  function renderView(view) {
    if (view === 'dashboard') renderDashboard();
    else if (view === 'portfolio') renderPortfolio();
    else if (view === 'delegation') renderDelegation();
    else if (view === 'workload') renderWorkload();
    else if (view === 'engagements') renderEngagements();
  }

  function openSidebar() { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); }
  function closeSidebar() { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); }

  function updateHeaderDate() {
    const now = new Date();
    $('#page-date').textContent = `${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} · ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }

  function renderProfile() {
    const name = state.settings.name || 'Chief Executive';
    const title = state.settings.title || 'Executive Office';
    $('#profile-name').textContent = name;
    $('#profile-title').textContent = title;
    $('#profile-avatar').textContent = initials(name);
  }

  /* ---------------------------------------------------------------------
     Derived data helpers
  --------------------------------------------------------------------- */
  const openTasks = () => state.tasks.filter((t) => t.status !== 'Completed');
  const isOverdue = (t) => t.status !== 'Completed' && t.deadline && daysFromToday(t.deadline) < 0;

  function sortedTasks() {
    const rank = (t) => (t.status === 'Completed' ? 1 : 0);
    return [...state.tasks].sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if (rank(a) === 1) return (b.deadline || '').localeCompare(a.deadline || '');
      return (a.deadline || '9999').localeCompare(b.deadline || '9999');
    });
  }

  function sortedEvents() {
    return [...state.engagements].sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  }

  function nextEvent() {
    return sortedEvents().find((e) => daysFromToday(e.date) >= 0) || null;
  }

  /** Buckets items into N weeks starting today. */
  function weeklyBuckets(weeks) {
    const start = startOfDay(new Date());
    const labels = [];
    const ranges = [];
    const tasks = new Array(weeks).fill(0);
    const events = new Array(weeks).fill(0);
    for (let w = 0; w < weeks; w++) {
      const a = addDays(start, w * 7); const b = addDays(start, w * 7 + 6);
      const sameMonth = a.getMonth() === b.getMonth();
      labels.push(w === 0 ? 'This week' : a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      ranges.push(`${a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${b.toLocaleDateString('en-US', sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}`);
    }
    const bucket = (dateStr) => { const n = daysFromToday(dateStr); return n === null || n < 0 ? -1 : Math.floor(n / 7); };
    openTasks().forEach((t) => { const i = bucket(t.deadline); if (i >= 0 && i < weeks) tasks[i]++; });
    state.engagements.forEach((e) => { const i = bucket(e.date); if (i >= 0 && i < weeks) events[i]++; });
    return { labels, ranges, tasks, events, total: tasks.reduce((a, b) => a + b, 0) + events.reduce((a, b) => a + b, 0) };
  }

  const projectStatusChip = (s) => ({ 'On Track': 'chip-success', 'At Risk': 'chip-danger', 'On Hold': 'chip-warning', 'Completed': 'chip-info' }[s] || 'chip-neutral');
  const projectStatusIcon = (s) => ({ 'On Track': 'trending-up', 'At Risk': 'triangle-alert', 'On Hold': 'clock', 'Completed': 'circle-check' }[s] || 'info');
  const progressClass = (s) => ({ 'On Track': '', 'At Risk': 'danger', 'On Hold': 'warning', 'Completed': 'success' }[s] || '');
  const priorityChip = (p) => ({ Critical: 'chip-danger', High: 'chip-warning', Normal: 'chip-info' }[p] || 'chip-neutral');
  const taskStatusChip = (s) => ({ Completed: 'chip-success', 'In Progress': 'chip-info', Pending: 'chip-neutral' }[s] || 'chip-neutral');

  /* ---------------------------------------------------------------------
     Renderers
  --------------------------------------------------------------------- */
  function renderDashboard() {
    const active = state.projects.filter((p) => p.status !== 'Completed');
    const atRisk = active.filter((p) => p.status === 'At Risk').length;
    const onHold = active.filter((p) => p.status === 'On Hold').length;
    $('#kpi-projects').textContent = active.length;
    setSub('#kpi-projects-sub',
      !state.projects.length ? ['neutral', 'info', 'Add your first project']
        : atRisk ? ['warning', 'triangle-alert', `${plural(atRisk, 'project')} at risk`]
          : onHold ? ['neutral', 'clock', `${plural(onHold, 'project')} on hold`]
            : ['success', 'trending-up', 'All projects on track']);

    const total = state.projects.reduce((s, p) => s + (Number(p.budget) || 0), 0);
    $('#kpi-budget').textContent = fmtMoney(total);
    const byType = PROJECT_TYPES.map((t) => [t, state.projects.filter((p) => p.type === t).length]).filter(([, n]) => n > 0);
    setSub('#kpi-budget-sub', ['neutral', 'wallet', byType.length ? byType.map(([t, n]) => plural(n, t.toLowerCase())).join(' · ') : 'Across all institutions']);

    const open = openTasks();
    const overdue = open.filter(isOverdue).length;
    const urgent = open.filter((t) => t.priority !== 'Normal').length;
    $('#kpi-tasks').textContent = open.length;
    setSub('#kpi-tasks-sub',
      !state.tasks.length ? ['neutral', 'info', 'Delegate your first task']
        : overdue ? ['danger', 'circle-alert', `${plural(overdue, 'task')} overdue`]
          : urgent ? ['warning', 'flag', `${urgent} high priority`]
            : ['success', 'circle-check', 'Nothing urgent']);

    const nxt = nextEvent();
    $('#kpi-next').textContent = nxt ? nxt.title : 'No upcoming events';
    setSub('#kpi-next-sub', nxt ? ['gold', 'calendar', `${fmtDate(nxt.date, { month: 'short', day: 'numeric' })} · ${relDays(nxt.date)}${nxt.location ? ' · ' + nxt.location : ''}`] : ['neutral', 'calendar-plus', 'Add an engagement']);

    // Open tasks list
    const list = $('#dash-tasks');
    const rows = sortedTasks().filter((t) => t.status !== 'Completed').slice(0, 6);
    if (!rows.length) {
      list.innerHTML = emptyHTML('inbox', 'No open delegations', 'Everything delegated is complete. Assign a new work package when you are ready.', 'task', 'Delegate task');
    } else {
      list.innerHTML = rows.map((t) => {
        const od = isOverdue(t);
        const n = daysFromToday(t.deadline);
        return `<button class="list-row" type="button" data-edit="task" data-id="${esc(t.id)}" title="Open task">
          <div style="min-width:0">
            <div class="t">${esc(t.task)}</div>
            <div class="s ${od ? 'danger' : ''}">${esc(t.assignee)} · ${t.deadline ? (od ? relDays(t.deadline) : `due ${fmtDate(t.deadline, { month: 'short', day: 'numeric' })}${n !== null && n <= 14 ? ` (${relDays(t.deadline).toLowerCase()})` : ''}`) : 'no deadline'}</div>
          </div>
          <span class="chip ${priorityChip(t.priority)}">${esc(t.priority)}</span>
        </button>`;
      }).join('');
    }

    // Upcoming load chart (4 weeks)
    const wk = weeklyBuckets(4);
    toggleEmpty('empty-upcoming', wk.total === 0);
    makeStackedWeeks('chart-upcoming', wk);
  }

  function setSub(sel, [tone, ic, text]) {
    const el = $(sel);
    el.className = `kpi-sub ${tone === 'neutral' ? '' : tone}`;
    el.innerHTML = `${icon(ic, 'icon-sm')} <span>${esc(text)}</span>`;
  }

  function emptyHTML(ic, title, text, addKind, cta) {
    return `<div class="empty">${icon(ic, 'icon-xl')}<h4>${esc(title)}</h4><p>${esc(text)}</p>${addKind ? `<button class="btn btn-primary" type="button" data-add="${addKind}">${icon('plus')} ${esc(cta)}</button>` : ''}</div>`;
  }

  function renderPortfolio() {
    const grid = $('#portfolio-grid');
    const empty = $('#portfolio-empty');
    const total = state.projects.reduce((s, p) => s + (Number(p.budget) || 0), 0);
    const atRisk = state.projects.filter((p) => p.status === 'At Risk').length;
    $('#portfolio-summary').innerHTML = state.projects.length
      ? `<strong>${plural(state.projects.length, 'project')}</strong> · ${esc(fmtMoney(total))} total budget${atRisk ? ` · <strong>${atRisk} at risk</strong>` : ''}`
      : 'Monitor multi-institutional grants and high-stakes projects.';

    if (!state.projects.length) {
      grid.innerHTML = '';
      empty.hidden = false;
      empty.innerHTML = emptyHTML('chart-pie', 'No projects yet', 'Add grants, investments and strategic projects to track budget, status and progress at a glance.', 'project', 'New project');
      return;
    }
    empty.hidden = true;
    grid.innerHTML = state.projects.map((p) => `
      <article class="card project" data-edit="project" data-id="${esc(p.id)}" tabindex="0" role="button" aria-label="Edit ${esc(p.name)}">
        <div>
          <div class="project-top">
            <span class="chip chip-neutral">${esc(p.type)}</span>
            <div class="row-actions">
              <button class="btn btn-icon sm" type="button" data-edit="project" data-id="${esc(p.id)}" title="Edit" aria-label="Edit">${icon('pencil', 'icon-sm')}</button>
              <button class="btn btn-icon sm danger" type="button" data-delete="project" data-id="${esc(p.id)}" title="Delete" aria-label="Delete">${icon('trash-2', 'icon-sm')}</button>
            </div>
          </div>
          <h3>${esc(p.name)}</h3>
          <div class="project-budget">${esc(fmtMoney(p.budget))}<small>budget</small></div>
        </div>
        <div>
          <div class="progress-meta">
            <span class="chip ${projectStatusChip(p.status)}">${icon(projectStatusIcon(p.status))} ${esc(p.status)}</span>
            <span class="pct">${p.progress}% complete</span>
          </div>
          <div class="progress ${progressClass(p.status)}" role="progressbar" aria-valuenow="${p.progress}" aria-valuemin="0" aria-valuemax="100"><span style="width:${p.progress}%"></span></div>
        </div>
      </article>`).join('');
  }

  function renderDelegation() {
    const tbody = $('#delegation-list');
    const empty = $('#delegation-empty');
    const open = openTasks();
    const overdue = open.filter(isOverdue).length;
    $('#delegation-summary').innerHTML = state.tasks.length
      ? `<strong>${plural(open.length, 'open task')}</strong> · ${state.tasks.length - open.length} completed${overdue ? ` · <strong style="color:var(--danger)">${overdue} overdue</strong>` : ''}`
      : 'Assign and track work packages across assistants and departments.';

    if (!state.tasks.length) {
      tbody.innerHTML = '';
      $('#delegation-card .table-wrap').hidden = true;
      empty.hidden = false;
      empty.innerHTML = emptyHTML('users', 'Nothing delegated yet', 'Delegate work packages to assistants, departments or partners and track priority, deadline and status here.', 'task', 'Delegate task');
      return;
    }
    $('#delegation-card .table-wrap').hidden = false;
    empty.hidden = true;
    tbody.innerHTML = sortedTasks().map((t) => {
      const done = t.status === 'Completed';
      const n = daysFromToday(t.deadline);
      const dlClass = done ? '' : n !== null && n < 0 ? 'overdue' : n !== null && n <= 3 ? 'soon' : '';
      return `<tr class="${done ? 'done' : ''}" data-id="${esc(t.id)}">
        <td><div class="task-name">${esc(t.task)}</div></td>
        <td><div class="assignee"><span class="avatar">${esc(initials(t.assignee))}</span><span>${esc(t.assignee)}</span></div></td>
        <td><span class="chip ${priorityChip(t.priority)}">${esc(t.priority)}</span></td>
        <td><div class="deadline ${dlClass}">${t.deadline ? esc(fmtDate(t.deadline)) : '—'}<small>${done ? 'done' : esc(relDays(t.deadline))}</small></div></td>
        <td><span class="chip ${taskStatusChip(t.status)}">${esc(t.status)}</span></td>
        <td class="actions">
          <div class="row-actions">
            <button class="btn btn-icon sm success" type="button" data-toggle="${esc(t.id)}" title="${done ? 'Reopen task' : 'Mark as completed'}" aria-label="${done ? 'Reopen task' : 'Mark as completed'}">${icon(done ? 'rotate-ccw' : 'circle-check')}</button>
            <button class="btn btn-icon sm" type="button" data-edit="task" data-id="${esc(t.id)}" title="Edit" aria-label="Edit">${icon('pencil')}</button>
            <button class="btn btn-icon sm danger" type="button" data-delete="task" data-id="${esc(t.id)}" title="Delete" aria-label="Delete">${icon('trash-2')}</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  function renderWorkload() {
    const open = openTasks();
    const summary = $('#workload-summary');
    const points = open.reduce((s, t) => s + PRIORITY_WEIGHT[t.priority], 0);
    summary.innerHTML = state.tasks.length || state.projects.length || state.engagements.length
      ? `<strong>${plural(open.length, 'open task')}</strong> carrying <strong>${plural(points, 'load point')}</strong> across <strong>${plural(new Set(open.map((t) => t.assignee)).size, 'assignee')}</strong> · computed live from your data`
      : 'Bandwidth and resource allocation, computed live from your portfolio, delegations and engagements.';

    // Load by assignee (weighted)
    const byAssignee = {};
    open.forEach((t) => { byAssignee[t.assignee] = (byAssignee[t.assignee] || 0) + PRIORITY_WEIGHT[t.priority]; });
    const aRows = Object.entries(byAssignee).sort((a, b) => b[1] - a[1]).slice(0, 10);
    toggleEmpty('empty-assignee', !aRows.length);
    makeBars('chart-assignee', aRows.map((r) => r[0]), aRows.map((r) => r[1]), { horizontal: true, format: (v) => `${v} pt${v === 1 ? '' : 's'}` });

    // Budget by project
    const bRows = [...state.projects].sort((a, b) => b.budget - a.budget);
    const top = bRows.slice(0, 7);
    const rest = bRows.slice(7).reduce((s, p) => s + p.budget, 0);
    const bLabels = top.map((p) => p.name); const bData = top.map((p) => p.budget);
    if (rest > 0) { bLabels.push(`Other (${bRows.length - 7})`); bData.push(rest); }
    toggleEmpty('empty-budget', !bLabels.length);
    makeBars('chart-budget', bLabels, bData, { horizontal: true, format: fmtMoney });

    // Deadline pipeline (8 weeks)
    const b = weeklyBuckets(8);
    toggleEmpty('empty-pipeline', b.total === 0);
    makeStackedWeeks('chart-pipeline', b);

    // Status mix
    const sRows = TASK_STATUSES.map((s) => state.tasks.filter((t) => t.status === s).length);
    toggleEmpty('empty-status', !state.tasks.length);
    makeBars('chart-status', TASK_STATUSES, sRows, { horizontal: false, format: (v) => String(v) });
  }

  function toggleEmpty(id, show) { const el = $('#' + id); if (el) el.hidden = !show; }

  function renderEngagements() {
    const tl = $('#engagements-timeline');
    const empty = $('#engagements-empty');
    const events = sortedEvents();
    const upcoming = events.filter((e) => daysFromToday(e.date) >= 0);
    const past = events.filter((e) => daysFromToday(e.date) < 0).reverse();
    $('#engagements-summary').innerHTML = events.length
      ? `<strong>${plural(upcoming.length, 'upcoming engagement')}</strong>${upcoming[0] ? ` · next: ${esc(upcoming[0].title)} ${esc(relDays(upcoming[0].date).toLowerCase())}` : ''}${past.length ? ` · ${past.length} past` : ''}`
      : 'Track upcoming international keynotes, board meetings and travel.';

    if (!events.length) {
      tl.innerHTML = '';
      tl.hidden = true;
      empty.hidden = false;
      empty.innerHTML = emptyHTML('globe', 'No engagements scheduled', 'Add keynotes, board meetings, panels and travel to see them on your timeline and in your alerts.', 'engagement', 'Add event');
      return;
    }
    tl.hidden = false;
    empty.hidden = true;
    const item = (e, isPast) => {
      const d = parseDate(e.date);
      return `<article class="card event ${isPast ? 'past' : ''}" data-id="${esc(e.id)}">
        <div class="event-main">
          <div class="date-block">
            <div class="m">${d ? d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase() : '—'}</div>
            <div class="d">${d ? pad(d.getDate()) : '—'}</div>
            <div class="y">${d ? d.getFullYear() : ''}</div>
          </div>
          <div style="min-width:0">
            <h4>${esc(e.title)}</h4>
            <div class="event-meta">
              ${e.location ? `<span>${icon('map-pin', 'icon-sm')} ${esc(e.location)}</span>` : ''}
              ${e.time ? `<span>${icon('clock', 'icon-sm')} ${esc(fmtTime(e.time))}</span>` : ''}
              <span>${icon('calendar', 'icon-sm')} ${esc(fmtDate(e.date, { weekday: 'short', month: 'short', day: 'numeric' }))}</span>
            </div>
            <div class="event-tags"><span class="chip chip-gold">${esc(e.type)}</span><span class="rel">${esc(relDays(e.date))}</span></div>
          </div>
        </div>
        <div class="row-actions">
          <button class="btn btn-icon sm" type="button" data-edit="engagement" data-id="${esc(e.id)}" title="Edit" aria-label="Edit">${icon('pencil')}</button>
          <button class="btn btn-icon sm danger" type="button" data-delete="engagement" data-id="${esc(e.id)}" title="Delete" aria-label="Delete">${icon('trash-2')}</button>
        </div>
      </article>`;
    };
    let html = '';
    if (upcoming.length) html += `<div class="timeline-group">Upcoming</div>` + upcoming.map((e) => item(e, false)).join('');
    else html += `<div class="timeline-group">Nothing upcoming</div>`;
    if (past.length) html += `<div class="timeline-group">Past</div>` + past.map((e) => item(e, true)).join('');
    tl.innerHTML = html;
  }

  /* ---------------------------------------------------------------------
     Charts (Chart.js, themed from CSS tokens)
  --------------------------------------------------------------------- */
  function chartTheme() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    return { c1: v('--chart-1'), c2: v('--chart-2'), grid: v('--chart-grid'), text: v('--chart-text'), ink: v('--text'), surface: v('--surface-raised'), border: v('--border-strong') };
  }

  const valueLabels = {
    id: 'valueLabels',
    afterDatasetsDraw(chart, _args, opts) {
      if (!opts || !opts.enabled) return;
      const { ctx } = chart;
      ctx.save();
      ctx.font = `600 11px ${Chart.defaults.font.family}`;
      ctx.fillStyle = opts.color;
      chart.data.datasets.forEach((ds, i) => {
        const meta = chart.getDatasetMeta(i);
        if (meta.hidden) return;
        meta.data.forEach((bar, j) => {
          const v = ds.data[j];
          if (v == null || v === 0) return;
          const text = opts.format ? opts.format(v) : String(v);
          if (chart.options.indexAxis === 'y') { ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, bar.x + 6, bar.y); }
          else { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(text, bar.x, bar.y - 4); }
        });
      });
      ctx.restore();
    }
  };

  function destroyChart(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }

  function baseOptions(t) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: t.surface, titleColor: t.ink, bodyColor: t.text, borderColor: t.border, borderWidth: 1,
          cornerRadius: 8, padding: 10, displayColors: true, boxPadding: 4, usePointStyle: false
        }
      }
    };
  }

  function makeBars(id, labels, data, { horizontal, format }) {
    destroyChart(id);
    const canvas = document.getElementById(id);
    if (!canvas || !labels.length) return;
    const t = chartTheme();
    const opts = baseOptions(t);
    opts.indexAxis = horizontal ? 'y' : 'x';
    opts.layout = { padding: horizontal ? { right: 48 } : { top: 20 } };
    opts.plugins.valueLabels = { enabled: true, color: t.text, format };
    opts.plugins.tooltip.callbacks = { label: (c) => ` ${format ? format(c.raw) : c.raw}` };
    const valueAxis = { beginAtZero: true, grid: { color: t.grid, drawTicks: false }, border: { display: false }, ticks: { color: t.text, precision: 0, maxTicksLimit: 6, padding: 6 } };
    const catAxis = { grid: { display: false }, border: { display: false }, ticks: { color: t.text, autoSkip: false, callback(v) { const l = this.getLabelForValue(v); return l.length > 26 ? l.slice(0, 25) + '…' : l; } } };
    opts.scales = horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis };
    charts[id] = new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets: [{ data, backgroundColor: hexToRgba(t.c1, 0.85), hoverBackgroundColor: t.c1, borderRadius: 4, borderSkipped: 'start', maxBarThickness: horizontal ? 18 : 22, categoryPercentage: 0.62, barPercentage: 1 }] },
      options: opts,
      plugins: [valueLabels]
    });
  }

  function makeStackedWeeks(id, b) {
    destroyChart(id);
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const t = chartTheme();
    const opts = baseOptions(t);
    opts.plugins.legend = { display: true, position: 'top', align: 'end', labels: { color: t.text, boxWidth: 10, boxHeight: 10, borderRadius: 2, useBorderRadius: true, padding: 14, font: { size: 11 } } };
    opts.plugins.tooltip.mode = 'index';
    opts.plugins.tooltip.callbacks = { title: (items) => (items.length ? b.ranges[items[0].dataIndex] : '') };
    opts.interaction = { mode: 'index', intersect: false };
    opts.scales = {
      x: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { color: t.text, font: { size: 11 }, maxRotation: 0, autoSkip: true } },
      y: { stacked: true, beginAtZero: true, grace: '15%', grid: { color: t.grid, drawTicks: false }, border: { display: false }, ticks: { color: t.text, precision: 0, maxTicksLimit: 5, padding: 6 } }
    };
    const common = { maxBarThickness: 24, categoryPercentage: 0.55, barPercentage: 1, borderWidth: 0, borderSkipped: 'middle', borderRadius: { topLeft: 4, topRight: 4 } };
    charts[id] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: b.labels,
        datasets: [
          { label: 'Tasks due', data: b.tasks, backgroundColor: hexToRgba(t.c1, 0.85), hoverBackgroundColor: t.c1, ...common },
          { label: 'Engagements', data: b.events, backgroundColor: hexToRgba(t.c2, 0.9), hoverBackgroundColor: t.c2, ...common }
        ]
      },
      options: opts
    });
  }

  /* ---------------------------------------------------------------------
     Alerts (bell popover)
  --------------------------------------------------------------------- */
  function computeAlerts() {
    const out = [];
    state.tasks.filter((t) => t.status !== 'Completed' && t.deadline).forEach((t) => {
      const n = daysFromToday(t.deadline);
      if (n < 0) out.push({ level: 'danger', ic: 'circle-alert', title: t.task, sub: `${t.assignee} · ${relDays(t.deadline)}`, view: 'delegation', kind: 'task', id: t.id, order: n });
      else if (n <= 7) out.push({ level: 'warning', ic: 'clock', title: t.task, sub: `${t.assignee} · due ${relDays(t.deadline).toLowerCase()}`, view: 'delegation', kind: 'task', id: t.id, order: 100 + n });
    });
    state.engagements.forEach((e) => {
      const n = daysFromToday(e.date);
      if (n !== null && n >= 0 && n <= 14) out.push({ level: 'gold', ic: 'calendar', title: e.title, sub: `${e.location ? e.location + ' · ' : ''}${relDays(e.date)}${e.time ? ' · ' + fmtTime(e.time) : ''}`, view: 'engagements', kind: 'engagement', id: e.id, order: 200 + n });
    });
    state.projects.filter((p) => p.status === 'At Risk').forEach((p) => {
      out.push({ level: 'warning', ic: 'triangle-alert', title: `${p.name} is at risk`, sub: `${fmtMoney(p.budget)} budget · ${p.progress}% complete`, view: 'portfolio', kind: 'project', id: p.id, order: 300 });
    });
    return out.sort((a, b) => a.order - b.order);
  }

  function updateAlerts() {
    const alerts = computeAlerts();
    const badge = $('#alerts-badge');
    badge.hidden = alerts.length === 0;
    badge.textContent = alerts.length > 99 ? '99+' : String(alerts.length);
    $('#alerts-btn').title = alerts.length ? `${plural(alerts.length, 'item')} need attention` : 'Alerts — all clear';
    $('#alerts-count').textContent = alerts.length ? plural(alerts.length, 'item') : '';
    const list = $('#alerts-list');
    list.innerHTML = alerts.length
      ? alerts.map((a) => `<button class="alert-row" type="button" data-edit="${a.kind}" data-id="${esc(a.id)}"><span class="dot ${a.level}">${icon(a.ic, 'icon-sm')}</span><div><div class="t">${esc(a.title)}</div><div class="s">${esc(a.sub)}</div></div></button>`).join('')
      : `<div class="empty">${icon('check-check', 'icon-xl')}<h4>All clear</h4><p>No overdue tasks, nothing due this week and no engagements in the next 14 days.</p></div>`;
  }

  function toggleAlerts(force) {
    const pop = $('#alerts-popover');
    const show = force !== undefined ? force : pop.hidden;
    pop.hidden = !show;
    $('#alerts-btn').setAttribute('aria-expanded', String(show));
  }

  /* ---------------------------------------------------------------------
     Record dialog (add / edit)
  --------------------------------------------------------------------- */
  const recordDialog = $('#record-dialog');
  const recordForm = $('#record-form');
  let recordCtx = { kind: 'project', id: null };

  const collection = (kind) => ({ project: state.projects, task: state.tasks, engagement: state.engagements }[kind]);
  const findRecord = (kind, id) => collection(kind).find((r) => r.id === id) || null;
  const selectHTML = (id, label, options, value) => `<div class="field"><label for="${id}">${label}</label><select class="input" id="${id}">${options.map((o) => `<option value="${esc(o)}" ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
  const inputHTML = (id, label, type, value, attrs = '') => `<div class="field"><label for="${id}">${label}</label><input class="input" id="${id}" type="${type}" value="${esc(value)}" ${attrs}></div>`;

  function openRecord(kind, id = null) {
    const rec = id ? findRecord(kind, id) : null;
    recordCtx = { kind, id: rec ? rec.id : null };
    const editing = !!rec;
    const fields = $('#record-fields');
    const d7 = localISO(addDays(new Date(), 7));
    let title = '';
    if (kind === 'project') {
      title = editing ? 'Edit Project' : 'Add Strategic Project';
      fields.innerHTML = `
        ${inputHTML('f-name', 'Project name', 'text', rec ? rec.name : '', 'required maxlength="120" placeholder="e.g. EMEA Expansion Strategy" autocomplete="off"')}
        <div class="field-row">
          ${selectHTML('f-type', 'Type', PROJECT_TYPES, rec ? rec.type : 'Project')}
          ${inputHTML('f-budget', 'Budget ($M)', 'number', rec ? rec.budget : '', 'required min="0" step="0.1" placeholder="0.0" inputmode="decimal"')}
        </div>
        <div class="field-row">
          ${selectHTML('f-status', 'Status', PROJECT_STATUSES, rec ? rec.status : 'On Track')}
          <div class="field"><label for="f-progress">Progress</label><div class="range-wrap"><input type="range" id="f-progress" min="0" max="100" step="5" value="${rec ? rec.progress : 0}"><output for="f-progress" id="f-progress-out">${rec ? rec.progress : 0}%</output></div></div>
        </div>
        <p class="error-msg" id="f-error"></p>`;
    } else if (kind === 'task') {
      title = editing ? 'Edit Task' : 'Delegate Task';
      const names = [...new Set(state.tasks.map((t) => t.assignee).filter(Boolean))];
      fields.innerHTML = `
        ${inputHTML('f-task', 'Task / work package', 'text', rec ? rec.task : '', 'required maxlength="160" placeholder="e.g. Prepare Q4 board deck" autocomplete="off"')}
        <div class="field"><label for="f-assignee">Assignee</label><input class="input" id="f-assignee" type="text" list="assignee-list" value="${esc(rec ? rec.assignee : '')}" required maxlength="80" placeholder="e.g. Legal Dept, Sarah J. (EA)" autocomplete="off"><datalist id="assignee-list">${names.map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist></div>
        <div class="field-row">
          ${selectHTML('f-priority', 'Priority', PRIORITIES, rec ? rec.priority : 'Normal')}
          ${inputHTML('f-deadline', 'Deadline', 'date', rec ? rec.deadline : d7, 'required')}
        </div>
        ${selectHTML('f-tstatus', 'Status', TASK_STATUSES, rec ? rec.status : 'Pending')}
        <p class="error-msg" id="f-error"></p>`;
    } else {
      title = editing ? 'Edit Engagement' : 'Add Global Engagement';
      fields.innerHTML = `
        ${inputHTML('f-title', 'Event title', 'text', rec ? rec.title : '', 'required maxlength="120" placeholder="e.g. World Economic Summit keynote" autocomplete="off"')}
        <div class="field-row">
          ${selectHTML('f-etype', 'Type', EVENT_TYPES, rec ? rec.type : 'Meeting')}
          ${inputHTML('f-location', 'Location', 'text', rec ? rec.location : '', 'maxlength="120" placeholder="City, country or venue" autocomplete="off"')}
        </div>
        <div class="field-row">
          ${inputHTML('f-date', 'Date', 'date', rec ? rec.date : d7, 'required')}
          ${inputHTML('f-time', 'Time', 'time', rec ? rec.time : '09:00', '')}
        </div>
        <p class="error-msg" id="f-error"></p>`;
    }
    $('#record-title').textContent = title;
    $('#record-submit').textContent = editing ? 'Save changes' : (kind === 'task' ? 'Delegate' : 'Add');
    const range = $('#f-progress');
    if (range) range.addEventListener('input', () => { $('#f-progress-out').textContent = `${range.value}%`; });
    recordDialog.showModal();
    const first = fields.querySelector('input, select');
    if (first) { first.focus(); if (first.type === 'text') first.select(); }
  }

  function showFieldError(msg, el) {
    const err = $('#f-error');
    err.textContent = msg; err.classList.add('show');
    if (el) el.focus();
  }

  recordForm.addEventListener('submit', (e) => {
    const { kind, id } = recordCtx;
    $('#f-error').classList.remove('show');
    const val = (sel) => $(sel).value.trim();
    if (kind === 'project') {
      const name = val('#f-name'); const budget = parseFloat(val('#f-budget'));
      if (!name) return e.preventDefault(), showFieldError('Please enter a project name.', $('#f-name'));
      if (!Number.isFinite(budget) || budget < 0) return e.preventDefault(), showFieldError('Please enter a valid budget (0 or more).', $('#f-budget'));
      const data = { name, type: val('#f-type'), budget, status: val('#f-status'), progress: parseInt($('#f-progress').value, 10) };
      upsert('project', id, data);
    } else if (kind === 'task') {
      const task = val('#f-task'); const assignee = val('#f-assignee'); const deadline = val('#f-deadline');
      if (!task) return e.preventDefault(), showFieldError('Please describe the task.', $('#f-task'));
      if (!assignee) return e.preventDefault(), showFieldError('Please name the assignee.', $('#f-assignee'));
      if (!parseDate(deadline)) return e.preventDefault(), showFieldError('Please choose a deadline.', $('#f-deadline'));
      upsert('task', id, { task, assignee, priority: val('#f-priority'), deadline, status: val('#f-tstatus') });
    } else {
      const title = val('#f-title'); const date = val('#f-date');
      if (!title) return e.preventDefault(), showFieldError('Please enter the event title.', $('#f-title'));
      if (!parseDate(date)) return e.preventDefault(), showFieldError('Please choose a date.', $('#f-date'));
      upsert('engagement', id, { title, type: val('#f-etype'), location: val('#f-location'), date, time: val('#f-time') });
    }
  });

  function upsert(kind, id, data) {
    const norm = { project: normProject, task: normTask, engagement: normEvent }[kind];
    const label = { project: 'Project', task: 'Task', engagement: 'Engagement' }[kind];
    commit((s) => {
      const list = collection(kind);
      if (id) {
        const i = list.findIndex((r) => r.id === id);
        if (i >= 0) list[i] = norm({ ...list[i], ...data, id });
      } else {
        list.push(norm({ ...data, id: uid() }));
      }
    });
    toast(id ? `${label} updated.` : `${label} added.`, 'success');
  }

  async function removeRecord(kind, id) {
    const rec = findRecord(kind, id);
    if (!rec) return;
    const name = rec.name || rec.task || rec.title;
    const ok = await confirmDialog({ title: 'Delete this record?', message: `“${name}” will be removed permanently. This cannot be undone.`, okLabel: 'Delete', danger: true });
    if (!ok) return;
    commit(() => { const list = collection(kind); const i = list.findIndex((r) => r.id === id); if (i >= 0) list.splice(i, 1); });
    toast('Record deleted.', 'success');
  }

  function toggleTask(id) {
    const t = findRecord('task', id);
    if (!t) return;
    const done = t.status === 'Completed';
    commit(() => { t.status = done ? 'In Progress' : 'Completed'; });
    toast(done ? 'Task reopened.' : 'Task marked as completed.', 'success');
  }

  /* ---------------------------------------------------------------------
     Confirm dialog
  --------------------------------------------------------------------- */
  const confirmEl = $('#confirm-dialog');
  function confirmDialog({ title, message, okLabel = 'Confirm', danger = false, icon: ic = 'triangle-alert' }) {
    return new Promise((resolve) => {
      $('#confirm-title').textContent = title;
      $('#confirm-msg').textContent = message;
      const ok = $('#confirm-ok');
      ok.textContent = okLabel;
      ok.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
      const iconBox = $('#confirm-icon');
      iconBox.className = `confirm-icon ${danger ? '' : 'info'}`;
      iconBox.querySelector('use').setAttribute('href', `#i-${ic}`);
      const done = (v) => { cleanup(); resolve(v); if (confirmEl.open) confirmEl.close(); };
      const onOk = () => done(true); const onCancel = () => done(false); const onClose = () => done(false);
      const cleanup = () => { ok.removeEventListener('click', onOk); $('#confirm-cancel').removeEventListener('click', onCancel); confirmEl.removeEventListener('close', onClose); };
      ok.addEventListener('click', onOk); $('#confirm-cancel').addEventListener('click', onCancel); confirmEl.addEventListener('close', onClose);
      confirmEl.showModal();
      $('#confirm-cancel').focus();
    });
  }

  /* ---------------------------------------------------------------------
     Settings, profile, backup
  --------------------------------------------------------------------- */
  const settingsEl = $('#settings-dialog');
  function openSettings() {
    $$('input[name="theme"]').forEach((r) => { r.checked = r.value === state.settings.theme; });
    $('#set-name').value = state.settings.name;
    $('#set-title').value = state.settings.title;
    $('#about-version').textContent = `v${APP.version}`;
    settingsEl.showModal();
  }

  function exportBackup() {
    const payload = {
      app: APP.name, format: 1, version: APP.version, exportedAt: new Date().toISOString(),
      data: { projects: state.projects, tasks: state.tasks, engagements: state.engagements, settings: { name: state.settings.name, title: state.settings.title } }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ExecuFlow-backup-${localISO(new Date())}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Backup file created — check your Downloads folder.', 'success');
  }

  async function importBackup(file) {
    if (!file) return;
    let parsed;
    try { parsed = JSON.parse(await file.text()); } catch (e) { return toast('That file is not a valid ExecuFlow backup.', 'error'); }
    const src = parsed && parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
    const incoming = normalize(src);
    const n = incoming.projects.length + incoming.tasks.length + incoming.engagements.length;
    if (!n && !(Array.isArray(src.projects) || Array.isArray(src.portfolio) || Array.isArray(src.tasks))) return toast('That file is not a valid ExecuFlow backup.', 'error');
    const ok = await confirmDialog({
      title: 'Restore this backup?',
      message: `This replaces your current data with ${plural(incoming.projects.length, 'project')}, ${plural(incoming.tasks.length, 'task')} and ${plural(incoming.engagements.length, 'engagement')} from the backup${parsed.exportedAt ? ` (exported ${fmtDate(parsed.exportedAt)})` : ''}. A safety copy of your current data is kept until the next import.`,
      okLabel: 'Restore backup', danger: false, icon: 'database'
    });
    if (!ok) return;
    try { localStorage.setItem(APP.safetyKey, JSON.stringify(state)); } catch (e) { /* ignore */ }
    const theme = state.settings.theme;
    incoming.settings.theme = theme;
    if (!incoming.settings.name) incoming.settings.name = state.settings.name;
    if (!incoming.settings.title) incoming.settings.title = state.settings.title;
    state = incoming;
    save();
    renderProfile();
    refresh();
    if (settingsEl.open) settingsEl.close();
    toast(`Backup restored: ${plural(incoming.projects.length, 'project')}, ${plural(incoming.tasks.length, 'task')}, ${plural(incoming.engagements.length, 'engagement')}.`, 'success');
  }

  async function clearAll() {
    const ok = await confirmDialog({ title: 'Clear all data?', message: 'All projects, delegated tasks and engagements will be removed from this device. Export a backup first if you may need them again.', okLabel: 'Clear everything', danger: true });
    if (!ok) return;
    commit((s) => { s.projects = []; s.tasks = []; s.engagements = []; });
    if (settingsEl.open) settingsEl.close();
    toast('All data cleared.', 'success');
  }

  async function loadSample() {
    const ok = await confirmDialog({ title: 'Load sample data?', message: 'Sample projects, tasks and engagements will be added alongside your existing records so you can explore the app. You can delete them at any time.', okLabel: 'Load sample', danger: false, icon: 'sparkles' });
    if (!ok) return;
    const smp = normalize(sampleData());
    commit((s) => { s.projects.push(...smp.projects); s.tasks.push(...smp.tasks); s.engagements.push(...smp.engagements); });
    if (settingsEl.open) settingsEl.close();
    toast('Sample data loaded.', 'success');
  }

  /* ---------------------------------------------------------------------
     Toasts
  --------------------------------------------------------------------- */
  function toast(msg, type = 'info', action = null) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const ic = type === 'success' ? 'circle-check' : type === 'error' ? 'circle-alert' : type === 'warning' ? 'triangle-alert' : 'info';
    el.innerHTML = `${icon(ic)}<span>${esc(msg)}</span>`;
    if (action) {
      const b = document.createElement('button');
      b.className = 'btn-link'; b.type = 'button'; b.textContent = action.label;
      b.addEventListener('click', () => { action.run(); dismiss(); });
      el.appendChild(b);
    }
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    let timer = setTimeout(dismiss, action ? 9000 : 3200);
    function dismiss() { clearTimeout(timer); el.classList.add('hide'); setTimeout(() => el.remove(), 260); }
    el.addEventListener('click', (e) => { if (!e.target.closest('.btn-link')) dismiss(); });
  }

  /* ---------------------------------------------------------------------
     Events
  --------------------------------------------------------------------- */
  function wireEvents() {
    // Global delegated clicks (navigation, add, edit, delete, toggle, close)
    document.addEventListener('click', (e) => {
      const nav = e.target.closest('[data-view], [data-nav]');
      if (nav) { navigate(nav.dataset.view || nav.dataset.nav); return; }
      const add = e.target.closest('[data-add]');
      if (add) { openRecord(add.dataset.add); return; }
      const del = e.target.closest('[data-delete]');
      if (del) { e.stopPropagation(); removeRecord(del.dataset.delete, del.dataset.id); return; }
      const tog = e.target.closest('[data-toggle]');
      if (tog) { toggleTask(tog.dataset.toggle); return; }
      const edit = e.target.closest('[data-edit]');
      if (edit) {
        if (edit.closest('#alerts-popover')) {
          toggleAlerts(false);
          navigate({ task: 'delegation', project: 'portfolio', engagement: 'engagements' }[edit.dataset.edit] || currentView);
        }
        openRecord(edit.dataset.edit, edit.dataset.id); return;
      }
      const close = e.target.closest('[data-close]');
      if (close) { const dlg = close.closest('dialog'); if (dlg) dlg.close(); return; }
      // close alerts popover on outside click
      if (!e.target.closest('#alerts-popover') && !e.target.closest('#alerts-btn')) toggleAlerts(false);
    });

    // Keyboard activation for project cards (role=button)
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.project[data-edit]')) { e.preventDefault(); openRecord('project', e.target.dataset.id); }
    });

    $('#menu-btn').addEventListener('click', openSidebar);
    $('#sidebar-close').addEventListener('click', closeSidebar);
    $('#scrim').addEventListener('click', closeSidebar);
    $('#theme-btn').addEventListener('click', cycleTheme);
    $('#alerts-btn').addEventListener('click', () => toggleAlerts());
    $('#settings-btn').addEventListener('click', openSettings);
    $('#profile-btn').addEventListener('click', () => { openSettings(); setTimeout(() => $('#set-name').focus(), 50); });

    $$('input[name="theme"]').forEach((r) => r.addEventListener('change', () => { state.settings.theme = r.value; save(); applyTheme(); }));
    let profileTimer;
    ['#set-name', '#set-title'].forEach((sel) => $(sel).addEventListener('input', () => {
      clearTimeout(profileTimer);
      profileTimer = setTimeout(() => { state.settings.name = str($('#set-name').value, 60); state.settings.title = str($('#set-title').value, 60); save(); renderProfile(); }, 300);
    }));
    $('#export-btn').addEventListener('click', exportBackup);
    $('#import-btn').addEventListener('click', () => $('#import-file').click());
    $('#import-file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; importBackup(f); });
    $('#sample-btn').addEventListener('click', loadSample);
    $('#clear-btn').addEventListener('click', clearAll);

    // Dialog hygiene: reset form on close
    recordDialog.addEventListener('close', () => { recordForm.reset(); $('#record-fields').innerHTML = ''; });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if ($$('dialog[open]').length) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && /^[1-5]$/.test(e.key)) { e.preventDefault(); navigate(Object.keys(VIEWS)[+e.key - 1]); }
      else if (ctrl && e.key.toLowerCase() === 'n') { const add = VIEWS[currentView].add; if (add) { e.preventDefault(); openRecord(add); } }
      else if (ctrl && e.key.toLowerCase() === 'e') { e.preventDefault(); exportBackup(); }
      else if (e.key === 'Escape') { toggleAlerts(false); closeSidebar(); }
    });

    // Every change is written to storage immediately (see commit/save), so nothing
    // is lost when the window closes. If the page comes back from the browser's
    // back/forward cache, re-read storage in case another window changed it.
    window.addEventListener('pageshow', (e) => { if (e.persisted) { load(); renderProfile(); applyTheme(false); refresh(); } });

    // Another window of the app changed the data → reload it here
    window.addEventListener('storage', (e) => { if (e.key === APP.storageKey && e.newValue) { try { state = normalize(JSON.parse(e.newValue)); renderProfile(); applyTheme(false); refresh(); } catch (err) { /* ignore */ } } });
  }

  /* ---------------------------------------------------------------------
     Service worker (offline + update notice)
  --------------------------------------------------------------------- */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (!(location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              toast('A new version of ExecuFlow is ready.', 'info', { label: 'Restart now', run: () => { nw.postMessage({ type: 'SKIP_WAITING' }); } });
            }
          });
        });
      }).catch((err) => console.warn('Service worker registration failed', err));
      // Reload only when an *update* takes control (not on the very first install).
      let hadController = !!navigator.serviceWorker.controller;
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) { hadController = true; return; }
        if (refreshing) return;
        refreshing = true;
        location.reload();
      });
    });
  }

  /* ---------------------------------------------------------------------
     Boot
  --------------------------------------------------------------------- */
  function init() {
    Chart.defaults.font.family = getComputedStyle(document.documentElement).getPropertyValue('--font').trim() || 'Segoe UI, sans-serif';
    Chart.defaults.font.size = 12;
    load();
    renderProfile();
    applyTheme(false);
    updateHeaderDate();
    setInterval(updateHeaderDate, 30000);
    wireEvents();
    // Start view: ?view= (app shortcuts) wins, otherwise the last view used
    let startView = new URLSearchParams(location.search).get('view') || '';
    if (!VIEWS[startView]) { try { startView = localStorage.getItem(APP.viewKey) || 'dashboard'; } catch (e) { startView = 'dashboard'; } }
    if (location.search) history.replaceState(null, '', location.pathname);
    navigate(VIEWS[startView] ? startView : 'dashboard');
    updateAlerts();
    registerServiceWorker();
    // Re-evaluate relative dates when the day changes while the app stays open
    setInterval(() => { if (localISO(new Date()) !== lastDay) { lastDay = localISO(new Date()); refresh(); } }, 60000);
  }
  let lastDay = localISO(new Date());

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
