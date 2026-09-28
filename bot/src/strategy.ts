import { BlankBot } from '@zoria/sdk';
import type { BeliefFrame } from '@zoria/sdk';
import type { ClsName, Hex, Observe, Order, SlotName } from '@zoria/protocol';

export interface Strategy {
  init(manifestBytes: Uint8Array, slot: SlotName): void;
  tick(observeBytes: Uint8Array): Uint8Array;
  feedback?(verdictBytes: Uint8Array): void;
  belief(obs: Observe | null): BeliefFrame | null;
}

const SEATS: Record<SlotName, Hex> = { A: { q: 6, r: -12 }, B: { q: 6, r: 6 }, C: { q: -12, r: 6 } };

const key = (q: number, r: number): string => q + ',' + r;

function dist(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

class ExpansionBot extends BlankBot implements Strategy {
  private base: Hex = SEATS.A;
  private ruins: Hex[] = [];
  private assign = new Map<string, string>();
  private blocked = new Map<string, number>();
  private lastYard = -100;
  private costTkach = 90;
  private capWeight = 8;
  private linkRange = 5;

  override init(manifestBytes: Uint8Array, slot: SlotName): void {
    super.init(manifestBytes, slot);
    const m = this.manifest;
    if (!m) return;
    const idx = { A: 0, B: 1, C: 2 }[slot];
    const seat = m.seats[idx];
    this.base = seat ?? SEATS[slot];
    this.costTkach = m.cfg['costTkach'] ?? 90;
    this.capWeight = m.cfg['squadWeight'] ?? 8;
    this.linkRange = m.cfg['linkRange'] ?? 5;
    this.ruins = m.needles
      .filter((n) => n.start === null && !n.ring && !n.spoke)
      .map((n) => ({ q: n.q, r: n.r }))
      .sort((a, b) => dist(a, this.base) - dist(b, this.base));
  }

  protected override think(obs: Observe): Order[] {
    const t = obs.t;
    const orders: Order[] = [];
    const units = obs.mine.units;

    const mine = new Set<string>();
    for (const n of obs.mine.needles) mine.add(key(n.q, n.r));
    const enemy = new Set<string>();
    for (const e of obs.own) if (e.owner && e.owner !== this.slot && e.owner !== 'K') enemy.add(key(e.q, e.r));

    let weight = 0;
    let weavers = 0;
    for (const u of units) {
      weight += u.cls === ('ткач' as ClsName) ? 2 : 1;
      if (u.cls === 'ткач') weavers++;
    }

    if (t >= this.lastYard + 5 && weavers < 4 && weight + 2 <= this.capWeight && obs.pulse.energy >= this.costTkach) {
      orders.push({ kind: 'yard', cls: 'ткач' });
      this.lastYard = t;
    }

    const anchors: Hex[] = [this.base];
    for (const n of obs.mine.needles) if (!n.dark) anchors.push({ q: n.q, r: n.r });
    const reach = (ruin: Hex): boolean => anchors.some((a) => dist(a, ruin) <= this.linkRange);

    const board = obs.pub.order;
    const orderKeys = new Set<string>();
    if (board && board.to >= t) for (const c of board.cells) orderKeys.add(key(c.q, c.r));

    const alive = new Set(units.map((u) => u.id));
    for (const [id, target] of this.assign) {
      if (!alive.has(id) || mine.has(target) || enemy.has(target)) this.assign.delete(id);
    }
    const taken = new Set(this.assign.values());

    const candidates = this.ruins
      .filter((r) => {
        const k = key(r.q, r.r);
        if (mine.has(k) || enemy.has(k) || taken.has(k)) return false;
        const until = this.blocked.get(k);
        if (until !== undefined && until > t) return false;
        return reach(r);
      })
      .sort((a, b) => {
        const ao = orderKeys.has(key(a.q, a.r)) ? 0 : 1;
        const bo = orderKeys.has(key(b.q, b.r)) ? 0 : 1;
        return ao - bo || dist(a, this.base) - dist(b, this.base);
      });
    let next = 0;

    for (const u of units) {
      if (u.cls !== ('ткач' as ClsName)) continue;
      if (u.wait > 0 || (u.task?.path ?? 0) > 0) continue;

      const here = key(u.q, u.r);
      if (this.assign.get(u.id) === here) continue;

      if (u.stuck && this.assign.has(u.id)) {
        this.blocked.set(this.assign.get(u.id)!, t + 80);
        this.assign.delete(u.id);
      }

      let dest = this.assign.get(u.id);
      if (!dest || mine.has(dest) || enemy.has(dest)) {
        this.assign.delete(u.id);
        dest = undefined;
        while (next < candidates.length) {
          const c = candidates[next++]!;
          const k = key(c.q, c.r);
          if (taken.has(k)) continue;
          dest = k;
          this.assign.set(u.id, k);
          taken.add(k);
          break;
        }
      }

      if (dest) {
        const [q, r] = dest.split(',').map(Number);
        orders.push({ kind: 'move', unit: u.id, q: q!, r: r!, goal: null, home: false });
        continue;
      }

      const onOwnLit = obs.mine.needles.find((n) => n.q === u.q && n.r === u.r && !n.dark && !n.fed);
      if (onOwnLit) orders.push({ kind: 'feed', unit: u.id, q: u.q, r: u.r });
    }

    if (orders.length === 0) orders.push({ kind: 'watch', q: this.base.q, r: this.base.r, keep: 0 });
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
  return ['expansion'];
}

export function createStrategy(_preset?: string): Strategy {
  return new ExpansionBot();
}
