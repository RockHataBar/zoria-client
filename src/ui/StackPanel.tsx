import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../app/context.tsx';
import { describeError } from '../core/api.ts';
import type { StackVerdict, StackView } from '../core/types.ts';
import { Time, Zone } from './common.tsx';

const STATUS_TEXT: Record<StackView['status'], string> = {
  ok: 'придатний',
  failed: 'провалено',
  none: 'вердикту ще немає',
};

const STATUS_CLASS: Record<StackView['status'], string> = {
  ok: 'st-verified',
  failed: 'st-needs-attention',
  none: 'st-pending',
};

const PHASE_TEXT: Record<string, string> = {
  ahead: 'до фіксації',
  retry: 'іде вікно перездачі',
  past: 'закрито',
};

function Verdict({ v }: { v: StackVerdict }) {
  return (
    <div className="card">
      <h3>
        {v.ok ? <span className="ok">придатний</span> : <span className="error">провалено</span>} · <Time t={v.at} />
      </h3>
      <p className="meta">
        коміт <code>{v.sha.slice(0, 12) || '—'}</code> · замок <code>{v.digest.slice(0, 12) || '—'}</code>
      </p>
      {v.checks.length > 0 && (
        <table className="roll">
          <thead>
            <tr>
              <th>Ступінь</th>
              <th />
              <th>Деталі</th>
            </tr>
          </thead>
          <tbody>
            {v.checks.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td>{c.ok ? <span className="ok">+</span> : <span className="error">✗</span>}</td>
                <td>{c.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function StackPanel() {
  const { api, session, authed, requireLogin } = useApp();
  const [view, setView] = useState<StackView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [armed, setArmed] = useState(false);
  const [retryNote, setRetryNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await authed((t) => api.stack(t));
    setLoading(false);
    if (!r) return;
    if (r.kind === 'ok') {
      setView(r.data);
      setError(null);
    } else if (r.kind === 'error') setError(describeError(r.code, r.status));
    else if (r.kind === 'failure') setError(r.res.failure ? `збій зв'язку (${r.res.failure})` : `помилка сервера ${r.res.status}`);
    else setError('Відповідь сервера незнайомої форми.');
  }, [api, authed]);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  const retry = useCallback(async () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    const r = await authed((t) => api.stackRetry(t));
    if (!r) return;
    if (r.kind === 'ok') setRetryNote('Перездачу запрошено: знімаємо HEAD гілки і женемо прогін.');
    else if (r.kind === 'error') setRetryNote(r.code === 'retry-used' ? 'Перездачу вже використано.' : r.code === 'no-retry-window' ? 'Зараз немає вікна перездачі.' : describeError(r.code, r.status));
    else setRetryNote('Сервер не відповів як слід - спробуйте ще раз.');
    void load();
  }, [armed, api, authed, load]);

  if (!session) {
    return (
      <section className="panel">
        <h2>Стек</h2>
        <p>Вердикт передстартового прогону видно після входу.</p>
        <button type="button" onClick={() => requireLogin()}>
          Увійти
        </button>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Стек</h2>
      <p className="muted">
        Вердикт передстартового прогону і здача в поточному вікні. <Zone />
      </p>
      <p>
        <button type="button" className="small" onClick={() => void load()} disabled={loading}>
          {loading ? 'Читаємо…' : 'Оновити'}
        </button>
      </p>
      {error && <p className="error">{error}</p>}
      {!view && !error && <p>Читаємо…</p>}
      {view && (
        <>
          <div className="card">
            <h3>
              Стан: <span className={`badge ${STATUS_CLASS[view.status]}`}>{STATUS_TEXT[view.status]}</span>
            </h3>
            {view.window && (
              <p>
                Вікно «{view.window.title}»: {PHASE_TEXT[view.window.phase] ?? view.window.phase}; фіксація <Time t={view.window.freezeAt} />, перездача до{' '}
                <Time t={view.window.retryUntil} />.
              </p>
            )}
            {view.retry && (
              <p>
                Перездача: {view.retry.used ? 'використано' : view.retry.available ? 'доступна' : 'недоступна'}
                {view.retry.until && (
                  <>
                    {' '}
                    (до <Time t={view.retry.until} />)
                  </>
                )}
                .
              </p>
            )}
            {view.retry?.available && !view.retry.used && view.window?.phase === 'retry' && (
              <p>
                <button type="button" className={armed ? 'small warn' : 'small'} onClick={() => void retry()}>
                  {armed ? 'Точно? Перездача одна - натисніть ще раз' : 'Запросити перездачу'}
                </button>
              </p>
            )}
            {retryNote && <p className="hint-box">{retryNote}</p>}
            {view.submissions.length > 0 && (
              <ul>
                {view.submissions.map((s, i) => (
                  <li key={i}>
                    {s.kind === 'retry' ? 'перездача' : 'вікно'}
                    {s.auto ? ' (HEAD узято автоматично)' : ''}: <code>{s.sha?.slice(0, 12) ?? '—'}</code>, стан {s.state}
                  </li>
                ))}
              </ul>
            )}
            <p>
              Наступна гра: <Time t={view.nextGameAt} empty="ще не призначено" />
            </p>
          </div>
          {view.latest && <Verdict v={view.latest} />}
          {view.history.length > 1 && (
            <>
              <h3>Попередні вердикти</h3>
              {view.history
                .filter((h) => h.id !== view.latest?.id)
                .map((h) => (
                  <p key={h.id} className="meta">
                    <Time t={h.at} /> · {h.ok ? 'придатний' : 'провалено'} · <code>{h.sha.slice(0, 12)}</code>
                  </p>
                ))}
            </>
          )}
        </>
      )}
    </section>
  );
}
