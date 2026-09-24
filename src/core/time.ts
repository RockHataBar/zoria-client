// Час: сервер приймає і віддає тільки UTC; клієнт показує місцеву зону пристрою і називає її (CL-38).

export function zoneName(date = new Date()): string {
  let tz = 'місцевий час';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz;
  } catch {
    /* немає Intl - лишаємо загальну назву */
  }
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const h = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
  const m = String(Math.abs(off) % 60).padStart(2, '0');
  return `${tz}, UTC${sign}${h}:${m}`;
}

const dtf = new Intl.DateTimeFormat('uk-UA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** Місцевий час для показу; порожній рядок, якщо часу немає. */
export function fmtLocal(t: string | number | null | undefined): string {
  if (t === null || t === undefined || t === '') return '';
  const d = typeof t === 'number' ? new Date(t) : new Date(t);
  if (!Number.isFinite(d.getTime())) return '';
  return dtf.format(d);
}

export function fmtDuration(ms: number): string {
  const neg = ms < 0;
  let s = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const parts = [d ? `${d} д` : '', d || h ? `${h} год` : '', `${String(m).padStart(2, '0')} хв`, `${String(s).padStart(2, '0')} с`];
  return (neg ? '−' : '') + parts.filter(Boolean).join(' ');
}
