import { useApp, useNow } from '../app/context.tsx';
import { useRegistration } from '../app/registration.tsx';
import { msUntilOpen, registrationOpen, toLocalMs } from '../core/ether.ts';
import { fmtDuration } from '../core/time.ts';
import { normalizeUsername, parseRepository } from '../core/validate.ts';
import { Field, Time } from './common.tsx';

export function RegisterPanel() {
  const { snap, session, setTab } = useApp();
  const reg = useRegistration();
  const now = useNow(1000);
  const open = registrationOpen(snap.state);
  const { draft, fieldErrors: e } = reg;
  const repo = parseRepository(draft.repositoryUrl);
  const untilOpen = msUntilOpen(snap.state, now);

  if (session) {
    return (
      <section className="panel">
        <h2>Реєстрація</h2>
        <p className="ok">
          Ви в мережі як <strong>{session.user.username}</strong> ({session.user.displayName}). Реєстрація потрібна один раз.
        </p>
        <button type="button" onClick={() => setTab('access')}>
          Далі: запрошення і файл .zoria
        </button>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Реєстрація в просвіт</h2>
      <p>
        Акаунт створюється тільки в просвіт, кодом заявки з листа від <code>watching@zoria.net</code> або з бота <code>@zoria_net_bot</code>. Заготуйте
        заявку заздалегідь - клієнт надішле її сам за першим перевіреним кадром просвіту. Якщо ви вже зареєструвалися (наприклад, скриптом{' '}
        <code>npm run watch</code>), просто увійдіть.
      </p>
      <div className={`phase phase-${snap.state.phase ?? 'unknown'} small`}>
        {open
          ? 'Просвіт відкрито: реєстрацію можна надсилати.'
          : snap.state.phase === 'after'
            ? 'Просвіт минув: реєстрацію закрито.'
            : untilOpen !== null
              ? `До просвіту ${fmtDuration(untilOpen)} (відкриття ${new Date(toLocalMs(snap.state, snap.state.harbinger!.opensAtMs)).toLocaleString('uk-UA')}).`
              : 'Просвіт ще не відкрито. Надсилання ввімкнеться за першим перевіреним кадром phase: "window".'}
      </div>

      <form
        className="form"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (open) reg.sendNow();
          else reg.arm();
        }}
        autoComplete="on"
      >
        <Field label="Логін у мережі" error={e.username} hint="3-32 знаки: латинська літера, далі латинські літери, цифри, _ і -. Його ж пишуть у файл .zoria.">
          <input
            name="username"
            autoComplete="username"
            value={draft.username}
            onChange={(ev) => reg.setDraft({ username: ev.target.value })}
            spellCheck={false}
            autoCapitalize="none"
          />
        </Field>
        <Field label="Відображуване ім'я" error={e.displayName} hint="Увага: відображуване ім'я бачать усі в журналі виходу на зв'язок. 1-80 знаків, будь-яке письмо.">
          <input name="displayName" value={draft.displayName} onChange={(ev) => reg.setDraft({ displayName: ev.target.value })} />
        </Field>
        <Field label="Пароль" error={e.password} hint="12-256 знаків. Зміни і відновлення пароля немає - збережіть його в менеджері паролів.">
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            value={draft.password}
            onChange={(ev) => reg.setDraft({ password: ev.target.value })}
          />
        </Field>
        <Field label="Код заявки (invitation)" error={e.invitation} hint="Одноразовий і лише ваш: не передавайте його нікому.">
          <input
            name="invitation"
            autoComplete="off"
            spellCheck={false}
            value={draft.invitation}
            onChange={(ev) => reg.setDraft({ invitation: ev.target.value })}
          />
        </Field>
        <Field
          label="Ваш приватний репозиторій на GitHub"
          error={e.repositoryUrl}
          hint={
            <>
              <code>owner/repo</code> або адреса на github.com. Репозиторій має бути <strong>приватним</strong>: у відкритий бот допуску не заходить.
              {repo.ok && (
                <>
                  {' '}
                  Буде надіслано: <code>{repo.slug}</code>.
                </>
              )}
            </>
          }
        >
          <input
            name="repositoryUrl"
            spellCheck={false}
            autoCapitalize="none"
            value={draft.repositoryUrl}
            onChange={(ev) => reg.setDraft({ repositoryUrl: ev.target.value })}
            placeholder="owner/repo"
          />
        </Field>
        <Field label="Мова текстів сервера" hint="Цією мовою приходять сповіщення сервера і причини рішень щодо репозиторію.">
          <select value={draft.lang} onChange={(ev) => reg.setDraft({ lang: ev.target.value === 'en' ? 'en' : 'uk' })}>
            <option value="uk">українська (uk)</option>
            <option value="en">English (en)</option>
          </select>
        </Field>

        <label className="check">
          <input type="checkbox" checked={reg.remember} onChange={(ev) => reg.setRemember(ev.target.checked)} />
          Зберегти пароль і код на цьому пристрої (у сховищі браузера), щоб автонадсилання пережило перезавантаження сторінки. Інакше вони
          живуть тільки в пам'яті цієї вкладки.
        </label>

        <div className="actions">
          {open ? (
            <button type="submit" className="primary" disabled={reg.running}>
              {reg.running ? 'Надсилаємо…' : 'Зареєструватися зараз'}
            </button>
          ) : reg.armed ? (
            <button type="button" onClick={reg.disarm}>
              Скасувати автонадсилання
            </button>
          ) : (
            <button type="submit" className="primary" disabled={snap.state.phase === 'after'}>
              Заготовити: надіслати автоматично в просвіт
            </button>
          )}
          {reg.running && (
            <button type="button" onClick={reg.cancel}>
              Зупинити
            </button>
          )}
        </div>
        {reg.armed && !open && (
          <p className="ok">
            Заявку заготовлено для логіна <strong>{normalizeUsername(draft.username)}</strong>. Тримайте цю вкладку відкритою і комп'ютер увімкненим:
            клієнт слухає ефір і надішле заявку сам.
            {!reg.remember && ' Пароль і код - тільки в пам\'яті вкладки: після перезавантаження заготовку треба ввімкнути знову.'}
          </p>
        )}
      </form>

      {reg.steps.length > 0 && (
        <div className="log">
          <h3>Хід реєстрації</h3>
          <ul>
            {reg.steps.map((st, i) => (
              <li key={i}>
                <Time t={st.at} /> {st.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      {reg.outcome?.kind === 'error' && (
        <p className="error">
          {reg.outcome.message}
          {reg.outcome.requestId && (
            <>
              {' '}
              X-Request-Id: <code>{reg.outcome.requestId}</code>
            </>
          )}
        </p>
      )}
      {reg.outcome?.kind === 'field-error' && !reg.outcome.field && <p className="error">{reg.outcome.message}</p>}
    </section>
  );
}
