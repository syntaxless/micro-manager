import { createApp } from './app.js';
import { config, stripeEnabled } from './config.js';
import { one, run } from './db.js';
import { hashPassword } from './auth.js';

// Optional bootstrap admin from env so headless installs don't need the setup screen.
if (config.adminEmail && config.adminPassword && !one('SELECT 1 FROM users LIMIT 1')) {
  run("INSERT INTO users (email, name, password_hash, role) VALUES (?, 'Admin', ?, 'admin')", config.adminEmail, hashPassword(config.adminPassword));
  console.log(`Created admin ${config.adminEmail}`);
}

// Expired sessions and invites are cleaned up hourly.
setInterval(() => run('DELETE FROM sessions WHERE expires_at < ?', new Date().toISOString()), 3600_000).unref();

createApp().listen(config.port, () => {
  console.log(`Micro Manager listening on :${config.port} (${config.appUrl})`);
  console.log(stripeEnabled() ? 'Stripe: enabled' : 'Stripe: not configured, running in demo billing mode');
});
