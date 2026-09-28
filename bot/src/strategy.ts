import { BlankBot } from '@zoria/sdk';
import type { BeliefFrame } from '@zoria/sdk';
import { decodeVerdicts } from '@zoria/protocol';
import type { ClsName, Hex, Observe, Order, SlotName } from '@zoria/protocol';

const HARD_DENY = new Set([11, 12, 13, 21]);

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
  private costNeedle = 60;
  private capWeight = 8;
  private linkRange = 5;
  private center: Hex = { q: 0, r: 0 };
  private buildable = new Set<string>();
  private sent: Order[] = [];
  private silent = 0;
  private lastT = 0;

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

  override init(manifestBytes: Uint8Array, slot: SlotName): void {
    super.init(manifestBytes, slot);
    const m = this.manifest;
    if (!m) return;
    const idx = { A: 0, B: 1, C: 2 }[slot];
    const seat = m.seats[idx];
    this.base = seat ?? SEATS[slot];
    this.costTkach = m.cfg['costTkach'] ?? 90;
    this.costNeedle = m.cfg['costNeedle'] ?? 60;
    this.capWeight = m.cfg['squadWeight'] ?? 8;
    this.linkRange = m.cfg['linkRange'] ?? 5;
    this.center = m.citadel;
    this.ruins = m.needles
      .filter((n) => n.start === null && !n.ring && !n.spoke)
      .map((n) => ({ q: n.q, r: n.r }))
      .sort((a, b) => dist(a, this.base) - dist(b, this.base));

    const radius = m.terrain.radius - 1;
    const blocked = new Set<string>();
    for (const n of m.needles) blocked.add(key(n.q, n.r));
    for (const f of m.finds) if (f.kind === 'dead') blocked.add(key(f.q, f.r));
    const buildType = new Map<string, boolean>();
    for (const c of m.terrain.cells) {
      const type = m.terrain.types[c[2]];
      buildType.set(key(c[0], c[1]), type ? type.build : false);
    }
    const bases = m.seats;
    for (let q = -radius; q <= radius; q++) {
      for (let r = -radius; r <= radius; r++) {
        const h = { q, r };
        if (dist(h, this.center) > radius) continue;
        const k = key(q, r);
        if (blocked.has(k)) continue;
        if (!(buildType.get(k) ?? true)) continue;
        if (bases.some((b) => dist(h, b) <= 2)) continue;
        this.buildable.add(k);
      }
    }
  }

  private bridgeSite(ruin: Hex, anchors: Hex[], t: number, occupied: Set<string>): Hex | null {
    let best: Hex | null = null;
    let bestD = Infinity;
    for (let dq = -this.linkRange; dq <= this.linkRange; dq++) {
      for (let dr = -this.linkRange; dr <= this.linkRange; dr++) {
        const h = { q: ruin.q + dq, r: ruin.r + dr };
        if (dist(h, ruin) > this.linkRange || dist(h, ruin) === 0) continue;
        const hk = key(h.q, h.r);
        if (!this.buildable.has(hk) || this.isBlocked(hk, t) || occupied.has(hk)) continue;
        const near = anchors.find((a) => dist(a, h) <= this.linkRange);
        if (!near) continue;
        const d = dist(h, this.base);
        if (d < bestD) {
          bestD = d;
          best = h;
        }
      }
    }
    return best;
  }

  protected override think(obs: Observe): Order[] {
    const t = obs.t;
    this.lastT = t;
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
    const occupied = new Set(units.map((u) => key(u.q, u.r)));
    const feedClaim = new Set<string>();

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

      if (u.task?.site) continue;

      if (obs.pulse.energy >= this.costNeedle + 30) {
        let far: Hex | undefined;
        for (const ruin of this.ruins) {
          const k = key(ruin.q, ruin.r);
          if (mine.has(k) || enemy.has(k) || taken.has(k) || this.isBlocked(k, t)) continue;
          if (anchors.some((a) => dist(a, ruin) <= this.linkRange)) continue;
          const d = Math.min(...anchors.map((a) => dist(a, ruin)));
          if (d <= 2 * this.linkRange) {
            far = ruin;
            break;
          }
        }
        if (far) {
          const site = this.bridgeSite(far, anchors, t, occupied);
          if (site && !taken.has(key(site.q, site.r))) {
            taken.add(key(site.q, site.r));
            orders.push({ kind: 'needle', unit: u.id, q: site.q, r: site.r });
            continue;
          }
        }
      }

      const fed = u.task?.feed;
      if (fed && fed.q === u.q && fed.r === u.r) continue;

      const onHere = obs.mine.needles.find((n) => n.q === u.q && n.r === u.r && !n.dark && !n.fed);
      if (onHere) {
        orders.push({ kind: 'feed', unit: u.id, q: u.q, r: u.r });
        feedClaim.add(here);
        continue;
      }

      let best: (typeof obs.mine.needles)[number] | undefined;
      for (const n of obs.mine.needles) {
        if (n.dark || n.fed) continue;
        const k = key(n.q, n.r);
        if (feedClaim.has(k) || (occupied.has(k) && k !== here) || this.isBlocked(k, t)) continue;
        if (!best || n.weight > best.weight || (n.weight === best.weight && dist(n, u) < dist(best, u))) best = n;
      }
      if (best) {
        feedClaim.add(key(best.q, best.r));
        orders.push({ kind: 'move', unit: u.id, q: best.q, r: best.r, goal: null, home: false });
      }
    }

    if (this.silent > 0 || orders.length === 0) orders.unshift({ kind: 'watch', q: this.base.q, r: this.base.r, keep: 0 });
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
  return ['expansion'];
}

export function createStrategy(_preset?: string): Strategy {
  return new ExpansionBot();
}
