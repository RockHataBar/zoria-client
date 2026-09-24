import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app/context.tsx';
import { describeError } from '../core/api.ts';
import { retryAfterFor, sleep } from '../core/http.ts';
import { checkPassword, checkUsername, normalizeUsername } from '../core/validate.ts';
import { Field } from './common.tsx';

/** Вхід поверх поточного екрана: після входу учасник на тому самому екрані з введеним (CL-21). */
export function LoginModal() {
  const { login, closeLogin, api, setSession, session } = useApp();
  const [username, setUsername] = useState(session?.user.username ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (login.open) first.current?.focus();
  }, [login.open]);

  if (!login.open) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="login-title">
      <form
        className="modal form"
        onSubmit={async (ev) => {
          ev.preventDefault();
          const e = checkUsername(username) ?? checkPassword(password);
          if (e) return setError(e);
          setBusy(true);
          setError(null);
          for (let attempt = 0; attempt < 5; attempt++) {
            const r = await api.login(normalizeUsername(username), password);
            if (r.kind === 'ok') {
              setSession(r.data);
              setPassword('');
              setBusy(false);
              closeLogin();
              return;
            }
            if (r.kind === 'error' && r.status === 429) {
              const s = retryAfterFor(r.res);
              setError(`${describeError(r.code, 429)} Повтор через ${s} с.`);
              await sleep(s * 1000);
              continue;
            }
            if (r.kind === 'error') setError(describeError(r.code, r.status));
            else setError(`Відповіді не отримано (${r.res.failure ?? r.res.status}${r.res.requestId ? `, X-Request-Id ${r.res.requestId}` : ''}). Спробуйте ще раз.`);
            break;
          }
          setBusy(false);
        }}
      >
        <h2 id="login-title">Вхід у мережу</h2>
        {login.reason && <p className="warn">{login.reason}</p>}
        <Field label="Логін">
          <input ref={first} autoComplete="username" value={username} onChange={(ev) => setUsername(ev.target.value)} spellCheck={false} autoCapitalize="none" />
        </Field>
        <Field label="Пароль">
          <input type="password" autoComplete="current-password" value={password} onChange={(ev) => setPassword(ev.target.value)} />
        </Field>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Входимо…' : 'Увійти'}
          </button>
          <button type="button" onClick={closeLogin}>
            Скасувати
          </button>
        </div>
      </form>
    </div>
  );
}
