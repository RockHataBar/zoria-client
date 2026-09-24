import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, safeHref } from '../src/core/markdown.ts';
import { fetchAllPages } from '../src/core/paging.ts';
import type { Page } from '../src/core/types.ts';

describe('підмножина Markdown (CL-30)', () => {
  it('посилання тільки http і https', () => {
    expect(safeHref('https://zoria.net/')).toBe('https://zoria.net/');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<b>')).toBeNull();
    expect(parseInline('[x](javascript:alert(1))')).toEqual([{ t: 'text', v: 'x' }, { t: 'text', v: ')' }]);
  });

  it('HTML лишається текстом', () => {
    const b = parseMarkdown('<img src=x onerror=alert(1)>');
    expect(b).toEqual([{ t: 'p', c: [{ t: 'text', v: '<img src=x onerror=alert(1)>' }] }]);
  });

  it('заголовки, списки, код, жирний', () => {
    const b = parseMarkdown('# Частина 2\n\n- **важливо**\n- `код`\n\n1. один\n2. два\n\n```\nnpm ci\n```\n##### не заголовок');
    expect(b[0]).toEqual({ t: 'h', level: 1, c: [{ t: 'text', v: 'Частина 2' }] });
    expect(b[1]).toEqual({ t: 'ul', items: [[{ t: 'b', c: [{ t: 'text', v: 'важливо' }] }], [{ t: 'code', v: 'код' }]] });
    expect(b[2]).toMatchObject({ t: 'ol', start: 1 });
    expect(b[3]).toEqual({ t: 'pre', v: 'npm ci' });
    expect(b[4]).toEqual({ t: 'p', c: [{ t: 'text', v: '##### не заголовок' }] });
  });
});

describe('посторінкове читання (CL-28)', () => {
  it('читає до nextOffset: null без дублів', async () => {
    const all = Array.from({ length: 5 }, (_, i) => ({ id: `m${i}` }));
    const out = await fetchAllPages<{ id: string }>(async (limit, offset) => ({
      items: all.slice(offset, offset + limit),
      nextOffset: offset + limit < all.length ? offset + limit : null,
    }), { limit: 2 });
    expect(out?.map((x) => x.id)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
  });

  it('новий елемент під час гортання - гортання з нуля', async () => {
    let list = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
    let calls = 0;
    const out = await fetchAllPages<{ id: string }>(async (limit, offset): Promise<Page<{ id: string }>> => {
      calls++;
      if (calls === 2) list = [{ id: 'new' }, ...list]; // прийшов новий лист між сторінками
      return { items: list.slice(offset, offset + limit), nextOffset: offset + limit < list.length ? offset + limit : null };
    }, { limit: 2 });
    expect(out?.map((x) => x.id).sort()).toEqual(['a', 'b', 'c', 'd', 'new']);
    expect(calls).toBeGreaterThan(3);
  });

  it('сторінка не прочиталась - null, старі дані лишаються', async () => {
    const out = await fetchAllPages<{ id: string }>(async () => null);
    expect(out).toBeNull();
  });
});
