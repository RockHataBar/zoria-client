import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { byCodePoint, commitOf, intBelow, permute, saltOf, stream } from '../scripts/draw.ts';

const sha = (b: Buffer) => createHash('sha256').update(b).digest();

describe('жеребкування (оцінювання, додаток А)', () => {
  const secret = new Uint8Array(32).map((_, i) => i);
  const r = new Uint8Array(32).map((_, i) => 255 - i);

  it('А.0: коміт і сіль - від байтів, а не від hex-запису', () => {
    expect(commitOf(secret)).toBe(sha(Buffer.from(secret)).toString('hex'));
    expect(saltOf(secret, r)).toBe(sha(Buffer.concat([Buffer.from(secret), Buffer.from(r)])).toString('hex'));
    expect(saltOf(secret, r)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('А.2: блок k = SHA-256("zaria-tournament-v1" || 0x00 || s || d(k)), uint32 little-endian', () => {
    const s = new Uint8Array(Buffer.from('abc'));
    const next = stream(s);
    const b0 = sha(Buffer.concat([Buffer.from('zaria-tournament-v1'), Buffer.from([0]), Buffer.from('abc'), Buffer.from('0')]));
    const b1 = sha(Buffer.concat([Buffer.from('zaria-tournament-v1'), Buffer.from([0]), Buffer.from('abc'), Buffer.from('1')]));
    const got = Array.from({ length: 9 }, () => next());
    expect(got.slice(0, 8)).toEqual(Array.from({ length: 8 }, (_, i) => b0.readUInt32LE(i * 4)));
    expect(got[8]).toBe(b1.readUInt32LE(0));
  });

  it('А.3: значення від floor(2^32/n)*n відкидаються', () => {
    const vals = [2 ** 32 - 1, 7];
    expect(intBelow(() => vals.shift()!, 3)).toBe(1);
  });

  it('А.4: перестановка детермінована і не губить елементів', () => {
    const list = Array.from({ length: 50 }, (_, i) => `u${i}`);
    const salt = saltOf(secret, r);
    const p = permute(list, salt);
    expect(p).toEqual(permute(list, salt));
    expect([...p].sort()).toEqual([...list].sort());
    expect(p).not.toEqual(list);
    expect(permute(list, saltOf(r, secret))).not.toEqual(p);
  });

  it('А.1: сортування за кодовими точками, не за UTF-16', () => {
    expect(['\u{1F600}', '￿'].sort(byCodePoint)).toEqual(['￿', '\u{1F600}']);
    expect(['b', 'a-1', 'a_1', 'a'].sort(byCodePoint)).toEqual(['a', 'a-1', 'a_1', 'b']);
  });
});
