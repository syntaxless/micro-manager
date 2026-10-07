import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { agent, startApp } from './helpers.js';

const app = await startApp({ STRIPE_SECRET_KEY: '', DEMO_PAYMENTS: '', APP_URL: '' });
const { setStripeKeyVerifier } = await import('../server/stripe.js');
after(() => app.close());

const A = agent(app.base);

test('first-run setup remembers the address the studio uses', async () => {
  const state = (await A.get('/auth/state')).data;
  assert.equal(state.needsSetup, true);
  await A.post('/auth/setup', { name: 'Ada', email: 'ada@studio.test', password: 'password123', businessName: 'Ada Studio', origin: 'https://studio.example.com' });
  const after = (await A.get('/auth/state')).data;
  assert.equal(after.onboarded, false);
  assert.equal((await A.get('/settings/stripe')).data.appUrl, 'https://studio.example.com');
  const c = await A.post('/clients', { name: 'Acme', contact: { name: 'W', email: 'w@acme.test' } });
  assert.match(c.data.inviteUrl, /^https:\/\/studio\.example\.com\/invite\//);
});

test('Stripe connects by pasting a key in the app', async () => {
  let checked = '';
  setStripeKeyVerifier(async (k) => ((checked = k), 'Ada Studio LLC'));

  assert.equal((await A.post('/settings/stripe', { secretKey: 'pk_test_abc' })).status, 400);
  assert.equal((await A.post('/settings/stripe', { secretKey: 'hello' })).status, 400);

  const r = await A.post('/settings/stripe', { secretKey: '  sk_test_51abcDEF  ' });
  assert.equal(r.status, 200);
  assert.equal(checked, 'sk_test_51abcDEF');
  assert.equal(r.data.enabled, true);
  assert.equal(r.data.testMode, true);
  assert.equal(r.data.accountName, 'Ada Studio LLC');
  assert.ok(!JSON.stringify(r.data).includes('sk_test_51abcDEF'), 'full key is never sent back');
  assert.equal((await A.get('/auth/state')).data.stripe, true);

  setStripeKeyVerifier(async () => {
    throw Object.assign(new Error('Invalid API Key'), { type: 'StripeAuthenticationError' });
  });
  const bad = await A.post('/settings/stripe', { secretKey: 'sk_test_wrong' });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /did not accept/);

  await A.del('/settings/stripe');
  assert.equal((await A.get('/auth/state')).data.stripe, false);
});

test('example data loads, is labeled, and removes cleanly', async () => {
  await A.post('/settings/example-data');
  let clients = (await A.get('/clients')).data;
  assert.equal(clients.filter((c: any) => c.is_example).length, 2);
  assert.equal((await A.get('/auth/state')).data.hasExampleData, true);
  // Example contacts cannot sign in.
  assert.equal((await agent(app.base).post('/auth/login', { email: 'maya@nova.example', password: '' })).status, 401);

  const dash = (await A.get('/dashboard')).data;
  assert.equal(dash.checklist.find((s: any) => s.key === 'client').done, true, 'Acme is a real client');
  assert.equal(dash.checklist.find((s: any) => s.key === 'invoice').done, false, 'example invoices do not count');

  await A.del('/settings/example-data');
  clients = (await A.get('/clients')).data;
  assert.deepEqual(clients.map((c: any) => c.name), ['Acme']);
  assert.equal((await A.get('/files')).data.length, 0);
});

test('only admins can change payment settings', async () => {
  const fresh = agent(app.base);
  assert.equal((await fresh.post('/settings/stripe', { secretKey: 'sk_test_x' })).status, 401);
  assert.equal((await fresh.patch('/settings', { demoPayments: true })).status, 401);
});
