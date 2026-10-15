import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Refusal, statusServer } from './status.js';
import type { Head, HeadState } from './status.js';

const STATE: HeadState = {
  state: 'live',
  slot: 'B',
  preset: 'warden',
  presets: ['warden', 'swarm'],
  freeze: false,
  tick: 120,
  frames: 119,
  ticks: 1200,
  why: '',
  engine: 'e',
  uptimeMs: 5,
  stats: { ticks: 119, orders: 300, nacks: 2, bytesIn: 10, bytesOut: 20, resyncMs: 0, resumes: 0, faults: 0, deferred: 0, lastTickAt: 1 },
  belief: { frames: 3, ageMs: 7 },
};

let promoted: unknown[] = [];
let mode: 'ok' | 'refuse' | 'crash' = 'ok';

const head: Head = {
  state: () => STATE,
  promote: (p) => {
    promoted.push(p);
    if (mode === 'refuse') throw new Refusal(409, 'live');
    if (mode === 'crash') throw new Error('boom');
    if (typeof p !== 'string') throw new Refusal(400, 'preset');
    return p;
  },
};

let server: Server;
let base = '';

before(async () => {
  server = statusServer(head);
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((ok) => server.close(() => ok()));
});

async function call(method: string, path: string, body?: string): Promise<{ code: number; json: unknown; type: string | null }> {
  const r = await fetch(base + path, body === undefined ? { method } : { method, body, headers: { 'content-type': 'application/json' } });
  return { code: r.status, type: r.headers.get('content-type'), json: await r.json() };
}

test('GET /state віддає знімок голови', async () => {
  const r = await call('GET', '/state');
  assert.equal(r.code, 200);
  assert.equal(r.type, 'application/json; charset=utf-8');
  assert.deepEqual(r.json, STATE);
});

test('GET /state із параметрами теж знімок', async () => {
  const r = await call('GET', '/state?x=1');
  assert.equal(r.code, 200);
  assert.deepEqual(r.json, STATE);
});

test('POST /preset міняє пресет', async () => {
  promoted = [];
  mode = 'ok';
  const r = await call('POST', '/preset', JSON.stringify({ preset: 'swarm' }));
  assert.equal(r.code, 200);
  assert.deepEqual(r.json, { preset: 'swarm' });
  assert.deepEqual(promoted, ['swarm']);
});

test('POST /preset без тіла передає undefined', async () => {
  promoted = [];
  mode = 'ok';
  const r = await call('POST', '/preset', '');
  assert.equal(r.code, 400);
  assert.deepEqual(r.json, { error: 'preset' });
  assert.deepEqual(promoted, [undefined]);
});

test('відмова голови - її код і слово', async () => {
  mode = 'refuse';
  const r = await call('POST', '/preset', JSON.stringify({ preset: 'swarm' }));
  assert.equal(r.code, 409);
  assert.deepEqual(r.json, { error: 'live' });
  mode = 'ok';
});

test('чужа помилка - 500 з текстом', async () => {
  mode = 'crash';
  const r = await call('POST', '/preset', JSON.stringify({ preset: 'swarm' }));
  assert.equal(r.code, 500);
  assert.deepEqual(r.json, { error: 'boom' });
  mode = 'ok';
});

test('зіпсований JSON і не обʼєкт - 400 json', async () => {
  promoted = [];
  for (const body of ['{', '[1,2]', 'null', '5']) {
    const r = await call('POST', '/preset', body);
    assert.equal(r.code, 400, body);
    assert.deepEqual(r.json, { error: 'json' });
  }
  assert.deepEqual(promoted, []);
});

test('невідомий шлях і метод - 404 path', async () => {
  for (const [m, p] of [
    ['GET', '/nope'],
    ['POST', '/state'],
    ['GET', '/preset'],
  ] as const) {
    const r = await call(m, p);
    assert.equal(r.code, 404, `${m} ${p}`);
    assert.deepEqual(r.json, { error: 'path' });
  }
});

test('Refusal несе код і імʼя', () => {
  const e = new Refusal(409, 'freeze');
  assert.equal(e.code, 409);
  assert.equal(e.message, 'freeze');
  assert.equal(e.name, 'Refusal');
  assert.ok(e instanceof Error);
});
