import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_HASH } from '@zoria/engine';

const MAIN = fileURLToPath(new URL('./main.js', import.meta.url));
const BOT_DIR = fileURLToPath(new URL('..', import.meta.url));
const KIT = join(BOT_DIR, 'node_modules', '@zoria', 'kit', 'bin', 'zaria-kit.mjs');

const PACK_RUNLOGS = [
  '6caf45cd4a7d31eae0df41ab27c2e09f42dc37ce93c07e0dc013cbdaacd33e73',
  '1c5665b5ba30c098e56c6c003ad75b4bf0ca861f5e6fe090574bd051d5963773',
  '7afd7ecbf9828cd38419566687b4ddb7cf3bc6635ebb23f9c597624ca0898072',
];
const PACK_BELIEFS = [
  '228b570bbcc7ce6d36e140d8f71e980711d9ad86093826b4682d1044005484a4',
  '9919f5bd86e266bbf4c3add758eee63a7177c7242a207326f7c5c3fb13d5abbc',
  'cdcdee074c8a2e00c745d0c09991457f158db629912d34afaebdf6836431cd3f',
];

function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('ZARIA_') || k.startsWith('STATUS_')) delete env[k];
  return { ...env, ...extra };
}

function freePort(): Promise<number> {
  return new Promise((ok, bad) => {
    const s = createServer();
    s.once('error', bad);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => ok(port));
    });
  });
}

async function waitState(base: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(base + '/state');
      if (r.ok) return (await r.json()) as Record<string, unknown>;
    } catch {
      await new Promise((ok) => setTimeout(ok, 50));
    }
  }
  throw new Error('службовий порт не піднявся');
}

async function post(base: string, preset: unknown): Promise<{ code: number; json: unknown }> {
  const r = await fetch(base + '/preset', { method: 'POST', body: JSON.stringify({ preset }) });
  return { code: r.status, json: await r.json() };
}

function exited(child: ChildProcess): Promise<number | null> {
  return new Promise((ok) => child.once('exit', (code) => ok(code)));
}

test('без адреси і без порту - вихід 2 з поясненням', () => {
  const r = spawnSync(process.execPath, [MAIN], { env: cleanEnv({}), encoding: 'utf8', timeout: 15000 });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /потрібні ZARIA_URL і ZARIA_TOKEN/);
});

test('адреса без печатки - теж вихід 2, у вузол не йде', () => {
  const r = spawnSync(process.execPath, [MAIN], { env: cleanEnv({ ZARIA_URL: 'ws://127.0.0.1:9' }), encoding: 'utf8', timeout: 15000 });
  assert.equal(r.status, 2);
  const s = spawnSync(process.execPath, [MAIN], { env: cleanEnv({ ZARIA_TOKEN: 'seal' }), encoding: 'utf8', timeout: 15000 });
  assert.equal(s.status, 2);
});

test('службовий порт у простої: знімок, зміна пресета, відмови', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [MAIN], { env: cleanEnv({ STATUS_PORT: String(port), STATUS_HOST: '127.0.0.1', ZARIA_PRESET: 'raider' }), stdio: 'pipe' });
  const out: string[] = [];
  child.stdout?.on('data', (b: Buffer) => out.push(b.toString('utf8')));
  const done = exited(child);
  try {
    const base = `http://127.0.0.1:${port}`;
    const st = await waitState(base);
    assert.equal(st['state'], 'lobby');
    assert.equal(st['slot'], null);
    assert.equal(st['preset'], 'raider');
    assert.deepEqual(st['presets'], ['warden', 'sentinel', 'raider', 'swarm', 'guard', 'expansion']);
    assert.equal(st['freeze'], false);
    assert.equal(st['tick'], 0);
    assert.equal(st['frames'], 0);
    assert.equal(st['ticks'], 0);
    assert.equal(st['engine'], ENGINE_HASH);
    assert.match(String(st['why']), /потрібні ZARIA_URL/);
    assert.deepEqual(st['stats'], { ticks: 0, orders: 0, nacks: 0, bytesIn: 0, bytesOut: 0, resyncMs: 0, resumes: 0, faults: 0, deferred: 0, lastTickAt: 0 });
    assert.deepEqual(st['belief'], { frames: 0, ageMs: 0 });
    assert.ok(typeof st['uptimeMs'] === 'number' && st['uptimeMs'] >= 0);

    assert.deepEqual(await post(base, 'swarm'), { code: 200, json: { preset: 'swarm' } });
    assert.equal((await waitState(base))['preset'], 'swarm');
    assert.deepEqual(await post(base, 'nope'), { code: 400, json: { error: 'preset' } });
    assert.deepEqual(await post(base, 7), { code: 400, json: { error: 'preset' } });
    assert.equal((await waitState(base))['preset'], 'swarm');
    assert.match(out.join(''), new RegExp('службовий порт ' + port));
  } finally {
    child.kill('SIGTERM');
  }
  const code = await done;
  if (process.platform !== 'win32') assert.equal(code, 0);
});

test('заморожена здача відмовляє в зміні пресета; невідомий пресет - warden', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [MAIN], { env: cleanEnv({ STATUS_PORT: String(port), STATUS_HOST: '127.0.0.1', ZARIA_FREEZE: '1', ZARIA_PRESET: 'немає' }), stdio: 'ignore' });
  const done = exited(child);
  try {
    const base = `http://127.0.0.1:${port}`;
    const st = await waitState(base);
    assert.equal(st['freeze'], true);
    assert.equal(st['preset'], 'warden');
    assert.deepEqual(await post(base, 'swarm'), { code: 409, json: { error: 'freeze' } });
    assert.equal((await waitState(base))['preset'], 'warden');
  } finally {
    child.kill('SIGTERM');
  }
  await done;
});

const sha = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');

test('справжній провід: локальний пакет із процесом бота, запис і щоденник віри', () => {
  const out = mkdtempSync(join(tmpdir(), 'zaria-pack-'));
  try {
    const r = spawnSync(process.execPath, [KIT, 'pack', '--fast', '--ticks', '300', '--seed', '2040', '--out', out, '--lang', 'uk'], {
      cwd: BOT_DIR,
      env: cleanEnv({}),
      encoding: 'utf8',
      timeout: 120000,
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /відповідей 300, кидків 0, повернень 0/);
    const dir = join(out, readdirSync(out).find((n) => n.startsWith('pack-'))!);
    const pack = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')) as { shares: number[]; absent: boolean[][]; matches: { sha256: string }[] };
    assert.deepEqual(pack.shares, [9, 4, 5]);
    assert.deepEqual(pack.absent, [
      [false, false, false],
      [false, false, false],
      [false, false, false],
    ]);
    assert.deepEqual(
      pack.matches.map((m) => m.sha256),
      PACK_RUNLOGS,
    );
    assert.deepEqual(
      [1, 2, 3].map((n) => readFileSync(join(dir, `belief-${n}.ndjson`), 'utf8').split('\n').filter(Boolean).length),
      [300, 300, 300],
    );
    assert.deepEqual(
      [1, 2, 3].map((n) => sha(join(dir, `belief-${n}.ndjson`))),
      PACK_BELIEFS,
    );
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
