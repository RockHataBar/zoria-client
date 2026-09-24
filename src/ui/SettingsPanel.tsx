import { useState } from 'react';
import { useAccount } from '../app/account.tsx';
import { useApp } from '../app/context.tsx';
import { describeError } from '../core/api.ts';
import { FINGERPRINT_RE, normalizeBase, PRESETS, type ServerSetting } from '../core/config.ts';
import { Field, Time } from './common.tsx';

export function SettingsPanel() {
  const { server, setServer, session, api, authed, snap } = useApp();
  const acc = useAccount();
  const [custom, setCustom] = useState(server.id === 'custom' ? server.base : '');
  const [fp, setFp] = useState(server.fingerprint ?? '');
  const [err, setErr] = useState<string | undefined>();
  const [echo, setEcho] = useState('Зоря ✓');
  const [check, setCheck] = useState<string | null>(null);

  const choose = (s: ServerSetting) => {
    if (s.base !== server.base || s.fingerprint !== server.fingerprint) setServer(s);
  };

  return (
    <section className="panel">
      <h2>Налаштування</h2>

      <div className="card">
        <h3>Сервер</h3>
        <p>
          Зараз: <code>{server.base}</code>
        </p>
        <div className="actions">
          <button type="button" className={server.id === 'prod' ? 'primary' : ''} onClick={() => choose(PRESETS.prod)}>
            Бойовий сервер
          </button>
          <button type="button" className={server.id === 'stand' ? 'primary' : ''} onClick={() => choose(PRESETS.stand)}>
            Навчальний стенд
          </button>
        </div>
        <p className="muted">
          Стенд: коло щогодини за UTC - :00-:30 шум (з :20 провісник), :30-:50 просвіт, :50-:00 після. Навчальний код заявки - STAND-2026, база
          стирається щодня о 03:05 UTC. Сесія і заготовка зберігаються окремо для кожного сервера.
        </p>
        <form
          className="form"
          onSubmit={(ev) => {
            ev.preventDefault();
            const base = normalizeBase(custom);
            const f = fp.trim().toLowerCase();
            if (!base) return setErr('Потрібна адреса API, наприклад http://localhost:8787/api/v1');
            if (f && !FINGERPRINT_RE.test(f)) return setErr('Відбиток - 64 шістнадцяткові знаки (SHA-256 ключа).');
            setErr(undefined);
            choose({ id: 'custom', base, fingerprint: f || null });
          }}
        >
          <Field label="Інша адреса API" error={err}>
            <input value={custom} onChange={(ev) => setCustom(ev.target.value)} placeholder="http://localhost:8787/api/v1" spellCheck={false} />
          </Field>
          <Field label="Закріплений відбиток ключа печатки (необов'язково)" hint="Без відбитка ключ приймається, а відбиток показується для ручної звірки.">
            <input value={fp} onChange={(ev) => setFp(ev.target.value)} spellCheck={false} />
          </Field>
          <button type="submit">Застосувати</button>
        </form>
        <p className="muted">
          Ключ печатки: {snap.key ? <code className="wrap">{snap.key.fingerprint}</code> : snap.keyError ?? 'завантажується…'}
        </p>
      </div>

      {session && (
        <div className="card">
          <h3>Акаунт</h3>
          <p>
            {session.user.username} ({session.user.displayName}), зареєстровано <Time t={session.user.createdAt} />. Сесія діє до{' '}
            <Time t={session.expiresAt} />.
          </p>
          <Field label="Мова текстів сервера (листи, причини рішень)">
            <select value={acc.user?.lang ?? session.user.lang} onChange={(ev) => void acc.setLang(ev.target.value === 'en' ? 'en' : 'uk')}>
              <option value="uk">українська (uk)</option>
              <option value="en">English (en)</option>
            </select>
          </Field>
          <form
            className="form inline"
            onSubmit={async (ev) => {
              ev.preventDefault();
              const r = await authed((t) => api.developerCheck(t, echo));
              if (!r) setCheck('Потрібен вхід.');
              else if (r.kind === 'ok')
                setCheck(`OK: echo ${r.data.echo === echo ? 'збігся' : 'НЕ збігся'}, authenticated=${r.data.checks.authenticated}, utf8=${r.data.checks.utf8}`);
              else if (r.kind === 'error') setCheck(describeError(r.code, r.status));
              else setCheck(`Немає відповіді (${r.kind}${r.res.requestId ? `, X-Request-Id ${r.res.requestId}` : ''}).`);
            }}
          >
            <Field label="Перевірка обміну (POST /developer/check)">
              <input value={echo} onChange={(ev) => setEcho(ev.target.value)} />
            </Field>
            <button type="submit">Перевірити</button>
          </form>
          {check && <p>{check}</p>}
          <div className="actions">
            <button type="button" onClick={() => void acc.logout()}>
              Вийти (POST /auth/logout)
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
