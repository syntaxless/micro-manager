import path from 'node:path';
import fs from 'node:fs';

const dataDir = path.resolve(process.env.DATA_DIR ?? './data');
fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });

/** Static settings that are fixed at startup. Everything else lives in prefs.ts. */
export const config = {
  port: Number(process.env.PORT ?? 3000),
  dataDir,
  uploadDir: path.join(dataDir, 'uploads'),
  dbPath: process.env.DB_PATH ?? path.join(dataDir, 'micro-manager.db'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 200) * 1024 * 1024,
  adminEmail: process.env.ADMIN_EMAIL ?? '',
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
};
