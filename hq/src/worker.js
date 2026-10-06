import { Game, Diary } from './core.js';

const STEP = 40;
const WARM = 25;
const QUIET = 100;
const KEEP = 320;

const S = {
  packs: new Map(),
  games: new Map(),
  files: new Map(),
  asked: new Set(),
  failed: new Set(),
  want: null,
  answered: null,
  lastAsk: 0,
  warm: [],
  live: null,
  sent: new Set(),
  later: false,
  quick: 0,
  memo: new Map(),
};

const post = (m, tr) => self.postMessage(m, tr || []);

const chan = new MessageChannel();
let queued = false;
chan.port1.onmessage = () => {
  queued = false;
  try {
    pump();
  } catch (e) {
    post({ k: 'fault', why: String((e && e.message) || e) });
  }
};
function kick() {
  if (queued) return;
  queued = true;
  chan.port2.postMessage(0);
}

function names(id, match) {
  const p = S.packs.get(id);
  if (!p) return null;
  const m = p.matches && p.matches[match - 1];
  if (!m) return null;
  const log = m.file || 'match-' + match + '.runlog';
  const bel = p.belief && p.belief.files ? p.belief.files[match - 1] : null;
  return { log, bel };
}

function need(id, name) {
  const key = id + '/' + name;
  if (S.files.has(key) || S.asked.has(key) || S.failed.has(key)) return;
  S.asked.add(key);
  post({ k: 'need', id, name });
}

function game(id, match) {
  if (id === '@live') return S.live;
  const key = id + '#' + match;
  const had = S.games.get(key);
  if (had) return had;
  const n = names(id, match);
  if (!n) return null;
  const logKey = id + '/' + n.log;
  const belKey = n.bel ? id + '/' + n.bel : null;
  if (S.failed.has(logKey)) return null;
  if (!S.files.has(logKey)) {
    need(id, n.log);
    if (n.bel) need(id, n.bel);
    return null;
  }
  if (belKey && !S.files.has(belKey) && !S.failed.has(belKey)) {
    need(id, n.bel);
    return null;
  }
  const bytes = S.files.get(logKey);
  const text = belKey && S.files.has(belKey) ? S.files.get(belKey) : '';
  let g = null;
  try {
    g = Game.fromLog(bytes, text);
  } catch (e) {
    S.failed.add(logKey);
    post({ k: 'fault', why: String((e && e.message) || e), id, match });
    return null;
  }
  S.files.delete(logKey);
  if (belKey) S.files.delete(belKey);
  S.games.set(key, g);
  return g;
}

function seekToward(cur, target) {
  const now = cur.t();
  if (now === target) return true;
  let best = -1;
  for (const at of cur.snaps.keys()) if (at <= target && at > best) best = at;
  if (target < now || (best > now && best > 0)) cur.back(target);
  const left = target - cur.t();
  if (left > 0) cur.step(Math.min(left, STEP));
  return cur.t() === target || cur.done();
}

function extras(g, q, key) {
  const out = {};
  const tKey = key + '|terrain';
  if (!S.sent.has(tKey)) {
    S.sent.add(tKey);
    try {
      out.terrain = g.terrain();
    } catch {
      out.terrain = null;
    }
  }
  if (q.slot) {
    const sKey = key + '|series|' + q.slot;
    if (!S.sent.has(sKey) || q.id === '@live') {
      S.sent.add(sKey);
      out.series = g.series(q.slot);
    }
  }
  return out;
}

function answer(g, q, r, key, target) {
  const x = extras(g, q, key);
  S.answered = { seq: q.seq, t: target };
  const tr = [];
  if (x.series) tr.push(x.series.bytes.buffer, x.series.denies.buffer);
  post({ k: 'view', seq: q.seq, id: q.id, match: q.match, t: r.t, v: r.v, m: r.m, terrain: x.terrain, series: x.series, cap: g.cap }, tr);
}

function pump() {
  const q = S.want;
  if (q) {
    const g = game(q.id, q.match);
    if (g) {
      const cur = g.cur();
      let target = q.follow ? g.cap : q.t;
      target = Math.max(0, Math.min(target, g.ticks || target, q.id === '@live' ? g.cap : target));
      const done = S.answered && S.answered.seq === q.seq && S.answered.t === target;
      const key = q.id + '#' + q.match;
      const mk = q.id === '@live' ? null : [key, target, q.slot, q.belief ? 1 : 0, q.cell, q.unit, q.order].join('|');
      if (!done && mk && S.memo.has(mk)) {
        answer(g, q, S.memo.get(mk), key, target);
        kick();
        return;
      }
      if (!done) {
        if (q.id !== '@live' && S.quick !== q.seq && cur.t() !== target) {
          S.quick = q.seq;
          const f = g.quick(q, target);
          post({ k: 'quick', seq: q.seq, v: f.v });
        }
        if (seekToward(cur, target)) {
          const r = g.view(q);
          if (mk) {
            S.memo.set(mk, r);
            if (S.memo.size > KEEP) S.memo.delete(S.memo.keys().next().value);
          }
          answer(g, q, r, key, target);
        }
        kick();
        return;
      }
    }
  }
  if (performance.now() - S.lastAsk < QUIET) {
    if (S.warm.length && !S.later) {
      S.later = true;
      setTimeout(() => {
        S.later = false;
        kick();
      }, QUIET);
    }
    return;
  }
  while (S.warm.length) {
    const [id, match] = S.warm[0];
    const g = game(id, match);
    if (!g) {
      const n = names(id, match);
      if (!n || S.failed.has(id + '/' + n.log)) {
        S.warm.shift();
        continue;
      }
      return;
    }
    const cur = g.cur();
    if (cur.done() || cur.t() >= g.ticks) {
      S.warm.shift();
      continue;
    }
    if (q && q.id === id && q.match === match) {
      const last = Math.max(...cur.snaps.keys());
      if (cur.t() < last) cur.back(last);
    }
    cur.step(WARM);
    kick();
    return;
  }
}

function startLive(m) {
  const parts = {
    manifest: new Uint8Array(m.manifest),
    bots: m.bots || [],
    submits: [],
    roster: m.roster || [],
    episodes: [],
    denies: [],
  };
  S.live = new Game(parts, new Diary());
  S.sent = new Set([...S.sent].filter((k) => !k.startsWith('@live')));
}

function onTick(m) {
  const g = S.live;
  if (!g) return;
  const t = Number(m.t) || 0;
  for (const s of m.submits || []) {
    const b = s[1] instanceof Uint8Array ? s[1] : new Uint8Array(s[1]);
    g.submit(t, s[0], b);
  }
  for (const d of m.denies || []) g.deny(d[0], t, d[1], d[2]);
  if (m.belief) g.diary.push(m.belief);
  if (t > g.cap) g.cap = t;
}

self.onmessage = (e) => {
  const m = e.data || {};
  try {
    if (m.k === 'pack') {
      S.packs.set(m.id, m.pack);
      if (m.warm) {
        const n = (m.pack.matches || []).length;
        for (let i = 1; i <= n; i++) {
          S.warm.push([m.id, i]);
          const f = names(m.id, i);
          if (f) {
            need(m.id, f.log);
            if (f.bel) need(m.id, f.bel);
          }
        }
      }
    } else if (m.k === 'file') {
      const key = m.id + '/' + m.name;
      S.asked.delete(key);
      if (m.error) S.failed.add(key);
      else S.files.set(key, typeof m.bytes === 'string' ? m.bytes : new Uint8Array(m.bytes));
    } else if (m.k === 'view') {
      S.want = m.q;
      S.lastAsk = performance.now();
    } else if (m.k === 'live') {
      startLive(m);
    } else if (m.k === 'tick') {
      onTick(m);
    }
  } catch (err) {
    post({ k: 'fault', why: String((err && err.message) || err) });
  }
  kick();
};
