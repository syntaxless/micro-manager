import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, useApi, type ClientRow } from '../api';
import { useAuth } from '../auth';
import { Avatar, Badge, CopyButton, Drawer, Empty, Field, Modal, Skeleton, Spinner, useConfirm, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { money } from '../format';
import { tone } from '../theme';

const COLORS = ['blue', 'magenta', 'cyan', 'green', 'yellow', 'orange', 'red'];

export function Clients() {
  const auth = useAuth();
  const { data, reload } = useApi<ClientRow[]>('/clients');
  const [params, setParams] = useSearchParams();
  const [creating, setCreatingState] = useState(params.get('new') === '1');
  const setCreating = (v: boolean) => {
    setCreatingState(v);
    if (!v && params.get('new')) setParams({}, { replace: true });
  };
  const [open, setOpen] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const shown = (data ?? []).filter((c) => `${c.name} ${c.company ?? ''} ${c.email ?? ''}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow mono">~/clients</p>
          <h1>Clients</h1>
          <p className="muted">{data ? `${data.length} client${data.length === 1 ? '' : 's'}` : ' '}</p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Icon name="plus" /> New client
        </button>
      </header>
      {data && data.length > 4 && (
        <div className="toolbar">
          <div className="search">
            <Icon name="search" size={14} />
            <input placeholder="Search clients…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      )}
      {!data ? (
        <div className="client-grid">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} h={150} />
          ))}
        </div>
      ) : data.length === 0 ? (
        <Empty icon="users" title="No clients yet">
          Add a client and invite them to their portal.
        </Empty>
      ) : (
        <div className="client-grid">
          {shown.map((c, i) => (
            <button key={c.id} className="client-card stagger" style={{ animationDelay: `${i * 25}ms`, ['--tone' as string]: tone(c.color) }} onClick={() => setOpen(c.id)}>
              <div className="client-card-head">
                <Avatar name={c.name} color={c.color} size={36} />
                <div className="truncate">
                  <strong className="truncate">{c.name}</strong>
                  <span className="muted sm truncate">{c.company || c.email || ' '}</span>
                </div>
              </div>
              <dl className="client-stats mono">
                <div>
                  <dt>open</dt>
                  <dd>{c.open_projects}</dd>
                </div>
                <div>
                  <dt>files</dt>
                  <dd>{c.file_count}</dd>
                </div>
                <div>
                  <dt>owed</dt>
                  <dd className={c.outstanding ? 'warn' : ''}>{money(c.outstanding, auth.currency)}</dd>
                </div>
              </dl>
              <div className="client-card-foot">
                {c.is_example ? (
                  <Badge tone="magenta">example</Badge>
                ) : c.active_subscriptions > 0 ? (
                  <Badge tone="green" dot>
                    subscribed
                  </Badge>
                ) : (
                  <Badge tone="muted">per invoice</Badge>
                )}
                <span className="muted sm mono">
                  {c.user_count} login{c.user_count === 1 ? '' : 's'}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
      <NewClient open={creating} onClose={() => setCreating(false)} onCreated={reload} />
      <ClientDrawer id={open} onClose={() => setOpen(null)} onChanged={reload} />
    </>
  );
}

function NewClient({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', company: '', contactName: '', contactEmail: '' });
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setF({ name: '', company: '', contactName: '', contactEmail: '' });
      setInvite(null);
    }
  }, [open]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ id: number; inviteUrl: string | null }>('/clients', {
        body: {
          name: f.name,
          company: f.company || undefined,
          contact: f.contactEmail ? { name: f.contactName || f.name, email: f.contactEmail } : undefined,
        },
      });
      onCreated();
      if (r.inviteUrl) setInvite(r.inviteUrl);
      else {
        toast('Client added');
        onClose();
      }
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
      title={invite ? 'Client added' : 'New client'}
      footer={
        invite ? (
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" form="client-form" disabled={busy}>
              {busy ? <Spinner /> : 'Add client'}
            </button>
          </>
        )
      }
    >
      {invite ? (
        <InviteLink url={invite} />
      ) : (
        <form id="client-form" className="stack" onSubmit={submit}>
          <div className="row-2">
            <Field label="Client name">
              <input required autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </Field>
            <Field label="Company">
              <input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} />
            </Field>
          </div>
          <p className="muted sm">Optionally invite a contact to the portal now.</p>
          <div className="row-2">
            <Field label="Contact name">
              <input value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} />
            </Field>
            <Field label="Contact email">
              <input type="email" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} />
            </Field>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function InviteLink({ url }: { url: string }) {
  return (
    <div className="stack">
      <p className="muted">Send this link to your client. It lets them set a password and expires in 14 days.</p>
      <div className="link-box">
        <span className="mono truncate">{url}</span>
        <CopyButton text={url} />
      </div>
    </div>
  );
}

interface ClientDetail extends Omit<ClientRow, 'open_projects' | 'file_count' | 'outstanding' | 'active_subscriptions' | 'user_count'> {
  users: { id: number; name: string; email: string; pending: boolean }[];
}

function ClientDrawer({ id, onClose, onChanged }: { id: number | null; onClose: () => void; onChanged: () => void }) {
  const auth = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [c, setC] = useState<ClientDetail | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [nu, setNu] = useState({ name: '', email: '' });
  const load = (cid: number) => api<ClientDetail>(`/clients/${cid}`).then(setC);

  useEffect(() => {
    if (id) {
      setC(null);
      setInvite(null);
      load(id);
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (patch: Partial<ClientDetail>) => {
    if (!c) return;
    setC({ ...c, ...patch });
    try {
      await api(`/clients/${c.id}`, { method: 'PATCH', body: patch });
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const addUser = async (e: FormEvent) => {
    e.preventDefault();
    if (!c) return;
    try {
      const r = await api<{ inviteUrl: string }>(`/clients/${c.id}/users`, { body: nu });
      setInvite(r.inviteUrl);
      setNu({ name: '', email: '' });
      load(c.id);
      onChanged();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const reinvite = async (uid: number) => {
    const r = await api<{ inviteUrl: string }>(`/users/${uid}/invite`, { method: 'POST' });
    setInvite(r.inviteUrl);
    if (c) load(c.id);
  };

  const removeUser = async (uid: number, name: string) => {
    if (!(await confirm({ title: `Remove ${name}?`, body: 'They lose access to the portal.', confirm: 'Remove', danger: true }))) return;
    await api(`/users/${uid}`, { method: 'DELETE' });
    if (c) load(c.id);
    onChanged();
  };

  const removeClient = async () => {
    if (!c) return;
    if (!(await confirm({ title: `Delete ${c.name}?`, body: 'This deletes their requests, files, invoices and logins. It cannot be undone.', confirm: 'Delete client', danger: true }))) return;
    await api(`/clients/${c.id}`, { method: 'DELETE' });
    onChanged();
    onClose();
    toast('Client deleted');
  };

  return (
    <Drawer open={!!id} onClose={onClose} width={520}>
      {!c ? (
        <div className="drawer-body stack">
          <Skeleton h={30} w="60%" />
          <Skeleton h={120} />
        </div>
      ) : (
        <>
          <header className="drawer-head">
            <Avatar name={c.name} color={c.color} size={30} />
            <strong>{c.name}</strong>
            <span className="grow" />
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="x" />
            </button>
          </header>
          <div className="drawer-body">
            <div className="quick-links">
              <Link className="btn sm" to={`/board?client=${c.id}`}>
                <Icon name="board" size={14} /> Board
              </Link>
              <Link className="btn sm" to={`/files?client=${c.id}`}>
                <Icon name="folder" size={14} /> Files
              </Link>
              <Link className="btn sm" to={`/billing`}>
                <Icon name="receipt" size={14} /> Billing
              </Link>
            </div>
            <section className="section stack">
              <div className="row-2">
                <Field label="Name">
                  <input defaultValue={c.name} onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && save({ name: e.target.value.trim() })} />
                </Field>
                <Field label="Company">
                  <input defaultValue={c.company ?? ''} onBlur={(e) => e.target.value !== (c.company ?? '') && save({ company: e.target.value })} />
                </Field>
              </div>
              <Field label="Billing email" hint="Stripe sends invoices here">
                <input type="email" defaultValue={c.email ?? ''} onBlur={(e) => e.target.value !== (c.email ?? '') && save({ email: e.target.value })} />
              </Field>
              <div className="field">
                <span className="field-label">Color</span>
                <div className="color-row">
                  {COLORS.map((col) => (
                    <button key={col} type="button" className={`color-dot ${c.color === col ? 'on' : ''}`} style={{ background: `var(--${col})` }} onClick={() => save({ color: col })} aria-label={col} />
                  ))}
                </div>
              </div>
            </section>
            <section className="section">
              <h4 className="section-title">Portal logins</h4>
              <ul className="people">
                {c.users.map((u) => (
                  <li key={u.id}>
                    <Avatar name={u.name} color={c.color} size={28} />
                    <div className="grow truncate">
                      <strong>{u.name}</strong>
                      <span className="muted sm mono truncate">{u.email}</span>
                    </div>
                    {u.pending && <Badge tone="yellow">invited</Badge>}
                    <button className="btn sm ghost" onClick={() => reinvite(u.id)} title="Generate a new invite link">
                      <Icon name="link" size={13} /> Link
                    </button>
                    <button className="icon-btn xs danger" onClick={() => removeUser(u.id, u.name)} aria-label="Remove">
                      <Icon name="trash" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
              {invite && <InviteLink url={invite} />}
              <form className="inline-form" onSubmit={addUser}>
                <input placeholder="Name" required value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} />
                <input placeholder="Email" type="email" required value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} />
                <button className="btn sm primary">Invite</button>
              </form>
            </section>
          </div>
          {auth.user?.role === 'admin' && (
            <footer className="drawer-foot">
              <button className="btn ghost danger" onClick={removeClient}>
                <Icon name="trash" /> Delete client
              </button>
            </footer>
          )}
        </>
      )}
    </Drawer>
  );
}
