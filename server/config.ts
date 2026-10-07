import path from 'node:path';
import fs from 'node:fs';

const dataDir = path.resolve(process.env.DATA_DIR ?? './data');
fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });

export const config = {
  port: Number(process.env.PORT ?? 3000),
  appUrl: (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  dataDir,
  uploadDir: path.join(dataDir, 'uploads'),
  dbPath: process.env.DB_PATH ?? path.join(dataDir, 'micro-manager.db'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 200) * 1024 * 1024,
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  currency: (process.env.CURRENCY ?? 'usd').toLowerCase(),
  adminEmail: process.env.ADMIN_EMAIL ?? '',
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  secureCookies: (process.env.APP_URL ?? '').startsWith('https://'),
};

export const stripeEnabled = () => config.stripeSecretKey.length > 0;
/** Lets clients simulate payments when Stripe isn't configured. Never on by default. */
export const demoPayments = () => !stripeEnabled() && process.env.DEMO_PAYMENTS === 'true';
