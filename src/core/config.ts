// Адреса сервера - налаштування (CL-40): бойовий сервер і стенд перемикаються без правки коду:
// змінною VITE_ZORIA_SERVER (prod | stand | адреса API) або в налаштуваннях клієнта.

export type ServerId = 'prod' | 'stand' | 'custom';

export interface ServerSetting {
  id: ServerId;
  base: string;
  /** Закріплений відбиток ключа печатки (SHA-256, 64 hex) або null - прийняти й показати для звірки. */
  fingerprint: string | null;
}

export const PRESETS: Record<'prod' | 'stand', ServerSetting & { label: string }> = {
  prod: {
    id: 'prod',
    label: 'Бойовий сервер',
    base: 'https://zoria.net/api/v1',
    // ТЗ частини 1, розділ 3
    fingerprint: 'dcb3155eb8f2538d466a294315e984fa9f67f703556c5e276d5b3afc88895696',
  },
  stand: {
    id: 'stand',
    label: 'Навчальний стенд',
    base: 'https://stand.zoria.net/api/v1',
    // власний постійний ключ стенда (специфікація, розділ 6), звірено з GET /ether/key стенда
    fingerprint: 'd8860c95b821dc56c0f44a2f0b22f3e157af83bfaed9e55206ac5109d4230a1a',
  },
};

export const FINGERPRINT_RE = /^[0-9a-f]{64}$/;

export function normalizeBase(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.href.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** Налаштування з оточення збирання (Vite) або процесу (Node). */
export function serverFromEnv(value: string | undefined, fingerprint: string | undefined): ServerSetting {
  const v = (value ?? '').trim();
  const fp = fingerprint?.trim().toLowerCase();
  const pinned = fp && FINGERPRINT_RE.test(fp) ? fp : null;
  if (v === 'stand') return { ...PRESETS.stand, fingerprint: pinned ?? PRESETS.stand.fingerprint };
  if (v && v !== 'prod') {
    const base = normalizeBase(v);
    if (base) {
      const preset = Object.values(PRESETS).find((p) => p.base === base);
      return preset ? { id: preset.id, base, fingerprint: pinned ?? preset.fingerprint } : { id: 'custom', base, fingerprint: pinned };
    }
  }
  return { ...PRESETS.prod, fingerprint: pinned ?? PRESETS.prod.fingerprint };
}

// ---- Сховище браузера: будь-яка помилка доступу не ламає клієнт ----

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadJson<T>(key: string): T | null {
  try {
    const raw = storage()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    if (value === null || value === undefined) storage()?.removeItem(key);
    else storage()?.setItem(key, JSON.stringify(value));
  } catch {
    /* сховище недоступне - працюємо в пам'яті */
  }
}

export function scopedKey(base: string, name: string): string {
  let host = base;
  try {
    host = new URL(base).host;
  } catch {
    /* лишаємо як є */
  }
  return `zoria:${host}:${name}`;
}
