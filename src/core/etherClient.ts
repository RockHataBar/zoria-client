// Слухач ефіру: ключ печатки, опитування /ether не частіше ніж раз на 15 с, журнал не частіше
// ніж раз на хвилину, повтори збоїв із джитером (CL-04, CL-08, CL-09). Працює в браузері й у Node.
import { applyNoise, applySignal, initialEther, type EtherState } from './ether.ts';
import { asConfig } from './guards.ts';
import { backoffDelay, hostOf, httpRequest, isAbort, onSilenceChange, sleep, type HttpResponse } from './http.ts';
import { acceptKey, checkEnvelope, envelopeShape, type VerifiedKey } from './seal.ts';
import type { Config } from './types.ts';

export interface EtherSnapshot {
  state: EtherState;
  key: { keyId: string; fingerprint: string } | null;
  keyError: string | null;
  config: Config | null;
  /** Останній запит /ether: коли і чим скінчився (для показу). */
  last: { at: number; outcome: 'signal' | 'noise' | 'failure' | 'jammed'; status: number; requestId: string | null } | null;
  running: boolean;
  /**
   * leader - ця вкладка слухає ефір; follower - слухає інша вкладка цього браузера, кадри приходять
   * від неї (печатка перевіряється тут); solo - без координації (Node, старий браузер).
   */
  role: 'leader' | 'follower' | 'solo';
}

type PeerMessage =
  | { t: 'env'; json: unknown; receivedAt: number; status: number; requestId: string | null }
  | { t: 'config'; config: Config }
  | { t: 'roll'; until: number };

function sharedNumber(key: string): number {
  try {
    return typeof localStorage === 'undefined' ? 0 : Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

function setSharedNumber(key: string, v: number): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, String(v));
  } catch {
    /* сховище недоступне */
  }
}

export interface EtherClientOptions {
  base: string;
  fingerprint: string | null;
  fetchImpl?: typeof fetch;
  pollMs?: number;
  rollMs?: number;
  configMs?: number;
  log?: (msg: string) => void;
  random?: () => number;
}

export type EtherClient = ReturnType<typeof createEtherClient>;

export function createEtherClient(o: EtherClientOptions) {
  const pollMs = Math.max(15_000, o.pollMs ?? 15_000);
  const rollMs = Math.max(60_000, o.rollMs ?? 60_000);
  const configMs = o.configMs ?? 5 * 60_000;
  const random = o.random ?? Math.random;
  const log = o.log ?? (() => {});

  let state: EtherState = initialEther();
  const keys = new Map<string, VerifiedKey>();
  const refetchedFor = new Set<string>();
  let key: VerifiedKey | null = null;
  let keyError: string | null = null;
  let config: Config | null = null;
  let last: EtherSnapshot['last'] = null;
  let ctrl: AbortController | null = null;
  let failures = 0;
  let lastRollReq = 0;
  let lastConfigReq = 0;
  let rollInterest = 0;
  let remoteRollUntil = 0;
  let wake: (() => void) | null = null;
  let role: EtherSnapshot['role'] = 'solo';
  let channel: BroadcastChannel | null = null;
  const host = hostOf(o.base);
  const lastEtherKey = `zoria:lastEther:${host}`;

  const listeners = new Set<() => void>();
  let snapshot: EtherSnapshot = build();

  function build(): EtherSnapshot {
    return {
      state,
      key: key ? { keyId: key.keyId, fingerprint: key.fingerprint } : null,
      keyError,
      config,
      last,
      running: ctrl !== null,
      role,
    };
  }

  function post(m: PeerMessage) {
    try {
      channel?.postMessage(m);
    } catch {
      /* канал закрито */
    }
  }

  /** Кадр, який отримала вкладка-слухач: печатку перевіряємо самі. */
  async function onPeer(m: PeerMessage) {
    if (m.t === 'roll') {
      remoteRollUntil = Math.max(remoteRollUntil, m.until);
      if (role === 'leader' && Date.now() - lastRollReq >= rollMs) wake?.();
      return;
    }
    if (role === 'leader') return;
    if (m.t === 'config') {
      config = m.config;
      state = { ...state, configSaysOpen: m.config.registrationOpen };
      emit();
      return;
    }
    if (!key) return;
    const outcome = await accept(m.json, m.receivedAt);
    last = { at: m.receivedAt, outcome, status: m.status, requestId: m.requestId };
    emit();
  }

  function emit() {
    snapshot = build();
    listeners.forEach((fn) => fn());
  }

  const req = (path: string, signal?: AbortSignal) => httpRequest(o.base, 'GET', path, { signal, fetchImpl: o.fetchImpl });

  async function loadKey(signal?: AbortSignal): Promise<boolean> {
    const res = await req('/ether/key', signal);
    if (res.failure || res.status !== 200) {
      keyError = res.failure ? `ключ печатки недоступний (${res.failure})` : `ключ печатки: відповідь ${res.status}`;
      return false;
    }
    try {
      const k = await acceptKey(res.json, o.fingerprint);
      keys.set(k.keyId, k);
      key = k;
      keyError = null;
      log(`ключ печатки ${k.keyId} прийнято, відбиток ${k.fingerprint}`);
      return true;
    } catch (e) {
      keyError = e instanceof Error ? e.message : String(e);
      log(`ключ печатки відхилено: ${keyError}`);
      return false;
    }
  }

  /** Перевіряє тіло у формі конверта і, якщо печатка правильна, приймає кадр. */
  async function accept(json: unknown, receivedAt: number): Promise<'signal' | 'noise'> {
    let c = await checkEnvelope(json, keys);
    if (c.kind === 'unknown-key') {
      // Ключ незнайомий - перечитати /ether/key один раз; однаково незнайомий - перешкода.
      if (!refetchedFor.has(c.keyId)) {
        refetchedFor.add(c.keyId);
        await loadKey();
        c = await checkEnvelope(json, keys);
      }
      if (c.kind === 'unknown-key') {
        state = applyNoise(state, 'unknown-key');
        return 'noise';
      }
    }
    if (c.kind === 'signal') {
      const before = state.phase;
      state = applySignal(state, c.frame, receivedAt);
      if (state.phase !== before) log(`фаза: ${before ?? '?'} -> ${state.phase}`);
      return 'signal';
    }
    state = applyNoise(state, c.reason);
    return 'noise';
  }

  async function handle(res: HttpResponse): Promise<void> {
    if (res.failure) {
      if (res.failure === 'aborted') return;
      failures++;
      state = applyNoise(state, 'failure');
      last = { at: res.receivedAt, outcome: 'failure', status: 0, requestId: null };
      return;
    }
    if (res.status === 429) {
      // глушіння: мовчання вже враховано в http.ts
      last = { at: res.receivedAt, outcome: 'jammed', status: 429, requestId: res.requestId };
      log(`429: мовчимо ${res.retryAfterSec ?? '?'} с`);
      return;
    }
    if (envelopeShape(res.json)) post({ t: 'env', json: res.json, receivedAt: res.receivedAt, status: res.status, requestId: res.requestId });
    const outcome = await accept(res.json, res.receivedAt);
    if (outcome === 'signal') failures = 0;
    else if (res.status >= 500 && !envelopeShape(res.json)) failures++;
    last = { at: res.receivedAt, outcome, status: res.status, requestId: res.requestId };
  }

  async function refreshConfig(signal?: AbortSignal): Promise<void> {
    lastConfigReq = Date.now();
    const res = await req('/public/config', signal);
    if (res.failure || res.status === 429) return;
    if (envelopeShape(res.json)) {
      post({ t: 'env', json: res.json, receivedAt: res.receivedAt, status: res.status, requestId: res.requestId });
      await accept(res.json, res.receivedAt);
      return;
    }
    if (res.status >= 200 && res.status < 300) {
      const c = asConfig(res.json);
      if (c) {
        config = c;
        state = { ...state, configSaysOpen: c.registrationOpen };
        post({ t: 'config', config: c });
      }
    }
  }

  async function refreshRoll(signal?: AbortSignal): Promise<void> {
    lastRollReq = Date.now();
    const res = await req('/ether/roll', signal);
    if (res.failure || res.status === 429) return;
    if (envelopeShape(res.json)) post({ t: 'env', json: res.json, receivedAt: res.receivedAt, status: res.status, requestId: res.requestId });
    await accept(res.json, res.receivedAt);
  }

  function pause(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (wake === done) wake = null;
        fn();
      };
      const done = () => settle(resolve);
      sleep(ms, signal).then(done, (e: unknown) => settle(() => reject(e)));
      wake = done;
    });
  }

  async function loop(signal: AbortSignal): Promise<void> {
    let nextEtherAt = 0;
    while (!signal.aborted) {
      try {
        if (!key && !(await loadKey(signal))) {
          failures++;
          emit();
          await pause(Math.max(5_000, backoffDelay(failures, random)), signal);
          continue;
        }
        // 15 с між запитами /ether - спільні для вкладок і перезавантажень цього браузера
        const gap = sharedNumber(lastEtherKey) + pollMs - Date.now();
        if (Date.now() >= nextEtherAt && gap > 0) nextEtherAt = Date.now() + gap;
        if (Date.now() >= nextEtherAt) {
          setSharedNumber(lastEtherKey, Date.now());
          const res = await req('/ether', signal);
          setSharedNumber(lastEtherKey, Date.now());
          await handle(res);
          emit();
          const delay = Math.max(pollMs + random() * 2_000, failures > 0 ? backoffDelay(failures, random) : 0);
          nextEtherAt = Date.now() + delay;

          const now = Date.now();
          const wantConfig =
            now - lastConfigReq >= configMs ||
            (!config && (state.phase === 'window' || state.phase === 'after') && now - lastConfigReq >= 20_000);
          if (wantConfig) {
            await pause(1_000 + random() * 2_000, signal);
            await refreshConfig(signal);
            emit();
          }
        }
        if ((rollInterest > 0 || Date.now() < remoteRollUntil) && Date.now() - lastRollReq >= rollMs) {
          await pause(1_000 + random() * 2_000, signal);
          await refreshRoll(signal);
          emit();
        }
        // Пробудження раніше (інтерес до журналу) не прискорює /ether: чекаємо до nextEtherAt.
        await pause(Math.max(250, nextEtherAt - Date.now()), signal);
      } catch (e) {
        if (isAbort(e)) return;
        failures++;
        log(`помилка слухача: ${e instanceof Error ? e.message : String(e)}`);
        try {
          await pause(Math.max(pollMs, backoffDelay(failures, random)), signal);
        } catch {
          return;
        }
      }
    }
  }

  /** Вкладка, що не слухає ефір сама: потрібен тільки ключ, щоб перевіряти чужі кадри. */
  async function followerKey(signal: AbortSignal): Promise<void> {
    let n = 0;
    while (!key && !signal.aborted && role === 'follower') {
      if (await loadKey(signal).catch(() => false)) break;
      emit();
      await sleep(Math.max(5_000, backoffDelay(++n, random)), signal).catch(() => {});
    }
    emit();
  }

  let unsubSilence: (() => void) | null = null;
  let rollTimer: ReturnType<typeof setInterval> | null = null;

  function startCoordinated(signal: AbortSignal): boolean {
    const locks = typeof window !== 'undefined' && typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (!locks || typeof BroadcastChannel === 'undefined') return false;
    const name = `zoria-ether:${host}`;
    channel = new BroadcastChannel(name);
    channel.onmessage = (e: MessageEvent<PeerMessage>) => void onPeer(e.data);
    role = 'follower';
    void followerKey(signal);
    // Ліміт ефіру - на адресу: слухає одна вкладка, решта отримують її кадри.
    locks
      .request(name, { signal }, async () => {
        role = 'leader';
        log('ця вкладка слухає ефір');
        emit();
        await loop(signal);
      })
      .catch(() => {});
    rollTimer = setInterval(() => {
      if (role === 'follower' && rollInterest > 0) post({ t: 'roll', until: Date.now() + 75_000 });
    }, 30_000);
    return true;
  }

  return {
    base: o.base,
    start() {
      if (ctrl) return;
      ctrl = new AbortController();
      unsubSilence = onSilenceChange(emit);
      if (!startCoordinated(ctrl.signal)) {
        role = 'solo';
        void loop(ctrl.signal);
      }
      emit();
    },
    stop() {
      ctrl?.abort();
      ctrl = null;
      unsubSilence?.();
      unsubSilence = null;
      if (rollTimer) clearInterval(rollTimer);
      rollTimer = null;
      channel?.close();
      channel = null;
      role = 'solo';
      emit();
    },
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot(): EtherSnapshot {
      return snapshot;
    },
    /** Інтерес до журналу: поки > 0, /ether/roll опитується не частіше ніж раз на хвилину. */
    wantRoll(on: boolean) {
      rollInterest = Math.max(0, rollInterest + (on ? 1 : -1));
      if (on && role === 'follower') post({ t: 'roll', until: Date.now() + 75_000 });
      if (on && Date.now() - lastRollReq >= rollMs) wake?.();
    },
    /** Тіло з іншого маршруту у формі конверта (503 до просвіту) - теж кадр ефіру. */
    async acceptEnvelope(json: unknown, receivedAt: number): Promise<void> {
      if (!key) return;
      await accept(json, receivedAt);
      emit();
    },
    async reloadConfig(): Promise<Config | null> {
      await refreshConfig(ctrl?.signal);
      emit();
      return config;
    },
  };
}
