import { useApp, useNow } from '../app/context.tsx';
import { earliestOpenMs, msUntilOpen, registrationOpen, serverNowMs, toLocalMs } from '../core/ether.ts';
import { silenceRemainingMs } from '../core/http.ts';
import { fmtDuration } from '../core/time.ts';
import { Time, Zone } from './common.tsx';

const PHASE_TEXT = {
  static: 'Шум (static): мережа мовчить під перешкодами, реєстрації немає',
  window: 'ПРОСВІТ (window): перешкод немає, реєстрація відкрита',
  after: 'Після просвіту (after): реєстрацію закрито, решта мережі працює',
} as const;

export function EtherPanel() {
  const { snap, server } = useApp();
  const now = useNow(1000);
  const s = snap.state;
  const untilOpen = msUntilOpen(s, now);
  const earliest = earliestOpenMs(s);
  const silence = silenceRemainingMs(server.base, now);
  const fragments = Object.entries(s.fragments).sort((a, b) => Number(a[0]) - Number(b[0]));

  return (
    <section className="panel">
      <h2>Ефір</h2>
      <div className={`phase phase-${s.phase ?? 'unknown'}`}>
        {s.phase ? PHASE_TEXT[s.phase] : 'Слухаємо ефір: ще не було жодного кадру з правильною печаткою'}
      </div>

      {snap.role === 'follower' && (
        <p className="muted">Ефір слухає інша вкладка цього браузера: ця отримує її кадри і сама перевіряє печатку. Ліміт ефіру - на адресу, тож слухач один.</p>
      )}
      {silence > 0 && (
        <p className="warn">Адресу заглушено (429 jammed): мовчимо ще {fmtDuration(silence)} - жодного запиту до кінця глушіння.</p>
      )}

      {s.phase === 'static' && s.harbinger && untilOpen !== null && (
        <div className="countdown">
          <div className="big">{untilOpen > 0 ? fmtDuration(untilOpen) : 'відкривається…'}</div>
          <div>
            до відкриття просвіту: <Time t={toLocalMs(s, s.harbinger.opensAtMs)} />
          </div>
          {s.harbinger.text && <blockquote className="voice">{s.harbinger.text.uk}</blockquote>}
        </div>
      )}
      {s.phase === 'static' && !s.harbinger && earliest !== null && (
        <p>
          Провісника немає: найближчі 6 год просвіту не буде. Найраніше відкриття - не раніше{' '}
          <Time t={toLocalMs(s, earliest)} />. Провісник з'явиться в кадрах за 6 год до відкриття.
        </p>
      )}
      {s.window && (
        <p>
          Просвіт: з <Time t={s.window.opensAt} /> до <Time t={s.window.closesAt} />
          {s.phase === 'window' && <> (лишилось {fmtDuration(Date.parse(s.window.closesAt) - serverNowMs(s, now))})</>}.
        </p>
      )}
      {registrationOpen(s) && s.phase !== 'window' && <p>Розібраний /public/config каже: реєстрація відкрита.</p>}

      <dl className="facts">
        <dt>Останній перевірений кадр</dt>
        <dd>
          <Time t={s.lastAt} empty="ще не було" />
        </dd>
        <dt>У журналі виходу на зв'язок</dt>
        <dd>{s.onAir ?? '—'}</dd>
        <dt>Кадрів з печаткою / ехо</dt>
        <dd>
          {s.counts.signal} / {s.counts.echo}
        </dd>
        <dt>Перешкоди: підробки / биті / чужий код / збої</dt>
        <dd>
          {s.counts.forged} / {s.counts.broken} / {s.counts.foreign} / {s.counts.failure}
        </dd>
        <dt>Останній запит /ether</dt>
        <dd>
          {snap.last ? (
            <>
              <Time t={snap.last.at} /> - {snap.last.outcome === 'signal' ? 'кадр із печаткою' : snap.last.outcome === 'noise' ? 'перешкода' : snap.last.outcome === 'jammed' ? '429, мовчимо' : 'збій, повтор із паузою'}
              {snap.last.status ? ` (HTTP ${snap.last.status})` : ''}
            </>
          ) : (
            '—'
          )}
        </dd>
        <dt>Поправка годинника (сервер − пристрій)</dt>
        <dd>{s.offsetSamples.length ? `${Math.round(serverNowMs(s, now) - now) / 1000} с` : '—'}</dd>
        <dt>Ключ печатки</dt>
        <dd>
          {snap.key ? (
            <>
              <code>{snap.key.keyId}</code>, відбиток <code className="wrap">{snap.key.fingerprint}</code>
              {server.fingerprint ? ' - збігається з закріпленим' : ' - звірте вручну'}
            </>
          ) : (
            <span className="error">{snap.keyError ?? 'завантажується…'}</span>
          )}
        </dd>
      </dl>
      <p className="muted">
        Опитування: /ether не частіше ніж раз на 15 с, журнал - не частіше ніж раз на хвилину. Фаза і відлік беруться тільки з кадрів із правильною
        печаткою Ed25519 і з найбільшим часом кадру; старі кадри (ехо, затримка) стан не відкочують. <Zone />
      </p>

      {fragments.length > 0 && (
        <>
          <h3>
            Уривки листа Доглядача ({fragments.length}
            {s.fragmentsOf ? ` з ${s.fragmentsOf}` : ''})
          </h3>
          <ol className="fragments">
            {Array.from({ length: s.fragmentsOf ?? Math.max(...fragments.map(([n]) => Number(n))) }, (_, i) => {
              const text = s.fragments[String(i + 1)];
              return (
                <li key={i} className={text ? '' : 'missing'}>
                  {text ?? '…'}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
