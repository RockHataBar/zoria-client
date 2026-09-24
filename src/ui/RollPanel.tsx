import { useEffect } from 'react';
import { useApp } from '../app/context.tsx';
import { Time, Zone } from './common.tsx';

function sinceOpen(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h ? `${h} год ` : ''}${m ? `${m} хв ` : ''}${s} с`;
}

/** Журнал виходу на зв'язок (CL-34): /ether/roll не частіше ніж раз на хвилину, поки вкладка відкрита. */
export function RollPanel() {
  const { ether, snap, session } = useApp();
  useEffect(() => {
    ether.wantRoll(true);
    return () => ether.wantRoll(false);
  }, [ether]);

  const roll = snap.state.roll;
  const me = session?.user.displayName;
  return (
    <section className="panel">
      <h2>Журнал виходу на зв'язок</h2>
      <p className="muted">
        Оновлюється не частіше ніж раз на хвилину, тільки з кадрів із правильною печаткою. Логін і репозиторій до журналу не входять - тільки
        відображуване ім'я. <Zone />
      </p>
      {snap.state.rollAt && (
        <p className="meta">
          Кадр журналу від <Time t={snap.state.rollAt} />, записів: {roll?.length ?? 0}
        </p>
      )}
      {!roll && <p>Чекаємо кадр журналу…</p>}
      {roll && roll.length === 0 && <p>Журнал порожній.</p>}
      {roll && roll.length > 0 && (
        <table className="roll">
          <thead>
            <tr>
              <th>№</th>
              <th>Час</th>
              <th>Від відкриття</th>
              <th>Ім'я</th>
            </tr>
          </thead>
          <tbody>
            {roll.map((e) => (
              <tr key={e.n} className={me && e.name === me ? 'me' : ''}>
                <td>{e.n}</td>
                <td>
                  <Time t={e.at} />
                </td>
                <td>{sinceOpen(e.sinceOpen)}</td>
                <td>
                  {e.name}
                  {me && e.name === me ? ' ← ви' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
