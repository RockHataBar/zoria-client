import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createApi, type Api, type ApiResult } from '../core/api.ts';
import { loadJson, saveJson, scopedKey, serverFromEnv, type ServerSetting } from '../core/config.ts';
import { createEtherClient, type EtherClient, type EtherSnapshot } from '../core/etherClient.ts';
import { asSession } from '../core/guards.ts';
import { serverNowMs } from '../core/ether.ts';
import type { Session } from '../core/types.ts';

export type Tab = 'ether' | 'register' | 'access' | 'inbox' | 'news' | 'stages' | 'roll' | 'settings';

export interface AppCtx {
  server: ServerSetting;
  setServer(s: ServerSetting): void;
  ether: EtherClient;
  snap: EtherSnapshot;
  api: Api;
  session: Session | null;
  setSession(s: Session | null): void;
  /** Відкрити вхід поверх поточного екрана: введене на екрані лишається (CL-21). */
  requireLogin(reason?: string): void;
  login: { open: boolean; reason: string | null };
  closeLogin(): void;
  /** Запит із токеном; 401 (не перешкода) веде на вхід. null - сесії немає. */
  authed<T>(call: (token: string) => Promise<ApiResult<T>>): Promise<ApiResult<T> | null>;
  /** Відповіді без печатки до просвіту - шум (CL-02): довіряти помилкам тільки у window/after. */
  trusted: boolean;
  tab: Tab;
  setTab(t: Tab): void;
}

const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('AppProvider відсутній');
  return c;
}

const SERVER_KEY = 'zoria:server';

function initialServer(): ServerSetting {
  const saved = loadJson<ServerSetting>(SERVER_KEY);
  if (saved && typeof saved.base === 'string' && (saved.fingerprint === null || typeof saved.fingerprint === 'string')) return saved;
  return serverFromEnv(import.meta.env?.VITE_ZORIA_SERVER, import.meta.env?.VITE_ZORIA_FINGERPRINT);
}

function loadSession(base: string): Session | null {
  const s = asSession(loadJson(scopedKey(base, 'session')));
  if (!s || Date.parse(s.expiresAt) <= Date.now()) return null;
  return s;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [server, setServerState] = useState<ServerSetting>(initialServer);
  const [session, setSessionState] = useState<Session | null>(() => loadSession(server.base));
  const [login, setLogin] = useState<{ open: boolean; reason: string | null }>({ open: false, reason: null });
  const [tab, setTab] = useState<Tab>('ether');

  const ether = useMemo(
    () => createEtherClient({ base: server.base, fingerprint: server.fingerprint, log: (m) => console.info('[ефір]', m) }),
    [server.base, server.fingerprint],
  );
  useEffect(() => {
    ether.start();
    return () => ether.stop();
  }, [ether]);
  const snap = useSyncExternalStore(ether.subscribe, ether.getSnapshot);

  const api = useMemo(
    () => createApi(server.base, { onEnvelope: (json, at) => void ether.acceptEnvelope(json, at) }),
    [server.base, ether],
  );

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const trusted = snap.state.phase === 'window' || snap.state.phase === 'after';
  const trustedRef = useRef(trusted);
  trustedRef.current = trusted;

  const setSession = useCallback(
    (s: Session | null) => {
      sessionRef.current = s;
      setSessionState(s);
      saveJson(scopedKey(server.base, 'session'), s);
    },
    [server.base],
  );

  const requireLogin = useCallback((reason?: string) => setLogin({ open: true, reason: reason ?? null }), []);
  const closeLogin = useCallback(() => setLogin({ open: false, reason: null }), []);

  const authed = useCallback(
    async <T,>(call: (token: string) => Promise<ApiResult<T>>): Promise<ApiResult<T> | null> => {
      const s = sessionRef.current;
      if (!s) return null;
      const r = await call(s.token);
      if (r.kind === 'error' && r.status === 401 && trustedRef.current && sessionRef.current?.token === s.token) {
        setSession(null);
        requireLogin('Сесія недійсна або прострочена - увійдіть знову. Екран і введене збережено.');
      }
      return r;
    },
    [setSession, requireLogin],
  );

  // Кінець сесії (CL-22): до закінчення пропонуємо увійти знову, після - вхід.
  useEffect(() => {
    if (!session) return;
    const check = () => {
      const left = Date.parse(session.expiresAt) - serverNowMs(ether.getSnapshot().state);
      if (left <= 0 && sessionRef.current === session) {
        setSession(null);
        requireLogin('Сесія скінчилася (діє добу) - увійдіть знову.');
      }
    };
    check();
    const t = setInterval(check, 15_000);
    return () => clearInterval(t);
  }, [session, ether, setSession, requireLogin]);

  const setServer = useCallback((s: ServerSetting) => {
    saveJson(SERVER_KEY, s);
    setServerState(s);
    setSessionState(loadSession(s.base));
    setLogin({ open: false, reason: null });
  }, []);

  const value: AppCtx = {
    server,
    setServer,
    ether,
    snap,
    api,
    session,
    setSession,
    requireLogin,
    login,
    closeLogin,
    authed,
    trusted,
    tab,
    setTab,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Поточний час, що оновлюється раз на `ms` - для відліків. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
