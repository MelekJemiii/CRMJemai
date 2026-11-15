// Two interchangeable data stores: this device only (LocalStore) or synced (CloudStore, Supabase).
(function (root) {
  const { FIELD_KEYS, uuid } = root.LeadCore;
  const LOCAL_KEY = 'leadhub.local.v1';
  const CACHE_KEY = 'leadhub.cache.v1';

  function nowIso() {
    return new Date().toISOString();
  }

  function pickFields(lead) {
    const out = {};
    for (const k of FIELD_KEYS) if (lead[k] !== undefined) out[k] = lead[k];
    return out;
  }

  class LocalStore {
    constructor() {
      this.kind = 'local';
      try {
        this.data = JSON.parse(localStorage.getItem(LOCAL_KEY)) || { projects: [], leads: [] };
      } catch {
        this.data = { projects: [], leads: [] };
      }
    }
    save() {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(this.data));
    }
    async getAll() {
      return { projects: this.data.projects.slice(), leads: this.data.leads.slice() };
    }
    async addProject(name) {
      const p = { id: uuid(), name, position: this.data.projects.length, created_at: nowIso() };
      this.data.projects.push(p);
      this.save();
      return p;
    }
    async renameProject(id, name) {
      const p = this.data.projects.find((x) => x.id === id);
      if (p) p.name = name;
      this.save();
    }
    async setTemplate(id, template) {
      const p = this.data.projects.find((x) => x.id === id);
      if (p) p.message_template = template;
      this.save();
    }
    async deleteProject(id) {
      this.data.projects = this.data.projects.filter((x) => x.id !== id);
      this.data.leads = this.data.leads.filter((l) => l.project_id !== id);
      this.save();
    }
    async addLeads(projectId, leads) {
      const rows = leads.map((l) => ({ ...pickFields(l), id: uuid(), project_id: projectId, created_at: nowIso(), updated_at: nowIso() }));
      this.data.leads.push(...rows);
      this.save();
      return rows;
    }
    async updateLead(id, patch) {
      const l = this.data.leads.find((x) => x.id === id);
      if (l) Object.assign(l, pickFields(patch), { updated_at: nowIso() });
      this.save();
    }
    async deleteLead(id) {
      this.data.leads = this.data.leads.filter((x) => x.id !== id);
      this.save();
    }
  }

  function check(result) {
    if (result.error) throw new Error(result.error.message || 'Database error');
    return result.data;
  }

  function toDb(lead) {
    const row = pickFields(lead);
    if ('last_contacted' in row && !row.last_contacted) row.last_contacted = null;
    // only sent when there is a link, so imports keep working on a database without the column yet
    if ('mockup_url' in row && !row.mockup_url) delete row.mockup_url;
    return row;
  }

  function fromDb(row) {
    const lead = { ...row };
    for (const k of FIELD_KEYS) if (lead[k] == null) lead[k] = '';
    return lead;
  }

  class CloudStore {
    constructor(client) {
      this.kind = 'cloud';
      this.db = client;
    }
    async fetchAllRows(table, order) {
      const page = 1000;
      const rows = [];
      for (let from = 0; ; from += page) {
        const data = check(await this.db.from(table).select('*').order(order, { ascending: true }).order('id', { ascending: true }).range(from, from + page - 1));
        rows.push(...data);
        if (data.length < page) break;
      }
      return rows;
    }
    async getAll() {
      const [projects, leads] = await Promise.all([this.fetchAllRows('projects', 'position'), this.fetchAllRows('leads', 'created_at')]);
      const result = { projects, leads: leads.map(fromDb) };
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(result));
      } catch {}
      return result;
    }
    cached() {
      try {
        return JSON.parse(localStorage.getItem(CACHE_KEY));
      } catch {
        return null;
      }
    }
    async addProject(name) {
      const existing = check(await this.db.from('projects').select('id'));
      return check(await this.db.from('projects').insert({ id: uuid(), name, position: existing.length }).select().single());
    }
    async renameProject(id, name) {
      check(await this.db.from('projects').update({ name }).eq('id', id));
    }
    async setTemplate(id, template) {
      check(await this.db.from('projects').update({ message_template: template }).eq('id', id));
    }
    async deleteProject(id) {
      check(await this.db.from('projects').delete().eq('id', id));
    }
    async addLeads(projectId, leads) {
      const rows = leads.map((l) => ({ ...toDb(l), id: uuid(), project_id: projectId }));
      const saved = [];
      for (let i = 0; i < rows.length; i += 500) {
        saved.push(...check(await this.db.from('leads').insert(rows.slice(i, i + 500)).select()));
      }
      return saved.map(fromDb);
    }
    async updateLead(id, patch) {
      check(await this.db.from('leads').update({ ...toDb(patch), updated_at: nowIso() }).eq('id', id));
    }
    async deleteLead(id) {
      check(await this.db.from('leads').delete().eq('id', id));
    }
  }

  // ---- connection settings ----
  const CONN_KEY = 'leadhub.conn';
  const MODE_KEY = 'leadhub.mode';

  function getConnection() {
    const baked = root.LEADHUB_CONFIG || {};
    if (baked.supabaseUrl && baked.supabaseAnonKey) return { url: baked.supabaseUrl, key: baked.supabaseAnonKey, baked: true };
    try {
      const saved = JSON.parse(localStorage.getItem(CONN_KEY));
      if (saved && saved.url && saved.key) return saved;
    } catch {}
    return null;
  }
  function saveConnection(url, key) {
    localStorage.setItem(CONN_KEY, JSON.stringify({ url, key }));
  }
  function clearConnection() {
    localStorage.removeItem(CONN_KEY);
    localStorage.removeItem(CACHE_KEY);
  }
  function getMode() {
    return localStorage.getItem(MODE_KEY) || '';
  }
  function setMode(mode) {
    if (mode) localStorage.setItem(MODE_KEY, mode);
    else localStorage.removeItem(MODE_KEY);
  }
  function validConnection(url, key) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && key.trim().length > 20;
    } catch {
      return false;
    }
  }
  function createClient(conn) {
    return root.supabase.createClient(conn.url, conn.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  }

  root.LeadStore = { LocalStore, CloudStore, getConnection, saveConnection, clearConnection, getMode, setMode, validConnection, createClient };
})(window);
