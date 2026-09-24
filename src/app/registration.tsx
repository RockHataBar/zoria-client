// Заготовлена заявка і автоматичне надсилання в просвіт (CL-16): за першим перевіреним кадром
// з phase: "window" (або 2xx /public/config з registrationOpen). Працює на будь-якій вкладці.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { loadJson, saveJson, scopedKey } from '../core/config.ts';
import { registrationOpen } from '../core/ether.ts';
import { registerFlow, type RegisterOutcome } from '../core/register.ts';
import { validateApplication, type Application, type FieldErrors } from '../core/validate.ts';
import { useApp } from './context.tsx';

export interface Step {
  at: number;
  text: string;
}

export interface Registration {
  draft: Application;
  setDraft(patch: Partial<Application>): void;
  /** Зберігати пароль і код заявки на цьому пристрої (сховище браузера), щоб автонадсилання пережило перезавантаження. */
  remember: boolean;
  setRemember(v: boolean): void;
  armed: boolean;
  arm(): boolean;
  disarm(): void;
  running: boolean;
  steps: Step[];
  fieldErrors: FieldErrors;
  outcome: RegisterOutcome | null;
  sendNow(): boolean;
  cancel(): void;
}

const RegCtx = createContext<Registration | null>(null);

export function useRegistration(): Registration {
  const c = useContext(RegCtx);
  if (!c) throw new Error('RegistrationProvider відсутній');
  return c;
}

const EMPTY: Application = { username: '', displayName: '', password: '', invitation: '', repositoryUrl: '', lang: 'uk' };

interface Saved {
  draft: Partial<Application>;
  remember: boolean;
  armed: boolean;
}

export function RegistrationProvider({ children }: { children: ReactNode }) {
  const { api, server, snap, session, setSession, setTab } = useApp();
  const key = scopedKey(server.base, 'application');

  const [saved] = useState<Saved | null>(() => loadJson<Saved>(key));
  const [draft, setDraftState] = useState<Application>(() => ({ ...EMPTY, ...(saved?.draft ?? {}) }));
  const [remember, setRemember] = useState<boolean>(saved?.remember === true);
  const [armed, setArmed] = useState<boolean>(saved?.armed === true && saved.remember === true);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [outcome, setOutcome] = useState<RegisterOutcome | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const notOpenAtRef = useRef<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Введене не губиться: несекретні поля - завжди, пароль і код - тільки за згодою (CL-16, CL-20).
  useEffect(() => {
    const { password, invitation, ...open } = draft;
    const toSave: Saved = { draft: remember ? { ...open, password, invitation } : open, remember, armed };
    saveJson(key, toSave);
  }, [draft, remember, armed, key]);

  const setDraft = useCallback((patch: Partial<Application>) => {
    setDraftState((d) => ({ ...d, ...patch }));
    setFieldErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(patch)) delete next[k as keyof Application];
      return next;
    });
  }, []);

  const start = useCallback(async () => {
    if (runningRef.current) return; // одна заявка за раз, навіть при подвійному ефекті
    const app = draftRef.current;
    const errs = validateApplication(app);
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      setArmed(false);
      setTab('register');
      return;
    }
    runningRef.current = true;
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setRunning(true);
    setOutcome(null);
    setSteps([]);
    const push = (text: string) => setSteps((s) => [...s.slice(-49), { at: Date.now(), text }]);
    let out: RegisterOutcome;
    try {
      out = await registerFlow(api, app, { signal: ctrl.signal, onStep: push });
    } catch (e) {
      out = { kind: 'error', code: null, status: 0, requestId: null, message: e instanceof Error ? e.message : String(e) };
    } finally {
      runningRef.current = false;
    }
    ctrlRef.current = null;
    setRunning(false);
    setOutcome(out);
    switch (out.kind) {
      case 'registered':
        setSession(out.session);
        setArmed(false);
        // пароль і використаний код більше не потрібні - прибираємо зі сховища
        setDraftState((d) => ({ ...d, password: '', invitation: '' }));
        setRemember(false);
        setTab('access');
        break;
      case 'field-error':
        if (out.field) setFieldErrors({ [out.field]: out.message });
        setArmed(false);
        setTab('register');
        break;
      case 'error':
        setArmed(false);
        break;
      case 'not-open':
        notOpenAtRef.current = snap.state.lastAt;
        break;
      case 'aborted':
        break;
    }
  }, [api, setSession, setTab, snap.state.lastAt]);

  // Автонадсилання: тільки за перевіреним станом ефіру.
  useEffect(() => {
    if (!armed || running || session) return;
    if (!registrationOpen(snap.state)) return;
    if (notOpenAtRef.current !== null && notOpenAtRef.current === snap.state.lastAt) return;
    notOpenAtRef.current = null;
    void start();
  }, [armed, running, session, snap.state, start]);

  const arm = useCallback(() => {
    const errs = validateApplication(draftRef.current);
    setFieldErrors(errs);
    if (Object.keys(errs).length) return false;
    setArmed(true);
    return true;
  }, []);

  const sendNow = useCallback(() => {
    if (running) return false;
    const errs = validateApplication(draftRef.current);
    setFieldErrors(errs);
    if (Object.keys(errs).length) return false;
    void start();
    return true;
  }, [running, start]);

  const cancel = useCallback(() => {
    ctrlRef.current?.abort();
    setArmed(false);
  }, []);

  const value: Registration = {
    draft,
    setDraft,
    remember,
    setRemember,
    armed,
    arm,
    disarm: () => setArmed(false),
    running,
    steps,
    fieldErrors,
    outcome,
    sendNow,
    cancel,
  };
  return <RegCtx.Provider value={value}>{children}</RegCtx.Provider>;
}
