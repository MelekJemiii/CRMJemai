// Pure logic shared by the app and the tests: CSV, field mapping, filtering, stats.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LeadCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const STATUSES = ['Not contacted', 'Messaged', 'Replied', 'Demo sent', 'Call booked', 'Won', 'Not interested'];
  const PRIORITIES = ['A', 'B', 'C'];

  // key, label shown in the app and used as the CSV header
  const FIELDS = [
    ['name', 'Name'],
    ['priority', 'Priority'],
    ['category', 'Category'],
    ['phone', 'Phone'],
    ['phone_type', 'Phone type'],
    ['whatsapp', 'WhatsApp'],
    ['email', 'Email'],
    ['instagram', 'Instagram'],
    ['website', 'Website'],
    ['status', 'Status'],
    ['last_contacted', 'Last contacted'],
    ['reply_time', 'Reply time'],
    ['notes', 'Notes'],
    ['address', 'Address'],
    ['maps_url', 'Google Maps'],
    ['mockup_url', 'Mockup'],
  ];
  const FIELD_KEYS = FIELDS.map((f) => f[0]);

  const ALIASES = {
    name: ['name', 'clinic', 'company', 'business', 'lead', 'business name', 'company name', 'full name', 'title'],
    priority: ['priority', 'tier'],
    category: ['category', 'type', 'industry', 'segment'],
    phone: ['phone', 'phone number', 'mobile', 'tel', 'telephone', 'number', 'contact number'],
    phone_type: ['phone type'],
    whatsapp: ['whatsapp', 'whatsapp link', 'whatsapp number', 'wa'],
    email: ['email', 'e-mail', 'mail', 'email address'],
    instagram: ['instagram', 'ig', 'insta'],
    website: ['website', 'site', 'url', 'web'],
    status: ['status', 'stage'],
    last_contacted: ['last contacted', 'last contact', 'contacted on'],
    reply_time: ['reply time', 'reply time (test)', 'response time'],
    notes: ['notes', 'note', 'comment', 'comments', 'remarks'],
    address: ['address', 'location', 'street'],
    maps_url: ['google maps', 'maps', 'maps link', 'map', 'google maps link', 'maps url'],
    mockup_url: ['mockup', 'maquette', 'mockup link', 'mockup url', 'lien maquette'],
  };
  const ALIAS_LOOKUP = {};
  for (const key of Object.keys(ALIASES)) for (const a of ALIASES[key]) ALIAS_LOOKUP[a] = key;

  function detectDelimiter(text) {
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let inQuotes = false;
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (!inQuotes && ch in counts) counts[ch]++;
    }
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  }

  function parseCsv(input) {
    let text = String(input || '');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const delim = detectDelimiter(text);
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i++;
          } else inQuotes = false;
        } else cell += ch;
      } else if (ch === '"' && cell === '') inQuotes = true;
      else if (ch === delim) {
        row.push(cell);
        cell = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell);
        cell = '';
        rows.push(row);
        row = [];
      } else cell += ch;
    }
    if (cell !== '' || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  }

  function csvCell(value) {
    let s = value == null ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheets running it as a formula
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(rows) {
    return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  function cleanCell(value) {
    let s = String(value == null ? '' : value).trim();
    if (s.startsWith("'")) s = s.slice(1); // spreadsheet "keep as text" marker
    return s;
  }

  function mapHeaders(headerRow) {
    return headerRow.map((h) => ALIAS_LOOKUP[cleanCell(h).toLowerCase().replace(/\s+/g, ' ')] || null);
  }

  function normalizeStatus(value) {
    const s = cleanCell(value).toLowerCase();
    return STATUSES.find((x) => x.toLowerCase() === s) || 'Not contacted';
  }

  function normalizePriority(value) {
    const s = cleanCell(value).toUpperCase();
    return PRIORITIES.includes(s) ? s : '';
  }

  function normalizeDate(value) {
    const s = cleanCell(value);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  }

  function cleanLead(raw) {
    const lead = {};
    for (const key of FIELD_KEYS) lead[key] = cleanCell(raw[key]).slice(0, 4000);
    lead.status = normalizeStatus(raw.status);
    lead.priority = normalizePriority(raw.priority);
    lead.last_contacted = normalizeDate(raw.last_contacted);
    return lead;
  }

  // Returns leads without ids; the caller adds id and project_id.
  function csvToLeads(text) {
    const rows = parseCsv(text);
    if (!rows.length) return { leads: [], skipped: 0, unknownColumns: [], error: 'The file is empty.' };
    const map = mapHeaders(rows[0]);
    if (!map.includes('name')) {
      return { leads: [], skipped: 0, unknownColumns: [], error: 'No name column found. The first row needs a column called Name, Clinic or Company.' };
    }
    const unknownColumns = rows[0].filter((h, i) => !map[i] && cleanCell(h)).map(cleanCell);
    const leads = [];
    let skipped = 0;
    for (const r of rows.slice(1)) {
      const raw = {};
      map.forEach((key, i) => {
        if (key && raw[key] === undefined) raw[key] = r[i];
      });
      const lead = cleanLead(raw);
      if (!lead.name) {
        skipped++;
        continue;
      }
      leads.push(lead);
    }
    return { leads, skipped, unknownColumns, error: null };
  }

  function leadsToCsv(leads) {
    const rows = [FIELDS.map((f) => f[1])];
    for (const l of leads) rows.push(FIELD_KEYS.map((k) => l[k] || ''));
    return '﻿' + toCsv(rows); // BOM so Excel reads Arabic correctly
  }

  function leadKey(lead) {
    const digits = String(lead.phone || '').replace(/\D/g, '');
    return String(lead.name || '').trim().toLowerCase() + '|' + digits;
  }

  function dedupe(newLeads, existingLeads) {
    const seen = new Set(existingLeads.map(leadKey));
    const fresh = [];
    let duplicates = 0;
    for (const l of newLeads) {
      const k = leadKey(l);
      if (seen.has(k)) duplicates++;
      else {
        seen.add(k);
        fresh.push(l);
      }
    }
    return { fresh, duplicates };
  }

  function safeUrl(value, protocols) {
    const s = String(value || '').trim();
    if (!s) return '';
    try {
      const u = new URL(s);
      return (protocols || ['https:', 'http:']).includes(u.protocol) ? u.href : '';
    } catch {
      return '';
    }
  }

  function telUrl(phone) {
    const s = String(phone || '').replace(/[^\d+]/g, '');
    return s.replace(/\D/g, '').length >= 5 ? 'tel:' + s : '';
  }

  function whatsappUrl(lead) {
    const w = String(lead.whatsapp || '').trim();
    if (!w) return '';
    if (/^https?:/i.test(w)) {
      const u = safeUrl(w, ['https:']);
      return /^https:\/\/(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\//.test(u) ? u : '';
    }
    const digits = w.replace(/\D/g, '');
    return digits.length >= 8 ? 'https://wa.me/' + digits : '';
  }

  // Digits of the lead's WhatsApp number, or '' when the WhatsApp field has none.
  function whatsappDigits(lead) {
    const url = whatsappUrl(lead);
    if (!url) return '';
    const u = new URL(url);
    const digits = (u.hostname === 'wa.me' ? u.pathname : u.searchParams.get('phone') || '').replace(/\D/g, '');
    return /^\d{8,15}$/.test(digits) ? digits : '';
  }

  // Fills {name}, {category}, {phone} and {address} in a project's message template for one lead.
  function fillTemplate(template, lead) {
    const values = { name: lead.name, category: lead.category, phone: lead.phone, address: lead.address, mockup: lead.mockup_url };
    return String(template || '')
      .replace(/\{(name|category|phone|address|mockup)\}/gi, (m, key) => String(values[key.toLowerCase()] || '').trim())
      .trim()
      .slice(0, 2000);
  }

  // ---------- JemaiStudio mockups (Lead Hub's « Mockup » button) ----------
  function slugify(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 55).replace(/-+$/, '');
  }

  // « 12 Av. X, 83140 Six-Fours-les-Plages, France » → « Six-Fours-les-Plages »; otherwise the last useful part.
  function cityFromAddress(address) {
    const a = String(address || '');
    const m = a.match(/\b(?:0[1-9]|[1-8]\d|9[0-8]|2[AB])\d{3}\s+([^,\d][^,]*)/i);
    if (m) return m[1].replace(/\s+cedex.*$/i, '').trim().slice(0, 80);
    const parts = a.split(',').map((x) => x.trim()).filter((x) => x && !/^(france|saudi arabia|tunisia|tunisie)$/i.test(x) && !/\d/.test(x));
    return (parts[parts.length - 1] || '').slice(0, 80);
  }

  // Google names often carry the services: « ADEPT Plomberie -Recherche de fuite, … » → name + services.
  function splitListingName(raw) {
    const s = String(raw || '').replace(/\s+/g, ' ').trim();
    const m = s.match(/^(.{2,}?)(?:\s+[-–—|·:]\s*|\s*[–—|·]\s+|\s*\|\s*)(.+)$/);
    return m ? { name: m[1].trim().slice(0, 80), extra: m[2].trim() } : { name: s.slice(0, 80), extra: '' };
  }

  // A slug, or a whole mockup link pasted in the link field, as a slug.
  function slugInput(raw) {
    let s = String(raw || '').trim().toLowerCase();
    const m = s.match(/\/m\/([^/?#]+)/);
    if (m) s = m[1];
    return slugify(s.replace(/^https?:\/\/[^/]+\/?/, '').replace(/\.html$/, ''));
  }

  // What the mockup panel opens with: everything Lead Hub already knows about the lead.
  function mockupDraft(lead) {
    const city = cityFromAddress(lead.address);
    const trade = String(lead.category || '').trim();
    const { name, extra } = splitListingName(lead.name);
    const lines = [];
    lines.push(name + (trade ? ', ' + trade.toLowerCase() : '') + (city ? ' à ' + city : '') + '.');
    if (extra) lines.push('Services : ' + extra.replace(/[.\s]+$/, '') + '.');
    const notes = String(lead.notes || '').trim();
    if (notes) lines.push(notes);
    return {
      name,
      city,
      trade,
      description: lines.join('\n').slice(0, 3000),
      slug: slugify(name + ' ' + city),
    };
  }

  function instagramUrl(value) {
    const s = String(value || '').trim();
    if (!s) return '';
    if (/^https?:/i.test(s)) {
      const u = safeUrl(s, ['https:']);
      return /^https:\/\/(www\.)?instagram\.com\//.test(u) ? u : '';
    }
    const handle = s.replace(/^@/, '');
    return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? 'https://www.instagram.com/' + handle + '/' : '';
  }

  function filterLeads(leads, f) {
    const q = String((f && f.q) || '').trim().toLowerCase();
    return leads.filter((l) => {
      if (f && f.status && l.status !== f.status) return false;
      if (f && f.priority && l.priority !== f.priority) return false;
      if (!q) return true;
      return [l.name, l.phone, l.category, l.notes, l.address, l.email, l.instagram].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }

  function sortLeads(leads) {
    const rank = { A: 0, B: 1, C: 2 };
    return leads.slice().sort((a, b) => {
      const pa = a.priority in rank ? rank[a.priority] : 3;
      const pb = b.priority in rank ? rank[b.priority] : 3;
      if (pa !== pb) return pa - pb;
      return String(a.name).localeCompare(String(b.name));
    });
  }

  const CONTACTED = ['Messaged', 'Replied', 'Demo sent', 'Call booked', 'Won', 'Not interested'];
  const ENGAGED = ['Replied', 'Demo sent', 'Call booked', 'Won'];

  function statsFor(leads) {
    const byStatus = {};
    for (const s of STATUSES) byStatus[s] = 0;
    for (const l of leads) byStatus[STATUSES.includes(l.status) ? l.status : 'Not contacted']++;
    const total = leads.length;
    const contacted = CONTACTED.reduce((n, s) => n + byStatus[s], 0);
    const engaged = ENGAGED.reduce((n, s) => n + byStatus[s], 0);
    return {
      total,
      contacted,
      engaged,
      won: byStatus.Won,
      byStatus,
      replyRate: contacted ? Math.round((engaged / contacted) * 100) : 0,
    };
  }

  function computeStats(projects, leads) {
    return {
      all: statsFor(leads),
      projects: projects.map((p) => ({ project: p, stats: statsFor(leads.filter((l) => l.project_id === p.id)) })),
    };
  }

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  return {
    STATUSES, PRIORITIES, FIELDS, FIELD_KEYS,
    parseCsv, toCsv, csvToLeads, leadsToCsv, mapHeaders, cleanLead, dedupe,
    safeUrl, telUrl, whatsappUrl, whatsappDigits, fillTemplate, instagramUrl, slugify, slugInput, splitListingName, cityFromAddress, mockupDraft,
    filterLeads, sortLeads, statsFor, computeStats, uuid,
  };
});
