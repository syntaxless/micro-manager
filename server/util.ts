import { z } from 'zod';
import type { Request } from 'express';
import { HttpError } from './auth.js';

export function idParam(req: Request, name = 'id'): number {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${name}`);
  return n;
}

export function optionalId(v: unknown): number | null {
  if (v === undefined || v === null || v === '' || v === 'null') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Invalid id');
  return n;
}

export const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must look like YYYY-MM-DD')
  .nullable()
  .optional();

export const STATUSES = ['backlog', 'queued', 'in_progress', 'review', 'done'] as const;
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data);
}
