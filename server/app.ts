import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import multer from 'multer';
import { HttpError, csrfGuard, loadUser } from './auth.js';
import { authRouter } from './routes/auth.js';
import { clientsRouter } from './routes/clients.js';
import { projectsRouter } from './routes/projects.js';
import { filesRouter } from './routes/files.js';
import { billingRouter } from './routes/billing.js';
import { settingsRouter } from './routes/settings.js';
import { config } from './config.js';
import { handleWebhookEvent, stripe } from './stripe.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback');

  app.use((_req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  // Stripe needs the raw body to verify signatures, so this route comes before the JSON parser.
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    if (!config.stripeWebhookSecret) return res.status(400).json({ error: 'Webhook secret not configured' });
    let event;
    try {
      event = stripe().webhooks.constructEvent(req.body, req.get('stripe-signature') ?? '', config.stripeWebhookSecret);
    } catch (e) {
      return res.status(400).json({ error: `Signature check failed: ${(e as Error).message}` });
    }
    await handleWebhookEvent(event);
    res.json({ received: true });
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use('/api', loadUser, csrfGuard);
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', authRouter, settingsRouter, clientsRouter, projectsRouter, filesRouter, billingRouter);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  // Serve the built web app with SPA fallback.
  const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
  const compiled = fileURLToPath(import.meta.url).endsWith('.js');
  if (compiled && fs.existsSync(path.join(webDir, 'index.html'))) {
    app.use(express.static(webDir, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(webDir, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const field = issue?.path.join('.');
      return res.status(400).json({ error: field ? `${field}: ${issue.message}` : issue?.message ?? 'Invalid request' });
    }
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than the upload limit' : err.message });
    }
    const e = err as { type?: string; message?: string; status?: number };
    if (e?.type?.startsWith?.('Stripe')) return res.status(502).json({ error: `Stripe: ${e.message}` });
    if (e?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });

  return app;
}
