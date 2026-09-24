// Підмножина Markdown (специфікація, 5.6): заголовки #-####, списки -, * і 1., абзаци, **жирний**,
// `код`, блоки коду в потрійних зворотних лапках, посилання [текст](адреса). Решта - звичайний текст.
// Розбір дає дерево даних; HTML із тіла ніколи не виконується (CL-30).

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'b'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'a'; href: string; c: Inline[] };

export type Block =
  | { t: 'h'; level: 1 | 2 | 3 | 4; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; start: number; items: Inline[][] }
  | { t: 'pre'; v: string };

/** Посилання відкриваються тільки зі схемою http або https. */
export function safeHref(url: string): string | null {
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return null;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export function parseInline(s: string, allowBold = true): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ t: 'text', v: buf });
    buf = '';
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: 'code', v: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (allowBold && ch === '*' && s[i + 1] === '*') {
      const end = s.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: 'b', c: parseInline(s.slice(i + 2, end), false) });
        i = end + 2;
        continue;
      }
    }
    if (ch === '[') {
      const close = s.indexOf(']', i + 1);
      if (close > i && s[close + 1] === '(') {
        const end = s.indexOf(')', close + 2);
        if (end > close) {
          const text = s.slice(i + 1, close);
          const href = safeHref(s.slice(close + 2, end));
          flush();
          const c = parseInline(text, allowBold);
          out.push(href ? { t: 'a', href, c } : { t: 'text', v: text });
          i = end + 1;
          continue;
        }
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { t: 'ul' | 'ol'; start: number; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) blocks.push({ t: 'p', c: parseInline(para.join('\n')) });
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((x) => parseInline(x));
    blocks.push(list.t === 'ul' ? { t: 'ul', items } : { t: 'ol', start: list.start, items });
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flushPara();
      flushList();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
      blocks.push({ t: 'pre', v: code.join('\n') });
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const h = /^(#{1,4})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      blocks.push({ t: 'h', level: h[1].length as 1 | 2 | 3 | 4, c: parseInline(h[2]) });
      continue;
    }
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*(\d{1,9})\.\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const kind = ul ? 'ul' : 'ol';
      if (!list || list.t !== kind) {
        flushList();
        list = { t: kind, start: ol ? parseInt(ol[1], 10) : 1, items: [] };
      }
      list.items.push(ul ? ul[1] : ol![2]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) {
      // продовження пункту списку
      list.items[list.items.length - 1] += '\n' + line.trim();
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}
