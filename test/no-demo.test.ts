import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { agent, startApp, tokenFrom } from './helpers.js';

const app = await startApp({ STRIPE_SECRET_KEY: '', DEMO_PAYMENTS: '' });
after(() => app.close());

test('without Stripe or demo payments, clients cannot mark their own invoices paid', async () => {
  const A = agent(app.base);
  await A.post('/auth/setup', { name: 'Ada', email: 'ada@studio.test', password: 'password123' });
  const c = await A.post('/clients', { name: 'Acme', contact: { name: 'Wile', email: 'wile@acme.test' } });
  const C = agent(app.base);
  await C.post(`/auth/invite/${tokenFrom(c.data.inviteUrl)}`, { password: 'clientpass1' });

  const inv = await A.post('/invoices', { client_id: c.data.id, title: 'Work', items: [{ description: 'x', quantity: 1, unit_amount: 1000 }], send: true });
  assert.equal((await C.post(`/invoices/${inv.data.id}/pay`)).status, 400);
  assert.equal((await C.get(`/invoices/${inv.data.id}`)).data.status, 'open');

  const sub = await A.post('/subscriptions', { client_id: c.data.id, name: 'Retainer', amount: 1000, interval: 'month' });
  assert.equal((await C.post(`/subscriptions/${sub.data.id}/checkout`)).status, 400);
  // Staff can still record an offline payment or activation.
  assert.equal((await A.post(`/invoices/${inv.data.id}/mark-paid`)).status, 200);
  assert.equal((await A.post(`/subscriptions/${sub.data.id}/checkout`)).data.active, true);
});
