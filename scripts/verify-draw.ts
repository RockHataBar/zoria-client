// Перевірка жеребкування своїми руками (оцінювання, додаток А).
//
//   node scripts/verify-draw.ts --draw <draw.json або адреса> --me <логін> [--commit <hex>] [--round <номер>]
//
// Вихід 0 - усе зійшлося, 1 - ні.
import { readFileSync } from 'node:fs';
import { acceptKey, checkEnvelope } from '../src/core/seal.ts';
import { PRESETS } from '../src/core/config.ts';
import { byCodePoint, COMMIT, commitOf, DRAND_CHAIN, DRAND_ROUND, fromHex, permute, randomnessOf, saltOf } from './draw.ts';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

let failed = false;
const ok = (cond: boolean, what: string, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${what}${detail ? ` - ${detail}` : ''}`);
  if (!cond) failed = true;
  return cond;
};

/** Пошук поля за кількома можливими назвами на будь-якій глибині. */
function find(obj: unknown, names: string[]): unknown {
  if (obj === null || typeof obj !== 'object') return undefined;
  for (const n of names) if (n in (obj as Record<string, unknown>)) return (obj as Record<string, unknown>)[n];
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const r = find(v, names);
    if (r !== undefined) return r;
  }
  return undefined;
}

const loginOf = (e: unknown): string =>
  typeof e === 'string' ? e : String((e as Record<string, unknown>)?.login ?? (e as Record<string, unknown>)?.username ?? (e as Record<string, unknown>)?.name ?? '');

async function drandRound(round: number): Promise<{ randomness: string; signature: string } | null> {
  const hosts = ['https://api.drand.sh', 'https://drand.cloudflare.com', 'https://api2.drand.sh', 'https://api3.drand.sh'];
  const got: { host: string; randomness: string; signature: string }[] = [];
  for (const h of hosts) {
    try {
      const r = await fetch(`${h}/${DRAND_CHAIN}/public/${round}`);
      if (!r.ok) continue;
      const j = (await r.json()) as { round: number; randomness: string; signature: string };
      if (j.round === round) got.push({ host: h, randomness: j.randomness, signature: j.signature });
    } catch {
      /* дзеркало недоступне */
    }
    if (got.length >= 2) break;
  }
  if (!ok(got.length >= 2, 'раунд drand отримано з двох адрес', got.map((g) => new URL(g.host).host).join(', '))) return got[0] ?? null;
  ok(got.every((g) => g.randomness === got[0].randomness && g.signature === got[0].signature), 'адреси drand віддали те саме');
  ok(randomnessOf(got[0].signature) === got[0].randomness, 'правило маяка: randomness = SHA-256(signature)');
  return got[0];
}

async function rollCount(): Promise<number | null> {
  const base = PRESETS.prod.base;
  try {
    const key = await acceptKey(await (await fetch(base + '/ether/key')).json(), PRESETS.prod.fingerprint);
    const c = await checkEnvelope(await (await fetch(base + '/ether/roll')).json(), new Map([[key.keyId, key]]));
    if (c.kind !== 'signal' || !c.frame.roll) return null;
    return Math.max(0, ...c.frame.roll.map((e) => e.n));
  } catch {
    return null;
  }
}

async function main() {
  const src = opt('draw');
  if (!src) {
    console.log('node scripts/verify-draw.ts --draw <draw.json або адреса> --me <логін> [--commit <hex>] [--round <номер>]');
    process.exit(2);
  }
  const draw: unknown = /^https?:\/\//.test(src) ? await (await fetch(src)).json() : JSON.parse(readFileSync(src, 'utf8'));
  const commit = (opt('commit') ?? COMMIT).toLowerCase();

  // А.0 зобов'язання
  const secretHex = String(find(draw, ['secret', 'revealedSecret', 'secretHex']) ?? '');
  const secret = fromHex(secretHex, 32);
  ok(commitOf(secret) === commit, "SHA-256(секрет) збігається із зобов'язанням від 2026-09-21", commit.slice(0, 16) + '…');
  const pubCommit = find(draw, ['commit', 'commitment']);
  if (typeof pubCommit === 'string') ok(pubCommit.toLowerCase() === commit, "зобов'язання в draw.json - те саме");

  // А.0 маяк і сіль
  const round = Number(opt('round') ?? find(draw, ['round', 'drandRound']) ?? DRAND_ROUND);
  if (round === DRAND_ROUND) ok(true, `раунд drand ${round} - оголошений`);
  else if (opt('round') !== undefined) console.log(`! раунд drand ${round} замість оголошеного ${DRAND_ROUND} - чинний, лише якщо його назвала новина про подовження просвіту`);
  else ok(false, `раунд drand ${round}`, `оголошено ${DRAND_ROUND}; інший раунд - тільки за новиною про подовження`);
  const beacon = await drandRound(round);
  if (!beacon) return finish();
  const pubRandomness = find(draw, ['randomness']);
  if (typeof pubRandomness === 'string') ok(pubRandomness.toLowerCase() === beacon.randomness, 'randomness у draw.json = значення маяка');
  const salt = saltOf(secret, fromHex(beacon.randomness, 32));
  const pubSalt = find(draw, ['salt']);
  ok(typeof pubSalt === 'string' && pubSalt.toLowerCase() === salt, 'сіль перераховано і вона збігається', salt.slice(0, 16) + '…');

  // А.1 вхід
  const rawList = find(draw, ['registered', 'logins', 'participants', 'input', 'list']);
  const list = Array.isArray(rawList) ? rawList.map(loginOf) : [];
  const sorted = [...list].sort(byCodePoint);
  ok(list.length > 0, `список зареєстрованих: ${list.length}`);
  ok(new Set(list).size === list.length, 'без дублів');
  const inputIsSorted = list.every((l, i) => l === sorted[i]);
  console.log(`  (список у draw.json ${inputIsSorted ? 'вже' : 'не'} відсортовано за кодовими точками)`);
  const onAir = await rollCount();
  if (onAir !== null) ok(onAir === list.length, `число зареєстрованих = останній номер журналу (${onAir})`);

  // А.4 перестановка
  const perm = permute(sorted, salt);
  const rawPerm = find(draw, ['permutation', 'order', 'shuffled', 'draw']);
  const pubPerm = Array.isArray(rawPerm) ? rawPerm.map(loginOf) : null;
  if (pubPerm) ok(pubPerm.length === perm.length && pubPerm.every((l, i) => l === perm[i]), 'перестановку перераховано і вона збігається з опублікованою');
  else console.log('  (перестановки в draw.json не знайдено - показую перераховану)');

  const me = opt('me')?.toLowerCase();
  if (me) {
    const pos = perm.indexOf(me);
    if (ok(pos >= 0, `логін ${me} є серед зареєстрованих`)) {
      console.log(`\nВаше місце в жеребі: ${pos + 1} з ${perm.length} (індекс ${pos} від нуля).`);
      console.log('Групи ріжуться з цієї перестановки 2026-10-11: викреслюють тих, хто не пройшов допуск, далі підряд дев\'ятками, потім сімками.');
    }
  }
  finish();
}

function finish(): never {
  console.log(failed ? '\nНЕ ЗІЙШЛОСЯ' : '\nУСЕ ЗІЙШЛОСЯ');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
