// Реєстрація в просвіт (CL-13 - CL-19). Загублену відповідь не повторюємо наосліп:
// спершу вхід тими самими логіном і паролем (CL-17).
import { describeError, type Api, type ApiResult } from './api.ts';
import { backoffDelay, retryAfterFor, sleep, isAbort } from './http.ts';
import type { Session } from './types.ts';
import { registerBody, type Application } from './validate.ts';

export type RegisterOutcome =
  | { kind: 'registered'; session: Session; via: 'register' | 'login' }
  | { kind: 'field-error'; field: keyof Application | null; code: string | null; status: number; message: string }
  | { kind: 'error'; code: string | null; status: number; requestId: string | null; message: string }
  /** Сервер відповів конвертом ефіру: реєстрація ще не відкрита, стан не змінено. */
  | { kind: 'not-open' }
  | { kind: 'aborted' };

export interface RegisterOptions {
  signal?: AbortSignal;
  onStep?: (text: string) => void;
  random?: () => number;
}

const FIELD_BY_CODE: Record<string, keyof Application> = {
  'invalid-invitation': 'invitation',
  'invalid-repository': 'repositoryUrl',
  'repository-not-root': 'repositoryUrl',
  'repository-already-verified': 'repositoryUrl',
  'username-unavailable': 'username',
};

const FIELDS: readonly string[] = ['username', 'displayName', 'password', 'invitation', 'repositoryUrl', 'lang'];

function fieldOf(code: string | null, field: string | null): keyof Application | null {
  if (field && FIELDS.includes(field)) return field as keyof Application;
  return code ? (FIELD_BY_CODE[code] ?? null) : null;
}

export async function registerFlow(api: Api, app: Application, opts: RegisterOptions = {}): Promise<RegisterOutcome> {
  const { signal } = opts;
  const step = opts.onStep ?? (() => {});
  const random = opts.random ?? Math.random;
  const body = registerBody(app);
  let lost = false;
  let n = 0;

  const wait = async (ms: number) => sleep(ms, signal);

  /** Вхід після загубленої відповіді або 409: 'ok' | 'absent' | інший результат. */
  async function loginProbe(): Promise<{ kind: 'ok'; session: Session } | { kind: 'absent' } | { kind: 'other'; r: ApiResult<Session> }> {
    for (;;) {
      const r = await api.login(body.username, body.password, signal);
      if (r.kind === 'ok') return { kind: 'ok', session: r.data };
      if (r.kind === 'error' && r.status === 401) return { kind: 'absent' };
      if (r.kind === 'error' && r.status === 429) {
        const s = retryAfterFor(r.res);
        step(`Вхід: 429 ${r.code ?? ''} - чекаємо ${s} с.`);
        await wait(s * 1000);
        continue;
      }
      if (r.kind === 'failure' || r.kind === 'foreign' || r.kind === 'ether') {
        n++;
        const d = Math.max(1000, backoffDelay(n, random));
        step(`Вхід: збій зв'язку - повтор через ${Math.round(d / 1000)} с.`);
        await wait(d);
        continue;
      }
      return { kind: 'other', r };
    }
  }

  try {
    for (;;) {
      if (lost) {
        step('Відповідь на реєстрацію загублено - перевіряємо входом тими самими логіном і паролем.');
        const p = await loginProbe();
        if (p.kind === 'ok') {
          step('Вхід успішний: реєстрація відбулася.');
          return { kind: 'registered', session: p.session, via: 'login' };
        }
        if (p.kind === 'other') return errorOf(p.r);
        step('Акаунта ще немає - реєстрацію можна повторити.');
        lost = false;
      }

      step('Надсилаємо заявку: POST /auth/register.');
      const r = await api.register(body, signal);
      if (r.kind === 'ok') {
        step('201: акаунт створено.');
        return { kind: 'registered', session: r.data, via: 'register' };
      }
      if (r.kind === 'ether') {
        step('Сервер відповів ефіром: реєстрація ще не відкрита.');
        return { kind: 'not-open' };
      }
      if (r.kind === 'failure' || r.kind === 'foreign') {
        lost = true;
        n++;
        const d = Math.max(1000, backoffDelay(n, random));
        const why = r.res.failure ?? `відповідь ${r.res.status}`;
        step(`Відповідь загублено (${why}${r.res.requestId ? `, X-Request-Id ${r.res.requestId}` : ''}) - пауза ${Math.round(d / 1000)} с.`);
        await wait(d);
        continue;
      }
      // r.kind === 'error'
      if (r.status === 429) {
        const s = retryAfterFor(r.res);
        step(`429 ${r.code ?? ''}: ${describeError(r.code, 429)} Повтор через ${s} с.`);
        await wait(s * 1000);
        continue;
      }
      if (r.code === 'username-unavailable') {
        // Може бути наш власний акаунт після загубленої відповіді чи другого пристрою - спершу вхід.
        step('409 username-unavailable - перевіряємо, чи це не наш акаунт: вхід.');
        const p = await loginProbe();
        if (p.kind === 'ok') return { kind: 'registered', session: p.session, via: 'login' };
        if (p.kind === 'other') return errorOf(p.r);
        return { kind: 'field-error', field: 'username', code: r.code, status: r.status, message: describeError(r.code, r.status) };
      }
      if (r.status === 422 || r.status === 409) {
        return { kind: 'field-error', field: fieldOf(r.code, r.field), code: r.code, status: r.status, message: describeError(r.code, r.status) };
      }
      return errorOf(r);
    }
  } catch (e) {
    if (isAbort(e)) return { kind: 'aborted' };
    throw e;
  }
}

function errorOf(r: ApiResult<unknown>): RegisterOutcome {
  if (r.kind === 'error') {
    return { kind: 'error', code: r.code, status: r.status, requestId: r.requestId, message: describeError(r.code, r.status) };
  }
  return { kind: 'error', code: null, status: r.res.status, requestId: r.res.requestId, message: 'Несподівана відповідь сервера.' };
}
