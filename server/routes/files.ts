import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { all, one, run, type FileRow, type User } from '../db.js';
import { HttpError, assertClientAccess, isStaff, requireAuth } from '../auth.js';
import { config } from '../config.js';
import { fileAccess, hasActiveSubscription } from '../access.js';
import { idParam, optionalId, parse } from '../util.js';

export const filesRouter = Router();
filesRouter.use(requireAuth);

const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, _file, cb) => cb(null, crypto.randomBytes(16).toString('hex')),
  }),
  limits: { fileSize: config.maxUploadBytes, files: 20 },
});

type Listed = FileRow & {
  uploader_name: string | null;
  uploader_role: string | null;
  project_title: string | null;
  client_name: string;
};

function present(rows: Listed[], user: User) {
  const subCache = new Map<number, boolean>();
  return rows.map(({ stored_name: _s, ...f }) => {
    if (!subCache.has(f.client_id)) subCache.set(f.client_id, isStaff(user) || hasActiveSubscription(f.client_id));
    return {
      ...f,
      ...fileAccess({ ...f, stored_name: '' }, user, { activeSub: subCache.get(f.client_id), uploaderRole: f.uploader_role }),
    };
  });
}

const LIST_SQL = `
  SELECT f.*, u.name AS uploader_name, u.role AS uploader_role, p.title AS project_title, c.name AS client_name
  FROM files f
  JOIN clients c ON c.id = f.client_id
  LEFT JOIN users u ON u.id = f.uploaded_by
  LEFT JOIN projects p ON p.id = f.project_id`;

filesRouter.get('/files', (req, res) => {
  const u = req.user!;
  const clientId = isStaff(u) ? optionalId(req.query.client_id) : u.client_id;
  const projectId = optionalId(req.query.project_id);
  const where: string[] = [];
  const params: number[] = [];
  if (clientId) (where.push('f.client_id = ?'), params.push(clientId));
  if (projectId) (where.push('f.project_id = ?'), params.push(projectId));
  const rows = all<Listed>(`${LIST_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY f.id DESC`, ...params);
  res.json(present(rows, u));
});

filesRouter.post('/files', upload.array('files'), (req, res) => {
  const u = req.user!;
  const uploaded = (req.files as Express.Multer.File[] | undefined) ?? [];
  const cleanup = () => uploaded.forEach((f) => fs.rm(f.path, { force: true }, () => {}));
  try {
    if (!uploaded.length) throw new HttpError(400, 'Choose at least one file');
    const clientId = isStaff(u) ? optionalId(req.body.client_id) : u.client_id;
    if (!clientId || !one('SELECT 1 FROM clients WHERE id = ?', clientId)) throw new HttpError(400, 'Pick a client for these files');
    const projectId = optionalId(req.body.project_id);
    if (projectId && !one('SELECT 1 FROM projects WHERE id = ? AND client_id = ?', projectId, clientId)) {
      throw new HttpError(400, 'That project belongs to a different client');
    }
    const gated = isStaff(u) && (req.body.requires_subscription === 'true' || req.body.requires_subscription === '1') ? 1 : 0;
    const ids = uploaded.map(
      (f) =>
        run(
          `INSERT INTO files (client_id, project_id, uploaded_by, name, stored_name, mime, size, requires_subscription)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          clientId,
          projectId,
          u.id,
          // Multer decodes multipart filenames as latin1; restore UTF-8 names.
          Buffer.from(f.originalname, 'latin1').toString('utf8').slice(0, 255),
          f.filename,
          f.mimetype || 'application/octet-stream',
          f.size,
          gated,
        ).id,
    );
    const rows = all<Listed>(`${LIST_SQL} WHERE f.id IN (${ids.map(() => '?').join(',')}) ORDER BY f.id DESC`, ...ids);
    res.status(201).json(present(rows, u));
  } catch (e) {
    cleanup();
    throw e;
  }
});

function loadFile(user: User, id: number) {
  const f = one<FileRow>('SELECT * FROM files WHERE id = ?', id);
  if (!f) throw new HttpError(404, 'File not found');
  assertClientAccess(user, f.client_id);
  return f;
}

function canManage(user: User, f: FileRow) {
  return isStaff(user) || f.uploaded_by === user.id;
}

filesRouter.patch('/files/:id', (req, res) => {
  const u = req.user!;
  const f = loadFile(u, idParam(req));
  if (!canManage(u, f)) throw new HttpError(403, 'Only the uploader or your team can change this file');
  const body = parse(
    z.object({
      name: z.string().trim().min(1).max(255).optional(),
      project_id: z.number().int().positive().nullable().optional(),
      requires_subscription: z.boolean().optional(),
    }),
    req.body,
  );
  if (body.project_id && !one('SELECT 1 FROM projects WHERE id = ? AND client_id = ?', body.project_id, f.client_id)) {
    throw new HttpError(400, 'That project belongs to a different client');
  }
  run(
    'UPDATE files SET name = ?, project_id = ?, requires_subscription = ? WHERE id = ?',
    body.name ?? f.name,
    body.project_id !== undefined ? body.project_id : f.project_id,
    body.requires_subscription !== undefined && isStaff(u) ? Number(body.requires_subscription) : f.requires_subscription,
    f.id,
  );
  res.json({ ok: true });
});

filesRouter.delete('/files/:id', (req, res) => {
  const u = req.user!;
  const f = loadFile(u, idParam(req));
  if (!canManage(u, f)) throw new HttpError(403, 'Only the uploader or your team can delete this file');
  run('DELETE FROM files WHERE id = ?', f.id);
  fs.rm(path.join(config.uploadDir, f.stored_name), { force: true }, () => {});
  res.json({ ok: true });
});

filesRouter.get('/files/:id/download', (req, res) => {
  const u = req.user!;
  const f = loadFile(u, idParam(req));
  const access = fileAccess(f, u);
  if (access.locked) throw new HttpError(402, access.reason ?? 'This file is locked');
  const full = path.join(config.uploadDir, f.stored_name);
  if (!fs.existsSync(full)) throw new HttpError(410, 'The file is missing from storage');
  const inline = req.query.inline === '1' && /^(image\/(png|jpe?g|gif|webp|avif|svg\+xml)|application\/pdf|video\/(mp4|webm)|audio\/)/.test(f.mime);
  res.setHeader('Content-Type', f.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${f.name.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
  );
  res.sendFile(full);
});
