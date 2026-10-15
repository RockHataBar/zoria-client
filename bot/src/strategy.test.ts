import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '@zoria/engine';
import { ARCHETYPES, runPack } from '@zoria/sdk';
import type { PackSeat } from '@zoria/sdk';
import { NAKAZ_SAMPLES, createNakazSparring } from '@zoria/sdk/nakaz';
import type { SampleName } from '@zoria/sdk/nakaz';
import { createStrategy, presets } from './strategy.js';

function seat(name: string): PackSeat {
  if (name.startsWith('@')) return { bot: () => createStrategy(name.slice(1)) };
  if (name.startsWith('%')) return { bot: () => createNakazSparring(NAKAZ_SAMPLES[name.slice(1) as SampleName]) };
  return { style: ARCHETYPES[name]! };
}

interface Case {
  cast: [string, string, string];
  seed: number;
  shares: [number, number, number];
  score: number[][];
}

const CASES: Case[] = [
  {
    cast: ['@warden', 'обхідник', 'рівний'],
    seed: 2026,
    shares: [9, 5, 4],
    score: [
      [527.2302, 24.495, 147.1879],
      [31.1142, 559.5272, 178.2457],
      [51.7844, 39.5371, 641.7887],
    ],
  },
  {
    cast: ['@sentinel', 'проривник', 'облягач'],
    seed: 2027,
    shares: [9, 5, 4],
    score: [
      [339.7851, 104.1849, 108.9991],
      [29.2459, 477.5041, 184.1565],
      [100.6057, 70.309, 419.2309],
    ],
  },
  {
    cast: ['@expansion', 'шир', 'рівний'],
    seed: 2028,
    shares: [9, 5, 4],
    score: [
      [541.9635, 133.8099, 133.0762],
      [104.5019, 457.9247, 175.6674],
      [157.6785, 162.2061, 375.4062],
    ],
  },
  {
    cast: ['@guard', '@swarm', '@raider'],
    seed: 2029,
    shares: [5, 8, 5],
    score: [
      [106.4445, 343.7435, 299.8473],
      [35.0002, 387.2015, 336.4102],
      [410.4883, 276.7217, 51.6929],
    ],
  },
  {
    cast: ['@warden', '%тиск', '%замовлення'],
    seed: 2030,
    shares: [9, 6, 3],
    score: [
      [498.5308, 227.2412, 87.9486],
      [122.6912, 350.3713, 246.7428],
      [163.5535, 134.1236, 486.78],
    ],
  },
  {
    cast: ['@raider', 'облягач', 'шир'],
    seed: 2032,
    shares: [9, 5, 4],
    score: [
      [569.1615, 44.4514, 45.7391],
      [50.8026, 567.5156, 57.7265],
      [48.9553, 27.4247, 584.0883],
    ],
  },
  {
    cast: ['@swarm', '%економка', '%хвилини'],
    seed: 2033,
    shares: [8, 3, 7],
    score: [
      [422.7003, 42.5469, 166.6213],
      [256.7329, 235.4184, 140.1091],
      [52.841, 195.9003, 403.2958],
    ],
  },
  {
    cast: ['@warden', '@sentinel', '@expansion'],
    seed: 2034,
    shares: [8, 6, 4],
    score: [
      [559.5335, 36.0517, 256.1006],
      [63.8365, 403.3245, 366.8462],
      [457.618, 32.9528, 387.4465],
    ],
  },
];

for (const c of CASES) {
  test(`пакет ${c.cast.join(' / ')}, жереб ${c.seed}`, () => {
    const pack = runPack(createEngine, { seed: c.seed, ticks: 1200, cast: [seat(c.cast[0]), seat(c.cast[1]), seat(c.cast[2])] });
    const score = pack.matches.map((m) => (['A', 'B', 'C'] as const).map((s) => Number(m.score[s].toFixed(4))));
    assert.deepEqual(pack.shares, c.shares);
    assert.deepEqual(score, c.score);
  });
}

test('пресети: warden першим, шість штук', () => {
  assert.deepEqual(presets(), ['warden', 'sentinel', 'raider', 'swarm', 'guard', 'expansion']);
});

test('невідомий пресет грає як warden', () => {
  const run = (p: string | undefined) =>
    runPack(createEngine, { seed: 2031, ticks: 300, cast: [{ bot: () => createStrategy(p) }, { style: ARCHETYPES['рівний']! }, { style: ARCHETYPES['обхідник']! }] }).matches.map((m) => m.score);
  assert.deepEqual(run('немає-такого'), run('warden'));
  assert.deepEqual(run(undefined), run('warden'));
});
