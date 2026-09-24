// Печатка станції (специфікація, 5.2): Ed25519 над байтами UTF-8 рядка `frame` таким, яким він прийшов.
// Рядок `frame` не розбирається і не збирається заново до перевірки (CL-03).
import { isObj } from './guards.ts';
import type { Envelope, Frame, FrameWindow, Fragment, Harbinger, Phase, RollEntry } from './types.ts';

export function b64uDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface VerifiedKey {
  keyId: string;
  fingerprint: string;
  publicKey: string;
  verify(signature: Uint8Array<ArrayBuffer>, message: Uint8Array<ArrayBuffer>): Promise<boolean>;
}

export class KeyError extends Error {}

async function makeVerifier(pub: Uint8Array<ArrayBuffer>): Promise<VerifiedKey['verify']> {
  try {
    const key = await crypto.subtle.importKey('raw', pub, { name: 'Ed25519' }, false, ['verify']);
    return (sig, msg) => crypto.subtle.verify({ name: 'Ed25519' }, key, sig, msg).catch(() => false);
  } catch {
    // Браузер без Ed25519 у WebCrypto: запасна перевірка чистим JS.
    const ed = await import('@noble/ed25519');
    return (sig, msg) => ed.verifyAsync(sig, msg, pub).catch(() => false);
  }
}

/**
 * Приймає відповідь `GET /ether/key` (CL-04): відбиток рахується від 32 байтів ключа
 * і звіряється з відповіддю та із закріпленим відбитком (ТЗ, розділ 3).
 */
export async function acceptKey(info: unknown, pinnedFingerprint: string | null): Promise<VerifiedKey> {
  if (!isObj(info) || info.algorithm !== 'Ed25519') throw new KeyError('ключ не Ed25519 або відповідь чужої форми');
  const { key, publicKey, fingerprint } = info;
  if (typeof key !== 'string' || !/^[0-9a-f]{16}$/.test(key)) throw new KeyError('хибний id ключа');
  if (typeof publicKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(publicKey)) throw new KeyError('хибний відкритий ключ');
  if (typeof fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(fingerprint)) throw new KeyError('хибний відбиток');
  const raw = b64uDecode(publicKey);
  if (raw.length !== 32) throw new KeyError('ключ не 32 байти');
  const fp = await sha256Hex(raw);
  if (fp !== fingerprint) throw new KeyError('відбиток не збігається з ключем');
  if (key !== fp.slice(0, 16)) throw new KeyError('id ключа не збігається з відбитком');
  if (pinnedFingerprint && fp !== pinnedFingerprint.toLowerCase()) {
    throw new KeyError(`відбиток ${fp} не збігається з відбитком із ТЗ`);
  }
  return { keyId: key, fingerprint: fp, publicKey, verify: await makeVerifier(raw) };
}

export type NoiseReason = 'broken' | 'forged' | 'bad-frame' | 'foreign' | 'unknown-key';

export type EnvelopeCheck =
  | { kind: 'signal'; frame: Frame; envelope: Envelope }
  | { kind: 'noise'; reason: NoiseReason }
  | { kind: 'unknown-key'; keyId: string };

/** Чи схоже тіло на конверт за формою (без перевірки печатки). */
export function envelopeShape(json: unknown): Envelope | null {
  if (!isObj(json)) return null;
  const { frame, seal, key } = json;
  if (typeof frame !== 'string' || typeof seal !== 'string' || typeof key !== 'string') return null;
  if (!/^[A-Za-z0-9_-]{86}$/.test(seal) || !/^[0-9a-f]{16}$/.test(key)) return null;
  return { frame, seal, key };
}

/** Перевірка кадру за специфікацією 5.2: форма, ключ, печатка, потім розбір. */
export async function checkEnvelope(json: unknown, keys: ReadonlyMap<string, VerifiedKey>): Promise<EnvelopeCheck> {
  if (json === undefined) return { kind: 'noise', reason: 'broken' };
  const env = envelopeShape(json);
  if (!env) return { kind: 'noise', reason: 'foreign' };
  const key = keys.get(env.key);
  if (!key) return { kind: 'unknown-key', keyId: env.key };
  const ok = await key.verify(b64uDecode(env.seal), new TextEncoder().encode(env.frame) as Uint8Array<ArrayBuffer>);
  if (!ok) return { kind: 'noise', reason: 'forged' };
  const frame = parseFrame(env.frame);
  if (!frame) return { kind: 'noise', reason: 'bad-frame' };
  return { kind: 'signal', frame, envelope: env };
}

const PHASES: readonly string[] = ['static', 'window', 'after'];
const isTime = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const isInt = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min;

/** Розбір уже перевіреного рядка кадру. Незнайомі поля ігноруються (CL-06). */
export function parseFrame(frameStr: string): Frame | null {
  let f: unknown;
  try {
    f = JSON.parse(frameStr);
  } catch {
    return null;
  }
  if (!isObj(f) || f.v !== 1 || f.station !== 'zoria') return null;
  if (f.kind !== 'signal' && f.kind !== 'roll') return null;
  if (typeof f.phase !== 'string' || !PHASES.includes(f.phase)) return null;
  if (!isTime(f.at)) return null;

  let window: FrameWindow | null = null;
  if (isObj(f.window) && isTime(f.window.opensAt) && isTime(f.window.closesAt)) {
    window = { opensAt: f.window.opensAt, closesAt: f.window.closesAt };
  }

  let harbinger: Harbinger | null = null;
  if (isObj(f.harbinger) && isInt(f.harbinger.opensIn, 0)) {
    const t = f.harbinger.text;
    harbinger = {
      opensIn: f.harbinger.opensIn,
      text: isObj(t) && typeof t.uk === 'string' && typeof t.en === 'string' ? { uk: t.uk, en: t.en } : null,
    };
  }

  let fragment: Fragment | null = null;
  const fr = f.fragment;
  if (isObj(fr) && isInt(fr.n, 1) && isInt(fr.of, 1) && typeof fr.text === 'string') {
    fragment = { n: fr.n, of: fr.of, text: fr.text };
  }

  let roll: RollEntry[] | undefined;
  if (Array.isArray(f.roll)) {
    roll = f.roll.flatMap((e): RollEntry[] =>
      isObj(e) && isInt(e.n, 1) && isTime(e.at) && typeof e.name === 'string'
        ? [{ n: e.n, at: e.at, sinceOpen: isInt(e.sinceOpen, 0) ? e.sinceOpen : 0, name: e.name }]
        : [],
    );
  }

  return {
    v: 1,
    kind: f.kind,
    station: 'zoria',
    at: f.at,
    phase: f.phase as Phase,
    window,
    harbinger,
    fragment,
    onAir: isInt(f.onAir, 0) ? f.onAir : 0,
    ...(roll ? { roll } : {}),
  };
}
