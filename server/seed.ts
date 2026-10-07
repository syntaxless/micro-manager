/**
 * Fills an empty install with demo data: an admin, two clients with portal logins,
 * a board full of requests, some files, an invoice and a retainer.
 *
 *   npm run seed            (admin: admin@example.com / password123)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { one, run } from './db.js';
import { hashPassword } from './auth.js';
import { config } from './config.js';

if (one('SELECT 1 FROM users LIMIT 1')) {
  console.log('Database already has users; seed skipped.');
  process.exit(0);
}

const pw = hashPassword('password123');
run("INSERT INTO settings (key, value) VALUES ('business_name', 'Pixel & Pine Studio')");
const admin = run("INSERT INTO users (email, name, password_hash, role) VALUES ('admin@example.com', 'Jordan Reyes', ?, 'admin')", pw).id;

const clientA = run("INSERT INTO clients (name, company, email, color) VALUES ('Nova Coffee', 'Nova Coffee Co.', 'billing@nova.example', 'orange')").id;
const clientB = run("INSERT INTO clients (name, company, email, color) VALUES ('Lumen Labs', 'Lumen Labs Inc.', 'ap@lumen.example', 'cyan')").id;
const nova = run("INSERT INTO users (email, name, password_hash, role, client_id) VALUES ('client@example.com', 'Maya Chen', ?, 'client', ?)", pw, clientA).id;
run("INSERT INTO users (email, name, password_hash, role, client_id) VALUES ('lumen@example.com', 'Sam Okafor', ?, 'client', ?)", pw, clientB);

const projects: [number, string, string, string, string | null][] = [
  [clientA, 'Seasonal menu board illustrations', 'queued', 'high', '+5 days'],
  [clientA, 'Instagram story templates', 'queued', 'medium', null],
  [clientA, 'Cup sleeve redesign', 'in_progress', 'urgent', '+2 days'],
  [clientA, 'Loyalty card print files', 'review', 'medium', null],
  [clientA, 'Brand guidelines refresh', 'backlog', 'low', null],
  [clientA, 'Logo animation', 'done', 'medium', null],
  [clientB, 'Pitch deck polish', 'in_progress', 'high', '+3 days'],
  [clientB, 'Product launch hero video', 'queued', 'urgent', '+9 days'],
  [clientB, 'Icon set (48 icons)', 'review', 'medium', null],
  [clientB, 'Careers page photography', 'backlog', 'low', null],
];
const ids: number[] = [];
projects.forEach(([cid, title, status, priority, due], i) => {
  const dueDate = due ? new Date(Date.now() + parseInt(due) * 864e5).toISOString().slice(0, 10) : null;
  ids.push(
    run(
      'INSERT INTO projects (client_id, title, description, status, priority, position, due_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      cid,
      title,
      'Reference links and notes live here. Drag the card to reprioritise it.',
      status,
      priority,
      (i + 1) * 1000,
      dueDate,
      admin,
    ).id,
  );
});
for (const [t, done] of [
  ['Sketch three directions', 1],
  ['Client picks a direction', 1],
  ['Final vector artwork', 0],
  ['Export print-ready PDF', 0],
] as const) {
  run('INSERT INTO tasks (project_id, title, done, position) VALUES (?, ?, ?, 0)', ids[2], t, done);
}
run('INSERT INTO comments (project_id, user_id, body) VALUES (?, ?, ?)', ids[2], nova, 'Could we try a warmer orange on the second option?');
run('INSERT INTO comments (project_id, user_id, body) VALUES (?, ?, ?)', ids[2], admin, 'Absolutely. Updated mockups by tomorrow.');

function addFile(clientId: number, name: string, mime: string, body: string | Buffer, projectId: number | null = null, gated = 0) {
  const stored = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(path.join(config.uploadDir, stored), body);
  return run(
    'INSERT INTO files (client_id, project_id, uploaded_by, name, stored_name, mime, size, requires_subscription) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    clientId,
    projectId,
    admin,
    name,
    stored,
    mime,
    Buffer.byteLength(body),
    gated,
  ).id;
}
const svg = (c: string, label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="${c}"/><text x="50%" y="50%" font-family="sans-serif" font-size="48" fill="#fff" text-anchor="middle">${label}</text></svg>`;
const f1 = addFile(clientA, 'logo-animation-final.svg', 'image/svg+xml', svg('#c2410c', 'Nova logo'), ids[5]);
const f2 = addFile(clientA, 'logo-animation-source.zip', 'application/zip', crypto.randomBytes(2048), ids[5]);
addFile(clientA, 'brand-colors.txt', 'text/plain', 'Espresso #3b2416\nCrema #f4e3c1\nOrange #f97316\n');
addFile(clientB, 'icon-set-preview.svg', 'image/svg+xml', svg('#0e7490', 'Icons v1'), ids[8], 1);

const inv = run(
  "INSERT INTO invoices (client_id, number, title, status, currency, due_date, created_by, sent_at) VALUES (?, 'INV-0001', 'Logo animation', 'open', ?, ?, ?, datetime('now'))",
  clientA,
  config.currency,
  new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10),
  admin,
).id;
run("INSERT INTO invoice_items (invoice_id, description, quantity, unit_amount) VALUES (?, 'Logo animation (3 variants)', 1, 120000)", inv);
run("INSERT INTO invoice_items (invoice_id, description, quantity, unit_amount) VALUES (?, 'Revision rounds', 2, 15000)", inv);
run('INSERT INTO invoice_files (invoice_id, file_id) VALUES (?, ?), (?, ?)', inv, f1, inv, f2);

run("INSERT INTO subscriptions (client_id, name, amount, currency, interval, status, created_by) VALUES (?, 'Design retainer', 250000, ?, 'month', 'pending', ?)", clientB, config.currency, admin);

console.log('Seeded demo data.');
console.log('  admin:  admin@example.com / password123');
console.log('  client: client@example.com / password123 (Nova Coffee)');
console.log('  client: lumen@example.com / password123 (Lumen Labs)');
