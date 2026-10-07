import Stripe from 'stripe';
import { config, stripeEnabled } from './config.js';
import { all, one, run, type Client, type Invoice, type Subscription } from './db.js';
import { HttpError } from './auth.js';

let client: Stripe | null = null;

export function stripe(): Stripe {
  if (!stripeEnabled()) throw new HttpError(400, 'Stripe is not configured');
  if (!client) client = new Stripe(config.stripeSecretKey, { appInfo: { name: 'Micro Manager' } });
  return client;
}

/** Lets tests swap in a fake Stripe client. */
export function setStripeClient(fake: unknown) {
  client = fake as Stripe;
}

export async function ensureCustomer(clientId: number): Promise<string> {
  const c = one<Client>('SELECT * FROM clients WHERE id = ?', clientId);
  if (!c) throw new HttpError(404, 'Client not found');
  if (c.stripe_customer_id) return c.stripe_customer_id;
  const contact = one<{ email: string; name: string }>(
    "SELECT email, name FROM users WHERE client_id = ? AND role = 'client' ORDER BY id LIMIT 1",
    clientId,
  );
  const customer = await stripe().customers.create({
    name: c.company || c.name,
    email: c.email || contact?.email || undefined,
    metadata: { mm_client_id: String(c.id) },
  });
  run('UPDATE clients SET stripe_customer_id = ? WHERE id = ?', customer.id, c.id);
  return customer.id;
}

const unix = (d: string) => Math.floor(new Date(d + 'T23:59:59Z').getTime() / 1000);

/** Creates, finalizes and sends a Stripe invoice that mirrors a local draft invoice. */
export async function sendStripeInvoice(invoiceId: number) {
  const inv = one<Invoice>('SELECT * FROM invoices WHERE id = ?', invoiceId)!;
  const items = all<{ description: string; quantity: number; unit_amount: number }>(
    'SELECT * FROM invoice_items WHERE invoice_id = ?',
    invoiceId,
  );
  const customer = await ensureCustomer(inv.client_id);
  const s = stripe();

  const dueTs = inv.due_date ? unix(inv.due_date) : 0;
  const dueInFuture = dueTs > Date.now() / 1000 + 3600;
  const draft = await s.invoices.create({
    customer,
    collection_method: 'send_invoice',
    currency: inv.currency,
    description: inv.title,
    footer: inv.notes || undefined,
    pending_invoice_items_behavior: 'exclude',
    ...(dueInFuture ? { due_date: dueTs } : { days_until_due: 14 }),
    metadata: { mm_invoice_id: String(inv.id), mm_number: inv.number },
  });
  for (const it of items) {
    await s.invoiceItems.create({
      customer,
      invoice: draft.id,
      currency: inv.currency,
      amount: it.quantity * it.unit_amount,
      description: it.quantity > 1 ? `${it.description} (× ${it.quantity})` : it.description,
    });
  }
  const finalized = await s.invoices.finalizeInvoice(draft.id!);
  let sent = finalized;
  try {
    sent = await s.invoices.sendInvoice(finalized.id!);
  } catch (e) {
    // Sending the email can fail in test mode (e.g. unverified recipient); the hosted link still works.
    console.warn('[stripe] sendInvoice failed:', (e as Error).message);
  }
  run(
    "UPDATE invoices SET stripe_invoice_id = ?, hosted_url = ?, status = ?, sent_at = datetime('now') WHERE id = ?",
    sent.id!,
    sent.hosted_invoice_url ?? null,
    mapInvoiceStatus(sent.status),
    inv.id,
  );
}

export function mapInvoiceStatus(s: string | null | undefined): Invoice['status'] {
  switch (s) {
    case 'paid':
      return 'paid';
    case 'void':
      return 'void';
    case 'uncollectible':
      return 'uncollectible';
    case 'draft':
      return 'draft';
    default:
      return 'open';
  }
}

export function applyStripeInvoice(si: { id?: string; status?: string | null; hosted_invoice_url?: string | null; metadata?: Record<string, string> | null }) {
  const local =
    one<Invoice>('SELECT * FROM invoices WHERE stripe_invoice_id = ?', si.id ?? '') ??
    (si.metadata?.mm_invoice_id
      ? one<Invoice>('SELECT * FROM invoices WHERE id = ?', Number(si.metadata.mm_invoice_id))
      : undefined);
  if (!local) return false;
  const status = mapInvoiceStatus(si.status);
  run(
    `UPDATE invoices SET status = ?, hosted_url = COALESCE(?, hosted_url),
       paid_at = CASE WHEN ? = 'paid' AND paid_at IS NULL THEN datetime('now') ELSE paid_at END
     WHERE id = ?`,
    status,
    si.hosted_invoice_url ?? null,
    status,
    local.id,
  );
  return true;
}

const lastSync = new Map<string, number>();
const throttled = (key: string, ms = 20_000) => {
  const t = lastSync.get(key) ?? 0;
  if (Date.now() - t < ms) return true;
  lastSync.set(key, Date.now());
  return false;
};

/**
 * Pulls fresh status for open invoices and subscriptions straight from Stripe.
 * This keeps self-hosted installs correct even when webhooks can't reach them.
 */
export async function refreshFromStripe(clientId: number | null, force = false) {
  if (!stripeEnabled()) return;
  const key = `client:${clientId ?? 'all'}`;
  if (!force && throttled(key)) return;
  const s = stripe();
  const invs = clientId
    ? all<Invoice>("SELECT * FROM invoices WHERE client_id = ? AND status = 'open' AND stripe_invoice_id IS NOT NULL", clientId)
    : all<Invoice>("SELECT * FROM invoices WHERE status = 'open' AND stripe_invoice_id IS NOT NULL");
  const subs = clientId
    ? all<Subscription>("SELECT * FROM subscriptions WHERE client_id = ? AND status NOT IN ('canceled','incomplete_expired')", clientId)
    : all<Subscription>("SELECT * FROM subscriptions WHERE status NOT IN ('canceled','incomplete_expired')");
  await Promise.all([
    ...invs.map(async (i) => {
      try {
        applyStripeInvoice(await s.invoices.retrieve(i.stripe_invoice_id!));
      } catch (e) {
        console.warn('[stripe] invoice refresh failed', i.id, (e as Error).message);
      }
    }),
    ...subs.map(async (sub) => {
      try {
        if (sub.stripe_subscription_id) {
          applyStripeSubscription(await s.subscriptions.retrieve(sub.stripe_subscription_id));
        } else if (sub.checkout_session_id) {
          const session = await s.checkout.sessions.retrieve(sub.checkout_session_id);
          if (session.subscription) {
            const id = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
            applyStripeSubscription(await s.subscriptions.retrieve(id), sub.id);
          }
        }
      } catch (e) {
        console.warn('[stripe] subscription refresh failed', sub.id, (e as Error).message);
      }
    }),
  ]);
}

// Stripe moved current_period_end onto subscription items; read whichever exists.
type StripeSubLike = {
  id: string;
  status: string;
  metadata?: Record<string, string> | null;
  current_period_end?: number;
  canceled_at?: number | null;
  items?: { data?: { current_period_end?: number }[] };
};

export function applyStripeSubscription(ss: StripeSubLike, localId?: number) {
  const id =
    localId ??
    one<{ id: number }>('SELECT id FROM subscriptions WHERE stripe_subscription_id = ?', ss.id)?.id ??
    (ss.metadata?.mm_subscription_id ? Number(ss.metadata.mm_subscription_id) : undefined);
  if (!id) return false;
  const end = ss.items?.data?.[0]?.current_period_end ?? ss.current_period_end;
  run(
    `UPDATE subscriptions SET stripe_subscription_id = ?, status = ?, current_period_end = ?,
       canceled_at = CASE WHEN ? = 'canceled' AND canceled_at IS NULL THEN datetime('now') ELSE canceled_at END
     WHERE id = ?`,
    ss.id,
    ss.status,
    end ? new Date(end * 1000).toISOString() : null,
    ss.status,
    id,
  );
  return true;
}

export async function createCheckoutForSubscription(sub: Subscription) {
  const s = stripe();
  const customer = await ensureCustomer(sub.client_id);
  let priceId = sub.stripe_price_id;
  if (!priceId) {
    const product = await s.products.create({ name: sub.name, metadata: { mm_subscription_id: String(sub.id) } });
    const price = await s.prices.create({
      product: product.id,
      currency: sub.currency,
      unit_amount: sub.amount,
      recurring: { interval: sub.interval },
    });
    priceId = price.id;
    run('UPDATE subscriptions SET stripe_price_id = ? WHERE id = ?', priceId, sub.id);
  }
  const session = await s.checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${config.appUrl}/billing?subscribed=${sub.id}`,
    cancel_url: `${config.appUrl}/billing`,
    client_reference_id: String(sub.id),
    subscription_data: { metadata: { mm_subscription_id: String(sub.id) } },
    metadata: { mm_subscription_id: String(sub.id) },
  });
  run('UPDATE subscriptions SET checkout_session_id = ? WHERE id = ?', session.id, sub.id);
  return session.url!;
}

export async function handleWebhookEvent(event: Stripe.Event) {
  const obj = event.data.object as unknown as Record<string, unknown>;
  switch (event.type) {
    case 'invoice.paid':
    case 'invoice.payment_succeeded':
    case 'invoice.finalized':
    case 'invoice.voided':
    case 'invoice.marked_uncollectible':
    case 'invoice.updated':
      applyStripeInvoice(obj as Parameters<typeof applyStripeInvoice>[0]);
      break;
    case 'checkout.session.completed': {
      const localId = Number((obj.metadata as Record<string, string> | undefined)?.mm_subscription_id ?? obj.client_reference_id);
      const subId = obj.subscription as string | undefined;
      if (localId && subId) applyStripeSubscription(await stripe().subscriptions.retrieve(subId), localId);
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      applyStripeSubscription(obj as unknown as StripeSubLike);
      break;
  }
}
