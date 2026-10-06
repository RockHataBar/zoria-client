import { openHost } from './guest.js';
import { S } from './strings.js';
import Core from './worker.js?worker&inline';
import { Board, Spark } from './map.js';

const SLOTS = ['A', 'B', 'C'];
const SEAT = ['#e8a33d', '#4fa3e0', '#c066d6'];
const KEEPER = '#d3d8de';
const ARTICLES = ['network', 'orders', 'stolen', 'pactTax'];
const ARTICLE_KEY = { network: 'network', orders: 'ordersA', stolen: 'stolen', pactTax: 'pactTax' };

const $ = (s) => document.querySelector(s);
const fixed1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

const anchorCache = new Map();
const shown = new Map();

function anchors(name) {
  let list = anchorCache.get(name);
  if (!list) {
    list = Array.from(document.querySelectorAll('[data-zaria="' + name + '"]')).filter(
      (el) => !el.matches('input, select, textarea, button'),
    );
    anchorCache.set(name, list);
  }
  return list;
}

function put(name, value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (shown.get(name) === s) return;
  shown.set(name, s);
  for (const el of anchors(name)) el.textContent = s;
}

const staged = new Map();

function stage(name, value) {
  if (st.mode === 'live') {
    put(name, value);
    return;
  }
  staged.set(name, value);
}

function setText(el, s) {
  if (el && el.textContent !== s) el.textContent = s;
}

const organ = (name) => document.querySelector('[data-zaria="' + name + '"]');

const st = {
  mode: 'none',
  packs: [],
  packId: null,
  pack: null,
  match: 1,
  tick: 0,
  layer: 'truth',
  focus: '',
  cell: '',
  unit: '',
  order: 0,
  preset: '',
  seq: 0,
  promoteSeq: 0,
  live: null,
  playing: false,
  playAcc: 0,
  playPrev: 0,
  colors: { A: SEAT[0], B: SEAT[1], C: SEAT[2], K: KEEPER },
};

let hq = null;
let core = null;
let board = null;
let spark = null;
let dict = S.uk;
let last = null;
let drawQueued = false;
let boardDirty = true;
let panelsDirty = false;
let paintedAt = 0;
let rangeAt = '';
let sparkAt = -1;
let glide = 0;
const PAINT_MS = 33;
let pending = 0;
let ordersKey = '';
let unitsKey = '';
const local = new Map();

const text = (k) => dict[k] || S.uk[k] || k;

function note(s) {
  const el = $('#status');
  if (!s) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.textContent = s;
  el.hidden = false;
}

function setLang(lang) {
  dict = S[lang] || S.uk;
  for (const el of document.querySelectorAll('[data-t]')) {
    const k = el.getAttribute('data-t');
    if (dict[k]) el.textContent = dict[k];
  }
  document.documentElement.lang = lang === 'en' ? 'en' : 'uk';
  document.title = dict.title;
  setText($('#play'), st.playing ? text('pause') : text('play'));
  renderAb();
  if (st.mode === 'none' && !st.packs.length) note(text('noHost'));
}

function packEntry(id) {
  return st.packs.find((p) => p.id === id) || null;
}

function seatOf(pack, nick) {
  return pack && Array.isArray(pack.roster) ? pack.roster.indexOf(nick) : -1;
}

function beliefSeat(pack) {
  if (!pack || !pack.belief) return -1;
  if (typeof pack.belief.seat === 'number') return pack.belief.seat;
  return seatOf(pack, pack.belief.nick);
}

function focusSlot() {
  if (st.mode === 'live') {
    const i = st.live ? st.live.roster.indexOf(st.focus) : -1;
    return i >= 0 ? SLOTS[i] : null;
  }
  const p = st.pack;
  if (!p) return null;
  const seat = seatOf(p, st.focus);
  if (seat < 0) return null;
  const rot = p.rotations && p.rotations[st.match - 1];
  return rot ? rot[seat] : SLOTS[seat] || null;
}

function hasBelief() {
  if (st.mode === 'live') return !!st.live && st.live.roster.indexOf(st.focus) === st.live.seat;
  const p = st.pack;
  if (!p || !p.belief) return false;
  const seat = beliefSeat(p);
  return seat >= 0 && seatOf(p, st.focus) === seat;
}

function seatNicks() {
  if (st.mode === 'live') return st.live ? st.live.roster.slice(0, 3) : [];
  return st.pack && Array.isArray(st.pack.roster) ? st.pack.roster.slice(0, 3) : [];
}

function recolor() {
  const c = { K: KEEPER };
  if (st.mode === 'live') {
    SLOTS.forEach((s, i) => (c[s] = SEAT[i]));
  } else {
    const rot = st.pack && st.pack.rotations ? st.pack.rotations[st.match - 1] : null;
    SLOTS.forEach((s, i) => {
      const seat = rot ? rot.indexOf(s) : i;
      c[s] = SEAT[seat >= 0 ? seat : i];
    });
  }
  st.colors = c;
  const nicks = seatNicks();
  setText($('#legA'), nicks[0] || 'A');
  setText($('#legB'), nicks[1] || 'B');
  setText($('#legC'), nicks[2] || 'C');
}

function capTick() {
  if (st.mode === 'live') return st.live ? st.live.cap : 0;
  return st.pack && st.pack.ticks ? st.pack.ticks : 1200;
}

function maxTick() {
  if (st.mode === 'live') return st.live ? st.live.ticks || st.live.cap : 0;
  return capTick();
}

function ask() {
  if (!core) return;
  const q = {
    slot: focusSlot(),
    belief: hasBelief(),
    cell: st.cell,
    unit: st.unit,
    order: st.order,
  };
  if (st.mode === 'live') {
    if (!st.live) return;
    q.id = '@live';
    q.match = 0;
    q.t = st.tick;
    q.follow = st.live.follow;
  } else {
    if (!st.packId) return;
    q.id = st.packId;
    q.match = st.match;
    q.t = st.tick;
    q.follow = false;
  }
  q.seq = ++st.seq;
  core.postMessage({ k: 'view', q });
}

function load(id, name) {
  const key = id + '/' + name;
  let got;
  if (local.has(key)) {
    const v = local.get(key);
    got = Promise.resolve(v instanceof ArrayBuffer ? v.slice(0) : v);
  } else if (hq && hq.mode === 'record') {
    got = hq.file(id, name);
  } else {
    got = Promise.reject(new Error('no host'));
  }
  pending++;
  got.then(
    (bytes) => {
      pending--;
      const tr = bytes instanceof ArrayBuffer ? [bytes] : [];
      core.postMessage({ k: 'file', id, name, bytes }, tr);
    },
    () => {
      pending--;
      core.postMessage({ k: 'file', id, name, error: true });
    },
  );
  if (pending > 0 && !last) note(text('loading'));
}

function onCore(e) {
  const m = e.data || {};
  try {
    if (m.k === 'need') load(m.id, m.name);
    else if (m.k === 'view') apply(m);
    else if (m.k === 'quick') {
      if (m.seq === st.seq) {
        for (const k of Object.keys(m.v)) stage(k, m.v[k]);
        schedule(false);
      }
    }
    else if (m.k === 'fault') note(text('fault') + m.why);
  } catch (err) {
    note(String((err && err.message) || err));
  }
}

function apply(m) {
  if (m.seq !== st.seq) return;
  if (m.terrain) {
    board.setTerrain(m.terrain);
  }
  if (m.series) {
    spark.set(m.series);
    sparkAt = -1;
  }
  if (st.mode === 'live') {
    st.tick = m.t;
    put('tick', m.t);
    syncTick(null);
  }
  for (const k of Object.keys(m.v)) stage(k, m.v[k]);
  last = m.m;
  panelsDirty = true;
  if (st.mode === 'live' && st.live) {
    put('live-lag', Math.max(0, st.live.cap - m.t));
    hq.ready(m.t);
  }
  if (pending <= 0) note('');
  schedule();
}

function schedule(full) {
  if (full !== false) boardDirty = true;
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(draw);
}

function draw(ts) {
  drawQueued = false;
  if (staged.size) {
    for (const [k, v] of staged) put(k, v);
    staged.clear();
  }
  let again = false;
  if (glide !== st.tick || sparkAt < 0) {
    const d = st.tick - glide;
    glide = Math.abs(d) < 0.5 || sparkAt < 0 ? st.tick : glide + d * 0.35;
    sparkAt = 0;
    spark.draw(glide);
    again = glide !== st.tick;
  }
  if (boardDirty || panelsDirty || rangeAt !== String(st.tick)) {
    if (ts - paintedAt >= PAINT_MS) {
      paintedAt = ts;
      syncRange();
      if (panelsDirty) {
        panelsDirty = false;
        renderBoard();
        renderOrders();
        renderPulse();
        renderUnits();
      }
      if (boardDirty) {
        boardDirty = false;
        board.draw(last, {
          layer: st.layer,
          cell: st.cell,
          unit: st.unit,
          colors: st.colors,
          focusColor: st.colors[focusSlot()] || '#ffffff',
        });
      }
    } else again = true;
  }
  if (again) {
    drawQueued = true;
    requestAnimationFrame(draw);
  }
}

function renderBoard() {
  const body = $('#board tbody');
  if (!body.children.length) {
    for (let i = 0; i < 3; i++) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td><i class="sw"></i><span></span></td><td class="dim"></td><td class="n"></td><td class="n dim"></td>';
      body.append(tr);
    }
  }
  const rows = last ? last.board : null;
  const me = focusSlot();
  for (let i = 0; i < 3; i++) {
    const tr = body.children[i];
    const r = rows ? rows[i] : null;
    const slot = r ? r[0] : SLOTS[i];
    tr.className = slot === me ? 'me' : '';
    tr.children[0].firstChild.style.background = st.colors[slot] || '#555';
    setText(tr.children[0].lastChild, r ? r[1] : '');
    setText(tr.children[1], slot);
    setText(tr.children[2], r ? fixed1(r[2]) : '');
    setText(tr.children[3], r ? String(r[3]) : '');
  }
  setText($('#keeper'), last ? String(last.keeper) : '');
}

function renderOrders() {
  const list = last ? last.orders : [];
  const key = st.order + '|' + JSON.stringify(list);
  if (key === ordersKey) return;
  ordersKey = key;
  const ol = $('#orderList');
  ol.textContent = '';
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = text('noOrders');
    ol.append(li);
    return;
  }
  for (const o of list) {
    const li = document.createElement('li');
    li.textContent = o[1] + (o[2] ? ' ' + o[2] : '') + (o[3] ? ' - ' + o[3] : '');
    if (o[3]) li.className = 'bad';
    if (o[0] === st.order) li.style.fontWeight = '700';
    ol.append(li);
  }
}

function renderPulse() {
  const el = $('#pulse');
  const p = last ? last.pulse : null;
  if (!p) {
    setText(el, '');
    return;
  }
  const parts = [
    [text('energy'), p.energy],
    [text('chanP'), p.chan],
    [text('ear'), p.ear],
    [text('minutes'), typeof p.minutes === 'number' ? fixed1(p.minutes) : p.minutes],
  ];
  if (last.pact) parts.push([text('pact'), last.pact]);
  const s = parts.map((x) => x[0] + ' ' + (x[1] ?? '-')).join('   ');
  setText(el, text('pulse') + ':   ' + s);
}

function renderUnits() {
  const ids = last ? last.ghosts.map((g) => g[0]).sort() : [];
  const key = ids.join('|');
  if (key === unitsKey) return;
  unitsKey = key;
  const dl = $('#unitList');
  dl.textContent = '';
  for (const id of ids) {
    const o = document.createElement('option');
    o.value = id;
    dl.append(o);
  }
}

function abPair() {
  const a = packEntry('preset-a');
  const b = packEntry('preset-b');
  return a && b && a.pack && b.pack ? [a, b] : null;
}

function packSeat(p) {
  const s = beliefSeat(p.pack);
  return s >= 0 ? s : 0;
}

function matchBreak(p, n) {
  const pk = p.pack;
  const seat = packSeat(p);
  const rot = pk.rotations && pk.rotations[n - 1];
  const slot = rot ? rot[seat] : SLOTS[seat];
  const m = pk.matches && pk.matches[n - 1];
  return m && m.breakdown ? m.breakdown[slot] || null : null;
}

function renderAb() {
  const pair = abPair();
  const table = $('#abTable');
  if (!pair) {
    put('ab-winner', '');
    put('ab-diff', '');
    put('ab-top', '');
    table.textContent = '';
    return;
  }
  const [a, b] = pair;
  const allA = a.pack.breakdown ? a.pack.breakdown[packSeat(a)] : null;
  const allB = b.pack.breakdown ? b.pack.breakdown[packSeat(b)] : null;
  if (allA && allB) put('ab-winner', (allA.network ?? 0) >= (allB.network ?? 0) ? a.id : b.id);
  else put('ab-winner', '');
  const n = st.mode === 'live' ? 1 : st.match;
  const ba = matchBreak(a, n);
  const bb = matchBreak(b, n);
  let top = '';
  if (ba && bb) {
    put('ab-diff', fixed1(Math.abs((ba.total ?? 0) - (bb.total ?? 0))));
    let best = -1;
    for (const k of ARTICLES) {
      const d = Math.abs((ba[k] ?? 0) - (bb[k] ?? 0));
      if (d > best) {
        best = d;
        top = k;
      }
    }
    put('ab-top', top);
  } else {
    put('ab-diff', '');
    put('ab-top', '');
  }
  table.textContent = '';
  const head = document.createElement('tr');
  for (const s of [text('article') + ' (' + text('inMatch') + ' ' + n + ')', a.preset || a.id, b.preset || b.id, 'Δ']) {
    const th = document.createElement('th');
    th.textContent = s;
    head.append(th);
  }
  table.append(head);
  const row = (label, x, y, mark) => {
    const tr = document.createElement('tr');
    if (mark) tr.className = 'top';
    for (const s of [label, x === null ? '-' : fixed1(x), y === null ? '-' : fixed1(y), x === null || y === null ? '-' : fixed1(x - y)]) {
      const td = document.createElement('td');
      td.textContent = s;
      tr.append(td);
    }
    table.append(tr);
  };
  for (const k of ARTICLES) row(text(ARTICLE_KEY[k]), ba ? ba[k] ?? 0 : null, bb ? bb[k] ?? 0 : null, k === top);
  row(text('total'), ba ? ba.total ?? 0 : null, bb ? bb.total ?? 0 : null, false);
  row(text('network') + ' ' + text('inPack'), allA ? allA.network ?? 0 : null, allB ? allB.network ?? 0 : null, false);
}

function syncTick(from) {
  const f = organ('go-tick');
  const s = String(st.tick);
  if (from !== 'field' && f.value !== s && document.activeElement !== f) f.value = s;
  if (from === 'range') rangeAt = s;
  schedule(false);
}

function syncRange() {
  const s = String(st.tick);
  if (rangeAt === s) return;
  rangeAt = s;
  const r = $('#tickRange');
  if (r.value !== s) r.value = s;
}

function syncBounds() {
  const r = $('#tickRange');
  const mx = String(maxTick());
  if (r.max !== mx) r.max = mx;
  const f = organ('go-tick');
  if (f.max !== mx) f.max = mx;
  setText($('#tickMax'), '/ ' + mx);
}

function goTick(v, from) {
  const n = Math.round(Number(String(v).trim()));
  if (!Number.isFinite(n) || String(v).trim() === '') return;
  if (st.mode === 'live') {
    if (!st.live) return;
    const t = Math.max(0, Math.min(st.live.cap, n));
    st.live.follow = n >= st.live.cap;
    $('#toCap').hidden = st.live.follow;
    st.tick = t;
    syncTick(from);
    ask();
    return;
  }
  const t = Math.max(0, Math.min(capTick(), n));
  put('tick', t);
  if (t === st.tick) {
    syncTick(from);
    return;
  }
  st.tick = t;
  syncTick(from);
  ask();
  schedule(false);
}

function goMatch(v) {
  if (st.mode === 'live') return;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return;
  const max = st.pack && st.pack.matches ? st.pack.matches.length || 3 : 3;
  const m = Math.max(1, Math.min(max, n));
  put('match', m);
  const sel = organ('go-match');
  if (sel.value !== String(m)) sel.value = String(m);
  if (m === st.match) return;
  st.match = m;
  recolor();
  renderAb();
  ask();
}

function goMode(v) {
  const m = String(v).trim().toLowerCase();
  if (m !== 'truth' && m !== 'belief' && m !== 'both') return;
  st.layer = m;
  put('mode', m);
  const sel = organ('go-mode');
  if (sel.value !== m) sel.value = m;
  schedule();
}

function goFocus(v) {
  const nick = String(v).trim();
  if (!nick) return;
  put('focus', nick);
  if (nick === st.focus) return;
  st.focus = nick;
  ordersKey = '';
  ask();
  renderBoard();
  schedule();
}

function goCell(v) {
  const s = String(v).trim();
  const m = /^\(?\s*(-?\d+)\s*[,; ]\s*(-?\d+)\s*\)?$/.exec(s);
  let cell;
  if (m) cell = Number(m[1]) + ',' + Number(m[2]);
  else if (s === '') cell = '';
  else return;
  put('cell', cell);
  if (cell === st.cell) return;
  st.cell = cell;
  ask();
  schedule();
}

function goUnit(v) {
  const u = String(v).trim();
  if (u === st.unit) return;
  st.unit = u;
  setText($('#unitName'), u);
  ask();
  schedule();
}

function goOrder(v) {
  const n = Math.round(Number(String(v).trim()));
  if (!Number.isFinite(n) || String(v).trim() === '') return;
  const o = Math.max(0, n);
  if (o === st.order) return;
  st.order = o;
  ask();
}

function goPreset(v) {
  st.preset = String(v).trim();
}

async function promote() {
  const id = ++st.promoteSeq;
  if (!hq || hq.mode === 'none') {
    put('promote-status', '-');
    return;
  }
  put('promote-status', '…');
  let r = null;
  try {
    r = await Promise.race([hq.promote(st.preset), wait(10000).then(() => null)]);
  } catch {
    r = null;
  }
  if (id !== st.promoteSeq) return;
  put('promote-status', r && r.status !== undefined && r.status !== null ? String(r.status) : '-');
}

function usePack(id, force) {
  const p = packEntry(id);
  if (!p) return;
  const sel = organ('go-pack');
  if (sel.value !== id) sel.value = id;
  if (st.packId === id && !force) return;
  st.packId = id;
  st.pack = p.pack || {};
  setText($('#packName'), p.title || id);
  const n = (st.pack.matches && st.pack.matches.length) || 3;
  const ms = organ('go-match');
  if (ms.options.length !== n) {
    ms.textContent = '';
    for (let i = 1; i <= n; i++) {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = String(i);
      ms.append(o);
    }
  }
  st.match = Math.max(1, Math.min(n, st.match));
  ms.value = String(st.match);
  const fs = organ('go-focus');
  fs.textContent = '';
  for (const nick of st.pack.roster || []) {
    const o = document.createElement('option');
    o.value = nick;
    o.textContent = nick;
    fs.append(o);
  }
  const seat = beliefSeat(st.pack);
  st.focus = (st.pack.roster || [])[seat >= 0 ? seat : 0] || '';
  fs.value = st.focus;
  st.tick = Math.max(0, Math.min(capTick(), st.tick));
  last = null;
  ordersKey = '';
  put('match', st.match);
  put('tick', st.tick);
  put('focus', st.focus);
  put('shares', Array.isArray(st.pack.shares) ? st.pack.shares.join(',') : '');
  syncBounds();
  syncTick(null);
  recolor();
  renderAb();
  renderBoard();
  ask();
  schedule();
}

function setPlaying(on) {
  st.playing = on;
  setText($('#play'), on ? text('pause') : text('play'));
  if (on) {
    st.playPrev = 0;
    st.playAcc = 0;
    requestAnimationFrame(playStep);
  }
}

function playStep(ts) {
  if (!st.playing) return;
  if (st.playPrev) {
    const rate = 2 * (Number($('#speed').value) || 4);
    st.playAcc += ((ts - st.playPrev) / 1000) * rate;
    const n = Math.floor(st.playAcc);
    if (n > 0) {
      st.playAcc -= n;
      const next = Math.min(capTick(), st.tick + n);
      goTick(next, null);
      if (next >= capTick()) {
        setPlaying(false);
        return;
      }
    }
  }
  st.playPrev = ts;
  requestAnimationFrame(playStep);
}

function field(name, fn) {
  const el = organ(name);
  if (!el) return;
  if (el.matches('input, select, textarea')) {
    const run = () => {
      try {
        fn(el.value, 'field');
      } catch (err) {
        note(String((err && err.message) || err));
      }
    };
    el.addEventListener('input', run);
    el.addEventListener('change', run);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') run();
    });
  } else {
    el.addEventListener('click', () => {
      try {
        fn(el.getAttribute('data-zaria-value') || '');
      } catch (err) {
        note(String((err && err.message) || err));
      }
    });
  }
}

function setField(name, value) {
  const el = organ(name);
  if (el && el.value !== value) el.value = value;
}

function wire() {
  field('go-pack', (v) => usePack(v));
  field('go-match', (v) => goMatch(v));
  field('go-tick', (v, from) => goTick(v, from));
  field('go-mode', (v) => goMode(v));
  field('go-focus', (v) => goFocus(v));
  field('go-cell', (v) => goCell(v));
  field('go-unit', (v) => goUnit(v));
  field('go-order', (v) => goOrder(v));
  field('go-preset', (v) => goPreset(v));
  field('do-promote', () => {
    void promote();
  });

  $('#tickRange').addEventListener('input', (e) => goTick(e.currentTarget.value, 'range'));
  $('#play').addEventListener('click', () => setPlaying(!st.playing));
  $('#toCap').addEventListener('click', () => {
    if (!st.live) return;
    goTick(st.live.cap, null);
  });

  $('#map').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const hit = board.pick(e.clientX - r.left, e.clientY - r.top);
    if (!hit) return;
    const key = hit[0] + ',' + hit[1];
    setField('go-cell', key);
    goCell(key);
    if (!last) return;
    let unit = null;
    for (const g of last.ghosts) if (g[2] === hit[0] && g[3] === hit[1]) unit = g[0];
    if (!unit) {
      const me = focusSlot();
      for (const u of last.units) if (u[2] === hit[0] && u[3] === hit[1] && u[1] !== me) unit = u[0];
    }
    if (unit) {
      setField('go-unit', unit);
      goUnit(unit);
    }
  });

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && t.matches && t.matches('input, select, textarea')) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const d = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1);
      goTick(st.tick + d, null);
      e.preventDefault();
    } else if (e.key === ' ' && st.mode === 'record') {
      setPlaying(!st.playing);
      e.preventDefault();
    }
  });

  let resizeQueued = false;
  window.addEventListener('resize', () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      board.fit();
      spark.fit();
      sparkAt = -1;
      schedule();
    });
  });

  $('#openFiles').addEventListener('change', (e) => {
    void openLocal(Array.from(e.currentTarget.files || []));
  });
}

async function openLocal(files) {
  try {
    const pf = files.find((f) => f.name === 'pack.json');
    if (!pf) {
      note(text('noHost'));
      return;
    }
    const pack = JSON.parse(await pf.text());
    for (const f of files) {
      local.set('local/' + f.name, /\.(ndjson|json)$/.test(f.name) ? await f.text() : await f.arrayBuffer());
    }
    st.mode = 'record';
    st.packs = [{ id: 'local', title: pack.roster ? pack.roster.join(' · ') : 'local', preset: '', pack }];
    fillPacks();
    core.postMessage({ k: 'pack', id: 'local', pack, warm: true });
    note('');
    usePack('local', true);
    put('live-lag', '-');
    put('live-state', '-');
  } catch (err) {
    note(text('fault') + String((err && err.message) || err));
  }
}

function fillPacks() {
  const sel = organ('go-pack');
  sel.textContent = '';
  for (const p of st.packs) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.title || p.id;
    sel.append(o);
  }
  const dl = $('#presetList');
  dl.textContent = '';
  const seen = new Set();
  for (const p of st.packs) {
    if (p.preset && !seen.has(p.preset)) {
      seen.add(p.preset);
      const o = document.createElement('option');
      o.value = p.preset;
      dl.append(o);
    }
  }
  if (!st.preset && st.packs.length) {
    st.preset = st.packs[0].preset || '';
    setField('go-preset', st.preset);
  }
}

function startRecord() {
  st.mode = 'record';
  st.packs = hq.packs().filter((p) => p && p.id);
  fillPacks();
  const first = packEntry('reference') || st.packs[0] || null;
  for (const p of st.packs) core.postMessage({ k: 'pack', id: p.id, pack: p.pack || {}, warm: !!first && p.id === first.id });
  put('live-lag', '-');
  put('live-state', '-');
  if (first) usePack(first.id, true);
  else note(text('noHost'));
}

function startLive(info) {
  st.mode = 'live';
  st.live = {
    cap: hq.cap() || 0,
    ticks: Number(info.ticks) || 0,
    roster: Array.isArray(info.roster) ? info.roster.slice() : [],
    seat: Number(info.seat) || 0,
    follow: true,
    ended: false,
  };
  st.focus = st.live.roster[st.live.seat] || '';
  st.tick = 0;
  const fs = organ('go-focus');
  fs.textContent = '';
  for (const nick of st.live.roster) {
    const o = document.createElement('option');
    o.value = nick;
    o.textContent = nick;
    fs.append(o);
  }
  fs.value = st.focus;
  organ('go-pack').disabled = true;
  organ('go-match').disabled = true;
  $('#play').hidden = true;
  $('#speed').hidden = true;
  setText($('#packName'), text('liveName'));
  put('match', '-');
  put('tick', 0);
  put('focus', st.focus);
  put('shares', '');
  put('live-state', 'live');
  put('live-lag', 0);
  recolor();
  syncBounds();
  core.postMessage({
    k: 'live',
    manifest: info.manifest,
    bots: info.bots,
    roster: info.roster,
    ticks: info.ticks,
    seat: info.seat,
  });

  hq.on('tick', (m) => {
    try {
      const t = Number(m.t) || 0;
      if (t > st.live.cap) st.live.cap = t;
      const subs = [];
      const tr = [];
      const seen = new Set();
      for (const s of m.submits || []) {
        const b = s[1];
        subs.push([s[0], b]);
        if (b instanceof ArrayBuffer && !seen.has(b)) {
          seen.add(b);
          tr.push(b);
        }
      }
      core.postMessage({ k: 'tick', t, submits: subs, denies: m.denies || [], belief: m.belief || null }, tr);
      put('live-lag', Math.max(0, st.live.cap - st.tick));
      syncBounds();
    } catch (err) {
      note(String((err && err.message) || err));
    }
  });

  hq.on('end', (m) => {
    try {
      st.live.ended = true;
      const t = Number(m && m.t) || 0;
      if (t > st.live.cap) st.live.cap = t;
      const shares = m && Array.isArray(m.shares) ? m.shares : null;
      put('shares', shares ? shares.join(',') : '');
      put('live-state', 'end');
    } catch (err) {
      note(String((err && err.message) || err));
    }
  });

  ask();
}

function firstReady() {
  let sent = false;
  const go = () => {
    if (sent) return;
    sent = true;
    hq.ready(st.tick);
  };
  requestAnimationFrame(() => requestAnimationFrame(go));
  setTimeout(go, 300);
}

async function main() {
  board = new Board($('#map'));
  spark = new Spark($('#spark'));
  board.fit();
  spark.fit();
  put('mode', st.layer);
  put('promote-status', '-');
  put('live-lag', '-');
  put('live-state', '-');
  put('tick', 0);

  core = new Core();
  core.onmessage = onCore;
  core.onerror = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    note(text('fault') + String((e && e.message) || 'worker'));
  };
  core.onmessageerror = () => {};

  hq = await openHost({ hq: 'zoria-hq' });
  setLang(hq.lang);
  hq.on('lang', (l) => {
    try {
      setLang(l);
    } catch {
      note('');
    }
  });
  wire();

  if (hq.mode === 'record') startRecord();
  else if (hq.mode === 'live') startLive(hq.live());
  else {
    $('#openBox').hidden = false;
    note(text('noHost'));
  }

  schedule();
  firstReady();
}

main().catch((err) => note(String((err && err.message) || err)));
