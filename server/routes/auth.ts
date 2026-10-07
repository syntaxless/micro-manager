import { Router } from 'express';
import { z } from 'zod';
import { all, getSetting, one, run, setSetting, type User } from '../db.js';
import {
  HttpError,
  createSession,
  destroySession,
  destroyUserSessions,
  hashPassword,
  publicUser,
  requireAuth,
  verifyPassword,
} from '../auth.js';
import { currency, demoPayments, rememberAppUrl, stripeEnabled, stripeTestMode } from '../prefs.js';
import { hasExampleData } from '../examples.js';
import { parse } from '../util.js';
import { THEME_IDS } from '../themes.js';

export const authRouter = Router();

const password = z.string().min(8, 'Passwords need at least 8 characters').max(200);

authRouter.get('/auth/state', (req, res) => {
  const userCount = one<{ n: number }>('SELECT COUNT(*) n FROM users')!.n;
  const client = req.user?.client_id
    ? one<{ id: number; name: string; company: string | null }>('SELECT id, name, company FROM clients WHERE id = ?', req.user.client_id)
    : null;
  res.json({
    user: req.user ? publicUser(req.user) : null,
    client,
    needsSetup: userCount === 0,
    stripe: stripeEnabled(),
    demoPayments: demoPayments(),
    stripeTestMode: stripeTestMode(),
    businessName: getSetting('business_name', 'Micro Manager'),
    defaultTheme: getSetting('default_theme', 'tokyo-night'),
    currency: currency(),
    onboarded: getSetting('onboarded') === '1' || !!one('SELECT 1 FROM clients LIMIT 1'),
    hasExampleData: req.user && req.user.role !== 'client' ? hasExampleData() : false,
  });
});

authRouter.post('/auth/setup', (req, res) => {
  const userCount = one<{ n: number }>('SELECT COUNT(*) n FROM users')!.n;
  if (userCount > 0) throw new HttpError(409, 'Setup has already been completed');
  const body = parse(
    z.object({
      name: z.string().trim().min(1).max(100),
      email: z.email().max(200),
      password,
      businessName: z.string().trim().max(100).optional(),
      origin: z.string().max(300).optional(),
    }),
    req.body,
  );
  const { id } = run(
    "INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, 'admin')",
    body.email,
    body.name,
    hashPassword(body.password),
  );
  if (body.businessName) setSetting('business_name', body.businessName);
  rememberAppUrl(body.origin);
  createSession(req, res, id);
  res.json({ ok: true });
});

// Small in-memory brute-force brake: 10 failures per 15 minutes per IP+email.
const failures = new Map<string, { n: number; until: number }>();

authRouter.post('/auth/login', (req, res) => {
  const body = parse(z.object({ email: z.string().trim().max(200), password: z.string().max(200) }), req.body);
  const key = `${req.ip}|${body.email.toLowerCase()}`;
  const f = failures.get(key);
  if (f && f.n >= 10 && f.until > Date.now()) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
  const user = one<User>('SELECT * FROM users WHERE email = ?', body.email);
  if (!user || !verifyPassword(body.password, user.password_hash)) {
    const cur = f && f.until > Date.now() ? f : { n: 0, until: Date.now() + 15 * 60_000 };
    cur.n++;
    failures.set(key, cur);
    throw new HttpError(401, 'Email or password is incorrect');
  }
  failures.delete(key);
  createSession(req, res, user.id);
  res.json({ user: publicUser(user) });
});

authRouter.post('/auth/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

function inviteUser(token: string) {
  const user = one<User & { invite_expires: string }>(
    'SELECT * FROM users WHERE invite_token = ? AND invite_expires > ?',
    token,
    new Date().toISOString(),
  );
  if (!user) throw new HttpError(404, 'This invite link is invalid or has expired');
  return user;
}

authRouter.get('/auth/invite/:token', (req, res) => {
  const user = inviteUser(req.params.token);
  res.json({ email: user.email, name: user.name, businessName: getSetting('business_name', 'Micro Manager') });
});

authRouter.post('/auth/invite/:token', (req, res) => {
  const user = inviteUser(req.params.token);
  const body = parse(z.object({ password, name: z.string().trim().min(1).max(100).optional() }), req.body);
  run(
    'UPDATE users SET password_hash = ?, name = COALESCE(?, name), invite_token = NULL, invite_expires = NULL WHERE id = ?',
    hashPassword(body.password),
    body.name ?? null,
    user.id,
  );
  destroyUserSessions(user.id);
  createSession(req, res, user.id);
  res.json({ ok: true });
});

authRouter.patch('/me', requireAuth, (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(1).max(100).optional(),
      theme: z.enum(THEME_IDS).nullable().optional(),
      currentPassword: z.string().max(200).optional(),
      newPassword: password.optional(),
    }),
    req.body,
  );
  const u = req.user!;
  if (body.newPassword) {
    if (!verifyPassword(body.currentPassword ?? '', u.password_hash)) throw new HttpError(400, 'Current password is incorrect');
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(body.newPassword), u.id);
    destroyUserSessions(u.id, req);
  }
  if (body.name !== undefined) run('UPDATE users SET name = ? WHERE id = ?', body.name, u.id);
  if (body.theme !== undefined) run('UPDATE users SET theme = ? WHERE id = ?', body.theme, u.id);
  res.json({ user: publicUser(one<User>('SELECT * FROM users WHERE id = ?', u.id)!) });
});

/** Lightweight directory used for mentions and assignee labels. */
authRouter.get('/people', requireAuth, (req, res) => {
  const u = req.user!;
  const rows =
    u.role === 'client'
      ? all("SELECT id, name, role FROM users WHERE role != 'client' OR client_id = ?", u.client_id)
      : all('SELECT id, name, role, client_id FROM users');
  res.json(rows);
});
