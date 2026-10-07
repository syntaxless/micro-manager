export function money(minor: number, currency = 'usd') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

/** SQLite datetimes are UTC without a zone marker. */
export const parseDate = (s: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) || s.length === 10 ? s : s.replace(' ', 'T') + 'Z');

export function ago(s: string) {
  const diff = (Date.now() - parseDate(s).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return parseDate(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function shortDate(s: string | null) {
  if (!s) return '';
  const d = s.length === 10 ? new Date(s + 'T00:00:00') : parseDate(s);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export function dueState(s: string | null): 'overdue' | 'soon' | null {
  if (!s) return null;
  const d = new Date(s + 'T23:59:59').getTime();
  const now = Date.now();
  if (d < now) return 'overdue';
  if (d - now < 3 * 864e5) return 'soon';
  return null;
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

export const STATUS_LABEL: Record<string, string> = {
  backlog: 'Backlog',
  queued: 'Up next',
  in_progress: 'In progress',
  review: 'In review',
  done: 'Done',
};
export const STATUS_TONE: Record<string, string> = {
  backlog: 'muted',
  queued: 'blue',
  in_progress: 'yellow',
  review: 'magenta',
  done: 'green',
};
export const PRIORITY_TONE: Record<string, string> = { low: 'muted', medium: 'blue', high: 'orange', urgent: 'red' };
export const INVOICE_TONE: Record<string, string> = { draft: 'muted', open: 'yellow', paid: 'green', void: 'muted', uncollectible: 'red' };
export const SUB_TONE: Record<string, string> = {
  pending: 'muted',
  active: 'green',
  trialing: 'cyan',
  past_due: 'orange',
  unpaid: 'red',
  canceled: 'muted',
  incomplete: 'yellow',
  incomplete_expired: 'muted',
  paused: 'muted',
};
