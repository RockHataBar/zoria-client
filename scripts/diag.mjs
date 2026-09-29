import { createEngine } from '@zoria/engine';
import { ARCHETYPES, runPack } from '@zoria/sdk';
import { decodeManifest, decodeObserve, decodeOrders, decodeVerdicts } from '@zoria/protocol';
import { createStrategy } from './dist/strategy.js';

const rivals = process.argv[2] ? process.argv[2].split(',') : ['обхідник', 'рівний'];
const seeds = Number(process.argv[3] || 2);
const preset = process.argv[4] && process.argv[4] !== '-' ? process.argv[4] : undefined;
const first = Number(process.argv[5] || 2026);

async function seat(name) {
  if (name.startsWith('@')) return { bot: () => createStrategy(name.slice(1)) };
  if (name.startsWith('^')) {
    const [dir, p] = name.slice(1).split(':');
    const mod = await import(`./${dir}/dist/strategy.js`);
    return { bot: () => mod.createStrategy(p) };
  }
  return { style: ARCHETYPES[name] };
}

const DENY = ['', 'сміття', 'стеля', 'машина', 'поворот', 'тариф', 'канал', 'вуха', 'верф', 'заряд', 'вага рою', 'земля', 'немає шляху', 'не своя голка', 'спалах', 'погляд', 'таран', 'ціль', 'глушіння', 'угода', 'клич', 'відмова', 'торги'];

function probe() {
  const inner = createStrategy(preset);
  const s = { built: {}, lost: {}, myRams: 0, ramsOnMe: 0, jamsOnMe: 0, myJams: 0, orders: 0, deny: {}, needles: [], ring: [], energy: [], mute: 0, units: [], where: {} };
  let ring = new Set();
  let sites = new Set();
  const owner = new Map();
  const pos = new Map();
  let slot = null;
  let last = [];
  let dawn = 1000;
  return {
    stats: s,
    init(mb, sl) {
      slot = sl;
      const m = decodeManifest(mb);
      ring = new Set(m.needles.filter((n) => n.ring || n.spoke).map((n) => n.q + ',' + n.r));
      sites = new Set(m.needles.map((n) => n.q + ',' + n.r));
      dawn = m.dawn.at;
      inner.init(mb, sl);
    },
    tick(ob) {
      const o = decodeObserve(ob);
      const out = inner.tick(ob);
      last = decodeOrders(out) ?? [];
      for (const x of last) if (x.kind === 'bid') s.bids = (s.bids ?? '') + ` #${x.lot}:${x.amount}@${o?.t}`;
      if (o) {
        for (const e of o.own) owner.set(e.q + ',' + e.r, e.owner);
        for (const n of o.mine.needles) owner.set(n.q + ',' + n.r, slot);
        for (const e of o.events) {
          if (e.type === 'lost' && e.p === slot && e.cls === 'ткач' && e.why === 'таран') {
            const k = e.q + ',' + e.r;
            const ow = owner.get(k);
            const kind = !sites.has(k) ? 'поле' : ow === slot ? 'своя' : ow === null || ow === undefined ? 'руїна' : ow === 'K' ? 'ключник' : 'чужа';
            s.where[kind] = (s.where[kind] ?? 0) + 1;
          }
        }
        for (const e of o.events) {
          if (e.type === 'build' && e.p === slot) s.built[e.cls] = (s.built[e.cls] ?? 0) + 1;
          if (e.type === 'lost' && e.p === slot) s.lost[e.cls + ':' + e.why] = (s.lost[e.cls + ':' + e.why] ?? 0) + 1;
          if (e.type === 'lost' && e.p === slot && (s.early ?? []).length < 12) (s.early ??= []).push(`${o.t}${e.cls === 'ткач' ? 'Т' : 'К'}@${e.q},${e.r}`);
          if (e.type === 'build' && e.p === slot && (s.births ?? []).length < 12) (s.births ??= []).push(`${o.t}${e.cls === 'ткач' ? 'Т' : 'К'}`);
          if (e.type === 'ram' && e.p === slot) s.myRams++;
          if (e.type === 'ram' && e.tgt === slot && e.p !== slot) s.ramsOnMe++;
          if (e.type === 'jam' && e.own === slot && e.p !== slot) s.jamsOnMe++;
          if (e.type === 'jam' && e.p === slot) s.myJams++;
          if (e.type === 'orderDone' && e.p === slot) s.orders++;
          if (e.type === 'order') s.opened = (s.opened ?? 0) + 1;
          if (e.type === 'lot') s.lots = (s.lots ?? '') + (e.p === slot ? 'м' : e.p ? 'ч' : '-');
        }
        if (o.pulse.energy >= 355) s.capped = (s.capped ?? 0) + 1;
        const board = o.pub.order;
        if (board && board.from === o.t - 0) {
          const tag = board.cells.map((c) => { const ow = owner.get(c.q + ',' + c.r); return ow === slot ? 'м' : ow === undefined || ow === null ? '0' : ow === 'K' ? 'K' : 'ч'; }).join('');
          s.boards = (s.boards ?? '') + ' ' + tag;
        }
        if (o.mine.order && o.mine.order.reason) s.reasons = s.reasons ?? {}, s.reasons[o.mine.order.reason] = (s.reasons[o.mine.order.reason] ?? 0) + 1;
        if (o.mine.order && o.mine.order.ticks > (s.maxHold ?? 0)) s.maxHold = o.mine.order.ticks;
        if (process.env.DIAG_AT && process.env.DIAG_AT.split(',').map(Number).includes(o.t)) {
          const line = o.mine.units.filter((u) => u.cls === 'ткач').map((u) => `${u.id}@${u.q},${u.r} w${u.wait} p${u.task?.path ?? 0} ${u.stuck ? 'stuck ' : ''}g${JSON.stringify(u.task?.goal)} s${JSON.stringify(u.task?.site)} f${JSON.stringify(u.task?.feed)}`).join(' | ');
          const sent = last.filter((x) => x.unit && x.unit.startsWith('T')).map((x) => `${x.kind}>${x.unit}@${x.q},${x.r}`).join(' ');
          s.dump = (s.dump ? s.dump + '\n      ' : '') + `t${o.t} e${Math.round(o.pulse.energy)} ${line} || ${sent}`;
        }
        if (o.t === 1199) s.crown = o.mine.needles.filter((n) => n.weight > 1.01).length;
        for (const u of o.mine.units) if (u.mute) s.mute++;
        if (o.t % 200 === 0 || o.t === 1199) {
          s.needles.push(o.mine.needles.length + '/' + o.mine.needles.filter((n) => n.weight > 1.01).length);
          s.energy.push(Math.round(o.pulse.energy));
          s.units.push(o.mine.units.map((u) => (u.cls === 'ткач' ? 'Т' : 'К')).join(''));
        }
        if (o.t === dawn + 60 || o.t === 1199) s.ring.push(o.mine.needles.filter((n) => ring.has(n.q + ',' + n.r)).length);
      }
      return out;
    },
    feedback(vb) {
      const v = decodeVerdicts(vb) ?? [];
      for (const [i, ok, code] of v) if (!ok) {
        const k = (last[i]?.kind ?? '?') + ':' + DENY[code];
        s.deny[k] = (s.deny[k] ?? 0) + 1;
      }
      inner.feedback?.(vb);
    },
  };
}

const r0 = await seat(rivals[0]);
const r1 = await seat(rivals[1]);
for (let x = 0; x < seeds; x++) {
  const seed = first + x;
  const probes = [];
  const pack = runPack(createEngine, {
    seed, ticks: 1200,
    cast: [{ bot: () => { const p = probe(); probes.push(p); return p; } }, r0, r1],
  });
  console.log('жереб', seed, 'частки', JSON.stringify(pack.shares));
  pack.matches.forEach((m, i) => {
    const slots = ['A', 'B', 'C'];
    const sc = [0, 1, 2].map((p) => m.score[slots[(p + i) % 3]].toFixed(0)).join(' / ');
    const st = probes[i].stats;
    console.log(`  партія ${i + 1}: рахунок ${sc}`);
    console.log(`    голки ${st.needles.join(' ')} | заряд ${st.energy.join(' ')} | кільце ${st.ring.join('->')} | замовлень ${st.orders}/${st.opened ?? 0} | вінець ${st.crown ?? 0} | лоти ${st.lots ?? ''} | тактів на стелі заряду ${st.capped ?? 0}`);
    console.log(`    рій ${st.units.join(' ')} | збудовано ${JSON.stringify(st.built)} | втрати ${JSON.stringify(st.lost)}`);
    console.log(`    мої тарани ${st.myRams}, тарани по мені ${st.ramsOnMe} ${JSON.stringify(st.where)}, мої завади ${st.myJams}, завади по мені ${st.jamsOnMe}, без рук ${st.mute}`);
    console.log(`    замовлення:${st.boards ?? ''} | причини ${JSON.stringify(st.reasons ?? {})} | найдовше утримання ${st.maxHold ?? 0} | ставки${st.bids ?? ' -'}`);
    console.log(`    відмови ${JSON.stringify(st.deny)}`);
    console.log(`    народження ${(st.births ?? []).join(' ')} | загибелі ${(st.early ?? []).join(' ')}`);
    if (st.dump) console.log('    машини:\n      ' + st.dump);
  });
}
