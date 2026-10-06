import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../src/core/api.ts';
import { resetSilence, silenceRemainingMs } from '../src/core/http.ts';
import { registerFlow } from '../src/core/register.ts';
import type { Application } from '../src/core/validate.ts';

const BASE = 'https://test.invalid/api/v1';

const session = {
  token: 'fJp9HfUeN_fA6pcc7H0hQoGerwUCs7lfTDkZDltKPeE',
  sessionId: '3f0c1d2e-5b6a-4c7d-8e9f-0a1b2c3d4e5f',
  expiresAt: '2026-09-25T09:00:04.311Z',
  user: { id: 'u1', username: 'north', displayName: 'Північна вахта', role: 'participant', disabled: false, createdAt: '2026-09-24T09:00:04.311Z', lang: 'uk' },
};

const pw = 'correct-horse-battery';
const app: Application = {
  username: 'North',
  displayName: 'Північна вахта',
  password: pw,
  invitation: 'CODE-1',
  repositoryUrl: 'https://github.com/north/zoria-client',
  lang: 'uk',
};

type Step = { status: number; body?: unknown; headers?: Record<string, string> } | 'network';

/** Підроблений fetch: відповідає за сценарієм і записує запити. */
function scripted(steps: Step[]) {
  const calls: { method: string; path: string; body: unknown; credentials?: string }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    calls.push({
      method: init?.method ?? 'GET',
      path: u.pathname.replace('/api/v1', ''),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      credentials: init?.credentials,
    });
    const step = steps.shift();
    if (!step) throw new Error('сценарій вичерпано');
    if (step === 'network') throw new TypeError('Failed to fetch');
    const body = step.body === undefined ? '' : typeof step.body === 'string' ? step.body : JSON.stringify(step.body);
    return new Response(body || null, { status: step.status, headers: { 'X-Request-Id': 'rid-1', ...step.headers } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const noJitter = () => 0;

beforeEach(() => resetSilence());

describe('реєстрація (CL-17, CL-18)', () => {
  it('201: акаунт створено; тіло - тільки поля контракту, без cookie', async () => {
    const { fetchImpl, calls } = scripted([{ status: 201, body: session }]);
    const out = await registerFlow(createApi(BASE, { fetchImpl }), app, { random: noJitter });
    expect(out).toMatchObject({ kind: 'registered', via: 'register' });
    expect(calls).toHaveLength(1);
    expect(calls[0].credentials).toBe('omit');
    expect(Object.keys(calls[0].body as object).sort()).toEqual(['displayName', 'invitation', 'lang', 'password', 'repositoryUrl', 'username']);
    expect((calls[0].body as { username: string }).username).toBe('north');
  });

  it('загублена відповідь (обрив) - спершу вхід; 200 означає, що реєстрація відбулася', async () => {
    const { fetchImpl, calls } = scripted(['network', { status: 200, body: session }]);
    const out = await registerFlow(createApi(BASE, { fetchImpl }), app, { random: noJitter });
    expect(out).toMatchObject({ kind: 'registered', via: 'login' });
    expect(calls.map((c) => c.path)).toEqual(['/auth/register', '/auth/login']);
  });

  it('5xx - теж загублена відповідь; вхід 401 - реєстрацію можна повторити', async () => {
    const { fetchImpl, calls } = scripted([
      { status: 502, body: '<html>Bad Gateway</html>' },
      { status: 401, body: { error: { code: 'invalid-credentials' } } },
      { status: 201, body: session },
    ]);
    const out = await registerFlow(createApi(BASE, { fetchImpl }), app, { random: noJitter });
    expect(out).toMatchObject({ kind: 'registered', via: 'register' });
    expect(calls.map((c) => c.path)).toEqual(['/auth/register', '/auth/login', '/auth/register']);
  });

  it('409 username-unavailable на повторі - спершу вхід', async () => {
    const { fetchImpl, calls } = scripted([
      { status: 504, body: '' },
      { status: 401, body: { error: { code: 'invalid-credentials' } } },
      { status: 409, body: { error: { code: 'username-unavailable', field: 'username' } } },
      { status: 200, body: session },
    ]);
    const out = await registerFlow(createApi(BASE, { fetchImpl }), app, { random: noJitter });
    expect(out).toMatchObject({ kind: 'registered', via: 'login' });
    expect(calls.map((c) => c.path)).toEqual(['/auth/register', '/auth/login', '/auth/register', '/auth/login']);
  });

  it('409 username-unavailable, а вхід 401 - логін зайнятий, помилка біля поля', async () => {
    const { fetchImpl } = scripted([
      { status: 409, body: { error: { code: 'username-unavailable', field: 'username' } } },
      { status: 401, body: { error: { code: 'invalid-credentials' } } },
    ]);
    const out = await registerFlow(createApi(BASE, { fetchImpl }), app, { random: noJitter });
    expect(out).toMatchObject({ kind: 'field-error', field: 'username', code: 'username-unavailable' });
  });

  it('429 authentication-busy - почекати Retry-After і повторити заявку; це не глушіння', async () => {
    const { fetchImpl, calls } = scripted([
      { status: 429, body: { error: { code: 'authentication-busy' } }, headers: { 'Retry-After': '0' } },
      { status: 201, body: session },
    ]);
    const out = await registerFlow(createApi(BASE, { fetchImpl }), app, { random: noJitter });
    expect(out).toMatchObject({ kind: 'registered', via: 'register' });
    expect(calls.map((c) => c.path)).toEqual(['/auth/register', '/auth/register']);
    expect(silenceRemainingMs(BASE)).toBe(0);
  });

  it('422 invalid-invitation - помилка біля поля invitation', async () => {
    const { fetchImpl } = scripted([{ status: 422, body: { error: { code: 'invalid-invitation', field: 'invitation' } } }]);
    const out = await registerFlow(createApi(BASE, { fetchImpl }), app, { random: noJitter });
    expect(out).toMatchObject({ kind: 'field-error', field: 'invitation', code: 'invalid-invitation' });
  });

  it('422 repository-not-root без field - поле репозиторію за кодом', async () => {
    const { fetchImpl } = scripted([{ status: 422, body: { error: { code: 'repository-not-root' } } }]);
    const out = await registerFlow(createApi(BASE, { fetchImpl }), app, { random: noJitter });
    expect(out).toMatchObject({ kind: 'field-error', field: 'repositoryUrl' });
  });

  it('403 registration-closed', async () => {
    const { fetchImpl } = scripted([{ status: 403, body: { error: { code: 'registration-closed' } } }]);
    const out = await registerFlow(createApi(BASE, { fetchImpl }), app, { random: noJitter });
    expect(out).toMatchObject({ kind: 'error', code: 'registration-closed', status: 403 });
  });

  it('конверт ефіру замість відповіді - реєстрація ще не відкрита', async () => {
    const env = { frame: '{"v":1}', seal: 'A'.repeat(86), key: '0123456789abcdef' };
    const { fetchImpl } = scripted([{ status: 503, body: env }]);
    const out = await registerFlow(createApi(BASE, { fetchImpl }), app, { random: noJitter });
    expect(out).toEqual({ kind: 'not-open' });
  });

  it('скасування під час паузи', async () => {
    const { fetchImpl } = scripted([{ status: 429, body: { error: { code: 'rate-limited' } }, headers: { 'Retry-After': '60' } }]);
    const ctrl = new AbortController();
    const p = registerFlow(createApi(BASE, { fetchImpl }), app, { random: noJitter, signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 20);
    expect(await p).toEqual({ kind: 'aborted' });
  });
});

describe('глушіння (CL-07)', () => {
  it('після 429 jammed сервер мовчить Retry-After', async () => {
    const { fetchImpl } = scripted([{ status: 429, body: { error: { code: 'jammed' } }, headers: { 'Retry-After': '30' } }]);
    const api = createApi(BASE, { fetchImpl });
    const r = await api.summary('t'.repeat(43));
    expect(r.kind).toBe('error');
    expect(silenceRemainingMs(BASE)).toBeGreaterThanOrEqual(30_000);
  });
});
