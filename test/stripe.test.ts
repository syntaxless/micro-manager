import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { agent, startApp, tokenFrom } from './helpers.js';

// A stand-in for the Stripe API that records calls and keeps objects in memory.
const calls: string[] = [];
const invoices = new Map<string, any>();
const subs = new Map<string, any>();
let n = 0;
const id = (p: string) => `${p}_${++n}`;
const real = new Stripe('sk_test_fake');

const fake = {
  customers: { create: async (p: any) => (calls.push('customers.create'), { id: id('cus'), ...p }) },
  invoices: {
    create: async (p: any) => {
      calls.push('invoices.create');
      const inv = { id: id('in'), status: 'draft', metadata: p.metadata, items: [] as any[], ...p };
      invoices.set(inv.id, inv);
      return inv;
    },
    finalizeInvoice: async (iid: string) => {
      calls.push('invoices.finalize');
      return Object.assign(invoices.get(iid), { status: 'open', hosted_invoice_url: `https://invoice.stripe.test/${iid}` });
    },
    sendInvoice: async (iid: string) => (calls.push('invoices.send'), invoices.get(iid)),
    retrieve: async (iid: string) => invoices.get(iid),
    pay: async (iid: string, p: any) => (calls.push(`invoices.pay:${p.paid_out_of_band}`), Object.assign(invoices.get(iid), { status: 'paid' })),
    voidInvoice: async (iid: string) => Object.assign(invoices.get(iid), { status: 'void' }),
  },
  invoiceItems: {
    create: async (p: any) => {
      calls.push('invoiceItems.create');
      invoices.get(p.invoice).items.push(p);
      return { id: id('ii') };
    },
  },
  products: { create: async () => ({ id: id('prod') }) },
  prices: { create: async (p: any) => (calls.push(`prices.create:${p.recurring.interval}`), { id: id('price') }) },
  checkout: {
    sessions: {
      create: async (p: any) => (calls.push('checkout.create'), { id: id('cs'), url: `https://checkout.stripe.test/${p.client_reference_id}`, subscription: null }),
      retrieve: async () => ({ subscription: null }),
    },
  },
  subscriptions: {
    retrieve: async (sid: string) => subs.get(sid),
    cancel: async (sid: string) => Object.assign(subs.get(sid), { status: 'canceled' }),
  },
  webhooks: real.webhooks,
};

let app: Awaited<ReturnType<typeof startApp>>;
let A: ReturnType<typeof agent>;
let C: ReturnType<typeof agent>;
let clientId: number;

before(async () => {
  app = await startApp({ STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_WEBHOOK_SECRET: 'whsec_test' });
  const { setStripeClient } = await import('../server/stripe.js');
  setStripeClient(fake);
  A = agent(app.base);
  await A.post('/auth/setup', { name: 'Ada', email: 'ada@studio.test', password: 'password123' });
  const c = await A.post('/clients', { name: 'Acme', contact: { name: 'Wile', email: 'wile@acme.test' } });
  clientId = c.data.id;
  C = agent(app.base);
  await C.post(`/auth/invite/${tokenFrom(c.data.inviteUrl)}`, { password: 'clientpass1' });
});

after(() => app.close());

async function webhook(event: object) {
  const payload = JSON.stringify(event);
  const header = real.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test' });
  return fetch(app.base + '/api/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': header }, body: payload });
}

test('sending an invoice creates, finalizes and emails it through Stripe', async () => {
  const form = new FormData();
  form.append('client_id', String(clientId));
  form.append('files', new Blob(['psd']), 'final.psd');
  const fileId = (await A.upload('/files', form)).data[0].id;

  const r = await A.post('/invoices', {
    client_id: clientId,
    title: 'Poster',
    items: [
      { description: 'Poster design', quantity: 1, unit_amount: 90000 },
      { description: 'Revisions', quantity: 2, unit_amount: 10000 },
    ],
    file_ids: [fileId],
    send: true,
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.sendError, undefined);
  assert.deepEqual(calls.slice(0, 5), ['customers.create', 'invoices.create', 'invoiceItems.create', 'invoiceItems.create', 'invoices.finalize']);
  const stripeInv = [...invoices.values()][0];
  assert.deepEqual(
    stripeInv.items.map((i: any) => i.amount),
    [90000, 20000],
  );

  const pay = await C.post(`/invoices/${r.data.id}/pay`);
  assert.match(pay.data.url, /^https:\/\/invoice\.stripe\.test\//);
  assert.equal((await C.get(`/files/${fileId}/download`)).status, 402);

  // Stripe tells us it was paid.
  const res = await webhook({ id: 'evt_1', object: 'event', type: 'invoice.paid', data: { object: { ...stripeInv, status: 'paid' } } });
  assert.equal(res.status, 200);
  assert.equal((await C.get(`/invoices/${r.data.id}`)).data.status, 'paid');
  assert.equal((await C.get(`/files/${fileId}/download`)).status, 200);
});

test('webhooks with a bad signature are rejected', async () => {
  const res = await fetch(app.base + '/api/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=bad' }, body: '{}' });
  assert.equal(res.status, 400);
});

test('status syncs from Stripe even without webhooks', async () => {
  const r = await A.post('/invoices', { client_id: clientId, title: 'Sync me', items: [{ description: 'x', quantity: 1, unit_amount: 5000 }], send: true });
  const inv = (await A.get(`/invoices/${r.data.id}`)).data;
  invoices.get(inv.stripe_invoice_id).status = 'paid';
  await A.post('/billing/refresh');
  assert.equal((await A.get(`/invoices/${r.data.id}`)).data.status, 'paid');
});

test('marking paid outside Stripe records an out-of-band payment', async () => {
  const r = await A.post('/invoices', { client_id: clientId, title: 'Cash', items: [{ description: 'x', quantity: 1, unit_amount: 5000 }], send: true });
  await A.post(`/invoices/${r.data.id}/mark-paid`);
  assert.ok(calls.includes('invoices.pay:true'));
  assert.equal((await C.get(`/invoices/${r.data.id}`)).data.status, 'paid');
});

test('subscriptions go through Checkout and activate from the webhook', async () => {
  const form = new FormData();
  form.append('client_id', String(clientId));
  form.append('requires_subscription', 'true');
  form.append('files', new Blob(['monthly']), 'monthly.zip');
  const fileId = (await A.upload('/files', form)).data[0].id;
  assert.equal((await C.get(`/files/${fileId}/download`)).status, 402);

  const sub = (await A.post('/subscriptions', { client_id: clientId, name: 'Retainer', amount: 200000, interval: 'month' })).data;
  const co = await C.post(`/subscriptions/${sub.id}/checkout`);
  assert.equal(co.data.url, `https://checkout.stripe.test/${sub.id}`);
  assert.ok(calls.includes('prices.create:month'));

  const stripeSub = { id: 'sub_123', object: 'subscription', status: 'active', metadata: { mm_subscription_id: String(sub.id) }, items: { data: [{ current_period_end: 1893456000 }] } };
  subs.set(stripeSub.id, stripeSub);
  await webhook({ id: 'evt_2', object: 'event', type: 'customer.subscription.created', data: { object: stripeSub } });

  const mine = (await C.get('/subscriptions')).data[0];
  assert.equal(mine.status, 'active');
  assert.equal(mine.current_period_end, new Date(1893456000 * 1000).toISOString());
  assert.equal((await C.get(`/files/${fileId}/download`)).status, 200);

  await A.post(`/subscriptions/${sub.id}/cancel`);
  assert.equal((await C.get(`/files/${fileId}/download`)).status, 402);
});
