import { useEffect, useState, type FormEvent } from 'react';
import { api, useApi, type Me, type StripeStatus } from '../api';
import { StripeConnect } from '../components/StripeConnect';
import { useAuth } from '../auth';
import { Avatar, Badge, Field, Spinner, useConfirm, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { THEMES } from '../theme';
import { InviteLink } from './Clients';

export function Settings() {
  const auth = useAuth();
  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow mono">~/settings</p>
          <h1>Settings</h1>
        </div>
      </header>
      <Appearance />
      <Profile />
      {auth.user?.role === 'admin' && (
        <>
          <Payments />
          <Workspace />
          <Team />
          <ExampleData />
        </>
      )}
    </>
  );
}

function Appearance() {
  const auth = useAuth();
  const current = auth.user?.theme ?? null;
  return (
    <section className="card settings-card">
      <header className="card-head">
        <h3>
          <Icon name="palette" /> Theme
        </h3>
        <span className="muted sm">
          Tip: press <kbd>⌘K</kbd> and type “theme” to preview while you browse.
        </span>
      </header>
      <div className="theme-grid">
        <button className={`theme-tile default ${current === null ? 'on' : ''}`} onClick={() => auth.setTheme(null)}>
          <span className="theme-default-label mono">workspace default</span>
          <span className="theme-name">{THEMES.find((t) => t.id === auth.defaultTheme)?.name}</span>
        </button>
        {THEMES.map((t) => (
          <button
            key={t.id}
            className={`theme-tile ${current === t.id ? 'on' : ''}`}
            onClick={() => auth.setTheme(t.id)}
            style={{ background: t.colors.bg, color: t.colors.fg, borderColor: current === t.id ? t.colors.accent : t.colors.border }}
          >
            <span className="theme-preview" style={{ background: t.colors.surface, borderColor: t.colors.border }}>
              <span className="mono" style={{ color: t.colors.muted }}>
                <span style={{ color: t.colors.green }}>❯</span> mm <span style={{ color: t.colors.accent }}>board</span>
              </span>
              <span className="theme-bars">
                {[t.colors.red, t.colors.yellow, t.colors.green, t.colors.cyan, t.colors.blue, t.colors.magenta].map((c, i) => (
                  <i key={i} style={{ background: c }} />
                ))}
              </span>
            </span>
            <span className="theme-name">
              {t.name}
              {current === t.id && <Icon name="check" size={14} />}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Profile() {
  const auth = useAuth();
  const toast = useToast();
  const [name, setName] = useState(auth.user!.name);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/me', { method: 'PATCH', body: { name, ...(pw.next ? { currentPassword: pw.current, newPassword: pw.next } : {}) } });
      await auth.refresh();
      setPw({ current: '', next: '' });
      toast('Profile saved');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card settings-card">
      <header className="card-head">
        <h3>Profile</h3>
        <span className="mono muted sm">{auth.user!.email}</span>
      </header>
      <form className="stack narrow" onSubmit={submit}>
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <div className="row-2">
          <Field label="Current password">
            <input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </Field>
          <Field label="New password">
            <input type="password" autoComplete="new-password" minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </Field>
        </div>
        <div>
          <button className="btn primary" disabled={busy}>
            {busy ? <Spinner /> : 'Save'}
          </button>
        </div>
      </form>
    </section>
  );
}

function Workspace() {
  const auth = useAuth();
  const toast = useToast();
  const [name, setName] = useState(auth.businessName);
  const [theme, setTheme] = useState(auth.defaultTheme);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/settings', { method: 'PATCH', body: { businessName: name, defaultTheme: theme } });
      await auth.refresh();
      toast('Workspace saved');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return (
    <section className="card settings-card">
      <header className="card-head">
        <h3>Workspace</h3>
      </header>
      <form className="stack narrow" onSubmit={submit}>
        <div className="row-2">
          <Field label="Studio name" hint="Shown to clients in the portal">
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Default theme" hint="For anyone who hasn't picked one">
            <select value={theme} onChange={(e) => setTheme(e.target.value)}>
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div>
          <button className="btn primary">Save</button>
        </div>
      </form>
    </section>
  );
}

function Team() {
  const auth = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, reload } = useApi<(Me & { pending: boolean })[]>('/team');
  const [f, setF] = useState({ name: '', email: '', role: 'member' as 'member' | 'admin' });
  const [invite, setInvite] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api<{ inviteUrl: string }>('/team', { body: f });
      setInvite(r.inviteUrl);
      setF({ name: '', email: '', role: 'member' });
      reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const remove = async (u: Me) => {
    if (!(await confirm({ title: `Remove ${u.name}?`, confirm: 'Remove', danger: true }))) return;
    try {
      await api(`/users/${u.id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return (
    <section className="card settings-card">
      <header className="card-head">
        <h3>Team</h3>
        <span className="muted sm">Team members can manage every client, file and invoice.</span>
      </header>
      <ul className="people">
        {data?.map((u) => (
          <li key={u.id}>
            <Avatar name={u.name} color="accent" size={28} />
            <div className="grow truncate">
              <strong>{u.name}</strong>
              <span className="muted sm mono truncate">{u.email}</span>
            </div>
            {u.pending && <Badge tone="yellow">invited</Badge>}
            <Badge tone={u.role === 'admin' ? 'magenta' : 'blue'}>{u.role}</Badge>
            {u.id !== auth.user!.id && (
              <button className="icon-btn xs danger" onClick={() => remove(u)} aria-label="Remove">
                <Icon name="trash" size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {invite && <InviteLink url={invite} />}
      <form className="inline-form" onSubmit={submit}>
        <input placeholder="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input placeholder="Email" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as 'member' | 'admin' })}>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <button className="btn sm primary">Invite</button>
      </form>
    </section>
  );
}

function Payments() {
  const auth = useAuth();
  const toast = useToast();
  const [st, setSt] = useState<StripeStatus | null>(null);
  const [appUrl, setAppUrl] = useState('');
  const [hook, setHook] = useState('');
  useEffect(() => {
    api<StripeStatus>('/settings/stripe').then((s) => (setSt(s), setAppUrl(s.appUrl)));
    if (window.location.hash === '#payments') setTimeout(() => document.getElementById('payments')?.scrollIntoView({ behavior: 'smooth' }), 200);
  }, []);
  const save = async (body: Record<string, unknown>, msg = 'Saved') => {
    try {
      await api('/settings', { method: 'PATCH', body });
      setSt(await api<StripeStatus>('/settings/stripe'));
      await auth.refresh();
      toast(msg);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <section className="card settings-card" id="payments">
      <header className="card-head">
        <h3>
          <Icon name="card" /> Payments
        </h3>
      </header>
      <div className="stack">
        <StripeConnect status={st} onChange={setSt} />
        {st && (
          <div className="row-2 narrow">
            <Field label="Currency" hint="Used for new invoices and subscriptions">
              <select value={st.currency} onChange={(e) => save({ currency: e.target.value }, 'Currency updated')}>
                {['usd', 'eur', 'gbp', 'cad', 'aud', 'nzd', 'chf', 'sek', 'nok', 'dkk', 'jpy', 'sgd', 'hkd', 'mxn', 'brl', 'inr', 'zar'].map((c) => (
                  <option key={c} value={c}>
                    {c.toUpperCase()}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
        {st && !st.enabled && (
          <label className="check wrap">
            <input type="checkbox" checked={st.demoPayments} onChange={(e) => save({ demoPayments: e.target.checked })} />
            <span>
              <b>Practice mode:</b> let clients press "Pay" without Stripe, to try the whole flow. Turn this off before real clients sign in.
            </span>
          </label>
        )}
        {st && (
          <details className="advanced">
            <summary>Advanced</summary>
            <div className="stack">
              <Field label="Web address of this app" hint="Used in invite links and after Stripe payments. Filled in automatically during setup.">
                <div className="connect-row">
                  <input value={appUrl} onChange={(e) => setAppUrl(e.target.value)} placeholder="https://studio.example.com" />
                  <button className="btn" onClick={() => save({ appUrl })} disabled={appUrl === st.appUrl}>
                    Save
                  </button>
                </div>
              </Field>
              {st.enabled && (
                <Field label="Stripe webhook signing secret (optional)" hint="Payments already update on their own. A webhook only makes them show up instantly.">
                  <div className="stack" style={{ gap: 8 }}>
                    <span className="muted sm">
                      In Stripe, add an endpoint for <span className="mono">{st.webhookUrl}</span> with the events <span className="mono">invoice.*</span>, <span className="mono">customer.subscription.*</span> and{' '}
                      <span className="mono">checkout.session.completed</span>, then paste its signing secret.
                    </span>
                    <div className="connect-row">
                      <input className="mono" value={hook} onChange={(e) => setHook(e.target.value)} placeholder={st.webhookConfigured ? 'whsec_… (saved)' : 'whsec_…'} />
                      <button className="btn" onClick={() => (save({ webhookSecret: hook.trim() }, 'Webhook saved'), setHook(''))} disabled={!hook.trim()}>
                        Save
                      </button>
                    </div>
                  </div>
                </Field>
              )}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}

function ExampleData() {
  const auth = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (auth.hasExampleData && !(await confirm({ title: 'Remove the example data?', body: 'Deletes the example clients and everything attached to them.', confirm: 'Remove', danger: true }))) return;
    setBusy(true);
    try {
      await api('/settings/example-data', { method: auth.hasExampleData ? 'DELETE' : 'POST' });
      await auth.refresh();
      toast(auth.hasExampleData ? 'Example data removed' : 'Example data added');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card settings-card">
      <header className="card-head">
        <h3>Example data</h3>
        <button className="btn sm" onClick={run} disabled={busy}>
          {busy ? <Spinner size={12} /> : auth.hasExampleData ? 'Remove examples' : 'Add examples'}
        </button>
      </header>
      <p className="muted sm">Two sample clients with requests, files and an invoice, for exploring or demoing. Your real clients are never touched.</p>
    </section>
  );
}
