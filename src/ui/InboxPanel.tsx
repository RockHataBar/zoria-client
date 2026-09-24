import { useState } from 'react';
import { useAccount } from '../app/account.tsx';
import { useApp } from '../app/context.tsx';
import type { Message } from '../core/types.ts';
import { Markdown, ProblemLine, StatusBadge, Time } from './common.tsx';
import { isAccessStatus } from '../core/guards.ts';

function NoticeBox({ m }: { m: Message }) {
  const n = m.notice;
  if (!n) return null;
  if (n.type === 'repository') {
    return (
      <div className="notice">
        Сповіщення сервера про репозиторій{n.url ? <> {n.url}</> : null}: {isAccessStatus(n.accessStatus) ? <StatusBadge status={n.accessStatus} /> : null}
        {n.reason && <div>{n.reason}</div>}
      </div>
    );
  }
  // незнайомий тип сповіщення - показуємо як звичайний лист (CL-29)
  return null;
}

export function InboxPanel() {
  const { session, requireLogin, setTab } = useApp();
  const acc = useAccount();
  const [openId, setOpenId] = useState<string | null>(null);

  if (!session) {
    return (
      <section className="panel">
        <h2>Листи</h2>
        <button type="button" onClick={() => requireLogin()}>
          Увійти
        </button>
      </section>
    );
  }
  const list = acc.inbox;
  const open = list?.find((m) => m.id === openId) ?? null;

  return (
    <section className="panel">
      <h2>Листи {acc.summary ? <span className="muted">(непрочитаних: {acc.summary.unread})</span> : null}</h2>
      <ProblemLine p={acc.problem} />
      {list === null && <p>Читаємо…</p>}
      {list?.length === 0 && <p>Листів немає.</p>}
      <div className="split">
        <ul className="list">
          {list?.map((m) => (
            <li key={m.id} className={`${m.readAt ? '' : 'unread'} ${m.id === openId ? 'active' : ''}`}>
              <button type="button" className="link" onClick={() => setOpenId(m.id)}>
                <span className="title">{m.title}</span>
                <span className="meta">
                  <Time t={m.createdAt} />
                  {m.kind === 'stage' ? ' · частина завдання' : ''}
                  {m.notice ? ' · сповіщення' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {open && (
          <article className="reader">
            <h3>{open.title}</h3>
            <p className="meta">
              <Time t={open.createdAt} /> · {open.readAt ? <>прочитано <Time t={open.readAt} /></> : 'не прочитано'}
            </p>
            <NoticeBox m={open} />
            <Markdown text={open.body} />
            <div className="actions">
              {!open.readAt && (
                <button type="button" onClick={() => void acc.markRead(open.id)}>
                  Позначити прочитаним
                </button>
              )}
              {open.stageId && (
                <button type="button" onClick={() => setTab('stages')}>
                  До частини завдання
                </button>
              )}
            </div>
          </article>
        )}
      </div>
    </section>
  );
}
