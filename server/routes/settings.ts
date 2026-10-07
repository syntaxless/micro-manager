import { Router } from 'express';
import { z } from 'zod';
import { all, getSetting, one, setSetting } from '../db.js';
import { HttpError, requireAdmin, requireAuth, isStaff } from '../auth.js';
import { appUrl, currency, stripeEnabled, stripeKey, stripeKeyFromEnv, stripeTestMode, webhookSecret } from '../prefs.js';
import { verifyStripeKey } from '../stripe.js';
import { loadExampleData, removeExampleData } from '../examples.js';
import { parse } from '../util.js';
import { THEME_IDS } from '../themes.js';
import { ACTIVE_SUB_STATUSES, hasActiveSubscription } from '../access.js';

export const settingsRouter = Router();

const CURRENCIES = ['usd', 'eur', 'gbp', 'cad', 'aud', 'nzd', 'chf', 'sek', 'nok', 'dkk', 'jpy', 'sgd', 'hkd', 'mxn', 'brl', 'inr', 'zar'] as const;

settingsRouter.patch('/settings', requireAdmin, (req, res) => {
  const body = parse(
    z.object({
      businessName: z.string().trim().min(1).max(100).optional(),
      defaultTheme: z.enum(THEME_IDS).optional(),
      currency: z.enum(CURRENCIES).optional(),
      demoPayments: z.boolean().optional(),
      appUrl: z.union([z.url({ protocol: /^https?$/ }), z.literal('')]).optional(),
      webhookSecret: z.union([z.string().trim().regex(/^whsec_\w+$/, 'Webhook secrets start with whsec_'), z.literal('')]).optional(),
      onboarded: z.boolean().optional(),
      checklistDismissed: z.boolean().optional(),
    }),
    req.body,
  );
  if (body.businessName) setSetting('business_name', body.businessName);
  if (body.defaultTheme) setSetting('default_theme', body.defaultTheme);
  if (body.currency) setSetting('currency', body.currency);
  if (body.demoPayments !== undefined) setSetting('demo_payments', body.demoPayments ? '1' : '0');
  if (body.appUrl !== undefined) setSetting('app_url', body.appUrl ? new URL(body.appUrl).origin : '');
  if (body.webhookSecret !== undefined) setSetting('stripe_webhook_secret', body.webhookSecret);
  if (body.onboarded !== undefined) setSetting('onboarded', body.onboarded ? '1' : '0');
  if (body.checklistDismissed !== undefined) setSetting('checklist_dismissed', body.checklistDismissed ? '1' : '0');
  res.json({ ok: true });
});

function stripeStatus() {
  const key = stripeKey();
  return {
    enabled: stripeEnabled(),
    testMode: stripeTestMode(),
    fromEnv: stripeKeyFromEnv(),
    keyHint: key ? `${key.slice(0, 8)}…${key.slice(-4)}` : null,
    accountName: getSetting('stripe_account_name') || null,
    webhookConfigured: webhookSecret().length > 0,
    webhookUrl: `${appUrl()}/api/stripe/webhook`,
    appUrl: appUrl(),
    currency: currency(),
    demoPayments: getSetting('demo_payments') === '1',
  };
}

settingsRouter.get('/settings/stripe', requireAdmin, (_req, res) => {
  res.json(stripeStatus());
});

/** Connects Stripe by pasting a secret key. The key is checked with Stripe before it's saved. */
settingsRouter.post('/settings/stripe', requireAdmin, async (req, res) => {
  if (stripeKeyFromEnv()) throw new HttpError(400, 'Stripe is set by the server configuration (STRIPE_SECRET_KEY).');
  const { secretKey } = parse(z.object({ secretKey: z.string().trim().max(300) }), req.body);
  if (/^pk_/.test(secretKey)) throw new HttpError(400, 'That is the publishable key. Paste the secret key instead (it starts with sk_).');
  if (!/^(sk|rk)_(test|live)_\w+$/.test(secretKey)) throw new HttpError(400, 'Stripe secret keys start with sk_test_ or sk_live_.');
  let name: string | null;
  try {
    name = await verifyStripeKey(secretKey);
  } catch (e) {
    const err = e as { type?: string; message?: string };
    if (err.type === 'StripeAuthenticationError') throw new HttpError(400, 'Stripe did not accept that key. Copy it again from your Stripe dashboard.');
    throw new HttpError(502, `Couldn't reach Stripe: ${err.message ?? 'unknown error'}`);
  }
  setSetting('stripe_secret_key', secretKey);
  setSetting('stripe_account_name', name ?? '');
  res.json(stripeStatus());
});

settingsRouter.delete('/settings/stripe', requireAdmin, (_req, res) => {
  if (stripeKeyFromEnv()) throw new HttpError(400, 'Stripe is set by the server configuration (STRIPE_SECRET_KEY).');
  setSetting('stripe_secret_key', '');
  setSetting('stripe_account_name', '');
  res.json(stripeStatus());
});

settingsRouter.post('/settings/example-data', requireAdmin, (req, res) => {
  loadExampleData(req.user!.id);
  res.json({ ok: true });
});

settingsRouter.delete('/settings/example-data', requireAdmin, (_req, res) => {
  removeExampleData();
  res.json({ ok: true });
});

const n = (sql: string, ...p: (string | number)[]) => one<{ n: number }>(sql, ...p)!.n;
const subIn = ACTIVE_SUB_STATUSES.map((s) => `'${s}'`).join(',');

settingsRouter.get('/dashboard', requireAuth, (req, res) => {
  const u = req.user!;
  const scoped = !isStaff(u);
  const cid = u.client_id ?? 0;
  const w = (alias: string) => (scoped ? `AND ${alias}.client_id = ${Number(cid)}` : '');

  const byStatus = all<{ status: string; n: number }>(
    `SELECT status, COUNT(*) n FROM projects p WHERE 1=1 ${w('p')} GROUP BY status`,
  );
  const outstanding = n(
    `SELECT COALESCE(SUM(ii.quantity * ii.unit_amount), 0) n FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id WHERE i.status = 'open' ${w('i')}`,
  );
  const paid30 = n(
    `SELECT COALESCE(SUM(ii.quantity * ii.unit_amount), 0) n FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id
     WHERE i.status = 'paid' AND i.paid_at >= datetime('now', '-30 days') ${w('i')}`,
  );
  const mrr = n(
    `SELECT COALESCE(SUM(CASE interval WHEN 'week' THEN amount * 52 / 12 WHEN 'year' THEN amount / 12 ELSE amount END), 0) n
     FROM subscriptions s WHERE status IN (${subIn}) ${w('s')}`,
  );
  const recent = all(
    `SELECT p.id, p.title, p.status, p.priority, p.updated_at, c.name AS client_name, c.color AS client_color
     FROM projects p JOIN clients c ON c.id = p.client_id WHERE 1=1 ${w('p')} ORDER BY p.updated_at DESC LIMIT 6`,
  );
  const dueSoon = all(
    `SELECT p.id, p.title, p.due_date, p.priority, c.name AS client_name FROM projects p JOIN clients c ON c.id = p.client_id
     WHERE p.status != 'done' AND p.due_date IS NOT NULL ${w('p')} ORDER BY p.due_date LIMIT 6`,
  );
  const openInvoices = all(
    `SELECT i.id, i.number, i.title, i.due_date, i.currency, c.name AS client_name,
       (SELECT COALESCE(SUM(quantity * unit_amount), 0) FROM invoice_items WHERE invoice_id = i.id) AS total
     FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.status = 'open' ${w('i')} ORDER BY i.due_date LIMIT 6`,
  );
  res.json({
    byStatus,
    outstanding,
    paid30,
    mrr,
    recent,
    dueSoon,
    openInvoices,
    clients: scoped ? null : n('SELECT COUNT(*) n FROM clients'),
    files: n(`SELECT COUNT(*) n FROM files f WHERE 1=1 ${w('f')}`),
    activeSubscription: scoped ? hasActiveSubscription(cid) : null,
    currency: currency(),
    checklist: u.role === 'admin' && getSetting('checklist_dismissed') !== '1' ? gettingStarted() : null,
  });
});

/** "Getting started" steps for a new studio; example clients don't count. */
function gettingStarted() {
  const real = 'JOIN clients c ON c.id = x.client_id AND c.is_example = 0';
  const has = (sql: string) => !!one(sql);
  return [
    { key: 'client', done: has('SELECT 1 FROM clients WHERE is_example = 0') },
    { key: 'invite', done: has(`SELECT 1 FROM users x ${real} WHERE x.role = 'client'`) },
    { key: 'stripe', done: stripeEnabled() },
    { key: 'file', done: has(`SELECT 1 FROM files x ${real}`) },
    { key: 'invoice', done: has(`SELECT 1 FROM invoices x ${real} WHERE x.status != 'draft'`) },
  ];
}
