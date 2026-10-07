import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, useApi, type ClientRow, type FileItem, type InvoiceRow, type SubscriptionRow } from '../api';
import { useAuth } from '../auth';
import { Badge, CopyButton, Drawer, Empty, Field, Modal, Segmented, Skeleton, Spinner, useConfirm, useToast } from '../components/ui';
import { Icon, fileIcon } from '../components/Icon';
import { INVOICE_TONE, SUB_TONE, bytes, money, shortDate } from '../format';
import { tone } from '../theme';

export function Billing() {
  const auth = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'invoices' | 'subscriptions') || 'invoices';
  const invoices = useApi<InvoiceRow[]>('/invoices');
  const subs = useApi<SubscriptionRow[]>('/subscriptions');
  const { data: clients } = useApi<ClientRow[]>(auth.isStaff ? '/clients' : null);
  const [refreshing, setRefreshing] = useState(false);
  const openInvoice = params.get('invoice') ? Number(params.get('invoice')) : null;

  const setParams2 = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) p.delete(k);
      else p.set(k, v);
    }
    setParams(p, { replace: true });
  };
  const setParam = (k: string, v: string | null) => setParams2({ [k]: v });

  // Returning from Stripe Checkout: pull fresh status right away.
  useEffect(() => {
    if (!params.get('subscribed')) return;
    api('/billing/refresh', { method: 'POST' })
      .then(() => (subs.reload(), invoices.reload(), toast('Subscription updated')))
      .finally(() => setParam('subscribed', null));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = async () => {
    setRefreshing(true);
    try {
      await api('/billing/refresh', { method: 'POST' });
      await Promise.all([invoices.reload(), subs.reload()]);
    } finally {
      setRefreshing(false);
    }
  };

  const openPortal = async () => {
    try {
      const r = await api<{ url: string }>('/billing/portal', { method: 'POST', body: {} });
      window.location.href = r.url;
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const outstanding = (invoices.data ?? []).filter((i) => i.status === 'open');
  const currency = auth.currency;

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow mono">~/billing</p>
          <h1>Billing</h1>
          <p className="muted">
            {outstanding.length
              ? `${money(outstanding.reduce((a, i) => a + i.total, 0), outstanding[0]?.currency ?? currency)} outstanding across ${outstanding.length} invoice${outstanding.length === 1 ? '' : 's'}`
              : 'All settled up.'}
            {!auth.stripe && auth.demoPayments && <span className="demo-pill mono">demo payments</span>}
            {auth.stripe && auth.stripeTestMode && <span className="demo-pill mono">stripe test mode</span>}
          </p>
        </div>
        <div className="head-actions">
          {auth.stripe && (
            <button className="btn ghost" onClick={refresh} disabled={refreshing} title="Sync with Stripe">
              <Icon name="refresh" className={refreshing ? 'spin' : ''} /> Sync
            </button>
          )}
          {!auth.isStaff && auth.stripe && (
            <button className="btn" onClick={openPortal}>
              <Icon name="card" /> Payment methods
            </button>
          )}
          {auth.isStaff && (
            <button className="btn primary" onClick={() => setParam(tab === 'invoices' ? 'new' : 'newsub', '1')}>
              <Icon name="plus" /> {tab === 'invoices' ? 'New invoice' : 'New subscription'}
            </button>
          )}
        </div>
      </header>

      <div className="tabs">
        <button className={tab === 'invoices' ? 'on' : ''} onClick={() => setParam('tab', null)}>
          Invoices <span className="mono">{invoices.data?.length ?? ''}</span>
        </button>
        <button className={tab === 'subscriptions' ? 'on' : ''} onClick={() => setParam('tab', 'subscriptions')}>
          Subscriptions <span className="mono">{subs.data?.length ?? ''}</span>
        </button>
      </div>

      {tab === 'invoices' ? (
        <InvoiceList rows={invoices.data} onOpen={(id) => setParam('invoice', String(id))} onChanged={invoices.reload} />
      ) : (
        <SubscriptionList rows={subs.data} onChanged={subs.reload} />
      )}

      {auth.isStaff && (
        <>
          <InvoiceEditor open={params.get('new') === 'invoice' || params.get('new') === '1'} onClose={() => setParam('new', null)} clients={clients ?? []} onSaved={(id) => (invoices.reload(), setParams2({ new: null, invoice: String(id) }))} />
          <NewSubscription open={params.get('newsub') === '1'} onClose={() => setParam('newsub', null)} clients={clients ?? []} onSaved={() => (subs.reload(), setParam('newsub', null))} />
        </>
      )}
      <InvoiceDrawer id={openInvoice} onClose={() => setParam('invoice', null)} onChanged={invoices.reload} />
    </>
  );
}

function usePay(onDone: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const pay = async (id: number) => {
    setBusy(id);
    try {
      const r = await api<{ url?: string; paid?: boolean }>(`/invoices/${id}/pay`, { method: 'POST' });
      if (r.url) window.open(r.url, '_blank', 'noopener');
      else {
        toast('Payment recorded (demo). Files unlocked.');
        onDone();
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };
  return { pay, busy };
}

function InvoiceList({ rows, onOpen, onChanged }: { rows: InvoiceRow[] | null; onOpen: (id: number) => void; onChanged: () => void }) {
  const auth = useAuth();
  const [filter, setFilter] = useState<'all' | 'open' | 'paid' | 'draft'>('all');
  const { pay, busy } = usePay(onChanged);
  const shown = useMemo(() => (rows ?? []).filter((r) => filter === 'all' || r.status === filter), [rows, filter]);

  if (!rows) {
    return (
      <div className="stack">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} h={58} />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <Empty icon="receipt" title="No invoices yet">
        {auth.isStaff ? 'Create one and attach the deliverables it unlocks.' : 'Invoices from your team will show up here.'}
      </Empty>
    );
  }
  return (
    <>
      <div className="toolbar">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'open', label: 'Open' },
            { value: 'paid', label: 'Paid' },
            ...(auth.isStaff ? [{ value: 'draft' as const, label: 'Drafts' }] : []),
          ]}
        />
      </div>
      <div className="table">
        {shown.map((i, n) => (
          <div key={i.id} className="trow stagger" style={{ animationDelay: `${Math.min(n, 12) * 20}ms` }} onClick={() => onOpen(i.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(i.id)}>
            <span className="mono muted">{i.number}</span>
            <span className="grow truncate">
              <strong>{i.title}</strong>
              {auth.isStaff && (
                <span className="sub muted">
                  <span className="client-dot" style={{ background: tone(i.client_color) }} /> {i.client_name}
                </span>
              )}
            </span>
            {i.file_count > 0 && (
              <span className="meta mono muted" title="Attached files">
                <Icon name={i.status === 'paid' ? 'unlock' : 'lock'} size={12} /> {i.file_count}
              </span>
            )}
            <span className="mono muted sm hide-sm">{i.status === 'paid' ? `paid ${shortDate(i.paid_at)}` : i.due_date ? `due ${shortDate(i.due_date)}` : shortDate(i.created_at)}</span>
            <Badge tone={INVOICE_TONE[i.status]} dot>
              {i.status}
            </Badge>
            <span className="mono amount">{money(i.total, i.currency)}</span>
            {!auth.isStaff && i.status === 'open' && (auth.stripe || auth.demoPayments) && (
              <button className="btn primary sm" onClick={(e) => (e.stopPropagation(), pay(i.id))} disabled={busy === i.id}>
                {busy === i.id ? <Spinner size={12} /> : 'Pay'}
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

interface InvoiceDetail extends Omit<InvoiceRow, 'client_name' | 'client_color' | 'file_count'> {
  notes: string;
  client: { id: number; name: string; company: string | null; color: string | null };
  items: { id: number; description: string; quantity: number; unit_amount: number }[];
  files: { id: number; name: string; size: number; mime: string }[];
}

function InvoiceDrawer({ id, onClose, onChanged }: { id: number | null; onClose: () => void; onChanged: () => void }) {
  const auth = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [inv, setInv] = useState<InvoiceDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editingFiles, setEditingFiles] = useState(false);
  const load = (iid: number) => api<InvoiceDetail>(`/invoices/${iid}`).then(setInv).catch((e) => (toast(e.message, 'error'), onClose()));

  useEffect(() => {
    if (id) {
      setInv(null);
      setEditingFiles(false);
      load(id);
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const { pay } = usePay(() => (id && load(id), onChanged()));

  const act = async (action: 'send' | 'mark-paid' | 'void' | 'delete', ok: string) => {
    if (!inv) return;
    if (action === 'void' && !(await confirm({ title: `Void ${inv.number}?`, body: 'The client will no longer be able to pay it.', confirm: 'Void invoice', danger: true }))) return;
    if (action === 'delete' && !(await confirm({ title: `Delete draft ${inv.number}?`, confirm: 'Delete', danger: true }))) return;
    if (action === 'mark-paid' && !(await confirm({ title: `Mark ${inv.number} as paid?`, body: 'Use this for payments received outside Stripe. Attached files unlock for the client.', confirm: 'Mark paid' }))) return;
    setBusy(action);
    try {
      if (action === 'delete') {
        await api(`/invoices/${inv.id}`, { method: 'DELETE' });
        onClose();
      } else {
        await api(`/invoices/${inv.id}/${action}`, { method: 'POST' });
        await load(inv.id);
      }
      onChanged();
      toast(ok);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Drawer open={!!id} onClose={onClose} width={560}>
      {!inv ? (
        <div className="drawer-body stack">
          <Skeleton h={28} w="50%" />
          <Skeleton h={160} />
        </div>
      ) : (
        <>
          <header className="drawer-head">
            <span className="mono">{inv.number}</span>
            <Badge tone={INVOICE_TONE[inv.status]} dot>
              {inv.status}
            </Badge>
            <span className="grow" />
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="x" />
            </button>
          </header>
          <div className="drawer-body">
            <div className="invoice-paper">
              <div className="invoice-top">
                <div>
                  <p className="eyebrow mono">bill to</p>
                  <strong>{inv.client.company || inv.client.name}</strong>
                </div>
                <div className="right">
                  <p className="eyebrow mono">{inv.status === 'paid' ? 'paid' : 'due'}</p>
                  <strong className="mono">{inv.status === 'paid' ? shortDate(inv.paid_at) : inv.due_date ? shortDate(inv.due_date) : 'on receipt'}</strong>
                </div>
              </div>
              <h2>{inv.title}</h2>
              <table className="items">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="num">Qty</th>
                    <th className="num">Price</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.items.map((it) => (
                    <tr key={it.id}>
                      <td>{it.description}</td>
                      <td className="num mono">{it.quantity}</td>
                      <td className="num mono">{money(it.unit_amount, inv.currency)}</td>
                      <td className="num mono">{money(it.unit_amount * it.quantity, inv.currency)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>Total</td>
                    <td className="num mono">{money(inv.total, inv.currency)}</td>
                  </tr>
                </tfoot>
              </table>
              {inv.notes && <p className="muted notes">{inv.notes}</p>}
            </div>

            <section className="section">
              <h4 className="section-title">
                <Icon name={inv.status === 'paid' ? 'unlock' : 'lock'} size={14} /> Unlocks on payment
                {auth.isStaff && inv.status !== 'void' && (
                  <button className="link sm" onClick={() => setEditingFiles((v) => !v)}>
                    {editingFiles ? 'done' : 'edit'}
                  </button>
                )}
              </h4>
              {editingFiles ? (
                <AttachPicker
                  clientId={inv.client_id}
                  selected={inv.files.map((f) => f.id)}
                  onSave={async (ids) => {
                    await api(`/invoices/${inv.id}`, { method: 'PATCH', body: { file_ids: ids } });
                    await load(inv.id);
                    onChanged();
                    setEditingFiles(false);
                    toast('Attachments updated');
                  }}
                />
              ) : inv.files.length === 0 ? (
                <p className="muted sm">No files attached.</p>
              ) : (
                <ul className="attach-list">
                  {inv.files.map((f) => (
                    <li key={f.id}>
                      <Icon name={fileIcon(f.mime)} size={14} />
                      <span className="grow truncate">{f.name}</span>
                      <span className="mono muted sm">{bytes(f.size)}</span>
                      {auth.isStaff || inv.status === 'paid' ? (
                        <a className="icon-btn xs" href={`/api/files/${f.id}/download`} download title="Download">
                          <Icon name="download" size={14} />
                        </a>
                      ) : (
                        <span className="icon-btn xs disabled">
                          <Icon name="lock" size={14} />
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {inv.hosted_url && auth.isStaff && (
              <section className="section">
                <h4 className="section-title">Payment link</h4>
                <div className="link-box">
                  <span className="mono truncate">{inv.hosted_url}</span>
                  <CopyButton text={inv.hosted_url} />
                </div>
              </section>
            )}
          </div>
          <footer className="drawer-foot">
            {auth.isStaff ? (
              <>
                {inv.status === 'draft' && (
                  <>
                    <button className="btn ghost danger" onClick={() => act('delete', 'Draft deleted')} disabled={!!busy}>
                      Delete
                    </button>
                    <span className="grow" />
                    <button className="btn primary" onClick={() => act('send', auth.stripe ? 'Sent via Stripe' : 'Invoice issued')} disabled={!!busy}>
                      {busy === 'send' ? <Spinner /> : <Icon name="send" />} {auth.stripe ? 'Send via Stripe' : 'Issue invoice'}
                    </button>
                  </>
                )}
                {inv.status === 'open' && (
                  <>
                    <button className="btn ghost danger" onClick={() => act('void', 'Invoice voided')} disabled={!!busy}>
                      Void
                    </button>
                    <span className="grow" />
                    {inv.hosted_url && (
                      <a className="btn" href={inv.hosted_url} target="_blank" rel="noopener">
                        <Icon name="external" /> Open
                      </a>
                    )}
                    <button className="btn primary" onClick={() => act('mark-paid', 'Marked as paid')} disabled={!!busy}>
                      {busy === 'mark-paid' ? <Spinner /> : <Icon name="check" />} Mark paid
                    </button>
                  </>
                )}
              </>
            ) : (
              inv.status === 'open' &&
              (auth.stripe || auth.demoPayments ? (
                <>
                  <span className="grow" />
                  <button className="btn primary lg" onClick={() => pay(inv.id)}>
                    <Icon name="card" /> Pay {money(inv.total, inv.currency)}
                  </button>
                </>
              ) : (
                <span className="muted sm">Online payment isn't set up yet. Contact the studio to pay this invoice.</span>
              ))
            )}
          </footer>
        </>
      )}
    </Drawer>
  );
}

function AttachPicker({ clientId, selected, onSave }: { clientId: number; selected: number[]; onSave: (ids: number[]) => Promise<void> | void }) {
  const { data: files } = useApi<FileItem[]>(`/files?client_id=${clientId}`);
  const [sel, setSel] = useState<Set<number>>(new Set(selected));
  const [busy, setBusy] = useState(false);
  useEffect(() => setSel(new Set(selected)), [selected.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!files) return <Skeleton h={60} />;
  if (!files.length) return <p className="muted sm">This client has no files yet. Upload them on the Files page first.</p>;
  return (
    <div className="attach-picker">
      {files.map((f) => (
        <label key={f.id} className="check attach-row">
          <input
            type="checkbox"
            checked={sel.has(f.id)}
            onChange={(e) => {
              const n = new Set(sel);
              if (e.target.checked) n.add(f.id);
              else n.delete(f.id);
              setSel(n);
            }}
          />
          <Icon name={fileIcon(f.mime)} size={14} />
          <span className="grow truncate">{f.name}</span>
          <span className="mono muted sm">{bytes(f.size)}</span>
        </label>
      ))}
      <button
        type="button"
        className="btn sm primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onSave([...sel]);
          } finally {
            setBusy(false);
          }
        }}
      >
        Save attachments
      </button>
    </div>
  );
}

type Line = { description: string; quantity: string; price: string };

function InvoiceEditor({ open, onClose, clients, onSaved }: { open: boolean; onClose: () => void; clients: ClientRow[]; onSaved: (id: number) => void }) {
  const auth = useAuth();
  const toast = useToast();
  const [clientId, setClientId] = useState('');
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([{ description: '', quantity: '1', price: '' }]);
  const [fileIds, setFileIds] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<'draft' | 'send' | null>(null);
  const { data: files } = useApi<FileItem[]>(clientId ? `/files?client_id=${clientId}` : null);

  useEffect(() => {
    if (!open) return;
    setClientId('');
    setTitle('');
    setNotes('');
    const d = new Date(Date.now() + 14 * 864e5);
    setDue(d.toISOString().slice(0, 10));
    setLines([{ description: '', quantity: '1', price: '' }]);
    setFileIds(new Set());
  }, [open]);

  useEffect(() => setFileIds(new Set()), [clientId]);

  const cents = (s: string) => Math.round(parseFloat(s || '0') * 100);
  const total = lines.reduce((a, l) => a + cents(l.price) * (parseInt(l.quantity) || 0), 0);
  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = async (send: boolean, e?: FormEvent) => {
    e?.preventDefault();
    setBusy(send ? 'send' : 'draft');
    try {
      const r = await api<{ id: number; sendError?: string }>('/invoices', {
        body: {
          client_id: Number(clientId),
          title,
          notes,
          due_date: due || null,
          items: lines.filter((l) => l.description.trim()).map((l) => ({ description: l.description.trim(), quantity: parseInt(l.quantity) || 1, unit_amount: cents(l.price) })),
          file_ids: [...fileIds],
          send,
        },
      });
      if (r.sendError) toast(`Saved as draft. Sending failed: ${r.sendError}`, 'error');
      else toast(send ? (auth.stripe ? 'Invoice sent via Stripe' : 'Invoice issued') : 'Draft saved');
      onSaved(r.id);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New invoice"
      width={680}
      footer={
        <>
          <span className="mono total-preview">{money(total, auth.currency)}</span>
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={() => submit(false)} disabled={!!busy || !clientId || !title}>
            {busy === 'draft' ? <Spinner /> : 'Save draft'}
          </button>
          <button className="btn primary" form="invoice-form" disabled={!!busy}>
            {busy === 'send' ? <Spinner /> : <Icon name="send" />} {auth.stripe ? 'Create & send' : 'Create & issue'}
          </button>
        </>
      }
    >
      <form id="invoice-form" className="stack" onSubmit={(e) => submit(true, e)}>
        <div className="row-2">
          <Field label="Client">
            <select required value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Choose a client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Due date">
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
        <Field label="Title">
          <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Brand identity, phase 1" />
        </Field>
        <div className="field">
          <span className="field-label">Line items</span>
          <div className="lines">
            {lines.map((l, i) => (
              <div className="line" key={i}>
                <input placeholder="Description" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} required={i === 0} />
                <input className="qty mono" inputMode="numeric" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value.replace(/\D/g, '') })} aria-label="Quantity" />
                <input className="price mono" inputMode="decimal" placeholder="0.00" value={l.price} onChange={(e) => setLine(i, { price: e.target.value.replace(/[^\d.]/g, '') })} aria-label="Unit price" required={i === 0} />
                <button type="button" className="icon-btn xs" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : lines)} aria-label="Remove line">
                  <Icon name="x" size={13} />
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="link sm add-line" onClick={() => setLines([...lines, { description: '', quantity: '1', price: '' }])}>
            + add line
          </button>
        </div>
        <div className="field">
          <span className="field-label">Files unlocked by this invoice</span>
          {!clientId ? (
            <span className="muted sm">Pick a client to choose from their files.</span>
          ) : !files ? (
            <Skeleton h={40} />
          ) : files.length === 0 ? (
            <span className="muted sm">No files for this client yet.</span>
          ) : (
            <div className="attach-picker">
              {files.map((f) => (
                <label key={f.id} className="check attach-row">
                  <input
                    type="checkbox"
                    checked={fileIds.has(f.id)}
                    onChange={(e) => {
                      const n = new Set(fileIds);
                      if (e.target.checked) n.add(f.id);
                      else n.delete(f.id);
                      setFileIds(n);
                    }}
                  />
                  <Icon name={fileIcon(f.mime)} size={14} />
                  <span className="grow truncate">{f.name}</span>
                  <span className="mono muted sm">{bytes(f.size)}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <Field label="Notes">
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Shown on the invoice footer" />
        </Field>
      </form>
    </Modal>
  );
}

function SubscriptionList({ rows, onChanged }: { rows: SubscriptionRow[] | null; onChanged: () => void }) {
  const auth = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<number | null>(null);
  const [link, setLink] = useState<{ id: number; url: string } | null>(null);

  const checkout = async (s: SubscriptionRow) => {
    setBusy(s.id);
    try {
      const r = await api<{ url?: string; active?: boolean }>(`/subscriptions/${s.id}/checkout`, { method: 'POST' });
      if (r.url) {
        if (auth.isStaff) setLink({ id: s.id, url: r.url });
        else window.location.href = r.url;
      } else {
        toast('Subscription active. All files unlocked.');
        onChanged();
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (s: SubscriptionRow) => {
    if (!(await confirm({ title: `Cancel ${s.name}?`, body: 'Billing stops immediately and subscription-gated files lock again.', confirm: 'Cancel subscription', danger: true }))) return;
    try {
      await api(`/subscriptions/${s.id}/cancel`, { method: 'POST' });
      toast('Subscription canceled');
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const remove = async (s: SubscriptionRow) => {
    try {
      await api(`/subscriptions/${s.id}`, { method: 'DELETE' });
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  if (!rows) return <Skeleton h={80} />;
  if (rows.length === 0) {
    return (
      <Empty icon="repeat" title="No subscriptions">
        {auth.isStaff ? 'Offer a retainer: an active subscription unlocks every file for that client.' : 'Retainers your team offers will appear here.'}
      </Empty>
    );
  }
  return (
    <div className="sub-grid">
      {rows.map((s, n) => {
        const pending = ['pending', 'incomplete', 'incomplete_expired'].includes(s.status);
        const live = !pending && s.status !== 'canceled';
        return (
          <div className={`sub-card stagger ${s.status}`} key={s.id} style={{ animationDelay: `${n * 30}ms` }}>
            <div className="sub-head">
              <Badge tone={SUB_TONE[s.status] ?? 'muted'} dot>
                {s.status.replace('_', ' ')}
              </Badge>
              {auth.isStaff && (
                <span className="muted sm truncate">
                  <span className="client-dot" style={{ background: tone(s.client_color) }} /> {s.client_name}
                </span>
              )}
            </div>
            <h3>{s.name}</h3>
            <p className="price mono">
              {money(s.amount, s.currency)}
              <span className="muted"> / {s.interval}</span>
            </p>
            <p className="muted sm">
              {live && s.current_period_end ? `Renews ${shortDate(s.current_period_end)}` : pending ? (auth.isStaff ? 'Waiting for the client to start it' : 'Ready to start') : 'Ended'}
            </p>
            {link?.id === s.id && (
              <div className="link-box">
                <span className="mono truncate">{link.url}</span>
                <CopyButton text={link.url} />
              </div>
            )}
            <div className="sub-actions">
              {pending && !auth.isStaff && (auth.stripe || auth.demoPayments) && (
                <button className="btn primary" onClick={() => checkout(s)} disabled={busy === s.id}>
                  {busy === s.id ? <Spinner /> : <Icon name="card" />} Start subscription
                </button>
              )}
              {pending && auth.isStaff && (
                <>
                  <button className="btn sm" onClick={() => checkout(s)} disabled={busy === s.id}>
                    {busy === s.id ? <Spinner size={12} /> : <Icon name="link" size={14} />} {auth.stripe ? 'Checkout link' : 'Activate manually'}
                  </button>
                  <button className="btn sm ghost danger" onClick={() => remove(s)}>
                    Remove
                  </button>
                </>
              )}
              {live && auth.isStaff && (
                <button className="btn sm ghost danger" onClick={() => cancel(s)}>
                  Cancel
                </button>
              )}
              {s.status === 'canceled' && auth.isStaff && (
                <button className="btn sm ghost" onClick={() => remove(s)}>
                  Remove
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NewSubscription({ open, onClose, clients, onSaved }: { open: boolean; onClose: () => void; clients: ClientRow[]; onSaved: () => void }) {
  const auth = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ client_id: '', name: 'Monthly retainer', amount: '', interval: 'month' as 'week' | 'month' | 'year' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setF({ client_id: '', name: 'Monthly retainer', amount: '', interval: 'month' });
  }, [open]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/subscriptions', { body: { client_id: Number(f.client_id), name: f.name, amount: Math.round(parseFloat(f.amount) * 100), interval: f.interval } });
      toast('Subscription created. The client can start it from their billing page.');
      onSaved();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New subscription"
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" form="sub-form" disabled={busy}>
            {busy ? <Spinner /> : 'Create'}
          </button>
        </>
      }
    >
      <form id="sub-form" className="stack" onSubmit={submit}>
        <Field label="Client">
          <select required value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })}>
            <option value="">Choose a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Plan name">
          <input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <div className="row-2">
          <Field label={`Amount (${auth.currency.toUpperCase()})`}>
            <input required className="mono" inputMode="decimal" placeholder="1500.00" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })} />
          </Field>
          <Field label="Every">
            <Segmented
              value={f.interval}
              onChange={(v) => setF({ ...f, interval: v })}
              options={[
                { value: 'week', label: 'week' },
                { value: 'month', label: 'month' },
                { value: 'year', label: 'year' },
              ]}
            />
          </Field>
        </div>
        <p className="muted sm">While active, the client can download every file on their account. {auth.stripe ? 'They pay through Stripe Checkout.' : 'Stripe is not configured, so you activate it by hand once they pay.'}</p>
      </form>
    </Modal>
  );
}
