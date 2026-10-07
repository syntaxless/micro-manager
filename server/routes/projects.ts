import { Router } from 'express';
import { z } from 'zod';
import { all, one, run, type User } from '../db.js';
import { HttpError, assertClientAccess, isStaff, requireAuth, requireStaff } from '../auth.js';
import { PRIORITIES, STATUSES, dateStr, idParam, optionalId, parse } from '../util.js';
import { fileAccess, hasActiveSubscription } from '../access.js';

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

interface Project {
  id: number;
  client_id: number;
  title: string;
  description: string;
  status: (typeof STATUSES)[number];
  priority: (typeof PRIORITIES)[number];
  position: number;
  due_date: string | null;
}

function loadProject(user: User, id: number): Project {
  const p = one<Project>('SELECT * FROM projects WHERE id = ?', id);
  if (!p) throw new HttpError(404, 'Project not found');
  assertClientAccess(user, p.client_id);
  return p;
}

projectsRouter.get('/projects', (req, res) => {
  const u = req.user!;
  const clientId = isStaff(u) ? optionalId(req.query.client_id) : u.client_id;
  const where = clientId ? 'WHERE p.client_id = ?' : '';
  const rows = all(
    `SELECT p.*, c.name AS client_name, c.color AS client_color,
       (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
       (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.done = 1) AS task_done,
       (SELECT COUNT(*) FROM comments m WHERE m.project_id = p.id) AS comment_count,
       (SELECT COUNT(*) FROM files f WHERE f.project_id = p.id) AS file_count
     FROM projects p JOIN clients c ON c.id = p.client_id
     ${where}
     ORDER BY p.position, p.id`,
    ...(clientId ? [clientId] : []),
  );
  res.json(rows);
});

const projectFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20_000),
  status: z.enum(STATUSES),
  priority: z.enum(PRIORITIES),
  due_date: dateStr,
};

projectsRouter.post('/projects', (req, res) => {
  const u = req.user!;
  const body = parse(
    z.object({
      client_id: z.number().int().positive().optional(),
      title: projectFields.title,
      description: projectFields.description.optional(),
      status: projectFields.status.optional(),
      priority: projectFields.priority.optional(),
      due_date: dateStr,
    }),
    req.body,
  );
  const clientId = isStaff(u) ? body.client_id : u.client_id!;
  if (!clientId) throw new HttpError(400, 'Pick a client for this project');
  if (!one('SELECT 1 FROM clients WHERE id = ?', clientId)) throw new HttpError(404, 'Client not found');
  // Clients submit new requests to the end of the queue; staff can drop them anywhere.
  const status = isStaff(u) ? (body.status ?? 'queued') : body.status === 'backlog' ? 'backlog' : 'queued';
  const bottom = one<{ p: number | null }>('SELECT MAX(position) p FROM projects WHERE status = ?', status)?.p;
  const { id } = run(
    `INSERT INTO projects (client_id, title, description, status, priority, position, due_date, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    clientId,
    body.title,
    body.description ?? '',
    status,
    body.priority ?? 'medium',
    bottom == null ? 1000 : bottom + 1000,
    body.due_date ?? null,
    u.id,
  );
  res.status(201).json(one('SELECT * FROM projects WHERE id = ?', id));
});

projectsRouter.get('/projects/:id', (req, res) => {
  const u = req.user!;
  const p = loadProject(u, idParam(req));
  const tasks = all('SELECT * FROM tasks WHERE project_id = ? ORDER BY position, id', p.id);
  const comments = all(
    `SELECT m.*, u.name AS author_name, u.role AS author_role FROM comments m
     LEFT JOIN users u ON u.id = m.user_id WHERE m.project_id = ? ORDER BY m.id`,
    p.id,
  );
  const activeSub = isStaff(u) ? true : hasActiveSubscription(p.client_id);
  const files = all<import('../db.js').FileRow & { uploader_role: string | null; uploader_name: string | null }>(
    `SELECT f.*, u.role AS uploader_role, u.name AS uploader_name FROM files f
     LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.project_id = ? ORDER BY f.id DESC`,
    p.id,
  ).map(({ stored_name: _s, ...f }) => ({
    ...f,
    ...fileAccess({ ...f, stored_name: '' }, u, { activeSub, uploaderRole: f.uploader_role }),
  }));
  const client = one('SELECT id, name, color FROM clients WHERE id = ?', p.client_id);
  res.json({ ...p, client, tasks, comments, files });
});

projectsRouter.patch('/projects/:id', (req, res) => {
  const u = req.user!;
  const p = loadProject(u, idParam(req));
  const body = parse(
    z.object({
      title: projectFields.title.optional(),
      description: projectFields.description.optional(),
      status: projectFields.status.optional(),
      priority: projectFields.priority.optional(),
      due_date: dateStr,
    }),
    req.body,
  );
  run(
    `UPDATE projects SET title = ?, description = ?, status = ?, priority = ?, due_date = ?, updated_at = datetime('now')
     WHERE id = ?`,
    body.title ?? p.title,
    body.description ?? p.description,
    body.status ?? p.status,
    body.priority ?? p.priority,
    body.due_date !== undefined ? body.due_date : p.due_date,
    p.id,
  );
  res.json(one('SELECT * FROM projects WHERE id = ?', p.id));
});

/**
 * Moves a card to a column and slots it between two neighbours.
 * Positions are fractional so only the moved card is written, whatever filter the board shows.
 */
projectsRouter.post('/projects/:id/move', (req, res) => {
  const u = req.user!;
  const p = loadProject(u, idParam(req));
  const body = parse(
    z.object({
      status: z.enum(STATUSES),
      before_id: z.number().int().positive().nullable().optional(),
      after_id: z.number().int().positive().nullable().optional(),
    }),
    req.body,
  );
  const neighbour = (id?: number | null) => {
    if (!id) return null;
    const n = one<{ position: number; client_id: number }>('SELECT position, client_id FROM projects WHERE id = ?', id);
    if (!n || (!isStaff(u) && n.client_id !== u.client_id)) return null;
    return n.position;
  };
  const above = neighbour(body.before_id);
  const below = neighbour(body.after_id);
  let position: number;
  if (above != null && below != null) position = (above + below) / 2;
  else if (above != null) position = above + 1000;
  else if (below != null) position = below - 1000;
  else position = p.position;

  // Guard against float exhaustion after many moves between the same two cards.
  if (above != null && below != null && Math.abs(below - above) < 1e-6) {
    const col = all<{ id: number }>('SELECT id FROM projects WHERE status = ? ORDER BY position, id', body.status);
    col.forEach((row, i) => run('UPDATE projects SET position = ? WHERE id = ?', (i + 1) * 1000, row.id));
    return res.status(409).json({ error: 'Board reindexed, please retry', retry: true });
  }

  run("UPDATE projects SET status = ?, position = ?, updated_at = datetime('now') WHERE id = ?", body.status, position, p.id);
  res.json({ id: p.id, status: body.status, position });
});

projectsRouter.delete('/projects/:id', requireStaff, (req, res) => {
  const p = loadProject(req.user!, idParam(req));
  run('DELETE FROM projects WHERE id = ?', p.id);
  res.json({ ok: true });
});

// --- Checklist tasks ---

projectsRouter.post('/projects/:id/tasks', (req, res) => {
  const p = loadProject(req.user!, idParam(req));
  const body = parse(z.object({ title: z.string().trim().min(1).max(300) }), req.body);
  const max = one<{ p: number | null }>('SELECT MAX(position) p FROM tasks WHERE project_id = ?', p.id)?.p ?? 0;
  const { id } = run('INSERT INTO tasks (project_id, title, position) VALUES (?, ?, ?)', p.id, body.title, max + 1);
  res.status(201).json(one('SELECT * FROM tasks WHERE id = ?', id));
});

function loadTask(user: User, id: number) {
  const t = one<{ id: number; project_id: number; title: string; done: number }>('SELECT * FROM tasks WHERE id = ?', id);
  if (!t) throw new HttpError(404, 'Task not found');
  loadProject(user, t.project_id);
  return t;
}

projectsRouter.patch('/tasks/:id', (req, res) => {
  const t = loadTask(req.user!, idParam(req));
  const body = parse(z.object({ title: z.string().trim().min(1).max(300).optional(), done: z.boolean().optional() }), req.body);
  run('UPDATE tasks SET title = ?, done = ? WHERE id = ?', body.title ?? t.title, body.done === undefined ? t.done : Number(body.done), t.id);
  res.json(one('SELECT * FROM tasks WHERE id = ?', t.id));
});

projectsRouter.delete('/tasks/:id', (req, res) => {
  const t = loadTask(req.user!, idParam(req));
  run('DELETE FROM tasks WHERE id = ?', t.id);
  res.json({ ok: true });
});

// --- Comments ---

projectsRouter.post('/projects/:id/comments', (req, res) => {
  const u = req.user!;
  const p = loadProject(u, idParam(req));
  const body = parse(z.object({ body: z.string().trim().min(1).max(10_000) }), req.body);
  const { id } = run('INSERT INTO comments (project_id, user_id, body) VALUES (?, ?, ?)', p.id, u.id, body.body);
  res.status(201).json(
    one('SELECT m.*, u.name AS author_name, u.role AS author_role FROM comments m LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ?', id),
  );
});

projectsRouter.delete('/comments/:id', (req, res) => {
  const u = req.user!;
  const c = one<{ id: number; project_id: number; user_id: number | null }>('SELECT * FROM comments WHERE id = ?', idParam(req));
  if (!c) throw new HttpError(404, 'Comment not found');
  loadProject(u, c.project_id);
  if (c.user_id !== u.id && !isStaff(u)) throw new HttpError(403, 'You can only delete your own comments');
  run('DELETE FROM comments WHERE id = ?', c.id);
  res.json({ ok: true });
});
