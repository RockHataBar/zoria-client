import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applySignal, initialEther, msUntilOpen } from '../src/core/ether.ts';
import { acceptKey, checkEnvelope, type VerifiedKey } from '../src/core/seal.ts';

const fx = JSON.parse(readFileSync(new URL('./fixtures/control-frames.json', import.meta.url), 'utf8')) as {
  trainingKey: { publicKey: string; fingerprint: string; key: string };
  A: string;
  B: string;
  C: string;
  D: string;
};

const parse = (t: string): unknown => {
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
};

async function trainingKeys(): Promise<Map<string, VerifiedKey>> {
  const k = await acceptKey(
    { algorithm: 'Ed25519', key: fx.trainingKey.key, publicKey: fx.trainingKey.publicKey, fingerprint: fx.trainingKey.fingerprint },
    fx.trainingKey.fingerprint,
  );
  return new Map([[k.keyId, k]]);
}

describe('ключ печатки (CL-04)', () => {
  it('приймає бойовий ключ із відбитком із ТЗ', async () => {
    const k = await acceptKey(
      {
        algorithm: 'Ed25519',
        key: 'dcb3155eb8f2538d',
        publicKey: '-2YbbHJzrSLa51KYabqpx_h2j60ddrLga5nEVPAFpHg',
        fingerprint: 'dcb3155eb8f2538d466a294315e984fa9f67f703556c5e276d5b3afc88895696',
      },
      'dcb3155eb8f2538d466a294315e984fa9f67f703556c5e276d5b3afc88895696',
    );
    expect(k.keyId).toBe('dcb3155eb8f2538d');
  });

  it('відхиляє ключ з іншим відбитком', async () => {
    await expect(
      acceptKey(
        { algorithm: 'Ed25519', key: fx.trainingKey.key, publicKey: fx.trainingKey.publicKey, fingerprint: fx.trainingKey.fingerprint },
        'dcb3155eb8f2538d466a294315e984fa9f67f703556c5e276d5b3afc88895696',
      ),
    ).rejects.toThrow();
  });

  it('відхиляє відповідь, де відбиток не від цього ключа', async () => {
    await expect(
      acceptKey(
        { algorithm: 'Ed25519', key: 'dcb3155eb8f2538d', publicKey: fx.trainingKey.publicKey, fingerprint: 'dcb3155eb8f2538d466a294315e984fa9f67f703556c5e276d5b3afc88895696' },
        null,
      ),
    ).rejects.toThrow();
  });
});

describe('контрольні кадри A-D (специфікація, 5.2 і розділ 6)', () => {
  it('A - справжній: шум, провісник, відкриття о 09:00Z, уривок', async () => {
    const c = await checkEnvelope(parse(fx.A), await trainingKeys());
    expect(c.kind).toBe('signal');
    if (c.kind !== 'signal') return;
    expect(c.frame.phase).toBe('static');
    expect(c.frame.harbinger?.opensIn).toBe(21600);
    expect(c.frame.harbinger?.text?.en).toContain('carrier');
    const opens = Date.parse(c.frame.at) + c.frame.harbinger!.opensIn * 1000;
    expect(new Date(opens).toISOString()).toBe('2026-09-24T09:00:00.000Z');
    expect(c.frame.fragment).toEqual({ n: 3, of: 12, text: 'навчальний уривок' });
  });

  it('B - підробка: печатка неправильна, кадр відкинуто', async () => {
    const c = await checkEnvelope(parse(fx.B), await trainingKeys());
    expect(c).toEqual({ kind: 'noise', reason: 'forged' });
  });

  it('C - битий: не розбирається, відкинуто без падіння', async () => {
    expect(fx.C.length).toBe(120);
    const c = await checkEnvelope(parse(fx.C), await trainingKeys());
    expect(c).toEqual({ kind: 'noise', reason: 'broken' });
  });

  it('D - справжній журнал у просвіт: два записи', async () => {
    const c = await checkEnvelope(parse(fx.D), await trainingKeys());
    expect(c.kind).toBe('signal');
    if (c.kind !== 'signal') return;
    expect(c.frame.kind).toBe('roll');
    expect(c.frame.phase).toBe('window');
    expect(c.frame.roll?.map((e) => e.name)).toEqual(['Північна вахта', 'Stitch']);
  });

  it('фаза за B не змінюється; A дає відлік', async () => {
    const keys = await trainingKeys();
    let s = initialEther();
    for (const raw of [fx.A, fx.B, fx.C]) {
      const c = await checkEnvelope(parse(raw), keys);
      if (c.kind === 'signal') s = applySignal(s, c.frame, Date.parse('2026-09-24T03:00:00.000Z'));
    }
    expect(s.phase).toBe('static');
    expect(msUntilOpen(s, Date.parse('2026-09-24T03:00:00.000Z'))).toBe(6 * 3600_000);
  });

  it('кадр, змінений хоч на байт після підпису, - підробка', async () => {
    const env = parse(fx.A) as { frame: string; seal: string; key: string };
    const tampered = { ...env, frame: env.frame.replace('"onAir":0', '"onAir":1') };
    expect(await checkEnvelope(tampered, await trainingKeys())).toEqual({ kind: 'noise', reason: 'forged' });
  });

  it('незнайомий ключ і чужа форма', async () => {
    const env = parse(fx.A) as { frame: string; seal: string; key: string };
    expect(await checkEnvelope({ ...env, key: '0123456789abcdef' }, await trainingKeys())).toEqual({
      kind: 'unknown-key',
      keyId: '0123456789abcdef',
    });
    expect(await checkEnvelope({ error: { code: 'invalid-invitation' } }, await trainingKeys())).toEqual({ kind: 'noise', reason: 'foreign' });
    expect(await checkEnvelope([1, 2], await trainingKeys())).toEqual({ kind: 'noise', reason: 'foreign' });
  });
});
