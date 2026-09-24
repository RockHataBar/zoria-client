// Стан ефіру: фаза і відлік - тільки з перевірених кадрів із найбільшим `at` (CL-02, CL-05).
import type { NoiseReason } from './seal.ts';
import type { Frame, FrameWindow, Phase, RollEntry } from './types.ts';

export interface EtherCounts {
  signal: number;
  echo: number;
  forged: number;
  broken: number;
  foreign: number;
  failure: number;
}

export interface EtherState {
  /** null - ще не було жодного перевіреного кадру. */
  phase: Phase | null;
  lastAt: string | null;
  window: FrameWindow | null;
  /** Момент відкриття за годинником сервера (мс) і голос провісника. */
  harbinger: { opensAtMs: number; text: { uk: string; en: string } | null } | null;
  /** Кадр без провісника у фазі static: найближчі 6 год просвіту не буде. */
  noHarbingerSince: string | null;
  onAir: number | null;
  /** Проби поправки годинника: `at` кадру мінус локальний час отримання, мс. */
  offsetSamples: number[];
  fragments: Record<string, string>;
  fragmentsOf: number | null;
  roll: RollEntry[] | null;
  rollAt: string | null;
  counts: EtherCounts;
  lastSignalLocal: number | null;
  /** Розібраний 2xx `/public/config` з registrationOpen: true - теж просвіт. */
  configSaysOpen: boolean;
}

export function initialEther(): EtherState {
  return {
    phase: null,
    lastAt: null,
    window: null,
    harbinger: null,
    noHarbingerSince: null,
    onAir: null,
    offsetSamples: [],
    fragments: {},
    fragmentsOf: null,
    roll: null,
    rollAt: null,
    counts: { signal: 0, echo: 0, forged: 0, broken: 0, foreign: 0, failure: 0 },
    lastSignalLocal: null,
    configSaysOpen: false,
  };
}

const ms = (iso: string) => Date.parse(iso);

/** Приймає перевірений кадр. Старший за останній (ехо, затримка) стан не відкочує. */
export function applySignal(s: EtherState, frame: Frame, receivedLocal: number): EtherState {
  const next: EtherState = { ...s, counts: { ...s.counts, signal: s.counts.signal + 1 }, lastSignalLocal: receivedLocal };

  // Уривки листа Доглядача - з будь-якого кадру з правильною печаткою; повтор номера відкидається (CL-35).
  if (frame.fragment && !(String(frame.fragment.n) in s.fragments)) {
    next.fragments = { ...s.fragments, [String(frame.fragment.n)]: frame.fragment.text };
    next.fragmentsOf = frame.fragment.of;
  }

  const atMs = ms(frame.at);
  // Поправка годинника: беремо найбільшу з останніх проб - затримка і ехо тільки зменшують її.
  next.offsetSamples = [...s.offsetSamples, atMs - receivedLocal].slice(-12);

  if (frame.kind === 'roll' && frame.roll && (s.rollAt === null || atMs >= ms(s.rollAt))) {
    next.roll = frame.roll;
    next.rollAt = frame.at;
  }

  if (s.lastAt !== null && atMs < ms(s.lastAt)) {
    next.counts.echo += 1;
    return next;
  }

  next.lastAt = frame.at;
  next.phase = frame.phase;
  next.window = frame.window;
  next.onAir = frame.onAir;
  if (frame.phase === 'static') {
    if (frame.harbinger) {
      next.harbinger = { opensAtMs: atMs + frame.harbinger.opensIn * 1000, text: frame.harbinger.text };
      next.noHarbingerSince = null;
    } else {
      next.harbinger = null;
      next.noHarbingerSince = frame.at;
    }
  } else {
    next.harbinger = null;
    next.noHarbingerSince = null;
  }
  return next;
}

export function applyNoise(s: EtherState, reason: NoiseReason | 'failure'): EtherState {
  const key: keyof EtherCounts = reason === 'unknown-key' || reason === 'bad-frame' ? 'foreign' : reason;
  return { ...s, counts: { ...s.counts, [key]: s.counts[key] + 1 } };
}

export function clockOffsetMs(s: EtherState): number {
  return s.offsetSamples.length ? Math.max(...s.offsetSamples) : 0;
}

export function serverNowMs(s: EtherState, localNow = Date.now()): number {
  return localNow + clockOffsetMs(s);
}

/** Реєстрація відкрита: перевірений кадр у фазі window або 2xx /public/config з registrationOpen. */
export function registrationOpen(s: EtherState): boolean {
  return s.phase === 'window' || (s.phase !== 'after' && s.configSaysOpen);
}

/** Мс до відкриття за провісником (за годинником сервера) або null. */
export function msUntilOpen(s: EtherState, localNow = Date.now()): number | null {
  if (!s.harbinger || s.phase !== 'static') return null;
  return s.harbinger.opensAtMs - serverNowMs(s, localNow);
}

/** Найраніший можливий момент відкриття, якщо провісника не було (мс сервера). */
export function earliestOpenMs(s: EtherState): number | null {
  if (s.phase !== 'static' || s.harbinger || !s.noHarbingerSince) return null;
  return ms(s.noHarbingerSince) + 6 * 3600_000;
}

/** Серверний момент у локальний для показу. */
export function toLocalMs(s: EtherState, serverMs: number): number {
  return serverMs - clockOffsetMs(s);
}
