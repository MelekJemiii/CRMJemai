(function () {
  'use strict';
  const C = window.LeadCore;
  const S = window.LeadStore;
  const $app = document.getElementById('app');
  const $overlay = document.getElementById('overlay-root');
  const $file = document.getElementById('csv-file');
  const PAGE = 200;
  // Present only inside the Windows app: controls for the WhatsApp Web side panel.
  const desktop = window.leadHubDesktop && window.leadHubDesktop.whatsapp ? window.leadHubDesktop.whatsapp : null;
  const wa = { open: false, width: 0 };

  const state = {
    store: null, client: null, user: null,
    projects: [], leads: [],
    view: 'dashboard', // 'dashboard' or a project id
    filters: { q: '', status: '', priority: '' },
    selected: null, limit: PAGE,
    lastSync: 0, syncError: '',
  };

  // ---------- tiny DOM helpers ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  }
  function clear(el) {
    el.textContent = '';
    return el;
  }
  function field(label, control) {
    return h('label', { class: 'field' }, h('span', { text: label }), control);
  }
  function select(options, value, onchange, cls) {
    const el = h('select', { class: cls || 'input', onchange: (e) => onchange(e.target.value) });
    for (const [val, label] of options) el.append(h('option', { value: val, text: label }));
    el.value = value;
    return el;
  }

  let toastTimer = null;
  function toast(message) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const el = h('div', { class: 'toast', role: 'status', text: message });
    document.body.append(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 3500);
  }

  function modal({ title, message, input, confirmLabel, danger, cancelLabel, extra }) {
    return new Promise((resolve) => {
      const inputEl = input ? h('input', { class: 'input', value: input.value || '', placeholder: input.placeholder || '', maxlength: '80' }) : null;
      const close = (result) => {
        backdrop.remove();
        resolve(result);
      };
      const ok = () => close(inputEl ? inputEl.value.trim() : true);
      const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
        h('h2', { text: title }),
        message ? h('p', { text: message }) : null,
        inputEl,
        extra || null,
        h('div', { class: 'row' },
          cancelLabel === null ? null : h('button', { class: 'btn', text: cancelLabel || 'Cancel', onclick: () => close(null) }),
          h('button', { class: 'btn primary' + (danger ? ' danger-fill' : ''), text: confirmLabel || 'OK', onclick: ok })));
      const backdrop = h('div', { class: 'modal-backdrop', onclick: (e) => e.target === backdrop && close(null) }, box);
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close(null);
        if (e.key === 'Enter' && inputEl && e.target === inputEl) ok();
      });
      $overlay.append(backdrop);
      (inputEl || box.querySelector('.btn.primary')).focus();
    });
  }

  // ---------- data ----------
  function currentProject() {
    return state.projects.find((p) => p.id === state.view) || null;
  }
  function projectLeads(id) {
    return state.leads.filter((l) => l.project_id === id);
  }

  async function refresh(silent) {
    if (!state.store) return;
    try {
      const data = await state.store.getAll();
      state.projects = data.projects;
      state.leads = data.leads;
      state.lastSync = Date.now();
      state.syncError = '';
      if (state.view !== 'dashboard' && !currentProject()) state.view = 'dashboard';
      if (state.selected && !state.leads.some((l) => l.id === state.selected)) state.selected = null;
    } catch (e) {
      state.syncError = e.message || 'Sync failed';
      if (!silent) toast('Could not sync: ' + state.syncError);
    }
    renderShell();
  }

  async function run(action, failMessage) {
    try {
      return await action();
    } catch (e) {
      toast((failMessage || 'Something went wrong') + ': ' + (e.message || e));
      await refresh(true);
      return undefined;
    }
  }

  // ---------- welcome / login ----------
  function renderWelcome(error) {
    const url = h('input', { class: 'input', placeholder: 'https://xxxx.supabase.co', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const key = h('input', { class: 'input', placeholder: 'anon public key', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const err = h('div', { class: 'form-error', text: error || '' });
    clear($app).append(h('div', { class: 'center' }, h('div', { class: 'panel' },
      h('h1', { text: 'Lead Hub' }),
      h('p', { text: 'Connect your Supabase project to sync leads between your devices.' }),
      field('Project URL', url),
      field('Anon public key', key),
      err,
      h('button', { class: 'btn primary', text: 'Connect', onclick: () => {
        if (!S.validConnection(url.value.trim(), key.value.trim())) {
          err.textContent = 'Enter the https project URL and the anon public key from Supabase.';
          return;
        }
        S.saveConnection(url.value.trim(), key.value.trim());
        S.setMode('cloud');
        boot();
      } }),
      h('div', { class: 'divider', text: 'or' }),
      h('button', { class: 'btn', text: 'Use on this device only', onclick: () => {
        S.setMode('local');
        boot();
      } }),
      h('p', { text: 'Device-only mode keeps leads in this app and does not sync.' }))));
  }

  function renderLogin(message) {
    const email = h('input', { class: 'input', type: 'email', placeholder: 'you@example.com', autocomplete: 'username', autocapitalize: 'off' });
    const pass = h('input', { class: 'input', type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
    const err = h('div', { class: 'form-error', text: message || '' });
    const busy = (on) => $app.querySelectorAll('button').forEach((b) => (b.disabled = on));
    async function go(kind) {
      err.textContent = '';
      if (!email.value.trim() || pass.value.length < 6) {
        err.textContent = 'Enter your email and a password of at least 6 characters.';
        return;
      }
      busy(true);
      try {
        const creds = { email: email.value.trim(), password: pass.value };
        const res = kind === 'in' ? await state.client.auth.signInWithPassword(creds) : await state.client.auth.signUp(creds);
        if (res.error) throw res.error;
        if (!res.data.session) {
          err.textContent = 'Account created. Confirm it from the email Supabase sent you, then sign in.';
          busy(false);
          return;
        }
        boot();
      } catch (e) {
        err.textContent = e.message || 'Sign in failed.';
        busy(false);
      }
    }
    pass.addEventListener('keydown', (e) => e.key === 'Enter' && go('in'));
    const conn = S.getConnection();
    clear($app).append(h('div', { class: 'center' }, h('div', { class: 'panel' },
      h('h1', { text: 'Sign in' }),
      h('p', { text: 'Use the same account on every device to see the same leads.' }),
      field('Email', email),
      field('Password', pass),
      err,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', text: 'Sign in', onclick: () => go('in') }),
        h('button', { class: 'btn', text: 'Create account', onclick: () => go('up') })),
      conn && conn.baked ? null : h('button', { class: 'btn ghost', text: 'Change connection', onclick: () => {
        S.clearConnection();
        S.setMode('');
        boot();
      } }))));
  }

  // ---------- shell ----------
  function renderShell() {
    const shell = h('div', { class: 'shell' }, buildSidebar(), h('main', { class: 'main', id: 'main' }));
    clear($app).append(shell);
    renderMain();
    renderDrawer();
  }

  function go(view) {
    state.view = view;
    state.selected = null;
    state.limit = PAGE;
    state.filters = { q: '', status: '', priority: '' };
    renderShell();
  }

  function buildSidebar() {
    const item = (label, view, count) => h('button', { class: 'nav-item' + (state.view === view ? ' active' : ''), onclick: () => go(view) },
      h('span', { class: 'label', dir: 'auto', text: label }),
      count == null ? null : h('span', { class: 'count', text: String(count) }));
    const cloud = state.store.kind === 'cloud';
    const status = state.syncError ? 'Sync problem' : cloud ? 'Synced' : 'This device only';
    return h('nav', { class: 'sidebar', 'aria-label': 'Projects' },
      h('div', { class: 'brand', text: 'Lead Hub' }),
      h('div', { class: 'nav-list' }, item('Dashboard', 'dashboard')),
      h('div', { class: 'nav-label', text: 'Projects' }),
      h('div', { class: 'nav-list' },
        state.projects.map((p) => item(p.name, p.id, projectLeads(p.id).length)),
        h('button', { class: 'nav-item add', onclick: addProject }, h('span', { class: 'label', text: '+ New project' }))),
      h('div', { class: 'sidebar-foot' },
        h('div', { class: 'who' }, h('span', { class: 'dot' + (state.syncError ? ' err' : cloud ? '' : ' off') }), status + (cloud && state.user ? ' · ' + state.user.email : '')),
        h('div', { class: 'row' },
          desktop ? h('button', { class: 'btn small', text: wa.open ? 'Hide WhatsApp' : 'WhatsApp', onclick: () => desktop.toggle() }) : null,
          cloud ? h('button', { class: 'btn small', text: 'Refresh', onclick: () => refresh(false) }) : null,
          h('button', { class: 'btn small', text: 'Mockups', title: 'JemaiStudio mockup settings', onclick: () => mockupSettings() }),
          h('button', { class: 'btn small', text: cloud ? 'Sign out' : 'Switch to sync', onclick: leave }))));
  }

  async function leave() {
    const cloud = state.store.kind === 'cloud';
    const ok = await modal({
      title: cloud ? 'Sign out?' : 'Switch to sync?',
      message: cloud ? 'Your leads stay in the cloud. Sign in again to see them.' : 'Leads saved in device-only mode stay on this device. Export them as CSV first if you want them in your synced account.',
      confirmLabel: cloud ? 'Sign out' : 'Continue',
    });
    if (!ok) return;
    if (cloud) await state.client.auth.signOut().catch(() => {});
    else S.setMode('');
    boot();
  }

  async function addProject() {
    const name = await modal({ title: 'New project', input: { placeholder: 'Project name' }, confirmLabel: 'Create' });
    if (!name) return;
    const p = await run(() => state.store.addProject(name), 'Could not create the project');
    if (!p) return;
    state.projects.push(p);
    go(p.id);
  }

  // ---------- main area ----------
  function renderMain() {
    const main = clear(document.getElementById('main'));
    if (state.view === 'dashboard') main.append(...buildDashboard());
    else {
      main.append(...buildProject(currentProject()));
      renderList();
    }
  }

  function buildDashboard() {
    const { all, projects } = C.computeStats(state.projects, state.leads);
    const stat = (name, value) => h('div', { class: 'card stat' }, h('div', { class: 'value', text: String(value) }), h('div', { class: 'name', text: name }));
    const head = h('div', { class: 'page-head' }, h('div', {}, h('h1', { text: 'Dashboard' }), h('div', { class: 'sub', text: state.projects.length + (state.projects.length === 1 ? ' project' : ' projects') })));
    if (!state.projects.length) {
      return [head, h('div', { class: 'card empty' }, h('h2', { text: 'No projects yet' }), h('p', { text: 'Create a project, then add leads or import a CSV file.' }), h('button', { class: 'btn primary', text: 'New project', onclick: addProject }))];
    }
    const bars = C.STATUSES.map((s) => {
      const n = all.byStatus[s];
      const fill = h('div', { class: 'bar-fill' });
      fill.style.width = (all.total ? Math.round((n / all.total) * 100) : 0) + '%';
      return h('div', { class: 'bar-row' }, h('div', { text: s }), h('div', { class: 'bar-track' }, fill), h('div', { class: 'num', text: String(n) }));
    });
    const cards = projects.map(({ project, stats }) => {
      const fill = h('div', { class: 'bar-fill' });
      fill.style.width = (stats.total ? Math.round((stats.contacted / stats.total) * 100) : 0) + '%';
      return h('button', { class: 'card project-card', onclick: () => go(project.id) },
        h('div', { class: 'title', dir: 'auto', text: project.name }),
        h('div', { class: 'bar-track' }, fill),
        h('div', { class: 'meta' }, h('span', { text: stats.contacted + ' of ' + stats.total + ' contacted' }), h('span', { text: stats.won + ' won' })));
    });
    return [
      head,
      h('div', { class: 'stats' }, stat('Total leads', all.total), stat('Contacted', all.contacted), stat('Reply rate', all.replyRate + '%'), stat('Won', all.won)),
      h('div', { class: 'section-title', text: 'Pipeline' }),
      h('div', { class: 'card pipeline' }, bars),
      h('div', { class: 'section-title', text: 'Projects' }),
      h('div', { class: 'project-grid' }, cards),
    ];
  }

  function buildProject(project) {
    const total = projectLeads(project.id).length;
    const search = h('input', { class: 'input search', type: 'search', placeholder: 'Search leads', value: state.filters.q, 'aria-label': 'Search leads', oninput: (e) => {
      state.filters.q = e.target.value;
      state.limit = PAGE;
      renderList();
    } });
    const setFilter = (k) => (v) => {
      state.filters[k] = v;
      state.limit = PAGE;
      renderList();
    };
    return [
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', { dir: 'auto', text: project.name }), h('div', { class: 'sub', text: total + (total === 1 ? ' lead' : ' leads') })),
        h('div', { class: 'actions' },
          h('button', { class: 'btn primary', text: 'Add lead', onclick: addLead }),
          h('button', { class: 'btn', text: 'Import CSV', onclick: () => $file.click() }),
          h('button', { class: 'btn', text: 'Export CSV', onclick: exportCsv }),
          h('button', { class: 'btn', text: 'Message', onclick: editTemplate }),
          h('button', { class: 'btn', text: 'Rename', onclick: renameProject }),
          h('button', { class: 'btn danger', text: 'Delete', onclick: deleteProject }))),
      h('div', { class: 'toolbar' },
        search,
        select([['', 'All statuses'], ...C.STATUSES.map((s) => [s, s])], state.filters.status, setFilter('status')),
        select([['', 'All priorities'], ...C.PRIORITIES.map((p) => [p, 'Priority ' + p])], state.filters.priority, setFilter('priority'))),
      h('div', { id: 'list' }),
    ];
  }

  function renderList() {
    const holder = document.getElementById('list');
    const project = currentProject();
    if (!holder || !project) return;
    const all = projectLeads(project.id);
    const rows = C.sortLeads(C.filterLeads(all, state.filters));
    clear(holder);
    if (!all.length) {
      holder.append(h('div', { class: 'card empty' }, h('h2', { text: 'No leads in this project' }), h('p', { text: 'Add one by hand or import a CSV file.' })));
      return;
    }
    if (!rows.length) {
      holder.append(h('div', { class: 'card empty' }, h('p', { text: 'No leads match your search or filters.' })));
      return;
    }
    const list = h('div', { class: 'list' });
    for (const lead of rows.slice(0, state.limit)) {
      const statusSel = select(C.STATUSES.map((s) => [s, s]), lead.status, (v) => patchLead(lead.id, { status: v }, true), 'input status-select');
      statusSel.setAttribute('aria-label', 'Status');
      statusSel.addEventListener('click', (e) => e.stopPropagation());
      list.append(h('div', { class: 'lead-row' + (state.selected === lead.id ? ' selected' : ''), onclick: () => openLead(lead.id) },
        h('div', { class: 'lead-main' },
          h('div', { class: 'lead-name', dir: 'auto', text: lead.name }),
          h('div', { class: 'lead-sub', dir: 'auto', text: [lead.category, lead.phone].filter(Boolean).join(' · ') || 'No details yet' })),
        h('div', {}, lead.priority ? h('span', { class: 'badge ' + lead.priority, text: lead.priority }) : null),
        h('div', { class: 'status-cell' }, statusSel)));
    }
    if (rows.length > state.limit) {
      list.append(h('div', { class: 'list-foot' }, h('button', { class: 'btn small', text: 'Show more (' + (rows.length - state.limit) + ' left)', onclick: () => {
        state.limit += PAGE;
        renderList();
      } })));
    }
    holder.append(list, h('div', { class: 'list-foot', text: rows.length === all.length ? rows.length + ' leads' : rows.length + ' of ' + all.length + ' leads' }));
  }

  // ---------- lead actions ----------
  function openLead(id) {
    state.selected = id;
    renderList();
    renderDrawer();
  }
  function closeLead() {
    state.selected = null;
    renderList();
    renderDrawer();
  }

  async function patchLead(id, patch, rerenderList) {
    const lead = state.leads.find((l) => l.id === id);
    if (!lead) return;
    Object.assign(lead, patch);
    if (rerenderList) renderList();
    refreshSidebarCounts();
    await run(() => state.store.updateLead(id, patch), 'Could not save');
  }

  function refreshSidebarCounts() {
    const old = document.querySelector('.sidebar');
    if (old) old.replaceWith(buildSidebar());
  }

  async function addLead() {
    const project = currentProject();
    const name = await modal({ title: 'New lead', input: { placeholder: 'Business or contact name' }, confirmLabel: 'Add' });
    if (!name || !project) return;
    const saved = await run(() => state.store.addLeads(project.id, [C.cleanLead({ name })]), 'Could not add the lead');
    if (!saved) return;
    state.leads.push(...saved);
    renderShell();
    openLead(saved[0].id);
  }

  async function renameProject() {
    const project = currentProject();
    const name = await modal({ title: 'Rename project', input: { value: project.name }, confirmLabel: 'Save' });
    if (!name || name === project.name) return;
    project.name = name;
    renderShell();
    await run(() => state.store.renameProject(project.id, name), 'Could not rename');
  }

  const TEMPLATE_SQL = "alter table public.projects add column if not exists message_template text not null default '';";

  async function editTemplate() {
    const project = currentProject();
    const area = h('textarea', { class: 'input', dir: 'auto', maxlength: '2000', placeholder: 'Hello {name}, ...', 'aria-label': 'Message template' });
    area.value = project.message_template || '';
    const pending = modal({
      title: 'WhatsApp message',
      message: 'Write it once for this project. It is filled in for each lead when you press WhatsApp, and you send it yourself.\nPlaceholders: {name}, {category}, {phone}, {address}, {mockup} (the lead\'s mockup link).',
      extra: area,
      confirmLabel: 'Save',
    });
    area.focus();
    if (!(await pending)) return;
    const value = area.value.trim();
    const previous = project.message_template || '';
    project.message_template = value;
    try {
      await state.store.setTemplate(project.id, value);
      toast(value ? 'Message saved' : 'Message cleared');
    } catch (e) {
      project.message_template = previous;
      const text = (e && e.message) || String(e);
      const missingColumn = /message_template/.test(text);
      await modal({
        title: missingColumn ? 'One database update needed' : 'Could not save the message',
        message: missingColumn ? 'In Supabase, open SQL Editor, run this line, then save the message again:\n\n' + TEMPLATE_SQL : text,
        cancelLabel: null,
      });
    }
  }

  async function deleteProject() {
    const project = currentProject();
    const n = projectLeads(project.id).length;
    const ok = await modal({ title: 'Delete "' + project.name + '"?', message: 'This permanently deletes the project and its ' + n + (n === 1 ? ' lead' : ' leads') + ' on every device. Export a CSV first if you want a copy.', confirmLabel: 'Delete project', danger: true });
    if (!ok) return;
    await run(() => state.store.deleteProject(project.id), 'Could not delete');
    state.projects = state.projects.filter((p) => p.id !== project.id);
    state.leads = state.leads.filter((l) => l.project_id !== project.id);
    go('dashboard');
  }

  // ---------- JemaiStudio mockups ----------
  // The key only makes mockups (MOCKUP_API_SECRET on Vercel). It stays on this device: never synced, never in a CSV.
  const MOCKUP_KEY = 'leadhub.mockup';
  const MOCKUP_SQL = "alter table public.leads add column if not exists mockup_url text not null default '';";
  function getMockupConn() {
    try {
      const c = JSON.parse(localStorage.getItem(MOCKUP_KEY)) || {};
      return { url: c.url || 'https://app.jemaistudio.dev', key: c.key || '' };
    } catch {
      return { url: 'https://app.jemaistudio.dev', key: '' };
    }
  }

  async function mockupSettings() {
    const conn = getMockupConn();
    const url = h('input', { class: 'input', type: 'url', value: conn.url, placeholder: 'https://app.jemaistudio.dev', spellcheck: 'false' });
    const key = h('input', { class: 'input', type: 'password', value: conn.key, placeholder: 'MOCKUP_API_SECRET', autocomplete: 'off', spellcheck: 'false' });
    const ok = await modal({
      title: 'Mockup settings',
      message: 'Lead Hub asks your JemaiStudio app to build each mockup. Paste the MOCKUP_API_SECRET you set on Vercel. It stays on this device only.',
      extra: h('div', { class: 'stack' }, field('JemaiStudio app', url), field('Mockup key', key)),
      confirmLabel: 'Save',
    });
    if (!ok) return false;
    const u = C.safeUrl(url.value.trim(), ['https:']);
    if (!u) {
      toast('The app address must start with https://');
      return false;
    }
    localStorage.setItem(MOCKUP_KEY, JSON.stringify({ url: u.replace(/\/+$/, ''), key: key.value.trim() }));
    toast('Mockup settings saved');
    return true;
  }

  async function saveMockupLink(lead, url) {
    Object.assign(lead, { mockup_url: url });
    try {
      await state.store.updateLead(lead.id, { mockup_url: url });
      return true;
    } catch (e) {
      const text = (e && e.message) || String(e);
      await modal({
        title: /mockup_url/.test(text) ? 'One database update needed' : 'Could not save the link',
        message: /mockup_url/.test(text)
          ? 'The mockup is online, but Lead Hub could not store its link. In Supabase, open SQL Editor and run this line once:\n\n' + MOCKUP_SQL + '\n\nThe link for now: ' + url
          : text + '\n\nThe link: ' + url,
        cancelLabel: null,
      });
      return false;
    }
  }

  function mockupPanel(lead) {
    if (!getMockupConn().key) {
      mockupSettings().then((saved) => saved && getMockupConn().key && mockupPanel(lead));
      return;
    }
    const d = C.mockupDraft(lead);
    const input = (value, attrs) => h('input', Object.assign({ class: 'input', value: value || '', dir: 'auto' }, attrs || {}));
    const name = input(d.name, { maxlength: '120' });
    const city = input(d.city, { maxlength: '80' });
    const trade = input(d.trade, { maxlength: '80', placeholder: 'Plombier, fleuriste…' });
    const desc = h('textarea', { class: 'input tall', dir: 'auto', maxlength: '3000', placeholder: 'What they do, the towns they cover, reviews, opening hours… Only what you write here can appear as a fact.' });
    desc.value = d.description;
    const slug = input(d.slug, { maxlength: '55', dir: 'ltr', spellcheck: 'false' });
    const choice = (pairs) => select(pairs, 'auto', () => {});
    const mode = choice([['auto', 'Auto'], ['sombre', 'Dark'], ['clair', 'Light']]);
    const type = choice([['auto', 'Auto'], ['serif', 'Serif (elegant)'], ['moderne', 'Modern (sans)']]);
    const style = choice([['auto', 'Auto (best fit)'], ['vert', 'Courant Vert · light green'], ['lumen', 'Lumen · dark violet'], ['sos', 'SOS · urgent red'], ['volt', 'Volt · black & yellow'], ['caloria', 'Caloria · warm, form on top'], ['atelier', 'Atelier · editorial beige'], ['lefort', 'Lefort · family craft'], ['plouf', 'Plouf · friendly blue'], ['hydra', 'Hydra · night urgent'], ['durand', 'Durand · navy & copper']]);
    const linkPreview = h('p', { class: 'hint', dir: 'ltr' });
    const showLink = () => {
      const base = getMockupConn().url.replace(/\/+$/, '');
      linkPreview.textContent = lead.mockup_url ? 'Keeps its link: ' + lead.mockup_url : base + '/m/' + (C.slugify(slug.value) || C.slugify(name.value + ' ' + city.value) || '…') + '-xxxx';
    };
    slug.addEventListener('input', showLink);
    showLink();
    const statusEl = h('p', { class: 'hint', role: 'status', 'aria-live': 'polite' });
    const result = h('div', { class: 'mockup-result' });
    const genBtn = h('button', { class: 'btn primary', text: lead.mockup_url ? 'Make a new design' : 'Generate' });
    const cancel = h('button', { class: 'btn', text: 'Close' });
    let busy = null;
    const close = () => {
      if (busy) busy.abort();
      backdrop.remove();
    };
    cancel.addEventListener('click', close);

    genBtn.addEventListener('click', async () => {
      if (busy) return;
      if (name.value.trim().length < 2) return toast('Add the business name.');
      if (desc.value.trim().length < 20) return toast('Describe the business in a sentence or two.');
      const conn = getMockupConn();
      busy = new AbortController();
      const timer = setTimeout(() => busy && busy.abort(), 75000);
      const started = Date.now();
      const tick = setInterval(() => { statusEl.textContent = 'Writing and designing the page… ' + Math.round((Date.now() - started) / 1000) + ' s (usually 20–40 s)'; }, 1000);
      genBtn.disabled = true;
      genBtn.textContent = 'Generating…';
      clear(result);
      statusEl.textContent = 'Writing and designing the page…';
      try {
        const res = await fetch(conn.url.replace(/\/+$/, '') + '/api/mockups/from-description', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + conn.key },
          body: JSON.stringify({
            name: name.value.trim(), city: city.value.trim(), trade: trade.value.trim(), description: desc.value.trim(),
            phone: lead.phone || '', email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email || '') ? lead.email : '', address: lead.address || '',
            slug: C.slugify(slug.value),
            design: { mode: mode.value, type: type.value, style: style.value },
          }),
          signal: busy.signal,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.url) throw new Error(body.error || 'The app answered ' + res.status);
        const url = C.safeUrl(body.url, ['https:']);
        if (!url) throw new Error('The app returned an unexpected link.');
        statusEl.textContent = (body.upgraded ? 'New design, same link. ' : 'Mockup ready. ') + (body.what || '') + (body.notes && body.notes.length ? ' · ' + body.notes.join(' · ') : '');
        result.append(
          h('a', { class: 'mockup-link', href: url, target: '_blank', rel: 'noopener noreferrer', dir: 'ltr', text: url }),
          h('div', { class: 'row' },
            h('a', { class: 'btn small primary', href: url, target: '_blank', rel: 'noopener noreferrer', text: 'Open' }),
            h('button', { class: 'btn small', text: 'Copy link', onclick: () => navigator.clipboard.writeText(url).then(() => toast('Link copied'), () => toast('Copy failed: select the link')) })));
        if (await saveMockupLink(lead, url)) {
          toast('Mockup link saved on the lead');
          if (state.selected === lead.id) renderDrawer();
          renderList();
        }
        genBtn.textContent = 'Make a new design';
      } catch (e) {
        const aborted = e && e.name === 'AbortError';
        statusEl.textContent = '';
        result.append(h('p', { class: 'error-text', text: aborted ? 'Stopped: no answer after 75 s. Try again.' : (e.message || String(e)) }));
        if (!aborted && /Clé refusée|401/.test(e.message || '')) result.append(h('button', { class: 'btn small', text: 'Check the key', onclick: () => { close(); mockupSettings(); } }));
        genBtn.textContent = 'Try again';
      } finally {
        clearTimeout(timer);
        clearInterval(tick);
        busy = null;
        genBtn.disabled = false;
      }
    });

    const box = h('div', { class: 'modal wide', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Mockup' },
      h('h2', { text: lead.mockup_url ? 'Redo the mockup' : 'Mockup for ' + (lead.name || 'this lead') }),
      h('p', { text: 'A JemaiStudio page written from your description, at your link. Numbers, reviews and labels only appear if they are in the description.' }),
      h('div', { class: 'two' }, field('Name', name), field('Town', city)),
      field('Trade', trade),
      field('Description', desc),
      h('div', { class: 'three' }, field('Template', style), field('Mood', mode), field('Type', type)),
      lead.mockup_url ? null : field('Link', slug),
      linkPreview,
      statusEl,
      result,
      h('div', { class: 'row' }, cancel, genBtn));
    box.addEventListener('keydown', (e) => e.key === 'Escape' && !busy && close());
    const backdrop = h('div', { class: 'modal-backdrop', onclick: (e) => e.target === backdrop && !busy && close() }, box);
    $overlay.append(backdrop);
    desc.focus();
  }

  // ---------- drawer ----------
  function renderDrawer() {
    document.querySelectorAll('.drawer, .drawer-backdrop').forEach((el) => el.remove());
    const lead = state.leads.find((l) => l.id === state.selected);
    if (!lead) return;
    const save = (key) => (e) => patchLead(lead.id, { [key]: e.target.value.trim() }, ['name', 'category', 'phone', 'priority', 'status'].includes(key)).then(() => key === 'name' || renderQuick());
    const text = (key, label, type) => field(label, h('input', { class: 'input', type: type || 'text', value: lead[key] || '', dir: 'auto', onchange: save(key) }));
    const quick = h('div', { class: 'quick' });
    function renderQuick() {
      clear(quick);
      const link = (label, url) => url && quick.append(h('a', { class: 'btn small', href: url, target: '_blank', rel: 'noopener noreferrer', text: label }));
      link('Call', C.telUrl(lead.phone));
      const waDigits = C.whatsappDigits(lead);
      const project = state.projects.find((p) => p.id === lead.project_id);
      const message = C.fillTemplate(project && project.message_template, lead);
      // Opening the chat counts as the first contact; the status can be changed back by hand.
      const markMessaged = () => {
        if (lead.status !== 'Not contacted') return;
        patchLead(lead.id, { status: 'Messaged', last_contacted: new Date().toISOString().slice(0, 10) }, true).then(renderDrawer);
        toast('Marked as messaged');
      };
      if (desktop && waDigits) {
        quick.append(h('button', { class: 'btn small', text: 'WhatsApp', onclick: () => {
          desktop.open(waDigits, message);
          markMessaged();
        } }));
      } else if (waDigits) {
        const url = 'https://wa.me/' + waDigits + (message ? '?text=' + encodeURIComponent(message) : '');
        quick.append(h('a', { class: 'btn small', href: url, target: '_blank', rel: 'noopener noreferrer', text: 'WhatsApp', onclick: markMessaged }));
      } else link('WhatsApp', C.whatsappUrl(lead));
      link('Instagram', C.instagramUrl(lead.instagram));
      link('Website', C.safeUrl(lead.website));
      link('Maps', C.safeUrl(lead.maps_url));
      if (lead.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) link('Email', 'mailto:' + lead.email);
      link('Open mockup', C.safeUrl(lead.mockup_url, ['https:']));
      quick.append(h('button', { class: 'btn small accent', text: lead.mockup_url ? 'Redo mockup' : 'Mockup', onclick: () => mockupPanel(lead) }));
    }
    renderQuick();
    const today = new Date().toISOString().slice(0, 10);
    const drawer = h('aside', { class: 'drawer', 'aria-label': 'Lead details' },
      h('div', { class: 'drawer-head' },
        h('strong', { text: 'Lead' }),
        h('button', { class: 'btn small', text: 'Done', onclick: closeLead })),
      h('div', { class: 'drawer-body' },
        h('input', { class: 'name-input', value: lead.name, dir: 'auto', 'aria-label': 'Name', onchange: (e) => {
          const v = e.target.value.trim();
          if (!v) {
            e.target.value = lead.name;
            return;
          }
          patchLead(lead.id, { name: v }, true);
        } }),
        quick,
        h('div', { class: 'group' },
          h('div', { class: 'two' },
            field('Status', select(C.STATUSES.map((s) => [s, s]), lead.status, (v) => patchLead(lead.id, { status: v }, true))),
            field('Priority', select([['', 'None'], ...C.PRIORITIES.map((p) => [p, p])], lead.priority, (v) => patchLead(lead.id, { priority: v }, true)))),
          h('div', { class: 'two' },
            text('last_contacted', 'Last contacted', 'date'),
            text('reply_time', 'Reply time')),
          h('button', { class: 'btn small', text: 'Mark contacted today', onclick: () => {
            const patch = { last_contacted: today };
            if (lead.status === 'Not contacted') patch.status = 'Messaged';
            patchLead(lead.id, patch, true).then(renderDrawer);
          } })),
        h('div', { class: 'group' },
          field('Notes', h('textarea', { class: 'input', dir: 'auto', onchange: save('notes') }, lead.notes || ''))),
        h('div', { class: 'group' },
          text('phone', 'Phone', 'tel'),
          h('div', { class: 'two' }, text('phone_type', 'Phone type'), text('whatsapp', 'WhatsApp')),
          text('email', 'Email', 'email'),
          h('div', { class: 'two' }, text('instagram', 'Instagram'), text('website', 'Website', 'url'))),
        h('div', { class: 'group' },
          text('category', 'Category'),
          text('address', 'Address'),
          text('maps_url', 'Google Maps link', 'url')),
        h('button', { class: 'btn danger', text: 'Delete lead', onclick: async () => {
          const ok = await modal({ title: 'Delete this lead?', message: lead.name + ' will be removed on every device.', confirmLabel: 'Delete', danger: true });
          if (!ok) return;
          state.leads = state.leads.filter((l) => l.id !== lead.id);
          state.selected = null;
          renderShell();
          await run(() => state.store.deleteLead(lead.id), 'Could not delete');
        } })));
    drawer.querySelector('textarea').value = lead.notes || '';
    document.body.append(h('div', { class: 'drawer-backdrop', onclick: closeLead }), drawer);
  }

  // ---------- CSV ----------
  $file.addEventListener('change', async () => {
    const file = $file.files[0];
    $file.value = '';
    const project = currentProject();
    if (!file || !project) return;
    if (file.size > 10 * 1024 * 1024) return toast('That file is over 10 MB. Split it into smaller files.');
    const parsed = C.csvToLeads(await file.text());
    if (parsed.error) return modal({ title: 'Could not import', message: parsed.error, cancelLabel: null });
    const { fresh, duplicates } = C.dedupe(parsed.leads, projectLeads(project.id));
    const lines = [fresh.length + ' new ' + (fresh.length === 1 ? 'lead' : 'leads') + ' will be added to "' + project.name + '".'];
    if (duplicates) lines.push(duplicates + ' skipped: same name and phone already in this project or repeated in the file.');
    if (parsed.skipped) lines.push(parsed.skipped + ' skipped: no name.');
    if (parsed.unknownColumns.length) lines.push('Columns not imported: ' + parsed.unknownColumns.join(', ') + '.');
    if (!fresh.length) return modal({ title: 'Nothing to import', message: lines.slice(1).join('\n') || 'The file has no leads.', cancelLabel: null });
    const ok = await modal({ title: 'Import leads', message: lines.join('\n'), confirmLabel: 'Import' });
    if (!ok) return;
    const saved = await run(() => state.store.addLeads(project.id, fresh), 'Import failed');
    if (!saved) return;
    state.leads.push(...saved);
    renderShell();
    toast('Imported ' + saved.length + ' leads');
  });

  async function exportCsv() {
    const project = currentProject();
    const leads = C.sortLeads(projectLeads(project.id));
    if (!leads.length) return toast('This project has no leads to export.');
    const csv = C.leadsToCsv(leads);
    const filename = project.name.replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim().replace(/\s+/g, '-').slice(0, 60) + '-leads.csv' || 'leads.csv';
    const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    try {
      const file = new File([csv], filename, { type: 'text/csv' });
      if (native && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
    if (!native) {
      const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: filename });
      document.body.append(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);
      toast('Exported ' + leads.length + ' leads');
      return;
    }
    // Fallback inside the iPhone wrapper when file sharing is unavailable: copy the CSV text.
    const area = h('textarea', { class: 'input', readonly: true });
    area.value = csv;
    await modal({ title: 'Copy your CSV', message: 'File sharing is not available here. Copy this text and save it as a .csv file.', extra: area, confirmLabel: 'Done', cancelLabel: null });
  }

  // ---------- boot ----------
  async function boot() {
    state.projects = [];
    state.leads = [];
    state.view = 'dashboard';
    state.selected = null;
    state.user = null;
    const mode = S.getMode();
    const conn = S.getConnection();
    if (mode === 'local') {
      state.store = new S.LocalStore();
      state.client = null;
      return refresh(false);
    }
    if (!conn) return renderWelcome();
    try {
      state.client = S.createClient(conn);
      const { data, error } = await state.client.auth.getSession();
      if (error) throw error;
      if (!data.session) return renderLogin();
      state.user = data.session.user;
      state.store = new S.CloudStore(state.client);
      const cached = state.store.cached();
      if (cached) {
        state.projects = cached.projects || [];
        state.leads = cached.leads || [];
        renderShell();
      }
      return refresh(false);
    } catch (e) {
      if (conn.baked) return renderLogin('Could not reach the database: ' + (e.message || e));
      S.clearConnection();
      return renderWelcome('Could not connect with those details: ' + (e.message || e));
    }
  }

  function editing() {
    const el = document.activeElement;
    return !!(el && el.closest && el.closest('.drawer, .modal, .toolbar'));
  }
  function backgroundSync() {
    if (document.hidden || !state.store || state.store.kind !== 'cloud' || editing() || $overlay.childElementCount) return;
    if (Date.now() - state.lastSync > 30000) refresh(true);
  }
  document.addEventListener('visibilitychange', backgroundSync);
  window.addEventListener('focus', backgroundSync);
  setInterval(backgroundSync, 60000);
  // Header strip above the WhatsApp panel, with the button that closes it.
  function renderWhatsAppBar() {
    document.querySelectorAll('.wa-bar').forEach((el) => el.remove());
    if (!wa.open) return;
    document.body.append(h('div', { class: 'wa-bar' },
      h('strong', { text: 'WhatsApp' }),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', text: 'All chats', onclick: () => desktop.home() }),
        h('button', { class: 'btn small', text: 'Close', onclick: () => desktop.close() }))));
  }

  if (desktop) {
    desktop.onState((next) => {
      wa.open = next.open;
      wa.width = next.width;
      document.documentElement.style.setProperty('--wa-w', (wa.open ? wa.width : 0) + 'px');
      document.body.classList.toggle('wa-open', wa.open);
      renderWhatsAppBar();
      if (state.store) refreshSidebarCounts();
    });
    desktop.requestState();
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.selected && !$overlay.childElementCount) closeLead();
  });

  boot();
})();
