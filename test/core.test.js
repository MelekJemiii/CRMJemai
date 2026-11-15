// node test/core.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const C = require('../www/core.js');

let n = 0;
function check(name, fn) { fn(); n++; console.log('ok  ' + name); }

check('parses quotes, commas, newlines and a BOM', () => {
  const rows = C.parseCsv('﻿Name,Notes\r\n"Acme, Inc","line1\nline2"\r\n"He said ""hi""",x\r\n\r\n');
  assert.deepStrictEqual(rows, [['Name', 'Notes'], ['Acme, Inc', 'line1\nline2'], ['He said "hi"', 'x']]);
});
check('detects semicolon and tab delimiters', () => {
  assert.deepStrictEqual(C.parseCsv('Name;Phone\nA;1'), [['Name', 'Phone'], ['A', '1']]);
  assert.deepStrictEqual(C.parseCsv('Name\tPhone\nA\t1'), [['Name', 'Phone'], ['A', '1']]);
});
check('maps common header names', () => {
  assert.deepStrictEqual(C.mapHeaders(['Clinic', 'WhatsApp link', 'Google Maps', 'Reply time (test)', '#', 'E-mail']),
    ['name', 'whatsapp', 'maps_url', 'reply_time', null, 'email']);
});
check('imports the Jeddah sample file', () => {
  const sample = path.join(__dirname, '..', 'sample-data', 'jeddah-clinic-leads.csv');
  if (!fs.existsSync(sample)) return; // lead lists are not committed
  const text = fs.readFileSync(path.join(__dirname, '..', 'sample-data', 'jeddah-clinic-leads.csv'), 'utf8');
  const r = C.csvToLeads(text);
  assert.strictEqual(r.error, null);
  assert.strictEqual(r.leads.length, 178);
  assert.deepStrictEqual(r.unknownColumns, ['#']);
  const first = r.leads[0];
  assert.strictEqual(first.name, 'Cosmoderm Clinic');
  assert.strictEqual(first.priority, 'A');
  assert.strictEqual(first.phone, '+966 55 704 0333');
  assert.strictEqual(first.status, 'Not contacted');
  assert.ok(r.leads.some((l) => /[؀-ۿ]/.test(l.name)), 'Arabic names survive');
});
check('rejects a file with no name column and skips nameless rows', () => {
  assert.ok(C.csvToLeads('Phone,City\n1,2').error);
  const r = C.csvToLeads('Name,Phone\n,123\nA,456');
  assert.strictEqual(r.leads.length, 1);
  assert.strictEqual(r.skipped, 1);
});
check('normalises status, priority and dates', () => {
  const l = C.cleanLead({ name: ' X ', status: 'won', priority: 'b', last_contacted: '15/11/2026' });
  assert.strictEqual(l.name, 'X');
  assert.strictEqual(l.status, 'Won');
  assert.strictEqual(l.priority, 'B');
  assert.strictEqual(l.last_contacted, '');
  assert.strictEqual(C.cleanLead({ name: 'Y', status: 'weird', priority: 'Z' }).status, 'Not contacted');
});
check('export then import round-trips, including formula-like cells', () => {
  const leads = [C.cleanLead({ name: '=SUM(A1)', phone: '+966 55 123 4567', notes: 'a, "b"\nc', status: 'Replied', priority: 'A', last_contacted: '2026-11-15' })];
  const csv = C.leadsToCsv(leads);
  assert.ok(csv.includes("'=SUM(A1)"), 'formula is neutralised in the file');
  assert.ok(csv.includes("'+966"), 'plus-prefixed phone is neutralised in the file');
  const back = C.csvToLeads(csv).leads;
  assert.deepStrictEqual(back, leads);
});
check('dedupes by name and phone digits', () => {
  const existing = [{ name: 'Acme', phone: '+966 55 123 4567' }];
  const r = C.dedupe([{ name: 'acme ', phone: '966551234567' }, { name: 'Acme', phone: '0500' }, { name: 'Acme', phone: '0500' }], existing);
  assert.strictEqual(r.fresh.length, 1);
  assert.strictEqual(r.duplicates, 2);
});
check('only safe links are produced', () => {
  assert.strictEqual(C.safeUrl('javascript:alert(1)'), '');
  assert.strictEqual(C.safeUrl('https://example.com/a'), 'https://example.com/a');
  assert.strictEqual(C.whatsappUrl({ whatsapp: 'https://wa.me/966557040333' }), 'https://wa.me/966557040333');
  assert.strictEqual(C.whatsappUrl({ whatsapp: 'https://evil.example/wa.me/1' }), '');
  assert.strictEqual(C.whatsappUrl({ whatsapp: '+966 55 704 0333' }), 'https://wa.me/966557040333');
  assert.strictEqual(C.whatsappDigits({ whatsapp: 'https://wa.me/966557040333' }), '966557040333');
  assert.strictEqual(C.whatsappDigits({ whatsapp: 'https://api.whatsapp.com/send?phone=966557040333&text=hi' }), '966557040333');
  assert.strictEqual(C.whatsappDigits({ whatsapp: '+966 55 704 0333' }), '966557040333');
  assert.strictEqual(C.whatsappDigits({ whatsapp: '', phone: '+966 55 704 0333' }), '');
  assert.strictEqual(C.whatsappDigits({ whatsapp: 'https://evil.example/966557040333' }), '');
  assert.strictEqual(C.telUrl('+966 55 704 0333'), 'tel:+966557040333');
  assert.strictEqual(C.telUrl('n/a'), '');
  assert.strictEqual(C.instagramUrl('@my.clinic'), 'https://www.instagram.com/my.clinic/');
  assert.strictEqual(C.instagramUrl('https://evil.example/x'), '');
});
check('fills message templates', () => {
  const lead = { name: ' عيادة جوري ', category: 'Dental', phone: '+966 55 1', address: '' };
  assert.strictEqual(C.fillTemplate('Hi {name} ({Category}) {address}{unknown}', lead), 'Hi عيادة جوري (Dental) {unknown}');
  assert.strictEqual(C.fillTemplate('', lead), '');
  assert.strictEqual(C.fillTemplate(undefined, lead), '');
  assert.strictEqual(C.fillTemplate('x'.repeat(3000), lead).length, 2000);
});
check('filters, sorts and computes stats', () => {
  const leads = [
    { id: 1, project_id: 'p', name: 'Zed', priority: 'C', status: 'Won', phone: '1' },
    { id: 2, project_id: 'p', name: 'Amy', priority: 'A', status: 'Messaged', phone: '2' },
    { id: 3, project_id: 'q', name: 'Bob', priority: '', status: 'Not contacted', phone: '3', notes: 'dental' },
  ];
  assert.deepStrictEqual(C.sortLeads(leads).map((l) => l.name), ['Amy', 'Zed', 'Bob']);
  assert.deepStrictEqual(C.filterLeads(leads, { q: 'DENT' }).map((l) => l.id), [3]);
  assert.deepStrictEqual(C.filterLeads(leads, { status: 'Won', priority: 'C' }).map((l) => l.id), [1]);
  const s = C.computeStats([{ id: 'p' }, { id: 'q' }], leads);
  assert.strictEqual(s.all.total, 3);
  assert.strictEqual(s.all.contacted, 2);
  assert.strictEqual(s.all.won, 1);
  assert.strictEqual(s.all.replyRate, 50);
  assert.strictEqual(s.projects[1].stats.total, 1);
});
check('prepares the mockup panel from a French lead', () => {
  assert.strictEqual(C.cityFromAddress('101 Av. du 8 Mai 1945, 83140 Six-Fours-les-Plages, France'), 'Six-Fours-les-Plages');
  assert.strictEqual(C.cityFromAddress('Rue X, 13001 Marseille CEDEX 01'), 'Marseille');
  assert.strictEqual(C.cityFromAddress('Al Rawdah, Jeddah'), 'Jeddah');
  const d = C.mockupDraft({ name: 'ADEPT Plomberie', category: 'Plombier', address: '83140 Six-Fours-les-Plages, France', notes: 'Note 5.0 (41 avis)' });
  assert.strictEqual(d.city, 'Six-Fours-les-Plages');
  assert.strictEqual(d.slug, 'adept-plomberie-six-fours-les-plages');
  assert.ok(d.description.includes('plombier à Six-Fours-les-Plages') && d.description.includes('41 avis'));
  assert.strictEqual(C.fillTemplate('Voici votre maquette : {mockup}', { mockup_url: 'https://app.jemaistudio.dev/m/x-1a2b' }), 'Voici votre maquette : https://app.jemaistudio.dev/m/x-1a2b');
  assert.strictEqual(C.mapHeaders(['Name', 'Maquette'])[1], 'mockup_url');
});
console.log('\nAll ' + n + ' checks passed.');
