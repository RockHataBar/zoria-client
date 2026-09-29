import { BlankBot } from '@zoria/sdk';
import type { BeliefFrame } from '@zoria/sdk';
import { decodeVerdicts } from '@zoria/protocol';
import type { ActorName, ClsName, Hex, MineUnit, Observe, Order, SlotName, TerrainType } from '@zoria/protocol';

const HARD_DENY = new Set([11, 12, 13, 21]);
const TKACH: ClsName = 'ткач';
const KLINOK: ClsName = 'клинок';
const RING_W = [1, 1, 2 / 3, 1 / 3];

export interface Strategy {
  init(manifestBytes: Uint8Array, slot: SlotName): void;
  tick(observeBytes: Uint8Array): Uint8Array;
  feedback?(verdictBytes: Uint8Array): void;
  belief(obs: Observe | null): BeliefFrame | null;
}

interface Shape {
  weavers: number;
  blades: number;
  reactive: boolean;
  steal: boolean;
  build: boolean;
  ring: boolean;
  hunt: number;
  escort: boolean;
  raid: boolean;
  wary: boolean;
  adapt: boolean;
  bid: boolean;
  crown: boolean;
}

const BASE: Shape = { weavers: 3, blades: 2, reactive: false, steal: true, build: true, ring: true, hunt: 0, escort: false, raid: false, wary: false, adapt: false, bid: true, crown: true };

const SHAPES: Record<string, Shape> = {
  warden: { ...BASE, weavers: 2, blades: 4, hunt: 1, escort: true, raid: true, wary: true },
  sentinel: { ...BASE, weavers: 2, blades: 4, hunt: 1, escort: true, raid: true, wary: true, adapt: true },
  ranger: { ...BASE, weavers: 2, blades: 4, hunt: 2, escort: true, raid: true, wary: true, adapt: true },
  calm: { ...BASE, weavers: 2, blades: 4, hunt: 1, escort: true, raid: false, wary: true },
  still: { ...BASE, weavers: 2, blades: 4, hunt: 0, escort: true, raid: true, wary: true },
  homely: { ...BASE, weavers: 2, blades: 4, hunt: 1, escort: true, raid: true, wary: true, steal: false },
  raider: { ...BASE, weavers: 2, blades: 4, hunt: 1, escort: true, raid: true },
  guard: { ...BASE },
  pack: { ...BASE, weavers: 2, blades: 4, hunt: 1, escort: true },
  swarm: { ...BASE, weavers: 1, blades: 6, hunt: 2, escort: true, raid: true },
  expansion: { ...BASE, weavers: 4, blades: 0 },
};
const DEFAULT_SHAPE = 'warden';

interface Cand {
  k: string;
  h: Hex;
  heat: number;
  value: number;
  prio: number;
  ring: boolean;
}

interface World {
  mine: Set<string>;
  litKeys: Set<string>;
  anchors: Hex[];
  cov: Map<string, number>;
  occupied: Set<string>;
  weavers: MineUnit[];
  blades: MineUnit[];
  weight: number;
  energy: number;
  dawnOn: boolean;
  free: boolean;
  home: Hex[];
  crowned: boolean;
}

const SEATS: Record<SlotName, Hex> = { A: { q: 6, r: -12 }, B: { q: 6, r: 6 }, C: { q: -12, r: 6 } };

const key = (q: number, r: number): string => q + ',' + r;

function unkey(k: string): Hex {
  const i = k.indexOf(',');
  return { q: Number(k.slice(0, i)), r: Number(k.slice(i + 1)) };
}

function dist(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

function hexRound(qf: number, rf: number): Hex {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

function around(c: Hex, rad: number, fn: (q: number, r: number, d: number) => void): void {
  for (let dq = -rad; dq <= rad; dq++) {
    const lo = Math.max(-rad, -dq - rad);
    const hi = Math.min(rad, -dq + rad);
    for (let dr = lo; dr <= hi; dr++) fn(c.q + dq, c.r + dr, Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr)));
  }
}

class ExpansionBot extends BlankBot implements Strategy {
  private readonly shape: Shape;
  private base: Hex = SEATS.A;
  private center: Hex = { q: 0, r: 0 };
  private radius = 19;
  private cherta = 6;
  private dawnAt = 0;
  private dawnMult = 2;
  private ticks = 1200;
  private types: TerrainType[] = [];
  private cellType = new Map<string, number>();
  private linkMemo = new Map<string, boolean>();
  private pool: Hex[] = [];
  private ringKeys = new Set<string>();
  private sites = new Set<string>();
  private starts = new Set<string>();
  private buildable = new Set<string>();
  private foeSeats: Hex[] = [];
  private known = new Map<string, { o: ActorName | null; dark: boolean }>();
  private assign = new Map<string, string>();
  private since = new Map<string, number>();
  private blocked = new Map<string, number>();
  private hurt = new Map<string, number>();
  private foeBlades = new Map<string, { h: Hex; t: number }>();
  private deaths: { h: Hex; t: number }[] = [];
  private foeSeen = new Map<string, { h: Hex; t: number; still: number }>();
  private issued = new Map<string, { pos: string; dest: string; t: number }>();
  private rammed: number[] = [];
  private threat = -1000;
  private lastYard = -100;
  private buildIdle = 0;
  private crownAt = -1000;
  private crownLost = 0;
  private costTkach = 90;
  private costKlinok = 50;
  private costNeedle = 60;
  private capWeight = 8;
  private linkRange = 5;
  private heatRuin = 8;
  private heatDark = 16;
  private heatLit = 24;
  private holdTicks = 12;
  private rate = 0.0005;
  private sent: Order[] = [];
  private silent = 0;
  private lastT = 0;

  constructor(shape: Shape) {
    super();
    this.shape = shape;
  }

  feedback(verdictBytes: Uint8Array): void {
    const verdicts = decodeVerdicts(verdictBytes);
    if (!verdicts || verdicts.length === 0) {
      this.silent++;
      return;
    }
    let accepted = 0;
    for (const [i, ok, code] of verdicts) {
      if (ok) {
        accepted++;
        continue;
      }
      if (!HARD_DENY.has(code)) continue;
      const o = this.sent[i];
      if (o && (o.kind === 'move' || o.kind === 'needle' || o.kind === 'feed')) {
        this.blocked.set(key(o.q, o.r), this.lastT + 60);
      }
    }
    this.silent = accepted > 0 ? 0 : this.silent + 1;
  }

  private isBlocked(k: string, t: number): boolean {
    const until = this.blocked.get(k);
    return until !== undefined && until > t;
  }

  private typeOf(q: number, r: number): TerrainType | undefined {
    return this.types[this.cellType.get(key(q, r)) ?? 0];
  }

  private inValley(q: number, r: number): boolean {
    return dist({ q, r }, this.center) <= this.radius;
  }

  private linkOk(a: Hex, b: Hex): boolean {
    const d = dist(a, b);
    if (d > this.linkRange + 1) return false;
    const mk = a.q + ',' + a.r + ',' + b.q + ',' + b.r;
    const memo = this.linkMemo.get(mk);
    if (memo !== undefined) return memo;
    const rng = this.linkRange + (this.typeOf(a.q, a.r)?.reach || this.typeOf(b.q, b.r)?.reach ? 1 : 0);
    let ok = d <= rng;
    if (ok && d > 1) {
      const aq = a.q + 1e-6;
      const ar = a.r + 1e-6;
      const bq = b.q + 1e-6;
      const br = b.r + 1e-6;
      for (let i = 1; i < d; i++) {
        const k = i / d;
        const h = hexRound(aq + (bq - aq) * k, ar + (br - ar) * k);
        if (this.typeOf(h.q, h.r)?.block) {
          ok = false;
          break;
        }
      }
    }
    this.linkMemo.set(mk, ok);
    return ok;
  }

  private linked(h: Hex, anchors: Hex[]): boolean {
    for (const a of anchors) if (this.linkOk(a, h)) return true;
    return false;
  }

  private gain(h: Hex, cov: Map<string, number>, mult = 1): number {
    let g = 0;
    around(h, 3, (q, r, d) => {
      if (!this.inValley(q, r)) return;
      const p = this.typeOf(q, r)?.cost ?? 0;
      if (!p) return;
      const c = cov.get(key(q, r)) ?? 0;
      g += p * Math.max(0, Math.min(RING_W[d]! * mult, 1 - c));
    });
    return g;
  }

  private danger(h: Hex, w: World): number {
    let d = 0;
    for (const v of this.foeBlades.values()) if (dist(v.h, h) <= 5 + Math.min(4, this.lastT - v.t)) d++;
    for (const x of this.deaths) if (dist(x.h, h) <= 5) d++;
    if (!d) return 0;
    for (const b of w.blades) if (dist(b, h) <= 2) return d / 3;
    return d;
  }

  private inZone(h: Hex, w: World): boolean {
    return dist(h, this.base) <= this.linkRange || (w.cov.get(key(h.q, h.r)) ?? 0) > 0;
  }

  override init(manifestBytes: Uint8Array, slot: SlotName): void {
    super.init(manifestBytes, slot);
    const m = this.manifest;
    if (!m) return;
    const idx = { A: 0, B: 1, C: 2 }[slot];
    const pi = m.perm.indexOf(slot);
    const seat = pi >= 0 ? pi : idx;
    this.base = m.seats[seat] ?? SEATS[slot];
    this.foeSeats = m.seats.filter((_, i) => i !== seat);
    this.center = m.citadel;
    this.cherta = m.cherta;
    this.ticks = m.ticks;
    this.radius = m.terrain.radius - 1;
    this.dawnAt = m.dawn.at > 0 && m.dawn.at < m.ticks ? m.dawn.at : 0;
    this.dawnMult = m.dawn.ring || 2;
    const cfg = m.cfg;
    this.costTkach = cfg['costTkach'] ?? 90;
    this.costKlinok = cfg['costKlinok'] ?? 50;
    this.costNeedle = cfg['costNeedle'] ?? 60;
    this.capWeight = cfg['squadWeight'] ?? 8;
    this.linkRange = cfg['linkRange'] ?? 5;
    this.heatRuin = cfg['heatNeedle'] ?? 8;
    this.heatDark = cfg['heatDark'] ?? 16;
    this.heatLit = cfg['heatEnemy'] ?? 24;
    this.holdTicks = cfg['orderHoldTicks'] ?? 12;
    this.rate = cfg['minuteRate'] ?? 0.0005;
    this.types = m.terrain.types;
    for (const c of m.terrain.cells) this.cellType.set(key(c[0], c[1]), c[2]);

    for (const n of m.needles) {
      const k = key(n.q, n.r);
      this.sites.add(k);
      if (n.start) {
        this.starts.add(k);
      } else if (n.ring || n.spoke) {
        this.ringKeys.add(k);
        this.pool.push({ q: n.q, r: n.r });
        this.known.set(k, { o: 'K', dark: false });
      } else {
        this.pool.push({ q: n.q, r: n.r });
        this.known.set(k, { o: null, dark: false });
      }
    }

    const dead = new Set<string>();
    for (const f of m.finds) if (f.kind === 'dead') dead.add(key(f.q, f.r));
    for (let q = -this.radius; q <= this.radius; q++) {
      for (let r = -this.radius; r <= this.radius; r++) {
        const h = { q: q + this.center.q, r: r + this.center.r };
        if (dist(h, this.center) > this.radius) continue;
        const k = key(h.q, h.r);
        if (this.sites.has(k) || dead.has(k)) continue;
        const ty = this.typeOf(h.q, h.r);
        if (!ty || !ty.build || !ty.pass) continue;
        if (m.seats.some((b) => dist(h, b) <= 2)) continue;
        this.buildable.add(k);
      }
    }
  }

  private observe(obs: Observe, t: number): void {
    const me = this.slot as ActorName;
    for (const e of obs.own) {
      const k = key(e.q, e.r);
      const prev = this.known.get(k);
      if (prev && prev.o !== e.owner && e.owner && e.owner !== me && e.owner !== 'K') this.blocked.set(k, t + 61);
      this.known.set(k, { o: e.owner, dark: e.dark });
    }
    const mineKeys = new Set<string>();
    for (const n of obs.mine.needles) mineKeys.add(key(n.q, n.r));
    for (const [k, v] of this.known) if (v.o === me && !mineKeys.has(k)) this.known.set(k, { o: null, dark: false });
    for (const n of obs.mine.needles) this.known.set(key(n.q, n.r), { o: me, dark: n.dark });
    for (const l of obs.mine.losts) {
      if (l.t < t - 1) continue;
      const k = key(l.q, l.r);
      this.known.set(k, { o: l.owner, dark: l.dark });
      if (l.owner && l.owner !== me) this.blocked.set(k, t + 61);
    }
    for (const ev of obs.events) {
      if (ev.type === 'jam' && ev.own === me && ev.p !== me) {
        this.hurt.set(key(ev.q, ev.r), t + 25);
        this.threat = t;
      } else if (ev.type === 'cap' && ev.from === me && ev.p !== me && ev.p !== 'K') {
        this.threat = t;
      } else if (ev.type === 'ram' && ev.tgt === me && ev.p !== 'K') {
        this.threat = t;
        this.deaths.push({ h: { q: ev.q, r: ev.r }, t });
        this.rammed.push(t);
      } else if (ev.type === 'lost' && ev.p === me && ev.cls === TKACH && ev.why === 'таран' && this.shape.wary) {
        around(ev, 1, (q, r) => {
          const k = key(q, r);
          if (this.sites.has(k)) this.blocked.set(k, Math.max(this.blocked.get(k) ?? 0, t + 150));
        });
      }
    }
    this.rammed = this.rammed.filter((x) => t - x <= 150);
    for (const f of obs.foe) if (f.p !== me && f.p !== 'K' && f.cls === KLINOK) this.foeBlades.set(f.id, { h: { q: f.q, r: f.r }, t });
    for (const f of obs.foe) {
      if (f.p === me || f.p === 'K') continue;
      const prev = this.foeSeen.get(f.id);
      const still = prev && prev.t === t - 1 && prev.h.q === f.q && prev.h.r === f.r ? prev.still + 1 : 0;
      this.foeSeen.set(f.id, { h: { q: f.q, r: f.r }, t, still });
    }
    for (const [id, v] of this.foeSeen) if (t - v.t > 3) this.foeSeen.delete(id);
    for (const [id, v] of this.foeBlades) if (t - v.t > 12) this.foeBlades.delete(id);
    this.deaths = this.deaths.filter((x) => t - x.t <= 50);
    for (const [k, until] of this.hurt) if (until <= t) this.hurt.delete(k);
    if (this.dawnAt && t >= this.dawnAt) {
      for (const k of this.ringKeys) {
        const v = this.known.get(k);
        if (v && v.o === 'K' && !v.dark) this.known.set(k, { o: 'K', dark: true });
      }
    }
  }

  private world(obs: Observe, t: number): World {
    const mine = new Set<string>();
    const litKeys = new Set<string>();
    const anchors: Hex[] = [this.base];
    const cov = new Map<string, number>();
    const home: Hex[] = [];
    let crowned = false;
    for (const n of obs.mine.needles) {
      const k = key(n.q, n.r);
      mine.add(k);
      if (n.weight > 1.01) crowned = true;
      if (this.starts.has(k)) home.push({ q: n.q, r: n.r });
      if (n.weight >= 1) {
        litKeys.add(k);
        anchors.push({ q: n.q, r: n.r });
        around(n, 3, (q, r, d) => {
          const ck = key(q, r);
          cov.set(ck, (cov.get(ck) ?? 0) + RING_W[d]!);
        });
      }
    }
    const occupied = new Set<string>();
    const weavers: MineUnit[] = [];
    const blades: MineUnit[] = [];
    let weight = 0;
    for (const u of obs.mine.units) {
      occupied.add(key(u.q, u.r));
      if (u.cls === TKACH) {
        weavers.push(u);
        weight += 2;
      } else {
        blades.push(u);
        weight += 1;
      }
    }
    for (const f of obs.foe) occupied.add(key(f.q, f.r));
    const dawnOn = this.dawnAt > 0 && t >= this.dawnAt;
    return {
      mine,
      litKeys,
      anchors,
      cov,
      occupied,
      weavers,
      blades,
      weight,
      energy: obs.pulse.energy,
      dawnOn,
      free: dawnOn || obs.pulse.mercy,
      home,
      crowned,
    };
  }

  private crownSite(w: World, t: number, claimed: Set<string>): Hex | null {
    let best: Hex | null = null;
    let bs = -Infinity;
    const seen = new Set<string>();
    for (const s of w.home) {
      around(s, this.linkRange + 1, (q, r) => {
        const k = key(q, r);
        if (seen.has(k)) return;
        seen.add(k);
        if (!this.buildable.has(k) || this.isBlocked(k, t) || w.occupied.has(k) || claimed.has(k)) return;
        const h = { q, r };
        let links = 0;
        for (const x of w.home) if (this.linkOk(x, h)) links++;
        if (!links) return;
        const sc = links * 100 + this.gain(h, w.cov);
        if (sc > bs) {
          bs = sc;
          best = h;
        }
      });
    }
    return best;
  }

  private siege(): boolean {
    return this.shape.adapt && this.rammed.length >= 3;
  }

  private wantWeavers(): number {
    return this.siege() ? Math.max(1, this.shape.weavers - 1) : this.shape.weavers;
  }

  private wantBlades(t: number): number {
    if (!this.shape.blades) return 0;
    const n = this.siege() ? this.shape.blades + 2 : this.shape.blades;
    if (!this.shape.reactive) return n;
    return t - this.threat < 300 ? n : 0;
  }

  private yard(t: number, w: World, out: Order[]): void {
    if (t < this.lastYard + 6) return;
    const weavers = w.weavers.length;
    const blades = w.blades.length;
    const want = this.wantBlades(t);
    const first = this.shape.wary && t - this.threat < 200 ? Math.min(2, want) : 0;
    const canWeaver = w.weight + 2 <= this.capWeight && w.energy >= this.costTkach;
    const canBlade = w.weight + 1 <= this.capWeight && w.energy >= this.costKlinok;
    let cls: ClsName | null = null;
    if (weavers === 0) cls = canWeaver ? TKACH : null;
    else if (blades < first) cls = canBlade ? KLINOK : null;
    else if (weavers < this.wantWeavers()) cls = canWeaver ? TKACH : null;
    else if (blades < want) cls = canBlade ? KLINOK : null;
    if (!cls) return;
    out.push({ kind: 'yard', cls });
    this.lastYard = t;
    w.energy -= cls === TKACH ? this.costTkach : this.costKlinok;
  }

  private bids(t: number, w: World, out: Order[]): void {
    const m = this.manifest;
    if (!m || !this.shape.bid) return;
    m.lots.forEach((lot, i) => {
      if (t !== lot.at - 1) return;
      const { free, value, near } = this.lotWorth(lot.cells, w);
      if (!free || !near || value < 30) return;
      let committed = 0;
      for (const u of w.weavers) if (u.task?.site) committed += this.costNeedle;
      const amount = Math.min(240, Math.floor(w.energy - committed - 5));
      if (amount < 60) return;
      out.push({ kind: 'bid', lot: i, amount });
    });
  }

  private lotWorth(cells: Hex[], w: World): { free: number; value: number; near: boolean } {
    let free = 0;
    let value = 0;
    let near = false;
    for (const c of cells) {
      const k = key(c.q, c.r);
      if (w.mine.has(k) || (this.known.get(k)?.o ?? null) !== null) continue;
      free++;
      value += this.gain(c, w.cov);
      if (!near) for (const a of w.anchors) if (dist(a, c) <= 2 * this.linkRange) near = true;
    }
    return { free, value, near };
  }

  private lotSoon(t: number, w: World): boolean {
    const m = this.manifest;
    if (!m || !this.shape.bid) return false;
    for (const lot of m.lots) {
      if (lot.at <= t || lot.at > t + 40) continue;
      const { free, value, near } = this.lotWorth(lot.cells, w);
      if (free && near && value >= 30) return true;
    }
    return false;
  }

  private reserve(t: number, w: World): number {
    const lot = this.lotSoon(t, w) ? 65 : 0;
    if (w.weavers.length < this.wantWeavers()) return this.costTkach + lot;
    if (w.blades.length < this.wantBlades(t)) return this.costKlinok + lot;
    return lot;
  }

  private nearHurt(h: Hex): boolean {
    for (const k of this.hurt.keys()) if (dist(unkey(k), h) <= 1) return true;
    return false;
  }

  private bladeOrders(obs: Observe, w: World, out: Order[]): void {
    if (!w.blades.length) return;
    const me = this.slot as ActorName;
    const foes = obs.foe.filter((f) => f.p !== 'K' && f.p !== me);
    const visible = new Set(foes.map((f) => f.id));
    const busy = new Set<string>();
    for (const b of w.blades) if (b.task?.ram && visible.has(b.task.ram)) busy.add(b.id);
    const chased = new Set<string>();
    for (const b of w.blades) if (b.task?.ram && busy.has(b.id)) chased.add(b.task.ram);

    const working: Hex[] = [];
    if (this.shape.escort || this.shape.wary) {
      for (const u of w.weavers) {
        const a = this.assign.get(u.id);
        if ((a && a === key(u.q, u.r)) || u.task?.site) working.push(u);
      }
    }
    const targets: { id: string; h: Hex; pri: number }[] = [];
    for (const f of foes) {
      if (chased.has(f.id)) continue;
      const fk = key(f.q, f.r);
      let pri = 0;
      if (f.cls === TKACH && w.mine.has(fk)) pri = 3;
      else if (f.cls === KLINOK && this.shape.wary && working.some((h) => dist(h, f) <= 3)) pri = 3;
      else if (f.cls === KLINOK && this.nearHurt(f)) pri = 2;
      else if (f.cls === KLINOK && working.some((h) => dist(h, f) <= 2)) pri = 2;
      else if (f.cls === KLINOK && this.shape.wary && w.weavers.some((h) => dist(h, f) <= 3)) pri = 2;
      else if (f.cls === TKACH && this.sites.has(fk) && !this.starts.has(fk) && this.linked(f, w.anchors)) pri = 1;
      else if (f.cls === TKACH && this.shape.hunt >= 1 && this.inZone(f, w)) pri = 1;
      else if (f.cls === TKACH && this.shape.hunt >= 2) pri = 1;
      if (pri && f.cls === TKACH && (this.foeSeen.get(f.id)?.still ?? 0) >= 1) pri += 0.5;
      if (pri) targets.push({ id: f.id, h: { q: f.q, r: f.r }, pri });
    }
    targets.sort((a, b) => b.pri - a.pri);
    for (const tg of targets) {
      let best: MineUnit | undefined;
      let bd = Infinity;
      for (const b of w.blades) {
        if (b.wait > 0 || busy.has(b.id)) continue;
        const d = dist(b, tg.h);
        if (d < bd && d <= 14) {
          bd = d;
          best = b;
        }
      }
      if (!best) continue;
      busy.add(best.id);
      out.push({ kind: 'ram', unit: best.id, target: tg.id });
    }

    if (this.shape.raid) this.raid(obs, w, busy, out);

    const posts: Hex[] = [];
    if (this.shape.wary) for (const h of working) posts.push(h);
    for (const k of this.hurt.keys()) posts.push(unkey(k));
    const lit = w.anchors.slice(1);
    lit.sort((a, b) => this.foeGap(a) - this.foeGap(b));
    for (const h of lit) posts.push(h);
    const usedPost = new Set<string>();
    for (const b of w.blades) {
      if (busy.has(b.id) || b.wait > 0 || (b.task?.path ?? 0) > 0) continue;
      let post: Hex | undefined;
      for (const p of posts) {
        const pk = key(p.q, p.r);
        if (usedPost.has(pk)) continue;
        post = p;
        usedPost.add(pk);
        break;
      }
      if (!post || dist(b, post) <= 1) continue;
      const spot = this.nextTo(post, b, w);
      if (spot) out.push({ kind: 'move', unit: b.id, q: spot.q, r: spot.r, goal: null, home: false });
    }
  }

  private prey(k: string): boolean {
    const me = this.slot as ActorName;
    const info = this.known.get(k);
    return !!info && !!info.o && info.o !== me && info.o !== 'K' && !info.dark && !this.starts.has(k);
  }

  private raid(obs: Observe, w: World, busy: Set<string>, out: Order[]): void {
    const score = obs.pub.score;
    const idx: Record<string, number> = { A: 0, B: 1, C: 2 };
    const top = Math.max(score[0], score[1], score[2]);
    const me = this.slot as ActorName;
    const held = (h: Hex): boolean => {
      const o = this.known.get(key(h.q, h.r))?.o;
      return !!o && o !== me && o !== 'K';
    };
    const marks = new Set<string>();
    for (const b of w.blades) {
      const j = b.task?.jam;
      if (j && !busy.has(b.id) && held(j)) marks.add(key(j.q, j.r));
    }
    for (const b of w.blades) {
      if (busy.has(b.id) || b.wait > 0) continue;
      const j = b.task?.jam;
      if (j && held(j) && (dist(b, j) <= 1 || (b.task?.path ?? 0) > 0)) {
        busy.add(b.id);
        continue;
      }
      let best: Hex | null = null;
      let bs = -Infinity;
      for (const [k, v] of this.known) {
        if (marks.has(k) || !this.prey(k)) continue;
        const h = unkey(k);
        const d = dist(b, h);
        if (d > 12) continue;
        let near = Infinity;
        for (const a of w.anchors) near = Math.min(near, dist(a, h));
        if (near > this.linkRange + 3) continue;
        const lead = v.o && score[idx[v.o] ?? 0] === top ? 1.5 : 1;
        const s = (this.gain(h, w.cov) * lead) / (d + 6);
        if (s > bs) {
          bs = s;
          best = h;
        }
      }
      if (!best) continue;
      marks.add(key(best.q, best.r));
      busy.add(b.id);
      if (dist(b, best) <= 1) {
        out.push({ kind: 'jam', unit: b.id, target: best, hold: true });
      } else {
        const spot = this.nextTo(best, b, w);
        if (!spot) continue;
        out.push({ kind: 'move', unit: b.id, q: spot.q, r: spot.r, goal: null, home: false });
        out.push({ kind: 'jam', unit: b.id, target: best, hold: false });
      }
    }
  }

  private foeGap(h: Hex): number {
    let m = Infinity;
    for (const s of this.foeSeats) m = Math.min(m, dist(s, h));
    return m;
  }

  private nextTo(p: Hex, u: Hex, w: World): Hex | null {
    let best: Hex | null = null;
    let bs = Infinity;
    around(p, 1, (q, r, d) => {
      if (d === 0 || !this.inValley(q, r)) return;
      const k = key(q, r);
      if (this.sites.has(k) || w.occupied.has(k)) return;
      if (!this.typeOf(q, r)?.pass) return;
      const s = dist({ q, r }, u);
      if (s < bs) {
        bs = s;
        best = { q, r };
      }
    });
    return best;
  }

  private stage(target: Hex, u: Hex, w: World, t: number): Hex | null {
    let best: Hex | null = null;
    let bs = Infinity;
    around(target, 3, (q, r, d) => {
      if (d === 0 || !this.inValley(q, r)) return;
      const k = key(q, r);
      if (this.sites.has(k) || this.isBlocked(k, t)) return;
      if (w.occupied.has(k) && !(q === u.q && r === u.r)) return;
      if (!this.typeOf(q, r)?.pass) return;
      const h = { q, r };
      if (!this.inZone(h, w)) return;
      const s = d * 10 + dist(h, u);
      if (s < bs) {
        bs = s;
        best = h;
      }
    });
    return best;
  }

  private candidates(obs: Observe, t: number, w: World): Map<string, Cand> {
    const out = new Map<string, Cand>();
    const me = this.slot as ActorName;
    const dawnSoon = this.shape.ring && this.dawnAt > 0 && t >= this.dawnAt - 30;
    const board = obs.pub.order;
    const orderKeys = new Set<string>();
    if (board && t <= board.to - this.holdTicks) for (const c of board.cells) orderKeys.add(key(c.q, c.r));

    const pool = new Map<string, Hex>();
    for (const h of this.pool) pool.set(key(h.q, h.r), h);
    for (const [k, v] of this.known) if (v.o && v.o !== me && v.o !== 'K' && !this.starts.has(k)) pool.set(k, unkey(k));
    for (const k of orderKeys) if (!pool.has(k)) pool.set(k, unkey(k));

    for (const [k, h] of pool) {
      if (w.mine.has(k) || this.starts.has(k) || this.isBlocked(k, t)) continue;
      const info = this.known.get(k);
      const o = info ? info.o : null;
      const ring = this.ringKeys.has(k);
      const inner = dist(h, this.center) <= this.cherta;
      const isOrder = orderKeys.has(k);
      let heat = this.heatRuin;
      let mult = 1;
      let prio = 2;
      if (o === 'K') {
        if (!ring || !dawnSoon) continue;
        mult = this.dawnMult;
        prio = 1;
      } else if (o === null) {
        if (inner && !w.free) continue;
        if (ring && w.dawnOn) mult = this.dawnMult;
      } else {
        if (!this.shape.steal && !isOrder) continue;
        if (inner && !w.free) continue;
        heat = info && info.dark ? this.heatDark : this.heatLit;
        if (ring && w.dawnOn) mult = this.dawnMult;
        prio = 3;
      }
      if (!this.linked(h, w.anchors) && !(isOrder && this.orderChain(h, orderKeys, w))) continue;
      let value = this.gain(h, w.cov, mult);
      if (o && o !== 'K') value *= 1.6;
      if (this.shape.wary) value /= 1 + 2 * this.danger(h, w);
      out.set(k, { k, h, heat, value, prio, ring: ring && o === 'K' });
    }

    if (board && orderKeys.size) {
      let ok = w.weavers.length > 0;
      const etas: number[] = [];
      for (const k of orderKeys) {
        if (!ok) break;
        if (w.litKeys.has(k)) continue;
        const c = out.get(k);
        if (w.mine.has(k) || !c) {
          ok = false;
          break;
        }
        let eta = Infinity;
        for (const u of w.weavers) eta = Math.min(eta, 2 * dist(u, c.h) + c.heat);
        etas.push(eta);
      }
      if (ok && etas.length) {
        etas.sort((a, b) => a - b);
        const par = Math.min(w.weavers.length, etas.length);
        let span = etas[par - 1]!;
        const extra = etas.length - par;
        if (extra > 0) span = Math.max(span, etas[0]! + Math.ceil(extra / par) * (8 + this.heatRuin));
        if (t + span + this.holdTicks + 2 > board.to) ok = false;
      }
      if (ok && etas.length > 0) {
        for (const k of orderKeys) {
          const c = out.get(k);
          if (c) {
            c.prio = 0;
            c.value += 30 / (this.rate * 60);
          }
        }
      } else {
        for (const k of orderKeys) {
          const c = out.get(k);
          if (c && c.prio === 3 && !this.shape.steal) out.delete(k);
        }
      }
    }
    return out;
  }

  private orderChain(h: Hex, orderKeys: Set<string>, w: World): boolean {
    for (const k of orderKeys) {
      const o = unkey(k);
      if (o.q === h.q && o.r === h.r) continue;
      if (!this.linkOk(o, h)) continue;
      if (w.litKeys.has(k) || this.linked(o, w.anchors)) return true;
    }
    return false;
  }

  private bridgeSite(target: Hex, u: Hex, w: World, t: number, claimed: Set<string>): Hex | null {
    let best: Hex | null = null;
    let bs = Infinity;
    around(target, this.linkRange + 1, (q, r, d) => {
      if (d === 0) return;
      const k = key(q, r);
      if (!this.buildable.has(k) || this.isBlocked(k, t) || w.occupied.has(k) || claimed.has(k)) return;
      const h = { q, r };
      if (!w.free && dist(h, this.center) <= this.cherta) return;
      if (this.shape.wary && w.energy < 300 && this.danger(h, w) >= 1) return;
      if (!this.linkOk(h, target) || !this.linked(h, w.anchors)) return;
      const s = dist(h, u) * 2 - this.gain(h, w.cov) / 10;
      if (s < bs) {
        bs = s;
        best = h;
      }
    });
    return best;
  }

  private bridge(u: MineUnit, w: World, t: number, cands: Map<string, Cand>, claimed: Set<string>): Hex | null {
    const me = this.slot as ActorName;
    const far: { h: Hex; v: number }[] = [];
    for (const h of this.pool) {
      const k = key(h.q, h.r);
      if (w.mine.has(k) || cands.has(k) || this.isBlocked(k, t)) continue;
      const o = this.known.get(k)?.o ?? null;
      const ring = this.ringKeys.has(k);
      if (o === me) continue;
      if (o !== null && !(o === 'K' && ring && w.dawnOn)) continue;
      if (!w.free && dist(h, this.center) <= this.cherta) continue;
      let near = Infinity;
      for (const a of w.anchors) near = Math.min(near, dist(a, h));
      if (near > 2 * this.linkRange + 2) continue;
      far.push({ h, v: this.gain(h, w.cov, ring && w.dawnOn ? this.dawnMult : 1) / (dist(u, h) + 8) });
    }
    far.sort((a, b) => b.v - a.v);
    for (const f of far) {
      const site = this.bridgeSite(f.h, u, w, t, claimed);
      if (site) return site;
    }
    return null;
  }

  private buildSite(u: MineUnit, w: World, t: number, claimed: Set<string>): Hex | null {
    const left = this.ticks - t - 12;
    if (left <= 0) return null;
    const seen = new Set<string>();
    let best: Hex | null = null;
    let bs = -Infinity;
    for (const a of w.anchors) {
      around(a, this.linkRange + 1, (q, r) => {
        const k = key(q, r);
        if (seen.has(k)) return;
        seen.add(k);
        if (!this.buildable.has(k) || this.isBlocked(k, t) || w.occupied.has(k) || claimed.has(k)) return;
        const h = { q, r };
        if (!w.free && dist(h, this.center) <= this.cherta) return;
        const risk = this.shape.wary ? this.danger(h, w) : 0;
        if (risk >= 1 && w.energy < 300) return;
        if (!this.linked(h, w.anchors)) return;
        const g = this.gain(h, w.cov);
        if (g * this.rate * left < 1.5) return;
        const s = g - 1.5 * dist(h, u) - 10 * risk;
        if (s > bs) {
          bs = s;
          best = h;
        }
      });
    }
    return best;
  }

  private weaverOrders(obs: Observe, t: number, w: World, moves: Order[], builds: Order[], feeds: Order[]): void {
    for (const u of w.weavers) {
      const rec = this.issued.get(u.id);
      if (!rec || u.wait > 0 || (u.task?.path ?? 0) > 0 || u.task?.site) continue;
      const here = key(u.q, u.r);
      if (here === rec.dest) this.issued.delete(u.id);
      else if (here === rec.pos && t - rec.t >= 6) {
        this.blocked.set(rec.dest, Math.max(this.blocked.get(rec.dest) ?? 0, t + 100));
        if (this.assign.get(u.id) === rec.dest) this.assign.delete(u.id);
        this.issued.delete(u.id);
      }
    }
    const cands = this.candidates(obs, t, w);
    const alive = new Set(w.weavers.map((u) => u.id));
    for (const [id, k] of this.assign) {
      if (!alive.has(id) || !cands.has(k)) {
        this.assign.delete(id);
        this.since.delete(id);
      }
    }
    const taken = new Set(this.assign.values());
    const fresh = new Set<string>();

    const free: MineUnit[] = [];
    for (const u of w.weavers) {
      if (u.wait > 0 || this.assign.has(u.id) || u.task?.site) continue;
      free.push(u);
    }
    for (const c of cands.values()) {
      if (c.prio > 1 || taken.has(c.k)) continue;
      for (const u of w.weavers) {
        const cur = this.assign.get(u.id);
        if (!cur || u.wait > 0 || free.includes(u)) continue;
        const cc = cands.get(cur);
        if (!cc || cc.prio <= c.prio || key(u.q, u.r) === cur) continue;
        this.assign.delete(u.id);
        this.since.delete(u.id);
        taken.delete(cur);
        free.push(u);
        break;
      }
    }

    const crowning = new Set<string>();
    let crownKey = '';
    if (w.crowned) this.crownLost = t;
    if (this.shape.crown && !w.crowned && w.litKeys.size >= 12 && t - this.crownLost >= 20 && t - this.crownAt > 60 && t < this.ticks - 60 && free.length) {
      const sites = new Set<string>();
      let spent = 0;
      for (const u of w.weavers) {
        if (!u.task?.site) continue;
        sites.add(key(u.task.site.q, u.task.site.r));
        spent += this.costNeedle;
      }
      const site = w.energy - spent >= this.costNeedle ? this.crownSite(w, t, sites) : null;
      if (site) {
        let bi = 0;
        for (let i = 1; i < free.length; i++) if (dist(free[i]!, site) < dist(free[bi]!, site)) bi = i;
        const u = free[bi]!;
        free.splice(bi, 1);
        builds.push({ kind: 'needle', unit: u.id, q: site.q, r: site.r });
        crowning.add(u.id);
        crownKey = key(site.q, site.r);
        this.crownAt = t;
      }
    }

    while (free.length) {
      let bu = -1;
      let bc: Cand | null = null;
      let bs = -Infinity;
      for (let i = 0; i < free.length; i++) {
        const u = free[i]!;
        for (const c of cands.values()) {
          if (taken.has(c.k)) continue;
          const eta = 2 * dist(u, c.h) + c.heat;
          const s = -c.prio * 1e6 + (c.value * 100) / (eta + 6);
          if (s > bs) {
            bs = s;
            bu = i;
            bc = c;
          }
        }
      }
      if (!bc || bu < 0) break;
      const u = free[bu]!;
      free.splice(bu, 1);
      this.assign.set(u.id, bc.k);
      this.since.delete(u.id);
      taken.add(bc.k);
      fresh.add(u.id);
    }

    const claimed = new Set<string>();
    let committed = 0;
    for (const u of w.weavers) {
      if (u.task?.site) {
        claimed.add(key(u.task.site.q, u.task.site.r));
        committed += this.costNeedle;
      }
    }
    if (crownKey) {
      claimed.add(crownKey);
      committed += this.costNeedle;
    }
    const feedClaim = new Set<string>();
    for (const u of w.weavers) if (u.task?.feed) feedClaim.add(key(u.task.feed.q, u.task.feed.r));

    for (const u of w.weavers) {
      if (u.wait > 0 || crowning.has(u.id)) continue;
      const here = key(u.q, u.r);
      const moving = (u.task?.path ?? 0) > 0;
      const target = this.assign.get(u.id);
      if (target) {
        const c = cands.get(target)!;
        if (c.ring && t < this.dawnAt) {
          if (moving && !fresh.has(u.id)) continue;
          if (dist(u, c.h) <= 3 && this.inZone(u, w)) continue;
          const st = this.stage(c.h, u, w, t);
          if (st) {
            moves.push({ kind: 'move', unit: u.id, q: st.q, r: st.r, goal: null, home: false });
          } else {
            this.assign.delete(u.id);
            this.blocked.set(target, t + 20);
          }
          continue;
        }
        if (target === here) {
          const s = this.since.get(u.id) ?? t;
          this.since.set(u.id, s);
          if (t - s > c.heat + 30) {
            this.blocked.set(target, t + 120);
            this.assign.delete(u.id);
            this.since.delete(u.id);
          }
          continue;
        }
        if (u.stuck) {
          this.blocked.set(target, t + 80);
          this.assign.delete(u.id);
          continue;
        }
        if (!moving || fresh.has(u.id)) moves.push({ kind: 'move', unit: u.id, q: c.h.q, r: c.h.r, goal: null, home: false });
        continue;
      }

      if (moving || u.task?.site) continue;

      const avail = w.energy - committed;
      if (avail >= this.costNeedle + 30) {
        const site = this.bridge(u, w, t, cands, claimed);
        if (site) {
          claimed.add(key(site.q, site.r));
          committed += this.costNeedle;
          builds.push({ kind: 'needle', unit: u.id, q: site.q, r: site.r });
          continue;
        }
      }
      if (this.shape.build && t >= this.buildIdle && avail >= this.costNeedle + this.reserve(t, w)) {
        const site = this.buildSite(u, w, t, claimed);
        if (!site) this.buildIdle = t + 10;
        if (site) {
          claimed.add(key(site.q, site.r));
          committed += this.costNeedle;
          builds.push({ kind: 'needle', unit: u.id, q: site.q, r: site.r });
          continue;
        }
      }

      const fed = u.task?.feed;
      if (fed && fed.q === u.q && fed.r === u.r) continue;

      if (w.litKeys.has(here) && !feedClaim.has(here)) {
        feeds.push({ kind: 'feed', unit: u.id, q: u.q, r: u.r });
        feedClaim.add(here);
        continue;
      }

      let best: Hex | undefined;
      let bs = -Infinity;
      for (const n of obs.mine.needles) {
        if (n.weight < 1 || n.fed) continue;
        const k = key(n.q, n.r);
        if (feedClaim.has(k) || w.occupied.has(k) || this.isBlocked(k, t)) continue;
        const s = this.gain(n, w.cov, 1) - 2 * dist(n, u);
        if (s > bs) {
          bs = s;
          best = n;
        }
      }
      if (best) {
        feedClaim.add(key(best.q, best.r));
        feeds.push({ kind: 'move', unit: u.id, q: best.q, r: best.r, goal: null, home: false });
        continue;
      }
      if (!this.inZone(u, w)) {
        let home: Hex = this.base;
        let hd = dist(u, home);
        for (const a of w.anchors) {
          const d = dist(u, a);
          if (d < hd) {
            hd = d;
            home = a;
          }
        }
        const spot = this.nextTo(home, u, w);
        if (spot) feeds.push({ kind: 'move', unit: u.id, q: spot.q, r: spot.r, goal: null, home: false });
      }
    }
  }

  protected override think(obs: Observe): Order[] {
    const t = obs.t;
    this.lastT = t;
    this.observe(obs, t);
    const w = this.world(obs, t);
    const head: Order[] = [];
    const rams: Order[] = [];
    const moves: Order[] = [];
    const builds: Order[] = [];
    const feeds: Order[] = [];
    this.yard(t, w, head);
    this.bids(t, w, head);
    this.bladeOrders(obs, w, rams);
    this.weaverOrders(obs, t, w, moves, builds, feeds);
    let orders = [...head, ...rams, ...moves, ...builds, ...feeds];
    const cap = Math.floor(obs.pulse.chanAt / 32) + 4 - 1;
    if (orders.length > cap) orders = orders.slice(0, Math.max(1, cap));
    if (this.silent > 0 || orders.length === 0) orders.unshift({ kind: 'watch', q: this.base.q, r: this.base.r, keep: 0 });
    const at = new Map<string, string>();
    for (const u of w.weavers) at.set(u.id, key(u.q, u.r));
    for (const o of orders) {
      if (o.kind !== 'move' && o.kind !== 'needle') continue;
      const pos = at.get(o.unit);
      if (pos) this.issued.set(o.unit, { pos, dest: key(o.q, o.r), t });
    }
    this.sent = orders;
    return orders;
  }

  belief(obs: Observe | null): BeliefFrame | null {
    if (!obs) return null;
    const own: Record<string, string | null> = {};
    const dark: Record<string, boolean> = {};
    for (const e of obs.own) {
      own[key(e.q, e.r)] = e.owner;
      if (e.dark) dark[key(e.q, e.r)] = true;
    }
    const active = obs.pub.pact.active.find((p) => p.a === this.slot || p.b === this.slot);
    return {
      t: obs.t,
      full: true,
      pulse: {
        energy: obs.pulse.energy,
        chan: obs.pulse.chanAt,
        ear: obs.pulse.earAt,
        minutes: obs.pulse.minutes,
        needles: obs.pulse.needles,
      },
      own,
      dark,
      foe: obs.foe.map((f) => [f.id, f.p, f.q, f.r] as [string, string, number, number]),
      noisy: obs.noisy.length,
      units: obs.mine.units.map((u) => [u.id, u.q, u.r, u.task?.path ?? 0] as [string, number, number, number]),
      pact: active ? (active.a === this.slot ? active.b : active.a) : null,
      cries: obs.pub.cries.map((c) => [c[0], c[1]] as [string, number]),
    };
  }
}

export function presets(): string[] {
  return Object.keys(SHAPES);
}

export function createStrategy(preset?: string): Strategy {
  const shape = (preset && SHAPES[preset]) || SHAPES[DEFAULT_SHAPE]!;
  return new ExpansionBot({ ...shape });
}
