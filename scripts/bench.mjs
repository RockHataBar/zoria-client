import { createEngine } from '@zoria/engine';
import { ARCHETYPES, runPack } from '@zoria/sdk';
import { createStrategy } from './dist/strategy.js';

const rivals = process.argv[2] ? process.argv[2].split(',') : ['обхідник', 'рівний'];
const seeds = Number(process.argv[3] ?? 8);
let mine = 0, a = 0, b = 0, wins = 0, games = 0, minesMin = 0, foeMin = 0;
for (let s = 0; s < seeds; s++) {
  const seed = 2026 + s;
  const pack = runPack(createEngine, {
    seed, ticks: 1200,
    cast: [{ bot: () => createStrategy() }, { style: ARCHETYPES[rivals[0]] }, { style: ARCHETYPES[rivals[1]] }],
  });
  mine += pack.shares[0]; a += pack.shares[1]; b += pack.shares[2];
  for (const m of pack.matches) {
    games++;
    const sc = m.score;
    if (sc[0] >= sc[1] && sc[0] >= sc[2]) wins++;
    minesMin += sc[0]; foeMin += Math.max(sc[1], sc[2]);
  }
}
const max = seeds * 9;
console.log(`сідів ${seeds}  доли: мій ${mine}/${max}  ${rivals[0]} ${a}  ${rivals[1]} ${b}`);
console.log(`партій ${games}  перемог мого ${wins}  сер.хвилини мій ${(minesMin/games).toFixed(1)}  найкращий суперник ${(foeMin/games).toFixed(1)}`);
