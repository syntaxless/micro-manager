import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { one, run, type User } from './db.js';

const SESSION_DAYS = 30;
export const COOKIE = 'mm_session';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function createSession(req: Request, res: Response, userId: number) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  run('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), userId, expires.toISOString());
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    expires,
    path: '/',
  });
}

export function destroySession(req: Request, res: Response) {
  const token = req.cookies?.[COOKIE];
  if (token) run('DELETE FROM sessions WHERE id = ?', sha256(token));
  res.clearCookie(COOKIE, { path: '/' });
}

export function destroyUserSessions(userId: number, exceptReq?: Request) {
  const keep = exceptReq?.cookies?.[COOKIE];
  if (keep) run('DELETE FROM sessions WHERE user_id = ? AND id != ?', userId, sha256(keep));
  else run('DELETE FROM sessions WHERE user_id = ?', userId);
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/** Loads the session user (if any) onto req.user. */
export function loadUser(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE];
  if (token) {
    const user = one<User>(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
      sha256(token),
      new Date().toISOString(),
    );
    if (user) req.user = user;
  }
  next();
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Not signed in'));
  next();
}

export function requireStaff(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Not signed in'));
  if (req.user.role === 'client') return next(new HttpError(403, 'Staff only'));
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Not signed in'));
  if (req.user.role !== 'admin') return next(new HttpError(403, 'Admins only'));
  next();
}

export const isStaff = (u: User) => u.role !== 'client';

/** Throws unless the user may see records belonging to this client. */
export function assertClientAccess(user: User, clientId: number) {
  if (isStaff(user)) return;
  if (user.client_id !== clientId) throw new HttpError(404, 'Not found');
}

/** Rejects cross-site state-changing requests that slipped past SameSite. */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/stripe/webhook')) return next();
  if (req.get('x-mm') !== '1') return next(new HttpError(403, 'Missing request header'));
  next();
}

export function publicUser(u: User) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, client_id: u.client_id, theme: u.theme };
}
