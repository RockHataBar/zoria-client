import { useState } from 'react';
import { useAccount } from '../app/account.tsx';
import { useApp } from '../app/context.tsx';
import { Markdown, ProblemLine, Time } from './common.tsx';

export function StagesPanel() {
  const { session, requireLogin } = useApp();
  const acc = useAccount();
  const [openId, setOpenId] = useState<string | null>(null);

  if (!session) {
    return (
      <section className="panel">
        <h2>Частини завдання</h2>
        <p>Частини завдання видаються в мережі після входу; частина 2 - 2026-09-28.</p>
        <button type="button" onClick={() => requireLogin()}>
          Увійти
        </button>
      </section>
    );
  }
  const stages = acc.stages;
  const body = openId ? acc.stageBodies[openId] : undefined;

  return (
    <section className="panel">
      <h2>
        Частини завдання{' '}
        {acc.summary ? (
          <span className="muted">
            (видано: {acc.summary.releasedStages}, підтверджено: {acc.summary.acknowledgedStages})
          </span>
        ) : null}
      </h2>
      <ProblemLine p={acc.problem} />
      <p className="muted">Нова частина з'являється тут сама, щойно зсувається лічильник видачі; майбутні частини клієнт не вгадує.</p>
      {stages === null && <p>Читаємо…</p>}
      {stages?.length === 0 && <p>Частин ще не видано.</p>}
      <div className="split">
        <ul className="list">
          {stages?.map((s) => (
            <li key={s.id} className={s.id === openId ? 'active' : ''}>
              <button
                type="button"
                className="link"
                onClick={() => {
                  setOpenId(s.id);
                  void acc.openStage(s.id);
                }}
              >
                <span className="title">
                  {s.position}. {s.title}
                  {s.errataAt ? ' · є уточнення' : ''}
                </span>
                <span className="meta">
                  видано <Time t={s.releasedAt} />
                  {s.acknowledgedAt ? ' · отримання підтверджено' : ''}
                </span>
                {s.excerpt && <span className="excerpt">{s.excerpt}</span>}
              </button>
            </li>
          ))}
        </ul>
        {openId && (
          <article className="reader">
            {acc.stageMissing[openId] && <p>Цієї частини немає або її ще не видано (404).</p>}
            {!body && !acc.stageMissing[openId] && <p>Читаємо…</p>}
            {body && (
              <>
                <h3>
                  {body.position}. {body.title}
                </h3>
                <p className="meta">
                  опубліковано <Time t={body.publishedAt} /> · видано <Time t={body.releasedAt} />
                </p>
                {body.errata && (
                  <aside className="errata">
                    <strong>
                      Уточнення від <Time t={body.errataAt} />:
                    </strong>
                    <Markdown text={body.errata} />
                  </aside>
                )}
                <Markdown text={body.body} />
                <div className="actions">
                  {body.acknowledgedAt ? (
                    <span className="ok">
                      Отримання підтверджено <Time t={body.acknowledgedAt} />
                    </span>
                  ) : (
                    <button type="button" onClick={() => void acc.ackStage(body.id)}>
                      Підтвердити отримання
                    </button>
                  )}
                </div>
              </>
            )}
          </article>
        )}
      </div>
    </section>
  );
}
