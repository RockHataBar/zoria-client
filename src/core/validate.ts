// Перевірка полів до надсилання (CL-13, CL-14; параметри - специфікація, 5.6).
import type { Lang } from './types.ts';

export interface Application {
  username: string;
  displayName: string;
  password: string;
  invitation: string;
  repositoryUrl: string;
  lang: Lang;
}

export type FieldErrors = Partial<Record<keyof Application, string>>;

const chars = (s: string) => [...s].length;

export function normalizeUsername(s: string): string {
  return s.trim().replace(/^@/, '').toLowerCase();
}

export function checkUsername(raw: string): string | null {
  const u = normalizeUsername(raw);
  if (!u) return 'Вкажіть логін.';
  if (u.length < 3 || u.length > 32) return 'Логін: від 3 до 32 знаків.';
  if (!/^[a-z]/.test(u)) return 'Логін починається з латинської літери.';
  if (!/^[a-z][a-z0-9_-]*$/.test(u)) return 'Логін: латинські літери, цифри, _ і -.';
  return null;
}

export function checkDisplayName(raw: string): string | null {
  const d = raw.trim();
  if (!d) return 'Вкажіть відображуване ім\'я.';
  if (chars(d) > 80) return 'Відображуване ім\'я: до 80 знаків.';
  if (/[\r\n\t]/.test(d)) return 'Без переведень рядка і табуляції.';
  return null;
}

export function checkPassword(p: string): string | null {
  const n = chars(p);
  if (n < 12) return 'Пароль: щонайменше 12 знаків.';
  if (n > 256) return 'Пароль: до 256 знаків.';
  return null;
}

export function checkInvitation(raw: string): string | null {
  const c = raw.trim();
  if (!c) return 'Вкажіть код заявки з листа або з бота @zoria_net_bot.';
  if (chars(c) > 100) return 'Код заявки задовгий - перевірте, що скопійовано тільки код.';
  return null;
}

export type RepoParse = { ok: true; owner: string; repo: string; slug: string } | { ok: false; notRoot: boolean; message: string };

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Репозиторій: `owner/repo` або адреса на github.com - зі схемою і без, з `www.`,
 * SSH `git@github.com:owner/repo.git`, з `.git` або `/` у кінці (CL-14).
 * Посилання всередину репозиторію (файл, гілка, вкладка, `?`, `#`) відхиляються.
 */
export function parseRepository(raw: string): RepoParse {
  const s = raw.trim();
  if (!s) return { ok: false, notRoot: false, message: 'Вкажіть свій приватний репозиторій на GitHub: owner/repo.' };
  if (chars(s) > 256) return { ok: false, notRoot: false, message: 'Адреса задовга (до 256 знаків).' };

  let path: string;
  const ssh = /^(?:ssh:\/\/)?git@github\.com[:/](.+)$/i.exec(s);
  if (ssh) {
    path = ssh[1];
  } else if (/^(?:https?:\/\/)?(?:www\.)?github\.com(?:[/:?#]|$)/i.test(s)) {
    path = s.replace(/^(?:https?:\/\/)?(?:www\.)?github\.com/i, '');
    if (path.startsWith(':')) return { ok: false, notRoot: false, message: 'Це не адреса репозиторію GitHub.' };
  } else if (/^[A-Za-z0-9-]+\/\S+$/.test(s)) {
    // коротка форма owner/repo: перший сегмент - ім'я власника, без крапок і схеми
    path = '/' + s;
  } else {
    return { ok: false, notRoot: false, message: 'Це не адреса репозиторію GitHub. Приклад: owner/repo або https://github.com/owner/repo' };
  }

  if (/[?#]/.test(path)) {
    return { ok: false, notRoot: true, message: 'Це посилання всередину репозиторію. Вкажіть адресу самого репозиторію: owner/repo.' };
  }
  path = path.replace(/^\/+/, '').replace(/\/+$/, '');
  const parts = path.split('/');
  if (parts.length > 2) {
    return { ok: false, notRoot: true, message: 'Це посилання всередину репозиторію (файл, гілка чи вкладка). Вкажіть адресу самого репозиторію: owner/repo.' };
  }
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return { ok: false, notRoot: false, message: 'Потрібні власник і назва: owner/repo.' };
  }
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!OWNER.test(owner) || owner.endsWith('-')) return { ok: false, notRoot: false, message: 'Хибне ім\'я власника репозиторію.' };
  if (!REPO.test(repo) || repo === '.' || repo === '..') return { ok: false, notRoot: false, message: 'Хибна назва репозиторію.' };
  return { ok: true, owner, repo, slug: `${owner}/${repo}` };
}

export function checkRepository(raw: string): string | null {
  const r = parseRepository(raw);
  return r.ok ? null : r.message;
}

export function validateApplication(a: Application): FieldErrors {
  const e: FieldErrors = {};
  const u = checkUsername(a.username);
  if (u) e.username = u;
  const d = checkDisplayName(a.displayName);
  if (d) e.displayName = d;
  const p = checkPassword(a.password);
  if (p) e.password = p;
  const i = checkInvitation(a.invitation);
  if (i) e.invitation = i;
  const r = checkRepository(a.repositoryUrl);
  if (r) e.repositoryUrl = r;
  return e;
}

/** Тіло POST /auth/register: тільки поля контракту (зайве поле - 400 invalid-fields). */
export function registerBody(a: Application): Record<string, string> {
  const repo = parseRepository(a.repositoryUrl);
  return {
    username: normalizeUsername(a.username),
    displayName: a.displayName.trim(),
    password: a.password,
    invitation: a.invitation.trim(),
    repositoryUrl: repo.ok ? repo.slug : a.repositoryUrl.trim(),
    lang: a.lang,
  };
}
