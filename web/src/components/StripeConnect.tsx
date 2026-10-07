import { useState, type FormEvent } from 'react';
import { api, type StripeStatus } from '../api';
import { useAuth } from '../auth';
import { Badge, Spinner, useConfirm, useToast } from './ui';
import { Icon } from './Icon';

/** Paste-a-key Stripe connection, written for people who have never touched an API key. */
export function StripeConnect({ status, onChange }: { status: StripeStatus | null; onChange: (s: StripeStatus) => void }) {
  const auth = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await api<StripeStatus>('/settings/stripe', { body: { secretKey: key } });
      onChange(s);
      setKey('');
      await auth.refresh();
      toast(s.testMode ? 'Stripe connected in test mode' : 'Stripe connected');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!(await confirm({ title: 'Disconnect Stripe?', body: 'Existing invoices stay in Stripe. New invoices will be recorded here and marked paid by hand.', confirm: 'Disconnect', danger: true }))) return;
    try {
      onChange(await api<StripeStatus>('/settings/stripe', { method: 'DELETE' }));
      await auth.refresh();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  if (!status) return <Spinner />;

  if (status.enabled) {
    return (
      <div className="stripe-connected">
        <span className="stripe-check">
          <Icon name="check" size={16} strokeWidth={2.6} />
        </span>
        <div className="grow">
          <strong>{status.accountName ? `Connected to ${status.accountName}` : 'Stripe is connected'}</strong>
          <span className="muted sm mono">{status.keyHint}</span>
          {status.testMode && <span className="muted sm">Test mode: payments use test cards like 4242 4242 4242 4242 and no real money moves. Paste your live key here when you're ready for real payments.</span>}
        </div>
        <Badge tone={status.testMode ? 'yellow' : 'green'} dot>
          {status.testMode ? 'test mode' : 'live'}
        </Badge>
        {!status.fromEnv && (
          <button className="btn sm ghost danger" onClick={disconnect}>
            Disconnect
          </button>
        )}
      </div>
    );
  }

  return (
    <form className="stripe-connect" onSubmit={connect}>
      <ol className="steps">
        <li>
          <span>
            Sign in to Stripe, or{' '}
            <a className="link" href="https://dashboard.stripe.com/register" target="_blank" rel="noopener">
              create a free account
            </a>
            . No business details are needed to start in test mode.
          </span>
        </li>
        <li>
          <span>
            Open your{' '}
            <a className="link" href="https://dashboard.stripe.com/test/apikeys" target="_blank" rel="noopener">
              API keys page
            </a>{' '}
            and click <b>Reveal test key</b> next to <b>Secret key</b>. Copy it.
          </span>
        </li>
        <li>
          <span>Paste it below.</span>
        </li>
      </ol>
      <div className="connect-row">
        <input
          className="mono"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk_test_…"
          autoComplete="off"
          spellCheck={false}
          aria-label="Stripe secret key"
        />
        <button className="btn primary" disabled={busy || !key.trim()}>
          {busy ? <Spinner /> : 'Connect'}
        </button>
      </div>
      {error && <div className="form-error shake">{error}</div>}
      <p className="muted sm">Your key is stored only on this server and is never shown to clients.</p>
    </form>
  );
}
