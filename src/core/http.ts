// HTTP-обмін із сервером: витримує будь-яку відповідь (CL-01), шанує глушіння (CL-07)
// і не передає cookie (credentials: 'omit', токен тільки в Authorization).
import { isObj } from './guards.ts';

export type Failure = 'network' | 'timeout' | 'aborted';

export interface HttpResponse {
  /** HTTP-статус; 0 - повної відповіді немає (обрив, тайм-аут, відмова мережі). */
  status: number;
  failure: Failure | null;
  text: string;
  /** Розібране тіло або `undefined`, якщо тіло не JSON. */
  json: unknown;
  requestId: string | null;
  retryAfterSec: number | null;
  receivedAt: number;
}

export interface ApiError {
  code: string;
  field: string | null;
  requestId: string | null;
}

export const DEFAULT_TIMEOUT_MS = 20_000; // відповідь буває і через 8 с - тайм-аут із запасом

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError(): Error {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}

export function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

/** Експоненційна пауза з повним джитером (CL-09): випадкове від 0 до min(60 с, 1 с * 2^n). */
export function backoffDelay(n: number, random: () => number = Math.random): number {
  const cap = Math.min(60_000, 1000 * 2 ** Math.max(0, n));
  return Math.floor(random() * cap);
}

export function parseRetryAfter(h: string | null, now = Date.now()): number | null {
  if (!h) return null;
  const t = h.trim();
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  const d = Date.parse(t);
  if (Number.isFinite(d)) return Math.max(0, Math.ceil((d - now) / 1000));
  return null;
}

export function apiError(res: HttpResponse): ApiError | null {
  const j = res.json;
  if (!isObj(j) || !isObj(j.error) || typeof j.error.code !== 'string') return null;
  return {
    code: j.error.code,
    field: typeof j.error.field === 'string' ? j.error.field : null,
    requestId: typeof j.error.requestId === 'string' ? j.error.requestId : res.requestId,
  };
}

// ---- Глушіння (CL-07): після 429 jammed жодного запиту цьому серверу до кінця Retry-After ----

const gates = new Map<string, number>();
const gateListeners = new Set<() => void>();

function hostOf(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}

/** Скільки ще мовчати перед цим сервером, мс. */
export function silenceRemainingMs(base: string, now = Date.now()): number {
  const until = gates.get(hostOf(base)) ?? 0;
  return Math.max(0, until - now);
}

export function onSilenceChange(fn: () => void): () => void {
  gateListeners.add(fn);
  return () => gateListeners.delete(fn);
}

export function noteSilence(base: string, seconds: number, now = Date.now()): void {
  const key = hostOf(base);
  // +1 с запасу: запит в останню секунду глушіння все одно отримує 429
  const until = now + Math.max(1, seconds) * 1000 + 1000;
  if (until > (gates.get(key) ?? 0)) {
    gates.set(key, until);
    gateListeners.forEach((fn) => fn());
  }
}

export function resetSilence(): void {
  gates.clear();
}

/** Типова пауза для 429 без Retry-After. */
function default429(code: string | undefined): number {
  if (code === 'authentication-busy') return 5;
  if (code === 'rate-limited') return 60;
  return 30;
}

/** Скільки чекати після цієї відповіді 429, с. */
export function retryAfterFor(res: HttpResponse): number {
  return res.retryAfterSec ?? default429(apiError(res)?.code);
}

export interface RequestOptions {
  body?: unknown;
  token?: string | null;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Для тестів і Node-скриптів: власна реалізація fetch. */
  fetchImpl?: typeof fetch;
}

let defaultFetch: typeof fetch | null = null;
export function setDefaultFetch(f: typeof fetch | null): void {
  defaultFetch = f;
}

export async function httpRequest(
  base: string,
  method: string,
  path: string,
  opts: RequestOptions = {},
): Promise<HttpResponse> {
  // Під час глушіння не надсилаємо нічого: запит подвоїв би строк.
  const wait = silenceRemainingMs(base);
  if (wait > 0) await sleep(wait, opts.signal);

  const headers: Record<string, string> = { Accept: 'application/json' };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  const f = opts.fetchImpl ?? defaultFetch ?? globalThis.fetch.bind(globalThis);
  const empty = (failure: Failure): HttpResponse => ({
    status: 0,
    failure,
    text: '',
    json: undefined,
    requestId: null,
    retryAfterSec: null,
    receivedAt: Date.now(),
  });

  try {
    let r: Response;
    try {
      r = await f(base.replace(/\/+$/, '') + path, {
        method,
        headers,
        body,
        credentials: 'omit',
        cache: 'no-store',
        signal: ctrl.signal,
      });
    } catch {
      if (opts.signal?.aborted) return empty('aborted');
      return empty(timedOut ? 'timeout' : 'network');
    }
    let text: string;
    try {
      text = await r.text();
    } catch {
      // обрив посеред тіла
      if (opts.signal?.aborted) return empty('aborted');
      return empty(timedOut ? 'timeout' : 'network');
    }
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }
    const res: HttpResponse = {
      status: r.status,
      failure: null,
      text,
      json,
      requestId: r.headers.get('X-Request-Id'),
      retryAfterSec: parseRetryAfter(r.headers.get('Retry-After')),
      receivedAt: Date.now(),
    };
    if (r.status === 429) {
      // 429 перешкодою не буває. authentication-busy - не порушення, чекає тільки цей запит.
      const code = apiError(res)?.code;
      if (code !== 'authentication-busy') noteSilence(base, retryAfterFor(res));
    }
    return res;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

/** Збій за CL-09: 5xx без конверта, обрив, тайм-аут, відмова мережі. */
export function isFailure(res: HttpResponse, hasEnvelope: boolean): boolean {
  if (res.failure) return res.failure !== 'aborted';
  return res.status >= 500 && !hasEnvelope;
}
