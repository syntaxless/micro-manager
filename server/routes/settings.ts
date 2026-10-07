import { Router } from 'express';
import { z } from 'zod';
import { all, getSetting, one, setSetting } from '../db.js';
import { requireAdmin, requireAuth, isStaff } from '../auth.js';
import { config, stripeEnabled } from '../config.js';
import { parse } from '../util.js';
import { THEME_IDS } from '../themes.js';
import { ACTIVE_SUB_STATUSES, hasActiveSubscription } from '../access.js';

export const settingsRouter = Router();

settingsRouter.patch('/settings', requireAdmin, (req, res) => {
  const body = parse(
    z.object({ businessName: z.string().trim().min(1).max(100).optional(), defaultTheme: z.enum(THEME_IDS).optional() }),
    req.body,
  );
  if (body.businessName) setSetting('business_name', body.businessName);
  if (body.defaultTheme) setSetting('default_theme', body.defaultTheme);
  res.json({ businessName: getSetting('business_name', 'Micro Manager'), defaultTheme: getSetting('default_theme', 'tokyo-night') });
});

settingsRouter.get('/settings/stripe', requireAdmin, (_req, res) => {
  res.json({
    enabled: stripeEnabled(),
    testMode: config.stripeSecretKey.startsWith('sk_test_') || config.stripeSecretKey.startsWith('rk_test_'),
    webhookConfigured: config.stripeWebhookSecret.length > 0,
    webhookUrl: `${config.appUrl}/api/stripe/webhook`,
  });
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
    currency: config.currency,
  });
});
