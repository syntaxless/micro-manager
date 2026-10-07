/**
 * Example clients, requests, files, an invoice and a retainer, so a new studio can look around
 * before adding real work. Everything hangs off two clients flagged is_example, so removing
 * those clients removes it all.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { all, one, run, tx } from './db.js';
import { config } from './config.js';
import { currency } from './prefs.js';

export const hasExampleData = () => !!one('SELECT 1 FROM clients WHERE is_example = 1 LIMIT 1');

export function loadExampleData(adminId: number) {
  if (hasExampleData()) return;
  const stored: string[] = [];
  try {
    tx(() => {
      const clientA = run("INSERT INTO clients (name, company, email, color, is_example) VALUES ('Nova Coffee', 'Nova Coffee Co.', 'billing@nova.example', 'orange', 1)").id;
      const clientB = run("INSERT INTO clients (name, company, email, color, is_example) VALUES ('Lumen Labs', 'Lumen Labs Inc.', 'ap@lumen.example', 'cyan', 1)").id;
      // Example contacts have no password, so nobody can sign in as them.
      const maya = run("INSERT INTO users (email, name, role, client_id) VALUES ('maya@nova.example', 'Maya Chen', 'client', ?)", clientA).id;
      run("INSERT INTO users (email, name, role, client_id) VALUES ('sam@lumen.example', 'Sam Okafor', 'client', ?)", clientB);

      const projects: [number, string, string, string, number | null][] = [
        [clientA, 'Seasonal menu board illustrations', 'queued', 'high', 5],
        [clientA, 'Instagram story templates', 'queued', 'medium', null],
        [clientA, 'Cup sleeve redesign', 'in_progress', 'urgent', 2],
        [clientA, 'Loyalty card print files', 'review', 'medium', null],
        [clientA, 'Brand guidelines refresh', 'backlog', 'low', null],
        [clientA, 'Logo animation', 'done', 'medium', null],
        [clientB, 'Pitch deck polish', 'in_progress', 'high', 3],
        [clientB, 'Product launch hero video', 'queued', 'urgent', 9],
        [clientB, 'Icon set (48 icons)', 'review', 'medium', null],
        [clientB, 'Careers page photography', 'backlog', 'low', null],
      ];
      const base = (one<{ p: number | null }>('SELECT MAX(position) p FROM projects')?.p ?? 0) + 1000;
      const ids = projects.map(([cid, title, status, priority, dueIn], i) =>
        run(
          'INSERT INTO projects (client_id, title, description, status, priority, position, due_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          cid,
          title,
          'This is an example request. Open it to see the checklist, files and conversation, or drag it to a new spot on the board.',
          status,
          priority,
          base + i * 1000,
          dueIn ? new Date(Date.now() + dueIn * 864e5).toISOString().slice(0, 10) : null,
          adminId,
        ).id,
      );
      for (const [t, done] of [
        ['Sketch three directions', 1],
        ['Client picks a direction', 1],
        ['Final vector artwork', 0],
        ['Export print-ready PDF', 0],
      ] as const) {
        run('INSERT INTO tasks (project_id, title, done, position) VALUES (?, ?, ?, 0)', ids[2], t, done);
      }
      run('INSERT INTO comments (project_id, user_id, body) VALUES (?, ?, ?)', ids[2], maya, 'Could we try a warmer orange on the second option?');
      run('INSERT INTO comments (project_id, user_id, body) VALUES (?, ?, ?)', ids[2], adminId, 'Absolutely. Updated mockups by tomorrow.');

      const addFile = (clientId: number, name: string, mime: string, body: string | Buffer, projectId: number | null = null, gated = 0) => {
        const name_ = crypto.randomBytes(16).toString('hex');
        fs.writeFileSync(path.join(config.uploadDir, name_), body);
        stored.push(name_);
        return run(
          'INSERT INTO files (client_id, project_id, uploaded_by, name, stored_name, mime, size, requires_subscription) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          clientId,
          projectId,
          adminId,
          name,
          name_,
          mime,
          Buffer.byteLength(body),
          gated,
        ).id;
      };
      const svg = (c: string, label: string) =>
        `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="${c}"/><text x="50%" y="50%" font-family="sans-serif" font-size="48" fill="#fff" text-anchor="middle">${label}</text></svg>`;
      const f1 = addFile(clientA, 'logo-animation-final.svg', 'image/svg+xml', svg('#c2410c', 'Nova logo'), ids[5]);
      const f2 = addFile(clientA, 'logo-animation-source.zip', 'application/zip', crypto.randomBytes(2048), ids[5]);
      addFile(clientA, 'brand-colors.txt', 'text/plain', 'Espresso #3b2416\nCrema #f4e3c1\nOrange #f97316\n');
      addFile(clientB, 'icon-set-preview.svg', 'image/svg+xml', svg('#0e7490', 'Icons v1'), ids[8], 1);

      const n = one<{ n: number }>('SELECT COUNT(*) n FROM invoices')!.n + 1;
      const inv = run(
        "INSERT INTO invoices (client_id, number, title, status, currency, due_date, created_by, sent_at) VALUES (?, ?, 'Logo animation', 'open', ?, ?, ?, datetime('now'))",
        clientA,
        `INV-${String(n).padStart(4, '0')}`,
        currency(),
        new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10),
        adminId,
      ).id;
      run("INSERT INTO invoice_items (invoice_id, description, quantity, unit_amount) VALUES (?, 'Logo animation (3 variants)', 1, 120000)", inv);
      run("INSERT INTO invoice_items (invoice_id, description, quantity, unit_amount) VALUES (?, 'Revision rounds', 2, 15000)", inv);
      run('INSERT INTO invoice_files (invoice_id, file_id) VALUES (?, ?), (?, ?)', inv, f1, inv, f2);
      run("INSERT INTO subscriptions (client_id, name, amount, currency, interval, status, created_by) VALUES (?, 'Design retainer', 250000, ?, 'month', 'pending', ?)", clientB, currency(), adminId);
    });
  } catch (e) {
    for (const f of stored) fs.rmSync(path.join(config.uploadDir, f), { force: true });
    throw e;
  }
}

export function removeExampleData() {
  const files = all<{ stored_name: string }>('SELECT f.stored_name FROM files f JOIN clients c ON c.id = f.client_id WHERE c.is_example = 1');
  run('DELETE FROM clients WHERE is_example = 1');
  for (const f of files) fs.rmSync(path.join(config.uploadDir, f.stored_name), { force: true });
}
