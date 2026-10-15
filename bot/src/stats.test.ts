import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thinkStats } from './stats.js';

test('thinkStats: порожньо - нулі', () => {
  assert.deepEqual(thinkStats([]), { p50: '0', p99: '0', max: '0' });
});

test('thinkStats: перцентилі за відсортованим, один знак', () => {
  const xs = Array.from({ length: 200 }, (_, i) => 200 - i);
  assert.deepEqual(thinkStats(xs), { p50: '101.0', p99: '199.0', max: '200.0' });
});

test('thinkStats: малий набір і дробові значення', () => {
  assert.deepEqual(thinkStats([5, 1.26, 3, 2, 4]), { p50: '3.0', p99: '5.0', max: '5.0' });
  assert.deepEqual(thinkStats([0.25]), { p50: '0.3', p99: '0.3', max: '0.3' });
  assert.deepEqual(thinkStats([9, 1, 4, 7]), { p50: '7.0', p99: '9.0', max: '9.0' });
});

test('thinkStats: вхід не змінюється', () => {
  const xs = [3, 1, 2];
  thinkStats(xs);
  assert.deepEqual(xs, [3, 1, 2]);
});
