// Жеребкування (оцінювання, додаток А): сіль, потік випадковості, ціле без зсуву, Фішер - Єйтс.
// Незалежна реалізація за текстом правила - для звірки з draw.json організаторів.
import { createHash } from 'node:crypto';

export const COMMIT = '49f5304dd735a00f4999ff518b4dc6f85e3288c828b71853b786e572bac73ab0';
export const DRAND_CHAIN = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
export const DRAND_ROUND = 32535412;

const sha256 = (...parts: Uint8Array[]) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
};
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const utf8 = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));

export function fromHex(s: string, bytes: number): Uint8Array {
  const t = s.trim().toLowerCase();
  if (!new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(t)) throw new Error(`очікувалось ${bytes} байтів у hex`);
  return new Uint8Array(Buffer.from(t, 'hex'));
}

/** А.0: коміт = SHA-256(секрет). */
export function commitOf(secret: Uint8Array): string {
  return hex(sha256(secret));
}

/** А.0: сіль = SHA-256(секрет || r) від 64 байтів поспіль, запис - 64 hex у нижньому регістрі. */
export function saltOf(secret: Uint8Array, randomness: Uint8Array): string {
  if (secret.length !== 32 || randomness.length !== 32) throw new Error('секрет і randomness - по 32 байти');
  return hex(sha256(secret, randomness));
}

/** Правило маяка drand: randomness = SHA-256(signature). */
export function randomnessOf(signatureHex: string): string {
  return hex(sha256(new Uint8Array(Buffer.from(signatureHex.trim(), 'hex'))));
}

/** А.1: сортування за кодовими точками Unicode (не за одиницями UTF-16). */
export function byCodePoint(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
    if (d) return d;
  }
  return x.length - y.length;
}

/** А.2: потік uint32 від рядка s; блок k = SHA-256("zaria-tournament-v1" || 0x00 || s || d(k)). */
export function stream(s: Uint8Array): () => number {
  const prefix = utf8('zaria-tournament-v1');
  const zero = new Uint8Array([0]);
  let k = 0;
  let buf: number[] = [];
  return () => {
    if (!buf.length) {
      const block = sha256(prefix, zero, s, utf8(String(k++)));
      const dv = new DataView(block.buffer, block.byteOffset, block.byteLength);
      buf = Array.from({ length: 8 }, (_, i) => dv.getUint32(i * 4, true));
    }
    return buf.shift()!;
  };
}

/** А.3: ціле в [0, n) з відкиданням, без зсуву. */
export function intBelow(next: () => number, n: number): number {
  if (!Number.isInteger(n) || n < 1) throw new Error('n >= 1');
  const limit = Math.floor(2 ** 32 / n) * n;
  for (;;) {
    const x = next();
    if (x < limit) return x % n;
  }
}

/** А.4: Фішер - Єйтс на місці, від кінця; рядок потоку - сіль || 0x00 || "split". */
export function permute<T>(list: readonly T[], saltHex: string): T[] {
  const out = [...list];
  const next = stream(new Uint8Array([...utf8(saltHex), 0, ...utf8('split')]));
  for (let i = out.length - 1; i >= 1; i--) {
    const j = intBelow(next, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
