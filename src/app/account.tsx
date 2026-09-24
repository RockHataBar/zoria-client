// Дані акаунта й опитування зведення (CL-25, CL-27 - CL-33): /me/summary приблизно раз на 15 с,
// перечитується тільки те, що зсунулося.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { describeError, type ApiResult } from '../core/api.ts';
import { backoffDelay, isAbort, retryAfterFor, sleep } from '../core/http.ts';
import { fetchAllPages } from '../core/paging.ts';
import type { Lang, Message, News, Repository, Stage, StageSummary, Summary, User } from '../core/types.ts';
import { useApp } from './context.tsx';

export interface Problem {
  text: string;
  requestId: string | null;
  at: number;
}

export interface Account {
  summary: Summary | null;
  user: User | null;
  /** undefined - ще не прочитано; null - заявки на репозиторій немає. */
  repository: Repository | null | undefined;
  inbox: Message[] | null;
  news: News[] | null;
  stages: StageSummary[] | null;
  stageBodies: Record<string, Stage>;
  stageMissing: Record<string, boolean>;
  problem: Problem | null;
  lastPoll: number | null;
  markRead(id: string): Promise<void>;
  ackStage(id: string): Promise<void>;
  openStage(id: string): Promise<void>;
  changeRepository(url: string): Promise<{ ok: true } | { ok: false; code: string | null; message: string }>;
  setLang(lang: Lang): Promise<boolean>;
  logout(): Promise<void>;
  refreshAll(): void;
}

const AccountCtx = createContext<Account | null>(null);

export function useAccount(): Account {
  const c = useContext(AccountCtx);
  if (!c) throw new Error('AccountProvider відсутній');
  return c;
}

function problemOf(r: ApiResult<unknown>): Problem | null {
  if (r.kind === 'ok' || r.kind === 'ether' || r.kind === 'foreign') return null;
  if (r.kind === 'failure') {
    const what = r.res.failure ? `збій зв'язку (${r.res.failure})` : `помилка сервера ${r.res.status}`;
    return { text: `${what} - повторимо з паузою.`, requestId: r.res.requestId, at: Date.now() };
  }
  return { text: describeError(r.code, r.status), requestId: r.status >= 500 ? r.requestId : null, at: Date.now() };
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const { api, session, authed, setSession, snap } = useApp();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [user, setUser] = useState<User | null>(session?.user ?? null);
  const [repository, setRepository] = useState<Repository | null | undefined>(undefined);
  const [inbox, setInbox] = useState<Message[] | null>(null);
  const [news, setNews] = useState<News[] | null>(null);
  const [stages, setStages] = useState<StageSummary[] | null>(null);
  const [stageBodies, setStageBodies] = useState<Record<string, Stage>>({});
  const [stageMissing, setStageMissing] = useState<Record<string, boolean>>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const [lastPoll, setLastPoll] = useState<number | null>(null);
  const [kick, setKick] = useState(0);

  const bodiesRef = useRef(stageBodies);
  bodiesRef.current = stageBodies;
  const phaseKnown = snap.state.phase !== null;

  const note = useCallback((r: ApiResult<unknown> | null) => {
    if (!r) return;
    const p = problemOf(r);
    if (p) setProblem(p);
    else if (r.kind === 'ok') setProblem(null);
  }, []);

  const refreshRepository = useCallback(async () => {
    const r = await authed((t) => api.repository(t));
    note(r);
    if (r?.kind === 'ok') setRepository(r.data);
  }, [api, authed, note]);

  const refreshUser = useCallback(async () => {
    const r = await authed((t) => api.me(t));
    note(r);
    if (r?.kind === 'ok') setUser(r.data);
  }, [api, authed, note]);

  const pageVia = useCallback(
    <T,>(call: (t: string, limit: number, offset: number) => Promise<ApiResult<{ items: T[]; nextOffset: number | null }>>) =>
      async (limit: number, offset: number) => {
        const r = await authed((t) => call(t, limit, offset));
        note(r);
        return r?.kind === 'ok' ? r.data : null;
      },
    [authed, note],
  );

  const refreshInbox = useCallback(async () => {
    const items = await fetchAllPages(pageVia(api.inbox));
    if (items) setInbox(items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }, [api, pageVia]);

  const refreshNews = useCallback(async () => {
    const items = await fetchAllPages(pageVia(api.news));
    if (items) setNews(items.sort((a, b) => (b.publishedAt ?? b.createdAt).localeCompare(a.publishedAt ?? a.createdAt)));
  }, [api, pageVia]);

  const openStage = useCallback(
    async (id: string) => {
      const r = await authed((t) => api.stage(t, id));
      note(r);
      if (r?.kind === 'ok') {
        setStageBodies((m) => ({ ...m, [id]: r.data }));
        setStageMissing((m) => ({ ...m, [id]: false }));
      } else if (r?.kind === 'error' && r.status === 404) {
        setStageMissing((m) => ({ ...m, [id]: true }));
      }
    },
    [api, authed, note],
  );

  const refreshStages = useCallback(async () => {
    const r = await authed((t) => api.stages(t));
    note(r);
    if (r?.kind !== 'ok') return;
    const list = [...r.data].sort((a, b) => a.position - b.position);
    setStages(list);
    // Зсунутий errataAt - сигнал перечитати частину (CL-31).
    for (const s of list) {
      const body = bodiesRef.current[s.id];
      if (body && body.errataAt !== s.errataAt) await openStage(s.id);
    }
  }, [api, authed, note, openStage]);

  // Опитування зведення: перечитуємо те, що зсунулося (CL-27).
  useEffect(() => {
    if (!session || !phaseKnown) return;
    const ctrl = new AbortController();
    let prev: Summary | null = null;
    let failures = 0;
    setUser(session.user);
    (async () => {
      while (!ctrl.signal.aborted) {
        let wait = 15_000 + Math.random() * 2_000;
        const r = await authed((t) => api.summary(t));
        if (ctrl.signal.aborted) return;
        if (r?.kind === 'ok') {
          failures = 0;
          const s = r.data;
          setLastPoll(Date.now());
          setProblem(null);
          const first = prev === null;
          if (first) void refreshUser();
          if (first || s.repositoryAt !== prev!.repositoryAt) await refreshRepository();
          if (first || s.unread !== prev!.unread) {
            await refreshInbox();
            await refreshStages();
          } else if (s.releasedStages !== prev!.releasedStages || s.acknowledgedStages !== prev!.acknowledgedStages) {
            await refreshStages();
          }
          if (first || s.latestNews !== prev!.latestNews) await refreshNews();
          prev = s;
          setSummary(s);
        } else if (r?.kind === 'failure') {
          failures++;
          note(r);
          wait = Math.max(wait, backoffDelay(failures));
        } else if (r?.kind === 'error' && r.status === 429) {
          wait = Math.max(wait, retryAfterFor(r.res) * 1000);
        } else if (r?.kind === 'error' && r.status !== 401) {
          note(r);
        }
        try {
          await sleep(wait, ctrl.signal);
        } catch (e) {
          if (isAbort(e)) return;
        }
      }
    })();
    return () => ctrl.abort();
    // kick - ручне оновлення всього
  }, [session, phaseKnown, api, authed, note, refreshUser, refreshRepository, refreshInbox, refreshStages, refreshNews, kick]);

  // Нова сесія - інший акаунт: чистимо дані попереднього.
  useEffect(() => {
    setSummary(null);
    setRepository(undefined);
    setInbox(null);
    setNews(null);
    setStages(null);
    setStageBodies({});
    setStageMissing({});
    setProblem(null);
    setUser(session?.user ?? null);
  }, [session?.user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const markRead = useCallback(
    async (id: string) => {
      const r = await authed((t) => api.markRead(t, id));
      note(r);
      if (r?.kind === 'ok') setInbox((list) => list?.map((m) => (m.id === id ? { ...m, readAt: r.data.readAt ?? new Date().toISOString() } : m)) ?? list);
    },
    [api, authed, note],
  );

  const ackStage = useCallback(
    async (id: string) => {
      const r = await authed((t) => api.ackStage(t, id));
      note(r);
      if (r?.kind === 'ok') {
        setStageBodies((m) => ({ ...m, [id]: r.data }));
        setStages((list) => list?.map((s) => (s.id === id ? { ...s, acknowledgedAt: r.data.acknowledgedAt } : s)) ?? list);
      }
    },
    [api, authed, note],
  );

  const changeRepository = useCallback(
    async (url: string) => {
      const r = await authed((t) => api.putRepository(t, url));
      if (!r) return { ok: false as const, code: null, message: 'Потрібен вхід.' };
      if (r.kind === 'ok') {
        setRepository(r.data);
        return { ok: true as const };
      }
      note(r);
      if (r.kind === 'error') return { ok: false as const, code: r.code, message: describeError(r.code, r.status) };
      return { ok: false as const, code: null, message: 'Відповідь не отримано - спробуйте ще раз.' };
    },
    [api, authed, note],
  );

  const setLang = useCallback(
    async (lang: Lang) => {
      const r = await authed((t) => api.patchMe(t, lang));
      note(r);
      if (r?.kind === 'ok') {
        setUser(r.data);
        return true;
      }
      return false;
    },
    [api, authed, note],
  );

  const logout = useCallback(async () => {
    const s = session;
    if (s) await api.logout(s.token);
    setSession(null);
  }, [api, session, setSession]);

  const value: Account = {
    summary,
    user,
    repository,
    inbox,
    news,
    stages,
    stageBodies,
    stageMissing,
    problem,
    lastPoll,
    markRead,
    ackStage,
    openStage,
    changeRepository,
    setLang,
    logout,
    refreshAll: () => setKick((k) => k + 1),
  };
  return <AccountCtx.Provider value={value}>{children}</AccountCtx.Provider>;
}
