import { createEngine } from '@zoria/engine';
import { JournalCursor } from '@zoria/sdk';
import { readRunLog, decodeManifest, decodeOrders, DENY_CODES } from '@zoria/protocol';

export const SLOTS = ['A', 'B', 'C'];

const fixed1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const blank = (v) => v === undefined || v === null || v === '';

export class Diary {
  constructor() {
    this.frames = [];
    this.fulls = [];
    this.foe = new Map();
  }

  static parse(text) {
    const d = new Diary();
    for (const line of String(text || '').split('\n')) {
      if (!line) continue;
      let f = null;
      try {
        f = JSON.parse(line);
      } catch {
        f = null;
      }
      d.push(f);
    }
    return d;
  }

  push(f) {
    if (!f || typeof f !== 'object' || typeof f.t !== 'number') return;
    const i = this.frames.length;
    this.frames.push(f);
    if (f.full) this.fulls.push(i);
    if (Array.isArray(f.foe)) {
      for (const c of f.foe) {
        if (!Array.isArray(c)) continue;
        let list = this.foe.get(c[0]);
        if (!list) this.foe.set(c[0], (list = []));
        list.push([f.t, c[1], c[2], c[3]]);
      }
    }
  }

  get size() {
    return this.frames.length;
  }

  at(t) {
    let start = 0;
    for (const i of this.fulls) {
      if (this.frames[i].t <= t) start = i;
      else break;
    }
    const own = new Map();
    const dark = new Map();
    let pulse = null;
    let units = null;
    let pact = null;
    for (let i = start; i < this.frames.length; i++) {
      const f = this.frames[i];
      if (f.t > t) break;
      if (f.own) for (const k of Object.keys(f.own)) own.set(k, f.own[k]);
      if (f.dark) for (const k of Object.keys(f.dark)) dark.set(k, f.dark[k]);
      if (f.pulse) pulse = f.pulse;
      if (f.units) units = f.units;
      if (f.pact !== undefined) pact = f.pact;
    }
    return { own, dark, pulse, units, pact };
  }

  contact(unit, t) {
    const list = this.foe.get(unit);
    if (!list || !list.length || list[0][0] > t) return null;
    let lo = 0;
    let hi = list.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (list[mid][0] <= t) lo = mid;
      else hi = mid - 1;
    }
    return list[lo];
  }

  ghosts(t) {
    const out = [];
    for (const unit of this.foe.keys()) {
      const c = this.contact(unit, t);
      if (c) out.push([unit, c[1], c[2], c[3], t - c[0]]);
    }
    return out;
  }
}

export class Game {
  constructor(parts, diary) {
    this.parts = parts;
    this.man = decodeManifest(parts.manifest);
    this.ticks = this.man ? this.man.ticks : 0;
    this.keys = this.man ? this.man.needles.map((n) => n.q + ',' + n.r) : [];
    this.kset = new Set(this.keys);
    this.roster = parts.roster || [];
    this.diary = diary || new Diary();
    this.frames = new Map();
    this.denyBy = new Map();
    this.top = {};
    this.cap = 0;
    this.cursor = null;
    this.lane = null;
    for (const s of parts.submits) this.indexSubmit(s[0], s[1], s[2]);
    for (const d of parts.denies || []) this.indexDeny(d[0], d[1], d[2], d[3]);
  }

  static fromLog(bytes, diaryText) {
    const log = readRunLog(bytes);
    return new Game(log, Diary.parse(diaryText));
  }

  indexSubmit(t, slot, bytes) {
    this.frames.set(t + slot, bytes);
    if (t > this.cap) this.cap = t;
  }

  indexDeny(slot, t, i, code) {
    const key = t + slot;
    let list = this.denyBy.get(key);
    if (!list) this.denyBy.set(key, (list = []));
    list.push([i, code]);
    const best = this.top[slot] || (this.top[slot] = [0, 0]);
    if (list.length > best[1] || (list.length === best[1] && t < best[0])) {
      best[0] = t;
      best[1] = list.length;
    }
  }

  submit(t, slot, bytes) {
    this.parts.submits.push([t, slot, bytes]);
    this.indexSubmit(t, slot, bytes);
  }

  deny(slot, t, i, code) {
    this.parts.denies.push([slot, t, i, code]);
    this.indexDeny(slot, t, i, code);
  }

  cur() {
    if (!this.cursor) this.cursor = new JournalCursor(createEngine, this.parts);
    return this.cursor;
  }

  nick(slot) {
    const i = SLOTS.indexOf(slot);
    return i < 0 ? null : this.roster[i] || null;
  }

  actor(a) {
    if (blank(a)) return '-';
    if (a === 'K') return 'K';
    return this.nick(a) || a;
  }

  terrain() {
    const E = this.cur().engine;
    const R = this.man.terrain.radius;
    const names = this.man.terrain.types.map((x) => x.name);
    const out = [];
    for (let q = -R; q <= R; q++) {
      const r1 = Math.max(-R, -q - R);
      const r2 = Math.min(R, -q + R);
      for (let r = r1; r <= r2; r++) {
        let i = 0;
        try {
          i = names.indexOf(E.terrainAt(q, r));
        } catch {
          i = 0;
        }
        out.push(q, r, i < 0 ? 0 : i);
      }
    }
    return { radius: R, types: names, cells: out, citadel: this.man.citadel || null };
  }

  series(slot) {
    const n = Math.max(this.ticks, this.cap);
    const bytes = new Uint16Array(n + 1);
    const denies = new Uint8Array(n + 1);
    for (let t = 1; t <= n; t++) {
      const f = this.frames.get(t + slot);
      if (f) bytes[t] = Math.min(65535, f.length);
      const d = this.denyBy.get(t + slot);
      if (d) denies[t] = Math.min(255, d.length);
    }
    return { slot, bytes, denies };
  }

  quick(q, t) {
    const slot = q.slot;
    const v = {};
    const frame = slot ? this.frames.get(t + slot) : null;
    let orders = [];
    if (frame) {
      try {
        orders = decodeOrders(frame) || [];
      } catch {
        orders = [];
      }
    }
    const denies = (slot && this.denyBy.get(t + slot)) || [];
    v.bytes = slot ? String(frame ? frame.length : 0) : '';
    v.orders = slot ? String(orders.length) : '';
    v.denied = slot ? String(denies.length) : '';
    const hit = denies.find((x) => x[0] === q.order);
    v['deny-word'] = slot ? (hit ? DENY_CODES[hit[1]] || String(hit[1]) : '-') : '';
    const best = slot ? this.top[slot] : null;
    v['deny-top-tick'] = slot ? String(best && best[1] > 0 ? best[0] : 0) : '';

    const bel = q.belief && this.diary.size ? this.diary.at(t) : null;
    if (bel) {
      v['cell-owner-belief'] = q.cell ? (bel.own.has(q.cell) ? this.actor(bel.own.get(q.cell)) : '?') : '';
      if (q.unit) {
        const c = this.diary.contact(q.unit, t);
        v['ghost-cell'] = c ? c[2] + ',' + c[3] : '-';
        v['ghost-age'] = c ? String(t - c[0]) : '-';
      } else {
        v['ghost-cell'] = '';
        v['ghost-age'] = '';
      }
      let dark = 0;
      for (const [k, x] of bel.dark) if (x && this.kset.has(k)) dark++;
      v['dark-count'] = String(dark);
    } else {
      v['cell-owner-belief'] = q.cell ? '?' : '';
      v['ghost-cell'] = '';
      v['ghost-age'] = '';
      v['dark-count'] = '';
    }
    const list = orders.map((o, i) => {
      const d = denies.find((x) => x[0] === i);
      return [i, o.kind || '', o.unit || '', d ? DENY_CODES[d[1]] || String(d[1]) : ''];
    });
    return { v, bel, list };
  }

  view(q) {
    const cur = this.cur();
    const t = cur.t();
    const E = cur.engine;
    const w = E.SIM.world;
    const own = w.own || {};
    const ownerOf = (k) => (blank(own[k]) ? null : own[k]);
    const slot = q.slot;
    const fast = this.quick(q, t);
    const v = fast.v;
    const bel = fast.bel;

    v['cell-owner-truth'] = q.cell ? this.actor(ownerOf(q.cell)) : '';

    const scores = {};
    for (const s of SLOTS) {
      let x = null;
      try {
        x = E.simScoreBreakdown(s);
      } catch {
        x = null;
      }
      scores[s] = x;
    }
    const mine = scores[slot];
    v.score = mine && Number.isFinite(mine.total) ? fixed1(mine.total) : '';
    v.needles = slot ? String((w.needles && w.needles[slot]) || 0) : '';

    if (bel) {
      let diff = 0;
      for (const k of this.keys) {
        if (!bel.own.has(k)) continue;
        const b = bel.own.get(k) ?? null;
        if (b !== ownerOf(k)) diff++;
      }
      v['diff-count'] = String(diff);
    } else {
      v['diff-count'] = '';
    }

    const lit = new Set();
    if (w.lit) for (const p of Object.keys(w.lit)) for (const k of Object.keys(w.lit[p] || {})) lit.add(k);

    const needles = this.keys.map((k) => {
      const tr = ownerOf(k);
      let b = '?';
      let d = 0;
      if (bel) {
        if (bel.own.has(k)) b = bel.own.get(k) ?? '';
        d = bel.dark.get(k) ? 1 : 0;
      }
      return [k, tr || '', b, d, lit.has(k) ? 1 : 0];
    });

    const units = [];
    for (const u of E.SIM.units || []) {
      if (u.from !== undefined && u.from > t) continue;
      if (u.until !== undefined && u.until < t) continue;
      units.push([u.id, u.p, u.q, u.r, u.cls || '']);
    }

    const board = SLOTS.map((s) => {
      const x = scores[s];
      return [s, this.nick(s) || s, x ? x.total : 0, (w.needles && w.needles[s]) || 0, x ? x.network : 0];
    });

    const list = fast.list;

    return {
      t,
      v,
      m: {
        needles,
        units,
        ghosts: bel ? this.diary.ghosts(t) : [],
        mine: bel && bel.units ? bel.units : [],
        board,
        keeper: (w.needles && w.needles.K) || 0,
        orders: list,
        pulse: bel ? bel.pulse : null,
        pact: bel ? bel.pact : null,
        breakdown: mine || null,
      },
    };
  }
}
