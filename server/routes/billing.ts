import { Router } from 'express';
import { z } from 'zod';
import { all, one, run, tx, type Invoice, type Subscription, type User } from '../db.js';
import { HttpError, assertClientAccess, isStaff, requireAuth, requireStaff } from '../auth.js';
import { config, demoPayments, stripeEnabled } from '../config.js';
import { dateStr, idParam, optionalId, parse } from '../util.js';
import {
  applyStripeSubscription,
  createCheckoutForSubscription,
  ensureCustomer,
  refreshFromStripe,
  sendStripeInvoice,
  stripe,
} from '../stripe.js';

export const billingRouter = Router();
billingRouter.use(requireAuth);

// ---------- Invoices ----------

const itemSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().int().min(1).max(10_000),
  unit_amount: z.number().int().min(0).max(100_000_000), // minor units (cents)
});

const invoiceSchema = z.object({
  client_id: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(5000).optional(),
  due_date: dateStr,
  currency: z.string().regex(/^[a-z]{3}$/).optional(),
  items: z.array(itemSchema).min(1, 'Add at least one line item').max(100),
  file_ids: z.array(z.number().int().positive()).max(200).optional(),
});

function invoiceTotal(id: number) {
  return one<{ t: number }>('SELECT COALESCE(SUM(quantity * unit_amount), 0) t FROM invoice_items WHERE invoice_id = ?', id)!.t;
}

function loadInvoice(user: User, id: number) {
  const inv = one<Invoice>('SELECT * FROM invoices WHERE id = ?', id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  assertClientAccess(user, inv.client_id);
  if (!isStaff(user) && inv.status === 'draft') throw new HttpError(404, 'Invoice not found');
  return inv;
}

function nextNumber() {
  const n = one<{ n: number }>('SELECT COUNT(*) n FROM invoices')!.n + 1;
  let candidate = `INV-${String(n).padStart(4, '0')}`;
  for (let i = n + 1; one('SELECT 1 FROM invoices WHERE number = ?', candidate); i++) {
    candidate = `INV-${String(i).padStart(4, '0')}`;
  }
  return candidate;
}

function setAttachments(invoiceId: number, clientId: number, fileIds: number[]) {
  for (const fid of fileIds) {
    if (!one('SELECT 1 FROM files WHERE id = ? AND client_id = ?', fid, clientId)) {
      throw new HttpError(400, 'Attached files must belong to the same client');
    }
  }
  run('DELETE FROM invoice_files WHERE invoice_id = ?', invoiceId);
  for (const fid of new Set(fileIds)) run('INSERT INTO invoice_files (invoice_id, file_id) VALUES (?, ?)', invoiceId, fid);
}

function setItems(invoiceId: number, items: z.infer<typeof itemSchema>[]) {
  run('DELETE FROM invoice_items WHERE invoice_id = ?', invoiceId);
  for (const it of items) {
    run('INSERT INTO invoice_items (invoice_id, description, quantity, unit_amount) VALUES (?, ?, ?, ?)', invoiceId, it.description, it.quantity, it.unit_amount);
  }
}

async function sendInvoice(inv: Invoice) {
  if (inv.status !== 'draft') throw new HttpError(400, 'Only drafts can be sent');
  if (invoiceTotal(inv.id) <= 0) throw new HttpError(400, 'Invoice total must be more than zero');
  if (stripeEnabled()) await sendStripeInvoice(inv.id);
  else run("UPDATE invoices SET status = 'open', sent_at = datetime('now') WHERE id = ?", inv.id);
}

billingRouter.get('/invoices', async (req, res) => {
  const u = req.user!;
  const clientId = isStaff(u) ? optionalId(req.query.client_id) : u.client_id;
  await refreshFromStripe(clientId);
  const where: string[] = [];
  const params: number[] = [];
  if (clientId) (where.push('i.client_id = ?'), params.push(clientId));
  if (!isStaff(u)) where.push("i.status != 'draft'");
  res.json(
    all(
      `SELECT i.*, c.name AS client_name, c.color AS client_color,
         (SELECT COALESCE(SUM(quantity * unit_amount), 0) FROM invoice_items WHERE invoice_id = i.id) AS total,
         (SELECT COUNT(*) FROM invoice_files WHERE invoice_id = i.id) AS file_count
       FROM invoices i JOIN clients c ON c.id = i.client_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY i.id DESC`,
      ...params,
    ),
  );
});

billingRouter.get('/invoices/:id', (req, res) => {
  const u = req.user!;
  const inv = loadInvoice(u, idParam(req));
  const items = all('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id', inv.id);
  const files = all(
    'SELECT f.id, f.name, f.size, f.mime FROM invoice_files x JOIN files f ON f.id = x.file_id WHERE x.invoice_id = ? ORDER BY f.name',
    inv.id,
  );
  const client = one('SELECT id, name, company, color FROM clients WHERE id = ?', inv.client_id);
  res.json({ ...inv, client, items, files, total: invoiceTotal(inv.id) });
});

billingRouter.post('/invoices', requireStaff, async (req, res) => {
  const body = parse(invoiceSchema.extend({ send: z.boolean().optional() }), req.body);
  if (!one('SELECT 1 FROM clients WHERE id = ?', body.client_id)) throw new HttpError(404, 'Client not found');
  const id = tx(() => {
    const { id } = run(
      'INSERT INTO invoices (client_id, number, title, notes, currency, due_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      body.client_id,
      nextNumber(),
      body.title,
      body.notes ?? '',
      body.currency ?? config.currency,
      body.due_date ?? null,
      req.user!.id,
    );
    setItems(id, body.items);
    setAttachments(id, body.client_id, body.file_ids ?? []);
    return id;
  });
  if (body.send) {
    try {
      await sendInvoice(one<Invoice>('SELECT * FROM invoices WHERE id = ?', id)!);
    } catch (e) {
      // Keep the draft so nothing typed is lost; report why sending failed.
      return res.status(201).json({ id, sendError: (e as Error).message });
    }
  }
  res.status(201).json({ id });
});

billingRouter.patch('/invoices/:id', requireStaff, (req, res) => {
  const inv = loadInvoice(req.user!, idParam(req));
  const body = parse(invoiceSchema.partial().omit({ client_id: true }), req.body);
  if (inv.status !== 'draft' && (body.items || body.title || body.due_date !== undefined || body.currency || body.notes !== undefined)) {
    throw new HttpError(400, 'Only draft invoices can be edited. Attachments can still change.');
  }
  tx(() => {
    if (inv.status === 'draft') {
      run(
        'UPDATE invoices SET title = ?, notes = ?, due_date = ?, currency = ? WHERE id = ?',
        body.title ?? inv.title,
        body.notes ?? inv.notes,
        body.due_date !== undefined ? body.due_date : inv.due_date,
        body.currency ?? inv.currency,
        inv.id,
      );
      if (body.items) setItems(inv.id, body.items);
    }
    if (body.file_ids) setAttachments(inv.id, inv.client_id, body.file_ids);
  });
  res.json({ ok: true });
});

billingRouter.post('/invoices/:id/send', requireStaff, async (req, res) => {
  const inv = loadInvoice(req.user!, idParam(req));
  await sendInvoice(inv);
  res.json(one('SELECT * FROM invoices WHERE id = ?', inv.id));
});

billingRouter.post('/invoices/:id/mark-paid', requireStaff, async (req, res) => {
  const inv = loadInvoice(req.user!, idParam(req));
  if (inv.status !== 'open') throw new HttpError(400, 'Only open invoices can be marked paid');
  if (inv.stripe_invoice_id) await stripe().invoices.pay(inv.stripe_invoice_id, { paid_out_of_band: true });
  run("UPDATE invoices SET status = 'paid', paid_at = datetime('now') WHERE id = ?", inv.id);
  res.json({ ok: true });
});

billingRouter.post('/invoices/:id/void', requireStaff, async (req, res) => {
  const inv = loadInvoice(req.user!, idParam(req));
  if (inv.status !== 'open') throw new HttpError(400, 'Only open invoices can be voided');
  if (inv.stripe_invoice_id) await stripe().invoices.voidInvoice(inv.stripe_invoice_id);
  run("UPDATE invoices SET status = 'void' WHERE id = ?", inv.id);
  res.json({ ok: true });
});

billingRouter.delete('/invoices/:id', requireStaff, (req, res) => {
  const inv = loadInvoice(req.user!, idParam(req));
  if (inv.status !== 'draft') throw new HttpError(400, 'Only drafts can be deleted. Void sent invoices instead.');
  run('DELETE FROM invoices WHERE id = ?', inv.id);
  res.json({ ok: true });
});

/** Client "Pay" button: Stripe's hosted page when configured, otherwise a demo payment. */
billingRouter.post('/invoices/:id/pay', async (req, res) => {
  const inv = loadInvoice(req.user!, idParam(req));
  if (inv.status !== 'open') throw new HttpError(400, 'This invoice is not awaiting payment');
  if (stripeEnabled()) {
    if (!inv.hosted_url) throw new HttpError(400, 'This invoice has no payment link yet');
    return res.json({ url: inv.hosted_url });
  }
  if (!demoPayments()) throw new HttpError(400, "Online payment isn't set up yet. Contact the studio to pay this invoice.");
  run("UPDATE invoices SET status = 'paid', paid_at = datetime('now') WHERE id = ?", inv.id);
  res.json({ paid: true, demo: true });
});

billingRouter.post('/billing/refresh', async (req, res) => {
  const u = req.user!;
  await refreshFromStripe(isStaff(u) ? null : u.client_id, true);
  res.json({ ok: true });
});

// ---------- Subscriptions ----------

billingRouter.get('/subscriptions', async (req, res) => {
  const u = req.user!;
  const clientId = isStaff(u) ? optionalId(req.query.client_id) : u.client_id;
  await refreshFromStripe(clientId);
  res.json(
    all(
      `SELECT s.*, c.name AS client_name, c.color AS client_color FROM subscriptions s JOIN clients c ON c.id = s.client_id
       ${clientId ? 'WHERE s.client_id = ?' : ''} ORDER BY s.id DESC`,
      ...(clientId ? [clientId] : []),
    ),
  );
});

billingRouter.post('/subscriptions', requireStaff, (req, res) => {
  const body = parse(
    z.object({
      client_id: z.number().int().positive(),
      name: z.string().trim().min(1).max(200),
      amount: z.number().int().min(50, 'Amount is too small').max(100_000_000),
      interval: z.enum(['week', 'month', 'year']),
      currency: z.string().regex(/^[a-z]{3}$/).optional(),
    }),
    req.body,
  );
  if (!one('SELECT 1 FROM clients WHERE id = ?', body.client_id)) throw new HttpError(404, 'Client not found');
  const { id } = run(
    'INSERT INTO subscriptions (client_id, name, amount, currency, interval, created_by) VALUES (?, ?, ?, ?, ?, ?)',
    body.client_id,
    body.name,
    body.amount,
    body.currency ?? config.currency,
    body.interval,
    req.user!.id,
  );
  res.status(201).json(one('SELECT * FROM subscriptions WHERE id = ?', id));
});

function loadSub(user: User, id: number) {
  const s = one<Subscription>('SELECT * FROM subscriptions WHERE id = ?', id);
  if (!s) throw new HttpError(404, 'Subscription not found');
  assertClientAccess(user, s.client_id);
  return s;
}

const addInterval = (interval: Subscription['interval']) => {
  const d = new Date();
  if (interval === 'week') d.setDate(d.getDate() + 7);
  else if (interval === 'month') d.setMonth(d.getMonth() + 1);
  else d.setFullYear(d.getFullYear() + 1);
  return d.toISOString();
};

/**
 * Starts checkout for a pending subscription. Returns a Stripe Checkout URL.
 * Without Stripe, staff can activate it by hand (paid offline), and clients can in demo mode.
 */
billingRouter.post('/subscriptions/:id/checkout', async (req, res) => {
  const u = req.user!;
  const sub = loadSub(u, idParam(req));
  if (!['pending', 'incomplete', 'incomplete_expired'].includes(sub.status)) throw new HttpError(400, 'This subscription is already set up');
  if (stripeEnabled()) return res.json({ url: await createCheckoutForSubscription(sub) });
  if (!isStaff(u) && !demoPayments()) throw new HttpError(400, "Online payment isn't set up yet. Contact the studio to start this subscription.");
  run("UPDATE subscriptions SET status = 'active', current_period_end = ? WHERE id = ?", addInterval(sub.interval), sub.id);
  res.json({ active: true, demo: true });
});

billingRouter.post('/subscriptions/:id/cancel', requireStaff, async (req, res) => {
  const sub = loadSub(req.user!, idParam(req));
  if (sub.stripe_subscription_id) {
    applyStripeSubscription(await stripe().subscriptions.cancel(sub.stripe_subscription_id), sub.id);
  }
  run("UPDATE subscriptions SET status = 'canceled', canceled_at = COALESCE(canceled_at, datetime('now')) WHERE id = ?", sub.id);
  res.json({ ok: true });
});

billingRouter.delete('/subscriptions/:id', requireStaff, (req, res) => {
  const sub = loadSub(req.user!, idParam(req));
  if (sub.stripe_subscription_id && !['canceled', 'incomplete_expired'].includes(sub.status)) {
    throw new HttpError(400, 'Cancel the subscription before removing it');
  }
  run('DELETE FROM subscriptions WHERE id = ?', sub.id);
  res.json({ ok: true });
});

/** Opens Stripe's customer portal so clients can update cards or cancel. */
billingRouter.post('/billing/portal', async (req, res) => {
  const u = req.user!;
  const clientId = isStaff(u) ? optionalId(req.body?.client_id) : u.client_id;
  if (!clientId) throw new HttpError(400, 'Pick a client');
  const customer = await ensureCustomer(clientId);
  const session = await stripe().billingPortal.sessions.create({ customer, return_url: `${config.appUrl}/billing` });
  res.json({ url: session.url });
});
