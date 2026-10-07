import { Router, type Request } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { all, one, run, tx, type Client, type User } from '../db.js';
import { HttpError, publicUser, randomToken, requireAdmin, requireStaff, destroyUserSessions } from '../auth.js';
import { config } from '../config.js';
import { idParam, parse } from '../util.js';
import { ACTIVE_SUB_STATUSES } from '../access.js';

export const clientsRouter = Router();

const INVITE_DAYS = 14;
const COLORS = ['blue', 'magenta', 'cyan', 'green', 'yellow', 'orange', 'red'];

function issueInvite(userId: number) {
  const token = randomToken(24);
  run(
    'UPDATE users SET invite_token = ?, invite_expires = ? WHERE id = ?',
    token,
    new Date(Date.now() + INVITE_DAYS * 864e5).toISOString(),
    userId,
  );
  return `${config.appUrl}/invite/${token}`;
}

function createInvitedUser(email: string, name: string, role: User['role'], clientId: number | null) {
  if (one('SELECT 1 FROM users WHERE email = ?', email)) throw new HttpError(409, 'Someone with that email already has an account');
  const { id } = run('INSERT INTO users (email, name, role, client_id) VALUES (?, ?, ?, ?)', email, name, role, clientId);
  return { id, inviteUrl: issueInvite(id) };
}

const statusList = ACTIVE_SUB_STATUSES.map((s) => `'${s}'`).join(',');

clientsRouter.get('/clients', requireStaff, (_req, res) => {
  res.json(
    all(`
      SELECT c.*,
        (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.id AND p.status != 'done') AS open_projects,
        (SELECT COUNT(*) FROM files f WHERE f.client_id = c.id) AS file_count,
        (SELECT COALESCE(SUM(ii.quantity * ii.unit_amount), 0) FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id
           WHERE i.client_id = c.id AND i.status = 'open') AS outstanding,
        (SELECT COUNT(*) FROM subscriptions s WHERE s.client_id = c.id AND s.status IN (${statusList})) AS active_subscriptions,
        (SELECT COUNT(*) FROM users u WHERE u.client_id = c.id) AS user_count
      FROM clients c ORDER BY c.name COLLATE NOCASE`),
  );
});

clientsRouter.post('/clients', requireStaff, (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(1).max(120),
      company: z.string().trim().max(120).optional(),
      email: z.union([z.email(), z.literal('')]).optional(),
      color: z.enum(COLORS).optional(),
      contact: z.object({ name: z.string().trim().min(1).max(100), email: z.email() }).optional(),
    }),
    req.body,
  );
  const out = tx(() => {
    const color = body.color ?? COLORS[(one<{ n: number }>('SELECT COUNT(*) n FROM clients')!.n) % COLORS.length];
    const { id } = run(
      'INSERT INTO clients (name, company, email, color) VALUES (?, ?, ?, ?)',
      body.name,
      body.company || null,
      body.email || body.contact?.email || null,
      color,
    );
    const invite = body.contact ? createInvitedUser(body.contact.email, body.contact.name, 'client', id) : null;
    return { id, inviteUrl: invite?.inviteUrl ?? null };
  });
  res.status(201).json(out);
});

clientsRouter.get('/clients/:id', requireStaff, (req, res) => {
  const id = idParam(req);
  const client = one<Client>('SELECT * FROM clients WHERE id = ?', id);
  if (!client) throw new HttpError(404, 'Client not found');
  const users = all<User & { invite_expires: string | null; password_hash: string | null }>(
    'SELECT * FROM users WHERE client_id = ? ORDER BY id',
    id,
  ).map((u) => ({ ...publicUser(u), pending: !u.password_hash }));
  res.json({ ...client, users });
});

clientsRouter.patch('/clients/:id', requireStaff, (req, res) => {
  const id = idParam(req);
  const body = parse(
    z.object({
      name: z.string().trim().min(1).max(120).optional(),
      company: z.string().trim().max(120).nullable().optional(),
      email: z.union([z.email(), z.literal('')]).nullable().optional(),
      color: z.enum(COLORS).optional(),
    }),
    req.body,
  );
  const c = one<Client>('SELECT * FROM clients WHERE id = ?', id);
  if (!c) throw new HttpError(404, 'Client not found');
  run(
    'UPDATE clients SET name = ?, company = ?, email = ?, color = ? WHERE id = ?',
    body.name ?? c.name,
    body.company !== undefined ? body.company || null : c.company,
    body.email !== undefined ? body.email || null : c.email,
    body.color ?? c.color,
    id,
  );
  res.json({ ok: true });
});

clientsRouter.delete('/clients/:id', requireAdmin, (req, res) => {
  const id = idParam(req);
  const files = all<{ stored_name: string }>('SELECT stored_name FROM files WHERE client_id = ?', id);
  run('DELETE FROM clients WHERE id = ?', id);
  for (const f of files) fs.rm(path.join(config.uploadDir, f.stored_name), { force: true }, () => {});
  res.json({ ok: true });
});

clientsRouter.post('/clients/:id/users', requireStaff, (req, res) => {
  const clientId = idParam(req);
  if (!one('SELECT 1 FROM clients WHERE id = ?', clientId)) throw new HttpError(404, 'Client not found');
  const body = parse(z.object({ name: z.string().trim().min(1).max(100), email: z.email() }), req.body);
  res.status(201).json(createInvitedUser(body.email, body.name, 'client', clientId));
});

clientsRouter.get('/team', requireStaff, (_req, res) => {
  res.json(
    all<User>("SELECT * FROM users WHERE role != 'client' ORDER BY role, name").map((u) => ({
      ...publicUser(u),
      pending: !u.password_hash,
    })),
  );
});

clientsRouter.post('/team', requireAdmin, (req, res) => {
  const body = parse(
    z.object({ name: z.string().trim().min(1).max(100), email: z.email(), role: z.enum(['admin', 'member']) }),
    req.body,
  );
  res.status(201).json(createInvitedUser(body.email, body.name, body.role, null));
});

function manageable(req: Request) {
  const target = one<User>('SELECT * FROM users WHERE id = ?', idParam(req));
  if (!target) throw new HttpError(404, 'User not found');
  const me = req.user!;
  if (target.role !== 'client' && me.role !== 'admin') throw new HttpError(403, 'Admins only');
  return target;
}

clientsRouter.post('/users/:id/invite', requireStaff, (req, res) => {
  const target = manageable(req);
  if (target.id === req.user!.id) throw new HttpError(400, "You can't re-invite yourself");
  run('UPDATE users SET password_hash = NULL WHERE id = ?', target.id);
  destroyUserSessions(target.id);
  res.json({ inviteUrl: issueInvite(target.id) });
});

clientsRouter.delete('/users/:id', requireStaff, (req, res) => {
  const target = manageable(req);
  if (target.id === req.user!.id) throw new HttpError(400, "You can't remove yourself");
  if (target.role === 'admin' && one<{ n: number }>("SELECT COUNT(*) n FROM users WHERE role = 'admin'")!.n <= 1) {
    throw new HttpError(400, 'At least one admin is required');
  }
  run('DELETE FROM users WHERE id = ?', target.id);
  res.json({ ok: true });
});
