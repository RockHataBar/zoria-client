import { useState } from 'react';
import { useAccount } from '../app/account.tsx';
import { useApp } from '../app/context.tsx';
import type { ReasonCode } from '../core/types.ts';
import { parseRepository } from '../core/validate.ts';
import { CopyButton, Field, ProblemLine, StatusBadge, Time, Zone } from './common.tsx';

const REASON_HINT: Record<Exclude<ReasonCode, null | 'organizer'>, (login: string) => string> = {
  'marker-found': () => 'Файл .zoria називає ваш акаунт - доступ підтверджено. Тримайте доступ до кінця конкурсу.',
  'marker-other': (login) => `Файл .zoria називає інший акаунт. Перший непорожній рядок має бути вашим логіном: ${login}.`,
  'marker-absent': () => 'Запрошення прийнято, але файлу .zoria немає в корені гілки за замовчуванням.',
  'inviter-mismatch': () => 'Запрошення надіслав не той GitHub-акаунт, що вказано у вашій заявці. Надішліть запрошення з нього.',
};

export function AccessPanel() {
  const { session, snap, requireLogin } = useApp();
  const acc = useAccount();
  const [newUrl, setNewUrl] = useState('');
  const [urlError, setUrlError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  if (!session) {
    return (
      <section className="panel">
        <h2>Доступ до репозиторію</h2>
        <p>Спершу зареєструйтеся в просвіт або увійдіть.</p>
        <button type="button" onClick={() => requireLogin()}>
          Увійти
        </button>
      </section>
    );
  }

  const login = acc.user?.username ?? session.user.username;
  const access = snap.config?.repositoryAccess;
  const bot = access?.githubUsername ?? 'zoria-net-bot';
  const repo = acc.repository;
  const slug = repo ? repo.url.replace(/^https:\/\/github\.com\//, '') : null;
  const verified = repo?.accessStatus === 'verified';

  return (
    <section className="panel">
      <h2>Доступ до репозиторію</h2>
      <ProblemLine p={acc.problem} />

      <div className="card">
        <h3>Статус</h3>
        {repo === undefined && <p>Читаємо заявку…</p>}
        {repo === null && <p>Заявки на репозиторій немає - вкажіть репозиторій нижче.</p>}
        {repo && (
          <>
            <p>
              Репозиторій:{' '}
              <a href={repo.url} target="_blank" rel="noopener noreferrer">
                {repo.url}
              </a>
            </p>
            <p>
              Стан: <StatusBadge status={repo.accessStatus} />
            </p>
            {repo.verifiedElsewhere && (
              <p className="error">
                Цей репозиторій уже підтверджено за іншим акаунтом - ваша заявка підтвердитися не може. Перевірте .zoria і зверніться до організаторів.
              </p>
            )}
            {repo.reasonCode && repo.reasonCode !== 'organizer' && <p className="hint-box">{REASON_HINT[repo.reasonCode](login)}</p>}
            {repo.reason && (
              <p>
                {repo.reasonCode === 'organizer' ? 'Рішення організатора' : 'Пояснення сервера'}: {repo.reason}
              </p>
            )}
            {!repo.reason && repo.accessStatus === 'pending' && <p className="muted">Бот ще не бачив запрошення. Запросіть акаунт і покладіть .zoria.</p>}
            <p className="muted">
              Остання перевірка: <Time t={repo.checkedAt} empty="ще не було" />; зміна заявки: <Time t={repo.updatedAt} />. Бот перечитує .zoria
              не рідше ніж раз на 10 хвилин. <Zone />
            </p>
          </>
        )}
      </div>

      <div className="card">
        {verified ? (
          <>
            <h3>Усе зроблено</h3>
            <p className="ok">
              Запрошення прийнято, файл .zoria називає ваш акаунт. Робити нічого не треба - тільки тримати доступ до кінця конкурсу: репозиторій
              лишається приватним, запрошення не відкликати, .zoria не видаляти.
            </p>
          </>
        ) : (
          <h3>Що зробити</h3>
        )}
        <details open={!verified}>
          <summary>{verified ? 'Інструкція для довідки' : 'Кроки'}</summary>
        <ol className="steps">
          <li>
            Репозиторій має лишатися <strong>приватним</strong> до кінця конкурсу: не відкривати, не видаляти, не перейменовувати, не передавати.
          </li>
          <li>
            Запросіть до репозиторію GitHub-акаунт <strong>{bot}</strong> <CopyButton text={bot} />: GitHub → репозиторій → Settings → Collaborators →
            Add people.
            {access?.permission && <> Право: {access.permission}.</>}
            {slug && (
              <>
                {' '}
                <a href={`https://github.com/${slug}/settings/access`} target="_blank" rel="noopener noreferrer">
                  Відкрити налаштування доступу
                </a>
                .
              </>
            )}
          </li>
          <li>
            У корінь гілки за замовчуванням покладіть файл <code>.zoria</code>, перший рядок - ваш логін у мережі: <code>{login}</code>{' '}
            <CopyButton text={login} label="Копіювати логін" />
            <pre>
              <code>{`echo ${login} > .zoria\ngit add .zoria\ngit commit -m "Зоря.нет: логін у мережі"\ngit push`}</code>
            </pre>
          </li>
          {access?.instructions && <li>Від організаторів: {access.instructions}</li>}
          <li>За кілька хвилин статус стане «verified», прийде лист. Строк підтвердження - у календарі (2026-10-05 21:00).</li>
        </ol>
        </details>
        {!access &&<p className="muted">Акаунт для запрошення взято з ТЗ; /public/config ще не прочитано.</p>}
      </div>

      <div className="card">
        <h3>Змінити репозиторій</h3>
        <form
          className="form inline"
          onSubmit={async (ev) => {
            ev.preventDefault();
            const p = parseRepository(newUrl);
            if (!p.ok) {
              setUrlError(p.message);
              return;
            }
            setSaving(true);
            const r = await acc.changeRepository(p.slug);
            setSaving(false);
            if (r.ok) {
              setNewUrl('');
              setUrlError(undefined);
            } else setUrlError(r.message);
          }}
        >
          <Field label="Новий приватний репозиторій" error={urlError} hint="Статус скинеться в pending: знову запрошення і .zoria. Лише із сесії входу.">
            <input value={newUrl} onChange={(ev) => setNewUrl(ev.target.value)} placeholder="owner/repo" spellCheck={false} />
          </Field>
          <button type="submit" disabled={saving || !newUrl.trim()}>
            {saving ? 'Зберігаємо…' : 'Змінити'}
          </button>
        </form>
      </div>
    </section>
  );
}
