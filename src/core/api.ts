// Маршрути частини 1 (специфікація, 5.3). Кожна відповідь класифікується, жодна не кидає виняток.
import {
  asConfig,
  asDeveloperCheck,
  asItems,
  asMessage,
  asNews,
  asPage,
  asRepositoryEnvelope,
  asSession,
  asStage,
  asStageSummary,
  asSummary,
  asUser,
  isObj,
} from './guards.ts';
import { apiError, httpRequest, type HttpResponse } from './http.ts';
import { envelopeShape } from './seal.ts';
import type {
  Config,
  DeveloperCheck,
  Lang,
  Message,
  News,
  Page,
  Repository,
  Session,
  Stage,
  StageSummary,
  Summary,
  User,
} from './types.ts';

export type ApiResult<T> =
  | { kind: 'ok'; data: T; res: HttpResponse }
  /** 4xx (і 429) з кодом помилки. До просвіту може бути перешкодою - див. `trustError`. */
  | { kind: 'error'; status: number; code: string | null; field: string | null; requestId: string | null; res: HttpResponse }
  /** Збій за CL-09: обрив, тайм-аут, відмова мережі, 5xx без конверта. */
  | { kind: 'failure'; res: HttpResponse }
  /** Конверт ефіру замість відповіді: сервер у фазі шуму (503 до просвіту). */
  | { kind: 'ether'; res: HttpResponse }
  /** 2xx чужої форми - перешкода, висновків не робимо. */
  | { kind: 'foreign'; res: HttpResponse };

export interface ApiOptions {
  /** Викликається на кожне тіло у формі конверта: його перевіряє і приймає клієнт ефіру. */
  onEnvelope?: (json: unknown, receivedAt: number) => void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

type Guard<T> = (json: unknown, res: HttpResponse) => T | null | undefined;

export function createApi(base: string, opts: ApiOptions = {}) {
  async function call<T>(
    method: string,
    path: string,
    guard: Guard<T>,
    init: { body?: unknown; token?: string | null; signal?: AbortSignal } = {},
  ): Promise<ApiResult<T>> {
    const res = await httpRequest(base, method, path, {
      body: init.body,
      token: init.token,
      signal: init.signal,
      fetchImpl: opts.fetchImpl,
      timeoutMs: opts.timeoutMs,
    });
    if (res.failure) return { kind: 'failure', res };
    if (envelopeShape(res.json)) {
      opts.onEnvelope?.(res.json, res.receivedAt);
      return { kind: 'ether', res };
    }
    if (res.status >= 200 && res.status < 300) {
      const data = guard(res.json, res);
      return data === null || data === undefined ? { kind: 'foreign', res } : { kind: 'ok', data, res };
    }
    if (res.status >= 500) return { kind: 'failure', res };
    const err = apiError(res);
    return {
      kind: 'error',
      status: res.status,
      code: err?.code ?? null,
      field: err?.field ?? null,
      requestId: err?.requestId ?? res.requestId,
      res,
    };
  }

  const q = (limit: number, offset: number) => `?limit=${limit}&offset=${offset}`;
  const id = (s: string) => encodeURIComponent(s);
  const userOf = (j: unknown) => (isObj(j) ? asUser(j.user) : null);
  const messageOf = (j: unknown) => (isObj(j) ? asMessage(j.message) : null);
  const stageOf = (j: unknown) => (isObj(j) ? asStage(j.stage) : null);

  return {
    base,
    config: (signal?: AbortSignal) => call<Config>('GET', '/public/config', asConfig, { signal }),
    register: (body: Record<string, string>, signal?: AbortSignal) =>
      call<Session>('POST', '/auth/register', asSession, { body, signal }),
    login: (username: string, password: string, signal?: AbortSignal) =>
      call<Session>('POST', '/auth/login', asSession, { body: { username, password }, signal }),
    logout: (token: string) => call<true>('POST', '/auth/logout', (_j, r) => (r.status === 204 || r.status === 200 ? true : null), { body: {}, token }),
    me: (token: string) => call<User>('GET', '/me', userOf, { token }),
    patchMe: (token: string, lang: Lang) => call<User>('PATCH', '/me', userOf, { body: { lang }, token }),
    repository: (token: string) => call<Repository | null>('GET', '/me/repository', asRepositoryEnvelope as Guard<Repository | null>, { token }),
    putRepository: (token: string, url: string) =>
      call<Repository | null>('PUT', '/me/repository', asRepositoryEnvelope as Guard<Repository | null>, { body: { url }, token }),
    summary: (token: string) => call<Summary>('GET', '/me/summary', asSummary, { token }),
    news: (token: string, limit: number, offset: number) =>
      call<Page<News>>('GET', '/news' + q(limit, offset), (j) => asPage(j, asNews), { token }),
    inbox: (token: string, limit: number, offset: number) =>
      call<Page<Message>>('GET', '/inbox' + q(limit, offset), (j) => asPage(j, asMessage), { token }),
    message: (token: string, messageId: string) => call<Message>('GET', `/inbox/${id(messageId)}`, messageOf, { token }),
    markRead: (token: string, messageId: string) =>
      call<Message>('POST', `/inbox/${id(messageId)}/read`, messageOf, { body: {}, token }),
    stages: (token: string) => call<StageSummary[]>('GET', '/stages', (j) => asItems(j, asStageSummary), { token }),
    stage: (token: string, stageId: string) => call<Stage>('GET', `/stages/${id(stageId)}`, stageOf, { token }),
    ackStage: (token: string, stageId: string) =>
      call<Stage>('POST', `/stages/${id(stageId)}/ack`, stageOf, { body: {}, token }),
    developerCheck: (token: string, echo: string) =>
      call<DeveloperCheck>('POST', '/developer/check', asDeveloperCheck, { body: { echo }, token }),
  };
}

export type Api = ReturnType<typeof createApi>;

/** Опис помилки для людини: код - стабільний рядок, тексти пише клієнт (5.5). */
export const ERROR_TEXT: Record<string, string> = {
  'invalid-json': 'Тіло запиту не JSON-об\'єкт (помилка клієнта).',
  'invalid-fields': 'Зайве або пропущене поле запиту (помилка клієнта).',
  'invalid-query': 'Хибні limit або offset (помилка клієнта).',
  'authentication-required': 'Потрібен вхід: сесії немає або вона прострочена.',
  'invalid-credentials': 'Хибний логін або пароль.',
  'registration-closed': 'Реєстрацію закрито: просвіт минув.',
  'session-required': 'Ця дія - тільки із сесії входу. Увійдіть логіном і паролем.',
  'origin-not-allowed': 'Запит із cookie з чужого origin.',
  'same-origin-required': 'Cookie на запиті зі зміною не зі свого origin.',
  'invalid-host': 'Сервер не знає цього імені. Звірте адресу сервера з ТЗ.',
  'not-found': 'Немає або ще не видано.',
  'username-unavailable': 'Логін зайнятий - оберіть інший.',
  'repository-already-verified': 'Репозиторій уже підтверджено за іншим акаунтом. Перевірте репозиторій; далі - до організаторів.',
  'registration-capacity': 'Досягнуто межі акаунтів сервера - зверніться до організаторів.',
  'session-limit': 'Забагато активних сесій - вийдіть із зайвих.',
  'body-too-large': 'Тіло запиту більше за 96 КіБ.',
  'json-required': 'Немає Content-Type: application/json (помилка клієнта).',
  'invalid-field': 'Поле не пройшло перевірку сервера.',
  'invalid-repository': 'Це не адреса репозиторію GitHub.',
  'repository-not-root': 'Це посилання всередину репозиторію. Потрібна адреса самого репозиторію: owner/repo.',
  'invalid-invitation': 'Код заявки чужий, використаний або прострочений. Перевірте код із листа; за новим - до організаторів.',
  jammed: 'Адресу заглушено за перевищення ліміту ефіру - мовчимо.',
  'rate-limited': 'Перевищено ліміт - чекаємо.',
  'authentication-busy': 'Черга перевірки паролів зайнята - повторимо за кілька секунд.',
  'internal-error': 'Помилка сервера - повторимо з паузою.',
  stopping: 'Вузол мовчить або перезапускається - повторимо з паузою.',
};

export function describeError(code: string | null, status: number): string {
  if (code && ERROR_TEXT[code]) return ERROR_TEXT[code];
  if (status === 400) return 'Помилка запиту клієнта.';
  if (status === 401) return 'Потрібен вхід.';
  if (status === 403) return 'Немає прав або дію закрито.';
  if (status === 404) return 'Немає або ще не видано.';
  if (status === 409 || status === 422) return 'Конфлікт або хибне поле.';
  if (status === 429) return 'Забагато запитів - чекаємо.';
  return `Відповідь ${status}${code ? ` (${code})` : ''}.`;
}
