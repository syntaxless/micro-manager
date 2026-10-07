/**
 * Developer seed: an admin plus the example data, with two example clients you can sign in as.
 *
 *   npm run seed     (admin@example.com / client@example.com / lumen@example.com, password123)
 *
 * New studios don't need this; the setup wizard offers the same example data.
 */
import { one, run, setSetting } from './db.js';
import { hashPassword } from './auth.js';
import { loadExampleData } from './examples.js';

if (one('SELECT 1 FROM users LIMIT 1')) {
  console.log('Database already has users; seed skipped.');
  process.exit(0);
}

const pw = hashPassword('password123');
setSetting('business_name', 'Pixel & Pine Studio');
setSetting('onboarded', '1');
const admin = run("INSERT INTO users (email, name, password_hash, role) VALUES ('admin@example.com', 'Jordan Reyes', ?, 'admin')", pw).id;
loadExampleData(admin);
run("UPDATE users SET email = 'client@example.com', password_hash = ? WHERE email = 'maya@nova.example'", pw);
run("UPDATE users SET email = 'lumen@example.com', password_hash = ? WHERE email = 'sam@lumen.example'", pw);

console.log('Seeded demo data.');
console.log('  admin:  admin@example.com / password123');
console.log('  client: client@example.com / password123 (Nova Coffee)');
console.log('  client: lumen@example.com / password123 (Lumen Labs)');
