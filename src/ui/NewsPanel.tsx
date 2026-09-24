import { useAccount } from '../app/account.tsx';
import { useApp } from '../app/context.tsx';
import { Markdown, ProblemLine, Time } from './common.tsx';

export function NewsPanel() {
  const { session, requireLogin } = useApp();
  const acc = useAccount();
  if (!session) {
    return (
      <section className="panel">
        <h2>Новини</h2>
        <p>Новини мережі читаються після входу.</p>
        <button type="button" onClick={() => requireLogin()}>
          Увійти
        </button>
      </section>
    );
  }
  const items = acc.news?.filter((n) => !n.archivedAt) ?? null;
  return (
    <section className="panel">
      <h2>Новини</h2>
      <ProblemLine p={acc.problem} />
      {items === null && <p>Читаємо…</p>}
      {items?.length === 0 && <p>Новин немає.</p>}
      {items?.map((n) => (
        <article key={n.id} className="card">
          <h3>{n.title}</h3>
          <p className="meta">
            <Time t={n.publishedAt ?? n.createdAt} />
            {n.updatedAt && n.updatedAt !== n.createdAt && (
              <>
                {' '}
                · оновлено <Time t={n.updatedAt} />
              </>
            )}
          </p>
          <Markdown text={n.body} />
        </article>
      ))}
    </section>
  );
}
