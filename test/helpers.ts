import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

/** Points the app at a throwaway data dir, then boots it on a random port. */
export async function startApp(env: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-test-'));
  Object.assign(process.env, { DATA_DIR: dir, APP_URL: 'http://localhost', ...env });
  const { createApp } = await import('../server/app.js');
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    dir,
    close: () => new Promise((r) => server.close(r)),
  };
}

/** A tiny cookie-keeping HTTP client. */
export function agent(base: string) {
  let cookie = '';
  async function req(method: string, url: string, body?: unknown, form?: FormData) {
    const headers: Record<string, string> = { 'x-mm': '1' };
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(base + '/api' + url, { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* binary or plain */
    }
    return { status: res.status, data };
  }
  return {
    get: (u: string) => req('GET', u),
    post: (u: string, b?: unknown) => req('POST', u, b ?? {}),
    patch: (u: string, b: unknown) => req('PATCH', u, b),
    del: (u: string) => req('DELETE', u),
    upload: (u: string, form: FormData) => req('POST', u, undefined, form),
  };
}

export const tokenFrom = (inviteUrl: string) => inviteUrl.split('/invite/')[1];
