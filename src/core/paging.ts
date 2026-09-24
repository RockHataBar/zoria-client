// Посторінкове читання /news і /inbox до nextOffset: null (CL-28). Елементи звіряються за id,
// дублів немає; якщо під час гортання прийшли нові елементи (сторінки зсунулися), гортання з нуля.
import type { Page } from './types.ts';

export interface PagingOptions {
  limit?: number;
  maxRestarts?: number;
  maxPages?: number;
}

/** Повертає всі елементи або null, якщо сторінку прочитати не вдалося (старі дані лишаються). */
export async function fetchAllPages<T extends { id: string }>(
  fetchPage: (limit: number, offset: number) => Promise<Page<T> | null>,
  opts: PagingOptions = {},
): Promise<T[] | null> {
  const limit = opts.limit ?? 50;
  const maxRestarts = opts.maxRestarts ?? 3;
  const maxPages = opts.maxPages ?? 200;

  for (let attempt = 0; ; attempt++) {
    const seen = new Map<string, T>();
    let offset = 0;
    let shifted = false;
    for (let pages = 0; pages < maxPages; pages++) {
      const page = await fetchPage(limit, offset);
      if (!page) return null;
      for (const item of page.items) {
        if (seen.has(item.id)) shifted = true;
        else seen.set(item.id, item);
      }
      if (shifted && attempt < maxRestarts) break;
      if (page.nextOffset === null || page.nextOffset <= offset) return [...seen.values()];
      offset = page.nextOffset;
    }
    if (!shifted || attempt >= maxRestarts) return [...seen.values()];
  }
}
