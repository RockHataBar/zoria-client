import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';

const API = process.env.ZORIA_API ?? 'https://zoria.net/api/v1';
const FILE = join(homedir(), '.zoria-registry.json');

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    if (hidden) {
      const w = rl as unknown as { _writeToOutput: (s: string) => void };
      w._writeToOutput = (s: string) => {
        if (s.includes(question)) stdout.write(question);
        else if (s.includes('\n') || s.includes('\r')) stdout.write('\n');
      };
    }
    rl.question(question, (a) => {
      rl.close();
      resolve(a);
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(method: string, path: string, body?: unknown, token?: string) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    if (r.status === 429) {
      const wait = Number(r.headers.get('Retry-After')) || 5;
      console.log(`Сервер просить зачекати ${wait} с…`);
      await sleep(wait * 1000);
      continue;
    }
    return { status: r.status, json, requestId: r.headers.get('X-Request-Id') };
  }
  throw new Error('Сервер довго відповідає 429, спробуйте пізніше.');
}

async function main() {
  const username = (await ask('Логін у мережі: ')).trim().replace(/^@/, '').toLowerCase();
  const password = await ask('Пароль (не показується): ', true);

  const login = await call('POST', '/auth/login', { username, password });
  if (login.status !== 200 || !login.json?.token) {
    const code = login.json?.error?.code ?? login.status;
    console.error(code === 'invalid-credentials' ? 'Хибний логін або пароль.' : `Вхід не вдався: ${code} (X-Request-Id ${login.requestId}).`);
    process.exit(1);
  }
  const token: string = login.json.token;

  try {
    const reg = await call('GET', '/me/registry-token', undefined, token);
    if (reg.status !== 200 || typeof reg.json?.auth !== 'string') {
      const code = reg.json?.error?.code ?? reg.status;
      console.error(code === 'registry-not-eligible' ? 'Реєстр доступний лише з підтвердженим репозиторієм.' : `Токен реєстру не отримано: ${code} (X-Request-Id ${reg.requestId}).`);
      process.exit(1);
    }
    writeFileSync(FILE, JSON.stringify(reg.json, null, 2), { mode: 0o600 });
    console.log(`\nГотово. Збережено: ${FILE}`);
    console.log(`Реєстр: ${reg.json.registry}  область: ${reg.json.scope}  користувач: ${reg.json.username}`);
    console.log('Секрет на екран не виводився і в репозиторій не потрапляє.');
  } finally {
    await call('POST', '/auth/logout', {}, token).catch(() => {});
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
