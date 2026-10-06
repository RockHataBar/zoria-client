// Нічна варта: слухає ефір із Node і сам надсилає заготовлену заявку за першим перевіреним
// кадром просвіту (CL-16). Пароль і код питаються в терміналі й живуть тільки в пам'яті процесу.
//
//   npm run watch                 - бойовий сервер
//   npm run watch -- --stand      - навчальний стенд (код STAND-2026)
//   ZORIA_SERVER=<адреса API> npm run watch
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { createApi } from '../src/core/api.ts';
import { serverFromEnv } from '../src/core/config.ts';
import { msUntilOpen, registrationOpen, toLocalMs, earliestOpenMs } from '../src/core/ether.ts';
import { createEtherClient } from '../src/core/etherClient.ts';
import { registerFlow } from '../src/core/register.ts';
import { fmtDuration, fmtLocal, zoneName } from '../src/core/time.ts';
import { validateApplication, normalizeUsername, parseRepository, type Application } from '../src/core/validate.ts';

const args = process.argv.slice(2);
const server = serverFromEnv(args.includes('--stand') ? 'stand' : process.env.ZORIA_SERVER, process.env.ZORIA_FINGERPRINT);
const stamp = () => fmtLocal(Date.now());
const log = (m: string) => console.log(`[${stamp()}] ${m}`);

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    if (hidden) {
      // не показуємо пароль і код у терміналі
      const w = (rl as unknown as { _writeToOutput: (s: string) => void });
      w._writeToOutput = (s: string) => {
        if (s.includes(question)) stdout.write(s);
        else if (s.includes('\n') || s.includes('\r')) stdout.write('\n');
      };
    }
    rl.question(question, (a) => {
      rl.close();
      resolve(a);
    });
  });
}

async function collect(): Promise<Application> {
  console.log(`Сервер: ${server.base}\nЧас показано в зоні ${zoneName()}.\n`);
  console.log('Заготовка заявки. Пароль і код заявки не зберігаються на диску.\n');
  for (;;) {
    const app: Application = {
      username: await ask('Логін у мережі: '),
      displayName: await ask("Відображуване ім'я (його бачать усі в журналі): "),
      password: await ask('Пароль (12-256 знаків, не показується): ', true),
      invitation: await ask('Код заявки (не показується): ', true),
      repositoryUrl: await ask('Приватний репозиторій GitHub (owner/repo): '),
      lang: (await ask('Мова текстів сервера uk/en [uk]: ')).trim() === 'en' ? 'en' : 'uk',
    };
    const confirm = await ask('Повторіть пароль: ', true);
    const errs = validateApplication(app);
    const mismatch = 'Паролі не збігаються.';
    if (confirm !== app.password) errs.password = mismatch;
    if (!Object.keys(errs).length) return app;
    for (const [k, v] of Object.entries(errs)) console.log(`  ${k}: ${v}`);
    console.log('Спробуймо ще раз.\n');
  }
}

async function main() {
  const app = await collect();
  const repo = parseRepository(app.repositoryUrl);
  const login = normalizeUsername(app.username);
  log(`Заявку заготовлено: логін ${login}, репозиторій ${repo.ok ? repo.slug : app.repositoryUrl}. Слухаємо ефір (раз на 15 с)…`);

  const ether = createEtherClient({ base: server.base, fingerprint: server.fingerprint, log });
  const api = createApi(server.base, { onEnvelope: (j, at) => void ether.acceptEnvelope(j, at) });
  let busy = false;
  let lastReport = 0;
  let notOpenAt: string | null = null;

  const unsubscribe = ether.subscribe(async () => {
    const { state, keyError } = ether.getSnapshot();
    if (keyError) log(`ключ печатки: ${keyError}`);
    if (Date.now() - lastReport > 10 * 60_000 && state.phase) {
      lastReport = Date.now();
      const until = msUntilOpen(state);
      const earliest = earliestOpenMs(state);
      if (state.phase === 'static' && until !== null) log(`шум; провісник: відкриття о ${fmtLocal(toLocalMs(state, state.harbinger!.opensAtMs))} (через ${fmtDuration(until)})`);
      else if (state.phase === 'static' && earliest) log(`шум; провісника немає - не раніше ${fmtLocal(toLocalMs(state, earliest))}`);
      else log(`фаза ${state.phase}; кадрів із печаткою ${state.counts.signal}, підробок ${state.counts.forged}`);
    }
    if (busy || !registrationOpen(state) || (notOpenAt !== null && notOpenAt === state.lastAt)) return;
    busy = true;
    log(`ПРОСВІТ: ${state.window ? `до ${fmtLocal(state.window.closesAt)}` : 'за /public/config'}. Надсилаємо заявку.`);
    const out = await registerFlow(api, app, { onStep: log });
    if (out.kind === 'not-open') {
      notOpenAt = state.lastAt;
      busy = false;
      return;
    }
    unsubscribe();
    ether.stop();
    if (out.kind === 'registered') {
      const cfg = await ether.reloadConfig();
      const bot = cfg?.repositoryAccess?.githubUsername ?? 'zoria-net-bot';
      log(`ГОТОВО: акаунт ${out.session.user.username} (${out.via === 'login' ? 'підтверджено входом' : '201'}).`);
      console.log(`\nДалі:\n  1. Запросіть ${bot} до репозиторію ${repo.ok ? `https://github.com/${repo.slug}/settings/access` : ''}`);
      console.log(`  2. Покладіть у корінь файл .zoria з рядком: ${out.session.user.username}`);
      console.log('  3. Відкрийте вебклієнт (npm run dev), увійдіть і стежте за статусом доступу.\n');
      process.exit(0);
    }
    log(`Не вдалося: ${out.kind === 'aborted' ? 'скасовано' : out.message}${'field' in out && out.field ? ` (поле ${out.field})` : ''}`);
    process.exit(1);
  });
  ether.start();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
