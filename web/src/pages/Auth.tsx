import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Field, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';

export function AuthCard({ title, subtitle, children, top, wide }: { title: string; subtitle?: ReactNode; children: ReactNode; top?: ReactNode; wide?: boolean }) {
  const auth = useAuth();
  return (
    <div className="auth-wrap">
      <div className={`auth-card ${wide ? 'wide' : ''}`}>
        <div className="auth-brand">
          <span className="brand-mark">
            <Icon name="terminal" size={15} strokeWidth={2.4} />
          </span>
          <span className="mono">{auth.businessName}</span>
        </div>
        {top}
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
      </div>
      <p className="auth-foot mono muted">micro-manager · self-hosted</p>
    </div>
  );
}

function useSubmit(fn: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

export function Login() {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, submit } = useSubmit(async () => {
    await api('/auth/login', { body: { email, password } });
    await auth.refresh();
  });
  return (
    <AuthCard title="Sign in" subtitle="Welcome back. Your projects are right where you left them.">
      <form onSubmit={submit} className="stack">
        <Field label="Email">
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label="Password">
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {error && <div className="form-error shake">{error}</div>}
        <button className="btn primary lg" disabled={busy}>
          {busy ? <Spinner /> : 'Sign in'}
        </button>
      </form>
    </AuthCard>
  );
}

export function Setup() {
  const auth = useAuth();
  const [f, setF] = useState({ businessName: '', name: '', email: '', password: '' });
  const { busy, error, submit } = useSubmit(async () => {
    await api('/auth/setup', { body: { ...f, businessName: f.businessName || undefined, origin: window.location.origin } });
    await auth.refresh();
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <AuthCard
      title="Welcome to Micro Manager"
      top={<WizardDots step={0} />}
      subtitle="First, create your account. This is how you'll sign in. Clients get their own logins later."
    >
      <form onSubmit={submit} className="stack">
        <Field label="Studio or business name" hint="Your clients see this when they sign in">
          <input value={f.businessName} onChange={set('businessName')} placeholder="e.g. Pixel & Pine Studio" autoFocus required />
        </Field>
        <Field label="Your name">
          <input value={f.name} onChange={set('name')} required />
        </Field>
        <Field label="Email">
          <input type="email" value={f.email} onChange={set('email')} required />
        </Field>
        <Field label="Choose a password" hint="At least 8 characters">
          <input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} required minLength={8} />
        </Field>
        {error && <div className="form-error shake">{error}</div>}
        <button className="btn primary lg" disabled={busy}>
          {busy ? <Spinner /> : 'Continue'}
        </button>
      </form>
    </AuthCard>
  );
}

export function AcceptInvite() {
  const { token } = useParams();
  const auth = useAuth();
  const nav = useNavigate();
  const [info, setInfo] = useState<{ email: string; name: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  useEffect(() => {
    api<{ email: string; name: string }>(`/auth/invite/${token}`)
      .then((i) => (setInfo(i), setName(i.name)))
      .catch((e) => setLoadError(e.message));
  }, [token]);
  const { busy, error, submit } = useSubmit(async () => {
    await api(`/auth/invite/${token}`, { body: { password, name } });
    await auth.refresh();
    nav('/', { replace: true });
  });
  if (loadError) {
    return (
      <AuthCard title="Invite unavailable" subtitle={loadError}>
        <a className="btn" href="/">
          Go to sign in
        </a>
      </AuthCard>
    );
  }
  if (!info) {
    return (
      <div className="boot">
        <Spinner />
      </div>
    );
  }
  return (
    <AuthCard title="You're invited" subtitle={<>Choose a password for <span className="mono">{info.email}</span>.</>}>
      <form onSubmit={submit} className="stack">
        <Field label="Your name">
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Password" hint="At least 8 characters">
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoFocus />
        </Field>
        {error && <div className="form-error shake">{error}</div>}
        <button className="btn primary lg" disabled={busy}>
          {busy ? <Spinner /> : 'Join'}
        </button>
      </form>
    </AuthCard>
  );
}

export const WIZARD_STEPS = ['Account', 'Look', 'Payments', 'Examples'];

export function WizardDots({ step }: { step: number }) {
  return (
    <span className="wizard-dots" aria-label={`Step ${step + 1} of ${WIZARD_STEPS.length}`}>
      {WIZARD_STEPS.map((label, i) => (
        <span key={label} className={i < step ? 'done' : i === step ? 'on' : ''}>
          <i />
          {label}
        </span>
      ))}
    </span>
  );
}
