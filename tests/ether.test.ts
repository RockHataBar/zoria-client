import { describe, expect, it } from 'vitest';
import { applySignal, clockOffsetMs, earliestOpenMs, initialEther, msUntilOpen, registrationOpen } from '../src/core/ether.ts';
import type { Frame } from '../src/core/types.ts';

const frame = (over: Partial<Frame>): Frame => ({
  v: 1,
  kind: 'signal',
  station: 'zoria',
  at: '2026-09-24T10:00:00.000Z',
  phase: 'static',
  window: null,
  harbinger: null,
  fragment: null,
  onAir: 0,
  ...over,
});
const t = (iso: string) => Date.parse(iso);

describe('стан ефіру (CL-05, CL-11, CL-35)', () => {
  it('старий кадр (ехо) не відкочує фазу', () => {
    let s = initialEther();
    s = applySignal(s, frame({ at: '2026-09-24T10:00:10.000Z', phase: 'window', window: { opensAt: '2026-09-24T10:00:00.000Z', closesAt: '2026-09-24T20:00:00.000Z' } }), t('2026-09-24T10:00:10.000Z'));
    s = applySignal(s, frame({ at: '2026-09-24T09:59:00.000Z', phase: 'static' }), t('2026-09-24T10:00:25.000Z'));
    expect(s.phase).toBe('window');
    expect(s.counts.echo).toBe(1);
    expect(registrationOpen(s)).toBe(true);
  });

  it('відлік провісника за годинником сервера: at + opensIn, поправка годинника', () => {
    let s = initialEther();
    // годинник пристрою відстає на 2 хв
    const received = t('2026-09-24T10:00:00.000Z') - 120_000;
    s = applySignal(s, frame({ harbinger: { opensIn: 3600, text: null } }), received);
    expect(clockOffsetMs(s)).toBe(120_000);
    expect(msUntilOpen(s, received)).toBe(3600_000);
    expect(msUntilOpen(s, received + 600_000)).toBe(3000_000);
  });

  it('затримана відповідь не псує поправку: береться найбільша проба', () => {
    let s = initialEther();
    s = applySignal(s, frame({ at: '2026-09-24T10:00:00.000Z' }), t('2026-09-24T10:00:00.000Z'));
    s = applySignal(s, frame({ at: '2026-09-24T10:00:15.000Z' }), t('2026-09-24T10:00:23.000Z')); // затримка 8 с
    expect(clockOffsetMs(s)).toBe(0);
  });

  it('кадр без провісника: найближчі 6 год просвіту не буде', () => {
    let s = initialEther();
    s = applySignal(s, frame({ at: '2026-09-24T18:04:26.616Z' }), t('2026-09-24T18:04:26.616Z'));
    expect(new Date(earliestOpenMs(s)!).toISOString()).toBe('2026-09-25T00:04:26.616Z');
  });

  it('уривки листа збираються за номером, повтор відкидається', () => {
    let s = initialEther();
    s = applySignal(s, frame({ fragment: { n: 2, of: 5, text: 'другий' } }), 0);
    s = applySignal(s, frame({ at: '2026-09-24T10:00:01.000Z', fragment: { n: 2, of: 5, text: 'інший' } }), 0);
    s = applySignal(s, frame({ at: '2026-09-24T09:00:00.000Z', fragment: { n: 1, of: 5, text: 'перший' } }), 0);
    expect(s.fragments).toEqual({ '1': 'перший', '2': 'другий' });
    expect(s.fragmentsOf).toBe(5);
  });

  it('після просвіту реєстрація закрита навіть якщо конфіг казав інше', () => {
    let s = { ...initialEther(), configSaysOpen: true };
    expect(registrationOpen(s)).toBe(true);
    s = applySignal(s, frame({ phase: 'after', window: { opensAt: '2026-09-24T00:00:00.000Z', closesAt: '2026-09-24T10:00:00.000Z' } }), 0);
    expect(registrationOpen(s)).toBe(false);
  });
});
