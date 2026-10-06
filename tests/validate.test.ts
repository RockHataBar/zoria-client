import { describe, expect, it } from 'vitest';
import { checkDisplayName, checkInvitation, checkPassword, checkUsername, normalizeInvitation, parseRepository, registerBody } from '../src/core/validate.ts';

describe('репозиторій (CL-14)', () => {
  const ok = [
    'north/zoria-client',
    'github.com/north/zoria-client',
    'www.github.com/north/zoria-client',
    'https://github.com/north/zoria-client',
    'http://github.com/north/zoria-client',
    'https://www.github.com/north/zoria-client/',
    'https://github.com/north/zoria-client.git',
    'git@github.com:north/zoria-client.git',
    'ssh://git@github.com/north/zoria-client.git',
    '  north/zoria-client/  ',
  ];
  for (const s of ok) {
    it(`приймає ${s.trim()}`, () => {
      const r = parseRepository(s);
      expect(r).toMatchObject({ ok: true, slug: 'north/zoria-client' });
    });
  }

  const notRoot = [
    'https://github.com/north/zoria-client/blob/main/README.md',
    'https://github.com/north/zoria-client/tree/dev',
    'https://github.com/north/zoria-client/issues',
    'https://github.com/north/zoria-client?tab=readme',
    'https://github.com/north/zoria-client#readme',
    'north/zoria-client/tree/main',
  ];
  for (const s of notRoot) {
    it(`відхиляє посилання всередину: ${s}`, () => {
      expect(parseRepository(s)).toMatchObject({ ok: false, notRoot: true });
    });
  }

  const bad = ['', 'north', 'https://gitlab.com/north/zoria-client', 'https://github.com/north', 'zoria-client', 'https://github.com/-bad/repo', 'north/..'];
  for (const s of bad) {
    it(`відхиляє не-репозиторій: "${s}"`, () => {
      expect(parseRepository(s)).toMatchObject({ ok: false, notRoot: false });
    });
  }
});

describe('поля заявки (5.6)', () => {
  it('логін', () => {
    expect(checkUsername('north')).toBeNull();
    expect(checkUsername('North_1-a')).toBeNull();
    expect(checkUsername('@north')).toBeNull();
    expect(checkUsername('no')).not.toBeNull();
    expect(checkUsername('1north')).not.toBeNull();
    expect(checkUsername('пів')).not.toBeNull();
    expect(checkUsername('a'.repeat(33))).not.toBeNull();
  });
  it('відображуване ім\'я', () => {
    expect(checkDisplayName('Північна вахта')).toBeNull();
    expect(checkDisplayName('   ')).not.toBeNull();
    expect(checkDisplayName('a\tb')).not.toBeNull();
    expect(checkDisplayName('я'.repeat(81))).not.toBeNull();
  });
  it('довгий код із листа: переноси рядків і пробіли всередині прибираються', () => {
    const code = 'Ab3_' + 'x'.repeat(60) + '-9Z';
    expect(normalizeInvitation(`  ${code.slice(0, 30)}\n${code.slice(30, 50)} ​${code.slice(50)}\r\n`)).toBe(code);
    expect(checkInvitation(code)).toBeNull();
    expect(checkInvitation('y'.repeat(101))).not.toBeNull();
    expect(checkInvitation(' \n ')).not.toBeNull();
  });
  it('пароль: 12-256 знаків', () => {
    expect(checkPassword('correct-horse')).toBeNull();
    expect(checkPassword('short')).not.toBeNull();
    expect(checkPassword('x'.repeat(257))).not.toBeNull();
  });
  it('тіло реєстрації: тільки поля контракту, логін у нижньому регістрі', () => {
    const spaced = ' pass with spaces ';
    const body = registerBody({
      username: ' North ',
      displayName: ' Північна вахта ',
      password: spaced,
      invitation: ' CODE-1 \n',
      repositoryUrl: 'https://github.com/North/zoria-client.git',
      lang: 'uk',
    });
    expect(body).toEqual({
      username: 'north',
      displayName: 'Північна вахта',
      password: spaced,
      invitation: 'CODE-1',
      repositoryUrl: 'North/zoria-client',
      lang: 'uk',
    });
  });
});
