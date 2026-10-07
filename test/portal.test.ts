import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { agent, startApp, tokenFrom } from './helpers.js';

let app: Awaited<ReturnType<typeof startApp>>;
const admin = () => agent(app.base);
let A: ReturnType<typeof agent>;
let clientA: ReturnType<typeof agent>;
let clientB: ReturnType<typeof agent>;
let acmeId: number;
let globexId: number;

before(async () => {
  app = await startApp({ STRIPE_SECRET_KEY: '', DEMO_PAYMENTS: 'true' });
  A = admin();
  assert.equal((await A.post('/auth/setup', { name: 'Ada', email: 'ada@studio.test', password: 'password123' })).status, 200);

  const acme = await A.post('/clients', { name: 'Acme', contact: { name: 'Wile', email: 'wile@acme.test' } });
  const globex = await A.post('/clients', { name: 'Globex', contact: { name: 'Hank', email: 'hank@globex.test' } });
  acmeId = acme.data.id;
  globexId = globex.data.id;
  clientA = agent(app.base);
  clientB = agent(app.base);
  assert.equal((await clientA.post(`/auth/invite/${tokenFrom(acme.data.inviteUrl)}`, { password: 'clientpass1' })).status, 200);
  assert.equal((await clientB.post(`/auth/invite/${tokenFrom(globex.data.inviteUrl)}`, { password: 'clientpass1' })).status, 200);
});

after(() => app.close());

test('setup can only run once', async () => {
  const r = await agent(app.base).post('/auth/setup', { name: 'X', email: 'x@x.test', password: 'password123' });
  assert.equal(r.status, 409);
});

test('mutations without the app header are rejected', async () => {
  const r = await fetch(app.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
});

test('invite links work once', async () => {
  const c = await A.post(`/clients/${acmeId}/users`, { name: 'Road', email: 'road@acme.test' });
  const t = tokenFrom(c.data.inviteUrl);
  assert.equal((await agent(app.base).post(`/auth/invite/${t}`, { password: 'password123' })).status, 200);
  assert.equal((await agent(app.base).post(`/auth/invite/${t}`, { password: 'password123' })).status, 404);
});

test('clients only see their own projects and cannot use staff endpoints', async () => {
  await A.post('/projects', { client_id: acmeId, title: 'Acme logo' });
  await A.post('/projects', { client_id: globexId, title: 'Globex site' });
  const mine = await clientA.get('/projects');
  assert.deepEqual(
    mine.data.map((p: any) => p.title),
    ['Acme logo'],
  );
  const other = (await A.get('/projects')).data.find((p: any) => p.title === 'Globex site');
  assert.equal((await clientA.get(`/projects/${other.id}`)).status, 404);
  assert.equal((await clientA.patch(`/projects/${other.id}`, { title: 'pwned' })).status, 404);
  assert.equal((await clientA.get('/clients')).status, 403);
  assert.equal((await clientA.post('/invoices', {})).status, 403);
});

test('clients can submit requests and reprioritise the queue by dragging', async () => {
  const one = (await clientA.post('/projects', { title: 'One' })).data;
  const two = (await clientA.post('/projects', { title: 'Two' })).data;
  const three = (await clientA.post('/projects', { title: 'Three' })).data;
  assert.equal(one.status, 'queued');
  // Drag "Three" to the top of the queue, above "One".
  const moved = await clientA.post(`/projects/${three.id}/move`, { status: 'queued', before_id: null, after_id: one.id });
  assert.equal(moved.status, 200);
  const queue = (await clientA.get('/projects')).data
    .filter((p: any) => p.status === 'queued')
    .sort((a: any, b: any) => a.position - b.position)
    .map((p: any) => p.title);
  assert.ok(queue.indexOf('Three') < queue.indexOf('One'));
  assert.ok(queue.indexOf('One') < queue.indexOf('Two'));
  // Move across columns, between two cards.
  await clientA.post(`/projects/${two.id}/move`, { status: 'in_progress', before_id: null, after_id: null });
  const after = (await clientA.get(`/projects/${two.id}`)).data;
  assert.equal(after.status, 'in_progress');
});

test('files attached to an invoice unlock only after payment', async () => {
  const form = new FormData();
  form.append('client_id', String(acmeId));
  form.append('files', new Blob(['final artwork']), 'final.png');
  const up = await A.upload('/files', form);
  assert.equal(up.status, 201);
  const fileId = up.data[0].id;

  // Before attaching: available.
  assert.equal((await clientA.get(`/files/${fileId}/download`)).status, 200);

  const inv = await A.post('/invoices', {
    client_id: acmeId,
    title: 'Artwork',
    items: [{ description: 'Artwork', quantity: 1, unit_amount: 50000 }],
    file_ids: [fileId],
  });
  assert.equal(inv.status, 201);
  // Drafts are invisible to the client, but the file is already gated.
  assert.equal((await clientA.get(`/invoices/${inv.data.id}`)).status, 404);
  let listed = (await clientA.get('/files')).data.find((f: any) => f.id === fileId);
  assert.equal(listed.locked, true);
  assert.equal((await clientA.get(`/files/${fileId}/download`)).status, 402);

  assert.equal((await A.post(`/invoices/${inv.data.id}/send`)).status, 200);
  listed = (await clientA.get('/files')).data.find((f: any) => f.id === fileId);
  assert.match(listed.reason, /INV-\d+ is paid/);

  // Another client can't see or pay it.
  assert.equal((await clientB.get(`/files/${fileId}/download`)).status, 404);
  assert.equal((await clientB.post(`/invoices/${inv.data.id}/pay`)).status, 404);

  const pay = await clientA.post(`/invoices/${inv.data.id}/pay`);
  assert.equal(pay.data.paid, true);
  const dl = await clientA.get(`/files/${fileId}/download`);
  assert.equal(dl.status, 200);
  assert.equal(dl.data, 'final artwork');
});

test('an active subscription unlocks subscription-gated files', async () => {
  const form = new FormData();
  form.append('client_id', String(globexId));
  form.append('requires_subscription', 'true');
  form.append('files', new Blob(['retainer deliverable']), 'deck.pdf');
  const fileId = (await A.upload('/files', form)).data[0].id;
  assert.equal((await clientB.get(`/files/${fileId}/download`)).status, 402);

  const sub = await A.post('/subscriptions', { client_id: globexId, name: 'Retainer', amount: 100000, interval: 'month' });
  assert.equal(sub.data.status, 'pending');
  assert.equal((await clientB.get(`/files/${fileId}/download`)).status, 402);

  const start = await clientB.post(`/subscriptions/${sub.data.id}/checkout`);
  assert.equal(start.data.active, true);
  assert.equal((await clientB.get(`/files/${fileId}/download`)).status, 200);

  await A.post(`/subscriptions/${sub.data.id}/cancel`);
  assert.equal((await clientB.get(`/files/${fileId}/download`)).status, 402);
});

test('clients manage their own uploads but not the studio’s', async () => {
  const form = new FormData();
  form.append('files', new Blob(['brief']), 'brief.txt');
  const mine = (await clientA.upload('/files', form)).data[0];
  assert.equal(mine.client_id, acmeId);
  assert.equal(mine.locked, false);
  assert.equal((await clientA.patch(`/files/${mine.id}`, { name: 'brief-v2.txt' })).status, 200);

  const studio = (await clientA.get('/files')).data.find((f: any) => f.uploader_role === 'admin');
  assert.equal((await clientA.del(`/files/${studio.id}`)).status, 403);
  assert.equal((await clientA.del(`/files/${mine.id}`)).status, 200);
});

test('invoice attachments must belong to the invoiced client', async () => {
  const form = new FormData();
  form.append('client_id', String(globexId));
  form.append('files', new Blob(['x']), 'x.txt');
  const globexFile = (await A.upload('/files', form)).data[0].id;
  const r = await A.post('/invoices', { client_id: acmeId, title: 'Bad', items: [{ description: 'a', quantity: 1, unit_amount: 100 }], file_ids: [globexFile] });
  assert.equal(r.status, 400);
});
