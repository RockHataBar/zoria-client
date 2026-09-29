import { createEngine } from '@zoria/engine';
import { ARCHETYPES, runPack } from '@zoria/sdk';
import { createStrategy } from './dist/strategy.js';

const rivals = process.argv[2] ? process.argv[2].split(',') : ['обхідник', 'рівний'];
const seeds = Number(process.argv[3] || 8);
const preset = process.argv[4] && process.argv[4] !== '-' ? process.argv[4] : undefined;
const verbose = process.argv[5] === 'v';
const first = Number(process.argv[6] || 2026);

async function seat(name) {
  if (name.startsWith('@')) return { bot: () => createStrategy(name.slice(1)) };
  if (name.startsWith('^')) {
    const [dir, p] = name.slice(1).split(':');
    const mod = await import(`./${dir}/dist/strategy.js`);
    return { bot: () => mod.createStrategy(p) };
  }
  return { style: ARCHETYPES[name] };
}

const cast = [{ bot: () => createStrategy(preset) }, await seat(rivals[0]), await seat(rivals[1])];
let mine = 0, a = 0, b = 0;
const sum = [0, 0, 0];
const t0 = Date.now();
for (let s = 0; s < seeds; s++) {
  const seed = first + s;
  const pack = runPack(createEngine, { seed, ticks: 1200, cast });
  mine += pack.shares[0]; a += pack.shares[1]; b += pack.shares[2];
  pack.matches.forEach((m, i) => {
    const slots = ['A', 'B', 'C'];
    for (let p = 0; p < 3; p++) sum[p] += m.score[slots[(p + i) % 3]];
  });
  if (verbose) {
    console.log(seed, 'частки', JSON.stringify(pack.shares));
    for (const m of pack.matches) {
      console.log('  ', JSON.stringify({ score: m.score, breakdown: m.breakdown, needles: m.needles, lit: m.lit, energy: m.energy }));
    }
  }
}
const g = seeds * 3;
console.log(`пресет ${preset ?? 'типовий'}  сідів ${seeds}  доли: мій ${mine}/${seeds * 9}  ${rivals[0]} ${a}  ${rivals[1]} ${b}  | сер. рахунок ${(sum[0] / g).toFixed(0)} / ${(sum[1] / g).toFixed(0)} / ${(sum[2] / g).toFixed(0)}  (${((Date.now() - t0) / 1000).toFixed(0)} с)`);
