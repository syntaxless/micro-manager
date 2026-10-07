import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-mm': '1' };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (body ? 'POST' : 'GET'),
    headers,
    body,
    credentials: 'same-origin',
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && onUnauthorized && !path.startsWith('/auth/')) onUnauthorized();
    throw new ApiError(res.status, data?.error ?? res.statusText);
  }
  return data as T;
}

/** Upload with progress, since fetch() can't report it. */
export function uploadFiles(form: FormData, onProgress?: (pct: number) => void): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files');
    xhr.setRequestHeader('x-mm', '1');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      const data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data?.error ?? 'Upload failed'));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Network error during upload'));
    xhr.send(form);
  });
}

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError((e as Error).message);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, setData, error, loading, reload };
}

// ---------- Shared types ----------

export type Role = 'admin' | 'member' | 'client';
export interface Me {
  id: number;
  email: string;
  name: string;
  role: Role;
  client_id: number | null;
  theme: string | null;
}
export interface AuthState {
  user: Me | null;
  client: { id: number; name: string; company: string | null } | null;
  needsSetup: boolean;
  stripe: boolean;
  demoPayments: boolean;
  stripeTestMode: boolean;
  businessName: string;
  defaultTheme: string;
  currency: string;
  onboarded: boolean;
  hasExampleData: boolean;
}
export type Status = 'backlog' | 'queued' | 'in_progress' | 'review' | 'done';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export interface ProjectCard {
  id: number;
  client_id: number;
  client_name: string;
  client_color: string | null;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  position: number;
  due_date: string | null;
  task_count: number;
  task_done: number;
  comment_count: number;
  file_count: number;
  updated_at: string;
}
export interface FileItem {
  id: number;
  client_id: number;
  client_name: string;
  project_id: number | null;
  project_title: string | null;
  uploaded_by: number | null;
  uploader_name: string | null;
  uploader_role: string | null;
  name: string;
  mime: string;
  size: number;
  requires_subscription: number;
  created_at: string;
  locked: boolean;
  reason: string | null;
  invoices: { id: number; number: string; status: string }[];
}
export interface ClientRow {
  id: number;
  name: string;
  company: string | null;
  email: string | null;
  color: string | null;
  open_projects: number;
  file_count: number;
  outstanding: number;
  active_subscriptions: number;
  user_count: number;
  is_example: number;
}
export interface InvoiceRow {
  id: number;
  client_id: number;
  client_name: string;
  client_color: string | null;
  number: string;
  title: string;
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  currency: string;
  due_date: string | null;
  hosted_url: string | null;
  stripe_invoice_id: string | null;
  total: number;
  file_count: number;
  created_at: string;
  sent_at: string | null;
  paid_at: string | null;
}
export interface SubscriptionRow {
  id: number;
  client_id: number;
  client_name: string;
  client_color: string | null;
  name: string;
  amount: number;
  currency: string;
  interval: 'week' | 'month' | 'year';
  status: string;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  created_at: string;
}

export interface StripeStatus {
  enabled: boolean;
  testMode: boolean;
  fromEnv: boolean;
  keyHint: string | null;
  accountName: string | null;
  webhookConfigured: boolean;
  webhookUrl: string;
  appUrl: string;
  currency: string;
  demoPayments: boolean;
}
