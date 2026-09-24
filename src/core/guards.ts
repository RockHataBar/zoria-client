// Перевірка форми відповідей (CL-01): JSON чужої форми не повинен ламати клієнт.
// Перевіряються тільки поля, якими клієнт користується; незнайомі поля ігноруються.
import type {
  AccessStatus,
  Config,
  DeveloperCheck,
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

export type Obj = Record<string, unknown>;

export function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const str = (v: unknown): v is string => typeof v === 'string';
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const bool = (v: unknown): v is boolean => typeof v === 'boolean';
const time = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const timeOrNull = (v: unknown): v is string | null => v === null || time(v);

const ACCESS: readonly string[] = ['pending', 'verified', 'needs-attention'];
export const isAccessStatus = (v: unknown): v is AccessStatus => str(v) && ACCESS.includes(v);

export function asUser(v: unknown): User | null {
  if (!isObj(v) || !str(v.id) || !str(v.username) || !str(v.displayName)) return null;
  return {
    id: v.id,
    username: v.username,
    displayName: v.displayName,
    role: v.role === 'admin' ? 'admin' : 'participant',
    disabled: v.disabled === true,
    createdAt: time(v.createdAt) ? v.createdAt : '',
    lang: v.lang === 'en' ? 'en' : 'uk',
  };
}

export function asSession(v: unknown): Session | null {
  if (!isObj(v) || !str(v.token) || !time(v.expiresAt)) return null;
  if (!/^[A-Za-z0-9_-]{16,}$/.test(v.token)) return null;
  const user = asUser(v.user);
  if (!user) return null;
  return { token: v.token, sessionId: str(v.sessionId) ? v.sessionId : '', expiresAt: v.expiresAt, user };
}

export function asConfig(v: unknown): Config | null {
  if (!isObj(v) || v.apiVersion !== 1 || !bool(v.registrationOpen)) return null;
  const ra = v.repositoryAccess;
  let repositoryAccess: Config['repositoryAccess'] = null;
  if (isObj(ra) && str(ra.githubUsername)) {
    repositoryAccess = {
      githubUsername: ra.githubUsername,
      permission: str(ra.permission) ? ra.permission : '',
      instructions: str(ra.instructions) ? ra.instructions : '',
    };
  } else if (ra !== null) {
    return null;
  }
  return {
    apiVersion: 1,
    title: str(v.title) ? v.title : 'Зоря.нет',
    season: str(v.season) ? v.season : '',
    registrationOpen: v.registrationOpen,
    inviteRequired: v.inviteRequired !== false,
    repositoryRequired: v.repositoryRequired !== false,
    repositoryAccess,
    webClient: v.webClient === true,
  };
}

export function asRepository(v: unknown): Repository | null {
  if (!isObj(v) || !str(v.url) || !isAccessStatus(v.accessStatus)) return null;
  return {
    url: v.url,
    accessStatus: v.accessStatus,
    checkedAt: timeOrNull(v.checkedAt) ? v.checkedAt : null,
    reason: strOrNull(v.reason) ? v.reason : null,
    reasonCode: str(v.reasonCode) ? (v.reasonCode as Repository['reasonCode']) : null,
    updatedAt: time(v.updatedAt) ? v.updatedAt : '',
    verifiedElsewhere: v.verifiedElsewhere === true,
  };
}

/** `{repository: Repository | null}`; `undefined` - відповідь чужої форми. */
export function asRepositoryEnvelope(v: unknown): Repository | null | undefined {
  if (!isObj(v) || !('repository' in v)) return undefined;
  if (v.repository === null) return null;
  return asRepository(v.repository) ?? undefined;
}

export function asSummary(v: unknown): Summary | null {
  if (!isObj(v) || !int(v.unread) || !int(v.releasedStages) || !time(v.serverTime)) return null;
  return {
    unread: v.unread,
    releasedStages: v.releasedStages,
    acknowledgedStages: int(v.acknowledgedStages) ? v.acknowledgedStages : 0,
    latestNews: timeOrNull(v.latestNews) ? v.latestNews : null,
    repositoryAt: timeOrNull(v.repositoryAt) ? v.repositoryAt : null,
    serverTime: v.serverTime,
  };
}

export function asNews(v: unknown): News | null {
  if (!isObj(v) || !str(v.id) || !str(v.title) || !str(v.body)) return null;
  return {
    id: v.id,
    title: v.title,
    body: v.body,
    createdAt: time(v.createdAt) ? v.createdAt : '',
    updatedAt: time(v.updatedAt) ? v.updatedAt : '',
    publishedAt: timeOrNull(v.publishedAt) ? v.publishedAt : null,
    archivedAt: timeOrNull(v.archivedAt) ? v.archivedAt : null,
  };
}

export function asMessage(v: unknown): Message | null {
  if (!isObj(v) || !str(v.id) || !str(v.title) || !str(v.body)) return null;
  const notice = isObj(v.notice) && str(v.notice.type) ? (v.notice as Message['notice']) : null;
  return {
    id: v.id,
    messageId: strOrNull(v.messageId) ? v.messageId : null,
    stageId: strOrNull(v.stageId) ? v.stageId : null,
    kind: str(v.kind) ? v.kind : 'message',
    title: v.title,
    body: v.body,
    createdAt: time(v.createdAt) ? v.createdAt : '',
    readAt: timeOrNull(v.readAt) ? v.readAt : null,
    notice,
  };
}

export function asStageSummary(v: unknown): StageSummary | null {
  if (!isObj(v) || !str(v.id) || !str(v.title)) return null;
  return {
    id: v.id,
    position: int(v.position) ? v.position : 0,
    title: v.title,
    excerpt: str(v.excerpt) ? v.excerpt : '',
    publishedAt: time(v.publishedAt) ? v.publishedAt : '',
    releasedAt: time(v.releasedAt) ? v.releasedAt : '',
    acknowledgedAt: timeOrNull(v.acknowledgedAt) ? v.acknowledgedAt : null,
    errataAt: timeOrNull(v.errataAt) ? v.errataAt : null,
  };
}

export function asStage(v: unknown): Stage | null {
  if (!isObj(v) || !str(v.id) || !str(v.title) || !str(v.body)) return null;
  return {
    id: v.id,
    position: int(v.position) ? v.position : 0,
    title: v.title,
    body: v.body,
    publishedAt: time(v.publishedAt) ? v.publishedAt : '',
    releasedAt: time(v.releasedAt) ? v.releasedAt : '',
    acknowledgedAt: timeOrNull(v.acknowledgedAt) ? v.acknowledgedAt : null,
    errata: strOrNull(v.errata) ? v.errata : null,
    errataAt: timeOrNull(v.errataAt) ? v.errataAt : null,
  };
}

export function asDeveloperCheck(v: unknown): DeveloperCheck | null {
  if (!isObj(v) || v.apiVersion !== 1 || !str(v.echo) || !isObj(v.checks)) return null;
  const summary = asSummary(v.summary);
  if (!summary) return null;
  return {
    apiVersion: 1,
    accountId: str(v.accountId) ? v.accountId : '',
    serverTime: str(v.serverTime) ? v.serverTime : '',
    echo: v.echo,
    checks: {
      authenticated: v.checks.authenticated === true,
      json: v.checks.json === true,
      utf8: v.checks.utf8 === true,
    },
    summary,
  };
}

/** Сторінка списку: елементи чужої форми відкидаються, `nextOffset` - число або null. */
export function asPage<T>(v: unknown, item: (x: unknown) => T | null): Page<T> | null {
  if (!isObj(v) || !Array.isArray(v.items)) return null;
  if (!(v.nextOffset === null || int(v.nextOffset))) return null;
  const items: T[] = [];
  for (const raw of v.items) {
    const it = item(raw);
    if (it) items.push(it);
  }
  return { items, nextOffset: v.nextOffset };
}

export function asItems<T>(v: unknown, item: (x: unknown) => T | null): T[] | null {
  if (!isObj(v) || !Array.isArray(v.items)) return null;
  const out: T[] = [];
  for (const raw of v.items) {
    const it = item(raw);
    if (it) out.push(it);
  }
  return out;
}
