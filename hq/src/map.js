const SQ3 = Math.sqrt(3);

const GROUND = {
  bare: '#262b31',
  meadow: '#26332a',
  wood: '#1f2d24',
  sand: '#363226',
  marsh: '#243036',
  hill: '#332e2c',
  water: '#1a2636',
  mount: '#3a3a40',
};

export const NEUTRAL = '#3b424b';
export const UNKNOWN = '#2e3339';

function hexPath(ctx, x, y, s) {
  ctx.moveTo(x, y - s);
  ctx.lineTo(x + (SQ3 / 2) * s, y - s / 2);
  ctx.lineTo(x + (SQ3 / 2) * s, y + s / 2);
  ctx.lineTo(x, y + s);
  ctx.lineTo(x - (SQ3 / 2) * s, y + s / 2);
  ctx.lineTo(x - (SQ3 / 2) * s, y - s / 2);
  ctx.closePath();
}

export class Board {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.bg = document.createElement('canvas');
    this.terrain = null;
    this.radius = 20;
    this.size = 8;
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.spots = new Map();
  }

  fit() {
    const box = this.cv.parentElement;
    const cw = Math.max(240, Math.floor(box.clientWidth));
    const R = this.radius;
    const size = cw / (SQ3 * (2 * R + 1) + 1);
    const h = Math.ceil(size * (3 * R + 2) + 4);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cw === this.w && h === this.h && dpr === this.dpr && this.bgReady) return false;
    this.w = cw;
    this.h = h;
    this.dpr = dpr;
    this.size = size;
    this.spots.clear();
    this.cv.width = Math.round(cw * dpr);
    this.cv.height = Math.round(h * dpr);
    this.cv.style.height = h + 'px';
    this.paintGround();
    return true;
  }

  setTerrain(t) {
    if (!t) return;
    this.terrain = t;
    this.radius = t.radius || 20;
    this.bgReady = false;
    this.fit();
    this.paintGround();
  }

  xy(q, r) {
    const s = this.size;
    return [this.w / 2 + s * SQ3 * (q + r / 2), this.h / 2 + s * 1.5 * r];
  }

  at(key) {
    let p = this.spots.get(key);
    if (!p) {
      const i = key.indexOf(',');
      p = this.xy(+key.slice(0, i), +key.slice(i + 1));
      this.spots.set(key, p);
    }
    return p;
  }

  paintGround() {
    const bg = this.bg;
    bg.width = this.cv.width;
    bg.height = this.cv.height;
    const g = bg.getContext('2d');
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#14171b';
    g.fillRect(0, 0, this.w, this.h);
    const s = this.size;
    const R = this.radius;
    const t = this.terrain;
    const types = t ? t.types : [];
    const fills = new Map();
    if (t) {
      for (let i = 0; i < t.cells.length; i += 3) {
        const name = types[t.cells[i + 2]] || 'bare';
        let list = fills.get(name);
        if (!list) fills.set(name, (list = []));
        list.push(t.cells[i], t.cells[i + 1]);
      }
    } else {
      const list = [];
      for (let q = -R; q <= R; q++) {
        for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) list.push(q, r);
      }
      fills.set('bare', list);
    }
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    for (const [name, list] of fills) {
      g.fillStyle = GROUND[name] || GROUND.bare;
      g.beginPath();
      for (let i = 0; i < list.length; i += 2) {
        const [x, y] = this.xy(list[i], list[i + 1]);
        hexPath(g, x, y, s * 0.98);
      }
      g.fill();
      g.stroke();
    }
    if (t && t.citadel) {
      const [x, y] = this.xy(t.citadel.q, t.citadel.r);
      g.strokeStyle = 'rgba(255,255,255,0.25)';
      g.lineWidth = 1.5;
      g.beginPath();
      hexPath(g, x, y, s * 1.9);
      g.stroke();
    }
    this.bgReady = true;
  }

  pick(px, py) {
    const s = this.size;
    const x = px - this.w / 2;
    const y = py - this.h / 2;
    const fq = ((SQ3 / 3) * x - y / 3) / s;
    const fr = ((2 / 3) * y) / s;
    const fs = -fq - fr;
    let q = Math.round(fq);
    let r = Math.round(fr);
    const ss = Math.round(fs);
    const dq = Math.abs(q - fq);
    const dr = Math.abs(r - fr);
    const ds = Math.abs(ss - fs);
    if (dq > dr && dq > ds) q = -r - ss;
    else if (dr > ds) r = -q - ss;
    if (Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)) > this.radius) return null;
    return [q, r];
  }

  draw(m, o) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (!m) return;
    const s = this.size;
    const col = o.colors;
    const paint = (a) => (a === '' || a === null || a === undefined ? NEUTRAL : col[a] || NEUTRAL);
    const truth = o.layer !== 'belief';
    const belief = o.layer !== 'truth';

    const fills = new Map();
    const add = (c, x, y, r) => {
      let list = fills.get(c);
      if (!list) fills.set(c, (list = []));
      list.push(x, y, r);
    };
    const flush = (round) => {
      for (const [c, list] of fills) {
        ctx.fillStyle = c;
        ctx.beginPath();
        for (let i = 0; i < list.length; i += 3) {
          if (round) {
            ctx.moveTo(list[i] + list[i + 2], list[i + 1]);
            ctx.arc(list[i], list[i + 1], list[i + 2], 0, Math.PI * 2);
          } else hexPath(ctx, list[i], list[i + 1], list[i + 2]);
        }
        ctx.fill();
      }
      fills.clear();
    };
    const spots = m.needles.map((n) => this.at(n[0]));
    const both = truth && belief;
    m.needles.forEach((n, i) => {
      const [x, y] = spots[i];
      if (truth) add(paint(n[1]), x, y, s * 0.86);
      else add(n[2] === '?' ? UNKNOWN : paint(n[2]), x, y, s * 0.86);
    });
    flush(false);
    if (both) {
      m.needles.forEach((n, i) => add(n[2] === '?' ? UNKNOWN : paint(n[2]), spots[i][0], spots[i][1], s * 0.45));
      flush(false);
      ctx.strokeStyle = '#ff5a4f';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      m.needles.forEach((n, i) => {
        if (n[2] !== '?' && (n[2] || '') !== (n[1] || '')) hexPath(ctx, spots[i][0], spots[i][1], s * 0.92);
      });
      ctx.stroke();
    }
    if (belief) {
      ctx.strokeStyle = '#0b0d10';
      ctx.lineWidth = 2;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      m.needles.forEach((n, i) => {
        if (n[3]) hexPath(ctx, spots[i][0], spots[i][1], s * 0.7);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (truth) {
      const r = Math.max(1.2, s * 0.18);
      ctx.fillStyle = '#fff3c4';
      ctx.beginPath();
      m.needles.forEach((n, i) => {
        if (!n[4]) return;
        ctx.moveTo(spots[i][0] + r, spots[i][1]);
        ctx.arc(spots[i][0], spots[i][1], r, 0, Math.PI * 2);
      });
      ctx.fill();
    }

    if (truth && m.units.length) {
      const r = Math.max(2, s * 0.38);
      for (const u of m.units) {
        const [x, y] = this.xy(u[2], u[3]);
        add(paint(u[1]), x, y, r);
      }
      flush(true);
      ctx.strokeStyle = '#0b0d10';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const u of m.units) {
        const [x, y] = this.xy(u[2], u[3]);
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.stroke();
    }

    if (belief) {
      const r = Math.max(2.5, s * 0.45);
      ctx.lineWidth = 1.5;
      for (const g of m.ghosts) {
        const [x, y] = this.xy(g[2], g[3]);
        ctx.globalAlpha = Math.max(0.25, 1 - g[4] / 150);
        ctx.strokeStyle = paint(g[1]);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (m.mine.length) {
        ctx.fillStyle = o.focusColor || '#fff';
        ctx.beginPath();
        for (const u of m.mine) {
          const [x, y] = this.xy(u[1], u[2]);
          ctx.moveTo(x, y - s * 0.5);
          ctx.lineTo(x + s * 0.45, y + s * 0.35);
          ctx.lineTo(x - s * 0.45, y + s * 0.35);
          ctx.closePath();
        }
        ctx.fill();
      }
    }

    if (o.unit) {
      const spots = [];
      if (truth) for (const u of m.units) if (u[0] === o.unit) spots.push([u[2], u[3]]);
      if (belief) for (const g of m.ghosts) if (g[0] === o.unit) spots.push([g[2], g[3]]);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      for (const [q, r] of spots) {
        const [x, y] = this.xy(q, r);
        ctx.beginPath();
        ctx.arc(x, y, s * 0.8, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    if (o.cell) {
      const i = o.cell.indexOf(',');
      const q = +o.cell.slice(0, i);
      const r = +o.cell.slice(i + 1);
      if (Number.isFinite(q) && Number.isFinite(r)) {
        const [x, y] = this.xy(q, r);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        hexPath(ctx, x, y, s * 1.05);
        ctx.stroke();
      }
    }
  }
}

export class Spark {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.bg = document.createElement('canvas');
    this.data = null;
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
  }

  set(series) {
    this.data = series ? { bytes: new Uint16Array(series.bytes), denies: new Uint8Array(series.denies) } : null;
    this.render();
  }

  fit() {
    const w = Math.max(120, Math.floor(this.cv.parentElement.clientWidth));
    const h = 44;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w === this.w && h === this.h && dpr === this.dpr) return false;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
    this.cv.style.height = h + 'px';
    this.render();
    return true;
  }

  render() {
    const bg = this.bg;
    bg.width = this.cv.width || 1;
    bg.height = this.cv.height || 1;
    const g = bg.getContext('2d');
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#14171b';
    g.fillRect(0, 0, this.w, this.h);
    const d = this.data;
    if (!d || !this.w) return;
    const n = d.bytes.length;
    let max = 1;
    for (let i = 0; i < n; i++) if (d.bytes[i] > max) max = d.bytes[i];
    const per = n / this.w;
    for (let x = 0; x < this.w; x++) {
      const a = Math.floor(x * per);
      const b = Math.max(a + 1, Math.floor((x + 1) * per));
      let top = 0;
      let deny = 0;
      for (let i = a; i < b && i < n; i++) {
        if (d.bytes[i] > top) top = d.bytes[i];
        deny += d.denies[i];
      }
      if (top) {
        const hh = Math.max(1, (top / max) * (this.h - 8));
        g.fillStyle = '#4f6b85';
        g.fillRect(x, this.h - hh, 1, hh);
      }
      if (deny) {
        g.fillStyle = '#ff5a4f';
        g.fillRect(x, 0, 1, Math.min(6, 2 + deny));
      }
    }
  }

  draw(t) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg, 0, 0);
    if (!this.data) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const n = this.data.bytes.length;
    const x = Math.round((t / Math.max(1, n - 1)) * (this.w - 1)) + 0.5;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, this.h);
    ctx.stroke();
  }
}
