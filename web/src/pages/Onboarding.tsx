import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type StripeStatus } from '../api';
import { useAuth } from '../auth';
import { Spinner, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { StripeConnect } from '../components/StripeConnect';
import { THEMES } from '../theme';
import { AuthCard, WizardDots } from './Auth';

/** Steps 2–4 of first-run setup. Shown to the admin until they finish or skip it. */
export function Onboarding() {
  const auth = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [step, setStep] = useState(1);
  const [stripe, setStripe] = useState<StripeStatus | null>(null);
  const [examples, setExamples] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const theme = auth.user?.theme ?? auth.defaultTheme;

  useEffect(() => {
    api<StripeStatus>('/settings/stripe').then(setStripe).catch(() => {});
  }, []);

  const pickTheme = async (id: string) => {
    await auth.setTheme(id);
    await api('/settings', { method: 'PATCH', body: { defaultTheme: id } });
  };

  const finish = async () => {
    setBusy(true);
    try {
      if (examples) await api('/settings/example-data', { method: 'POST' });
      await api('/settings', { method: 'PATCH', body: { onboarded: true } });
      await auth.refresh();
      nav('/', { replace: true });
      toast(examples ? 'All set. Example clients are loaded so you can look around.' : "All set. Let's add your first client.");
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const skipAll = async () => {
    await api('/settings', { method: 'PATCH', body: { onboarded: true } });
    await auth.refresh();
  };

  const footer = (next: () => void, nextLabel = 'Continue', disabled = false) => (
    <div className="wizard-foot">
      <button className="btn ghost" onClick={() => setStep(step - 1)} disabled={step <= 1}>
        Back
      </button>
      <span className="grow" />
      <button className="btn primary lg" onClick={next} disabled={disabled || busy}>
        {busy ? <Spinner /> : nextLabel}
      </button>
    </div>
  );

  return (
    <AuthCard
      wide
      top={<WizardDots step={step} />}
      title={step === 1 ? 'Pick a look' : step === 2 ? 'Get paid online' : 'Start with examples?'}
      subtitle={
        step === 1
          ? 'Choose a color theme for your studio. Everyone can change their own later, and you can press ⌘K anytime to try others.'
          : step === 2
            ? 'Connect Stripe so clients can pay invoices and subscriptions by card. You can skip this and mark invoices paid by hand.'
            : 'We can add two example clients with requests, files and an invoice, so you can see how everything works. Remove them with one click when you are ready.'
      }
    >
      <div className="wizard-step" key={step}>
        {step === 1 && (
          <>
            <div className="theme-grid compact">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  className={`theme-tile ${theme === t.id ? 'on' : ''}`}
                  onClick={() => pickTheme(t.id)}
                  style={{ background: t.colors.bg, color: t.colors.fg, borderColor: theme === t.id ? t.colors.accent : t.colors.border }}
                >
                  <span className="theme-bars">
                    {[t.colors.red, t.colors.yellow, t.colors.green, t.colors.cyan, t.colors.blue, t.colors.magenta].map((c, i) => (
                      <i key={i} style={{ background: c }} />
                    ))}
                  </span>
                  <span className="theme-name">
                    {t.name}
                    {theme === t.id && <Icon name="check" size={13} />}
                  </span>
                </button>
              ))}
            </div>
            {footer(() => setStep(2))}
          </>
        )}
        {step === 2 && (
          <>
            <StripeConnect status={stripe} onChange={setStripe} />
            {footer(() => setStep(3), stripe?.enabled ? 'Continue' : 'Skip for now')}
          </>
        )}
        {step === 3 && (
          <>
            <div className="choice-grid">
              <button className={`choice ${examples === true ? 'on' : ''}`} onClick={() => setExamples(true)}>
                <Icon name="board" size={22} />
                <strong>Show me examples</strong>
                <span className="muted sm">Two sample clients, a full board, files and an invoice. Clearly labeled and easy to remove.</span>
              </button>
              <button className={`choice ${examples === false ? 'on' : ''}`} onClick={() => setExamples(false)}>
                <Icon name="plus" size={22} />
                <strong>Start empty</strong>
                <span className="muted sm">Jump straight in and add your first real client.</span>
              </button>
            </div>
            {footer(finish, 'Finish setup', examples === null)}
          </>
        )}
      </div>
      <button className="link sm wizard-skip" onClick={skipAll}>
        Skip setup
      </button>
    </AuthCard>
  );
}
