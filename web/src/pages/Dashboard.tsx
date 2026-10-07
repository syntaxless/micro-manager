import { Link } from 'react-router-dom';
import { api, useApi } from '../api';
import { useAuth } from '../auth';
import { Badge, Empty, Skeleton, Spinner, useConfirm, useToast } from '../components/ui';
import { useState } from 'react';
import { Icon } from '../components/Icon';
import { STATUS_LABEL, STATUS_TONE, PRIORITY_TONE, ago, dueState, money, shortDate } from '../format';
import { tone } from '../theme';

interface Dash {
  byStatus: { status: string; n: number }[];
  outstanding: number;
  paid30: number;
  mrr: number;
  recent: { id: number; title: string; status: string; priority: string; updated_at: string; client_name: string; client_color: string | null }[];
  dueSoon: { id: number; title: string; due_date: string; priority: string; client_name: string }[];
  openInvoices: { id: number; number: string; title: string; due_date: string | null; currency: string; client_name: string; total: number }[];
  clients: number | null;
  files: number;
  activeSubscription: boolean | null;
  currency: string;
  checklist: { key: string; done: boolean }[] | null;
}

const ORDER = ['backlog', 'queued', 'in_progress', 'review', 'done'];

export function Dashboard() {
  const auth = useAuth();
  const { data, reload } = useApi<Dash>('/dashboard');
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const total = data?.byStatus.reduce((a, b) => a + b.n, 0) ?? 0;
  const count = (s: string) => data?.byStatus.find((b) => b.status === s)?.n ?? 0;

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow mono">~/overview</p>
          <h1>
            {greet}, {auth.user!.name.split(' ')[0]}
          </h1>
        </div>
        <Link className="btn primary" to="/board?new=1">
          <Icon name="plus" /> New request
        </Link>
      </header>

      {auth.hasExampleData && <ExampleBanner onRemoved={reload} />}
      {data?.checklist && <Checklist items={data.checklist} onDismiss={reload} />}

      <section className="stats">
        <Stat label="Active requests" value={data ? String(total - count('done')) : null} sub={data ? `${count('in_progress')} in progress` : ''} tone="blue" />
        <Stat label="Outstanding" value={data ? money(data.outstanding, data.currency) : null} sub={data ? `${data.openInvoices.length} open invoice${data.openInvoices.length === 1 ? '' : 's'}` : ''} tone="yellow" />
        {auth.isStaff ? (
          <>
            <Stat label="Paid, last 30 days" value={data ? money(data.paid30, data.currency) : null} sub="collected" tone="green" />
            <Stat label="Recurring / month" value={data ? money(data.mrr, data.currency) : null} sub={data ? `${data.clients} client${data.clients === 1 ? '' : 's'}` : ''} tone="magenta" />
          </>
        ) : (
          <>
            <Stat label="Files" value={data ? String(data.files) : null} sub="shared with you" tone="cyan" />
            <Stat label="Subscription" value={data ? (data.activeSubscription ? 'Active' : 'None') : null} sub={data?.activeSubscription ? 'all files unlocked' : 'pay per invoice'} tone="magenta" />
          </>
        )}
      </section>

      {data && total > 0 && (
        <section className="card pipeline">
          <div className="pipeline-bar">
            {ORDER.map((s) =>
              count(s) ? <span key={s} style={{ flex: count(s), background: `var(--${STATUS_TONE[s] === 'muted' ? 'border' : STATUS_TONE[s]})` }} title={`${STATUS_LABEL[s]}: ${count(s)}`} /> : null,
            )}
          </div>
          <div className="pipeline-legend mono">
            {ORDER.map((s) => (
              <span key={s}>
                <i style={{ background: `var(--${STATUS_TONE[s] === 'muted' ? 'border' : STATUS_TONE[s]})` }} />
                {STATUS_LABEL[s]} <b>{count(s)}</b>
              </span>
            ))}
          </div>
        </section>
      )}

      <div className="grid-2">
        <section className="card">
          <header className="card-head">
            <h3>Recent activity</h3>
            <Link to="/board" className="link mono">
              board →
            </Link>
          </header>
          {!data ? (
            <ListSkeleton />
          ) : data.recent.length === 0 ? (
            <Empty icon="board" title="No requests yet">
              Create the first one from the board.
            </Empty>
          ) : (
            <ul className="rows">
              {data.recent.map((p) => (
                <li key={p.id}>
                  <Link to={`/board?open=${p.id}`} className="row-link">
                    <span className="client-dot" style={{ background: tone(p.client_color) }} />
                    <span className="grow truncate">{p.title}</span>
                    <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                    <span className="mono muted sm">{ago(p.updated_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <header className="card-head">
            <h3>Due soon</h3>
          </header>
          {!data ? (
            <ListSkeleton />
          ) : data.dueSoon.length === 0 ? (
            <Empty icon="calendar" title="Nothing scheduled">
              Requests with due dates show up here.
            </Empty>
          ) : (
            <ul className="rows">
              {data.dueSoon.map((p) => (
                <li key={p.id}>
                  <Link to={`/board?open=${p.id}`} className="row-link">
                    <Badge tone={PRIORITY_TONE[p.priority]} dot>
                      {p.priority}
                    </Badge>
                    <span className="grow truncate">{p.title}</span>
                    {auth.isStaff && <span className="muted sm truncate">{p.client_name}</span>}
                    <span className={`mono sm due ${dueState(p.due_date) ?? ''}`}>{shortDate(p.due_date)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {data && data.openInvoices.length > 0 && (
        <section className="card">
          <header className="card-head">
            <h3>Open invoices</h3>
            <Link to="/billing" className="link mono">
              billing →
            </Link>
          </header>
          <ul className="rows">
            {data.openInvoices.map((i) => (
              <li key={i.id}>
                <Link to={`/billing?invoice=${i.id}`} className="row-link">
                  <span className="mono muted">{i.number}</span>
                  <span className="grow truncate">{i.title}</span>
                  {auth.isStaff && <span className="muted sm">{i.client_name}</span>}
                  <span className="mono">{money(i.total, i.currency)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Stat({ label, value, sub, tone: t }: { label: string; value: string | null; sub: string; tone: string }) {
  return (
    <div className="stat" style={{ ['--tone' as string]: `var(--${t})` }}>
      <span className="stat-label">{label}</span>
      <span className="stat-value mono">{value ?? <Skeleton h={28} w={90} />}</span>
      <span className="stat-sub muted">{sub}</span>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="stack" style={{ gap: 12, padding: '6px 0' }}>
      {[80, 60, 70].map((w, i) => (
        <Skeleton key={i} w={`${w}%`} />
      ))}
    </div>
  );
}

const STEPS: Record<string, { label: string; hint: string; to: string }> = {
  client: { label: 'Add your first client', hint: 'A client is a company or person you work for.', to: '/clients?new=1' },
  invite: { label: 'Invite them to their portal', hint: 'They get a link to set a password, then see their board, files and invoices.', to: '/clients' },
  stripe: { label: 'Connect Stripe to get paid online', hint: 'Paste one key from your Stripe dashboard. Optional.', to: '/settings#payments' },
  file: { label: 'Upload a file for a client', hint: 'Deliverables, drafts, source files.', to: '/files' },
  invoice: { label: 'Send your first invoice', hint: 'Attach files and they unlock once it is paid.', to: '/billing?new=invoice' },
};

function Checklist({ items, onDismiss }: { items: { key: string; done: boolean }[]; onDismiss: () => void }) {
  const done = items.filter((i) => i.done).length;
  const dismiss = async () => {
    await api('/settings', { method: 'PATCH', body: { checklistDismissed: true } });
    onDismiss();
  };
  return (
    <section className="card checklist">
      <header className="card-head">
        <div>
          <h3>Getting started</h3>
          <span className="muted sm">
            {done} of {items.length} done
          </span>
        </div>
        <button className="link sm" onClick={dismiss}>
          {done === items.length ? 'Done, hide this' : 'Hide'}
        </button>
      </header>
      <div className="progress thin">
        <span style={{ width: `${(done / items.length) * 100}%` }} />
      </div>
      <ol className="checklist-items">
        {items.map((i) => {
          const s = STEPS[i.key];
          if (!s) return null;
          return (
            <li key={i.key} className={i.done ? 'done' : ''}>
              <Link to={s.to} className="row-link">
                <span className="check-dot">{i.done && <Icon name="check" size={12} strokeWidth={3} />}</span>
                <span className="grow">
                  <strong>{s.label}</strong>
                  <span className="muted sm">{s.hint}</span>
                </span>
                {!i.done && <Icon name="external" size={14} className="muted" />}
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ExampleBanner({ onRemoved }: { onRemoved: () => void }) {
  const auth = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (auth.user?.role !== 'admin') return null;
  const remove = async () => {
    if (!(await confirm({ title: 'Remove the example data?', body: 'This deletes the two example clients and everything attached to them. Your own clients are not touched.', confirm: 'Remove examples', danger: true }))) return;
    setBusy(true);
    try {
      await api('/settings/example-data', { method: 'DELETE' });
      await auth.refresh();
      onRemoved();
      toast('Example data removed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="banner">
      <Icon name="board" />
      <span className="grow">
        You're looking at <b>example data</b> (Nova Coffee and Lumen Labs). Explore freely, then remove it when you're ready.
      </span>
      <button className="btn sm" onClick={remove} disabled={busy}>
        {busy ? <Spinner size={12} /> : 'Remove examples'}
      </button>
    </div>
  );
}
