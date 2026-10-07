/**
 * Runtime preferences. Most can be set from the Settings screen (stored in the database);
 * an environment variable with the same purpose always wins, for people who prefer config files.
 */
import { getSetting, setSetting } from './db.js';
import { config } from './config.js';

const env = (k: string) => (process.env[k] ?? '').trim();

export const stripeKey = () => env('STRIPE_SECRET_KEY') || getSetting('stripe_secret_key');
export const stripeKeyFromEnv = () => env('STRIPE_SECRET_KEY').length > 0;
export const webhookSecret = () => env('STRIPE_WEBHOOK_SECRET') || getSetting('stripe_webhook_secret');
export const stripeEnabled = () => stripeKey().length > 0;
export const stripeTestMode = () => /^(sk|rk)_test_/.test(stripeKey());
export const currency = () => (env('CURRENCY') || getSetting('currency') || 'usd').toLowerCase();
export const appUrl = () => (env('APP_URL') || getSetting('app_url') || `http://localhost:${config.port}`).replace(/\/$/, '');

/** Lets clients simulate payments when Stripe isn't connected. Never on by default. */
export const demoPayments = () =>
  !stripeEnabled() && (env('DEMO_PAYMENTS') === 'true' || getSetting('demo_payments') === '1');

/** Remembers the address people actually use, unless one was configured explicitly. */
export function rememberAppUrl(origin: string | undefined) {
  if (!origin || env('APP_URL') || getSetting('app_url')) return;
  try {
    const u = new URL(origin);
    if (u.protocol === 'http:' || u.protocol === 'https:') setSetting('app_url', u.origin);
  } catch {
    /* ignore malformed origins */
  }
}
