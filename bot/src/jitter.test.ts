import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backoffMs, retryable, withJitter } from './jitter.js';

test('backoffMs: стеля росте вдвічі від третини стелі', () => {
  const top = (): number => 0.999999;
  assert.equal(backoffMs(0, 3000, top), 999);
  assert.equal(backoffMs(1, 3000, top), 1999);
  assert.equal(backoffMs(2, 3000, top), 2999);
  assert.equal(backoffMs(5, 3000, top), 2999);
  assert.equal(backoffMs(3, 3000, () => 0), 0);
  assert.equal(backoffMs(1, 3000, () => 0.5), 1000);
});

test('backoffMs: база не менша за 1', () => {
  assert.equal(backoffMs(0, 1, () => 0.999), 0);
  assert.equal(backoffMs(1, 3, () => 0.999), 1);
  assert.equal(backoffMs(2, 9, () => 0.5), 4);
});

test('backoffMs: без rnd лишається в межах', () => {
  for (let i = 0; i < 50; i++) {
    const v = backoffMs(1, 3000);
    assert.ok(v >= 0 && v < 2000, String(v));
    assert.equal(v, Math.floor(v));
  }
});

test('retryable: лише мережа і коди транспорту', () => {
  assert.equal(retryable(new Error('wire did not come up: ECONNREFUSED')), true);
  assert.equal(retryable(new Error('wire closed before the oath, code 1006')), true);
  assert.equal(retryable(new Error('wire closed before the oath, code 3999')), true);
  assert.equal(retryable(new Error('wire closed before the oath, code 4000')), false);
  assert.equal(retryable(new Error('wire closed before the oath, code 4403')), false);
  assert.equal(retryable(new Error('engine hash mismatch')), false);
  assert.equal(retryable('wire did not come up'), true);
  assert.equal(retryable('something else'), false);
});

const netErr = (): Error => new Error('wire did not come up');

test('withJitter: успіх з першої спроби без пауз', async () => {
  const waits: number[] = [];
  let calls = 0;
  const v = await withJitter({ tries: 3, ceilMs: 3000, rnd: () => 0.5, sleep: async (ms) => void waits.push(ms) }, async () => {
    calls++;
    return 42;
  });
  assert.equal(v, 42);
  assert.equal(calls, 1);
  assert.deepEqual(waits, []);
});

test('withJitter: повтори з паузами за законом і onRetry', async () => {
  const waits: number[] = [];
  const retries: [number, number][] = [];
  let calls = 0;
  const v = await withJitter(
    {
      tries: 5,
      ceilMs: 3000,
      rnd: () => 0.5,
      sleep: async (ms) => void waits.push(ms),
      onRetry: (n, ms) => void retries.push([n, ms]),
    },
    async () => {
      calls++;
      if (calls < 3) throw netErr();
      return 'ok';
    },
  );
  assert.equal(v, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [500, 1000]);
  assert.deepEqual(retries, [
    [1, 500],
    [2, 1000],
  ]);
});

test('withJitter: неповторювану помилку кидає одразу', async () => {
  let calls = 0;
  const waits: number[] = [];
  await assert.rejects(
    withJitter({ tries: 5, ceilMs: 3000, sleep: async (ms) => void waits.push(ms) }, async () => {
      calls++;
      throw new Error('wire closed before the oath, code 4401');
    }),
    /code 4401/,
  );
  assert.equal(calls, 1);
  assert.deepEqual(waits, []);
});

test('withJitter: після tries спроб кидає останню помилку', async () => {
  let calls = 0;
  const waits: number[] = [];
  await assert.rejects(
    withJitter({ tries: 2, ceilMs: 3000, rnd: () => 0, sleep: async (ms) => void waits.push(ms) }, async () => {
      calls++;
      throw netErr();
    }),
    /did not come up/,
  );
  assert.equal(calls, 2);
  assert.deepEqual(waits, [0]);
});

test('withJitter: типова пауза справді чекає', async () => {
  let calls = 0;
  const t0 = Date.now();
  const v = await withJitter({ tries: 2, ceilMs: 90, rnd: () => 0.999 }, async () => {
    calls++;
    if (calls === 1) throw netErr();
    return 1;
  });
  assert.equal(v, 1);
  assert.ok(Date.now() - t0 >= 25);
});
