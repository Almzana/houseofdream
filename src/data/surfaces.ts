import { type Ctx, grain, grout, relief, rng, speckle, wrapDraw } from '../engine/canvas';

/**
 * Procedural surfaces. Drawn on a 512 logical canvas (rendered at 2x).
 * unit  = metres covered by one texture repeat [x, z]
 * rough = roughness [surface, grout], ns = normal strength, coat = clear-coat
 */
export interface FloorPrice {
  m2: number; // material THB / m²
  box?: number; // m² per box
  labor: number; // THB / m²
}
export interface Surface {
  id: string;
  name: string;
  unit: [number, number];
  rough: [number, number];
  ns: number;
  coat?: number;
  tint?: boolean;
  draw: (ctx: Ctx, W: number, H: number) => void;
  relief: 'luma' | 'invluma' | ((ctx: Ctx, W: number, H: number) => void);
}
export interface FloorDef extends Surface {
  dims: [number, number] | null; // tile size cm
  area?: number; // m² per tile when not a rectangle
  price: FloorPrice;
  adhesive: boolean; // laid with tile adhesive + grout
  outdoor?: boolean;
}
export type WallPrice =
  | { kind: 'paint' }
  | { kind: 'tile'; m2: number; tile: number; tileLabel?: string; box: number; labor: number }
  | { kind: 'roll'; roll: number; rollM2: number }
  | { kind: 'area'; m2: number; label: string };
export interface WallDef extends Surface {
  price: WallPrice;
}

export const FLOORS: FloorDef[] = [
  {
    id: 'antislip', name: 'กันลื่นเทา 30×30', unit: [0.6, 0.6], dims: [30, 30], adhesive: true,
    price: { m2: 280, box: 0.99, labor: 300 }, rough: [0.7, 0.95], ns: 1.2,
    draw(ctx, W, H) {
      const s = W / 2, tone = ['#9fa09c', '#a6a7a2', '#9a9b97', '#a3a49f'];
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = tone[i * 2 + j]; ctx.fillRect(i * s, j * s, s, s); }
      speckle(ctx, W, H, 6000, 17, ['rgba(60,60,60,.25)', 'rgba(255,255,255,.18)']);
      grout(ctx, W, H, 2, 2, '#e6e4de', 4);
    },
    relief(ctx, W, H) { speckle(ctx, W, H, 9000, 18, ['#b8b8b8', '#d0d0d0']); relief.grid(2, 2, 6)(ctx, W, H); },
  },
  {
    id: 'granito', name: 'แกรนิตโต้เทา 60×60', unit: [1.2, 1.2], dims: [60, 60], adhesive: true,
    price: { m2: 420, box: 1.44, labor: 350 }, rough: [0.18, 0.9], ns: 0.9, coat: 0.6,
    draw(ctx, W, H) {
      const r = rng(41), tone = ['#b9b8b3', '#bdbcb7', '#b5b4af', '#bab9b4'], s = W / 2;
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = tone[i * 2 + j]; ctx.fillRect(i * s, j * s, s, s); }
      for (let i = 0; i < 30; i++) {
        const x = r() * W, y = r() * H, rad = 40 + r() * 100;
        wrapDraw(ctx, W, H, () => { const g = ctx.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, 'rgba(255,255,255,.12)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2); });
      }
      speckle(ctx, W, H, 5000, 42, ['rgba(80,80,80,.18)', 'rgba(255,255,255,.2)']);
      grout(ctx, W, H, 2, 2, '#9a9893', 2);
    },
    relief: relief.grid(2, 2, 4),
  },
  {
    id: 'oak', name: 'ไม้โอ๊คลามิเนต', unit: [1.2, 1.2], dims: [20, 120], adhesive: false,
    price: { m2: 450, box: 1.92, labor: 150 }, rough: [0.45, 0.85], ns: 0.6, coat: 0.2,
    draw(ctx, W, H) {
      const r = rng(7), rows = 6, rh = H / rows, tone = ['#b88a5c', '#a97c50', '#c29463', '#9f744a', '#b58556', '#a78057'];
      for (let i = 0; i < rows; i++) {
        ctx.fillStyle = tone[i]; ctx.fillRect(0, i * rh, W, rh); grain(ctx, i * rh, rh, W, r, 16, '90,55,25');
        ctx.fillStyle = 'rgba(60,35,15,.55)'; ctx.fillRect(r() * W, i * rh, 2, rh); ctx.fillRect(0, i * rh, W, 1.5);
      }
    },
    relief: 'luma',
  },
  {
    id: 'walnut', name: 'ไม้วอลนัทเข้ม', unit: [1.2, 1.2], dims: [20, 120], adhesive: false,
    price: { m2: 690, box: 1.92, labor: 150 }, rough: [0.4, 0.85], ns: 0.6, coat: 0.3,
    draw(ctx, W, H) {
      const r = rng(8), rows = 6, rh = H / rows, tone = ['#6b4a33', '#5e412c', '#73503a', '#583c29', '#664632', '#5a3f2b'];
      for (let i = 0; i < rows; i++) {
        ctx.fillStyle = tone[i]; ctx.fillRect(0, i * rh, W, rh); grain(ctx, i * rh, rh, W, r, 18, '35,20,10');
        ctx.fillStyle = 'rgba(25,15,8,.6)'; ctx.fillRect(r() * W, i * rh, 2, rh); ctx.fillRect(0, i * rh, W, 1.5);
      }
    },
    relief: 'luma',
  },
  {
    id: 'chevron', name: 'ไม้ลายก้างปลา', unit: [1.6, 1.6], dims: [14, 56], adhesive: false,
    price: { m2: 1600, box: 1.0, labor: 350 }, rough: [0.4, 0.85], ns: 0.7, coat: 0.3,
    draw(ctx, _W, H) {
      const tone = ['#9a6a42', '#a8774c', '#8f613c', '#b2824f', '#9c6d44', '#a37148', '#8b5e3a', '#ad7b4e'];
      for (let c = 0; c < 4; c++) {
        const x0 = c * 128, up = c % 2 === 0;
        ctx.save(); ctx.beginPath(); ctx.rect(x0, 0, 128, H); ctx.clip();
        for (let k = -4; k < 12; k++) {
          const y = k * 64; ctx.fillStyle = tone[((k % 8) + 8) % 8]; ctx.beginPath();
          if (up) { ctx.moveTo(x0, y); ctx.lineTo(x0 + 128, y + 128); ctx.lineTo(x0 + 128, y + 192); ctx.lineTo(x0, y + 64); }
          else { ctx.moveTo(x0, y + 128); ctx.lineTo(x0 + 128, y); ctx.lineTo(x0 + 128, y + 64); ctx.lineTo(x0, y + 192); }
          ctx.closePath(); ctx.fill(); ctx.strokeStyle = 'rgba(60,35,18,.55)'; ctx.lineWidth = 1.5; ctx.stroke();
        }
        ctx.restore();
      }
      speckle(ctx, 512, H, 1500, 5, ['rgba(70,40,20,.15)', 'rgba(255,230,200,.08)']);
    },
    relief: 'luma',
  },
  {
    id: 'marble', name: 'หินอ่อนขาว 60×60', unit: [1.2, 1.2], dims: [60, 60], adhesive: true,
    price: { m2: 650, box: 1.44, labor: 350 }, rough: [0.12, 0.9], ns: 1, coat: 0.8,
    draw(ctx, W, H) {
      const r = rng(11); ctx.fillStyle = '#ecebe6'; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 36; i++) {
        const x = r() * W, y = r() * H, rad = 40 + r() * 120;
        wrapDraw(ctx, W, H, () => { const g = ctx.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, 'rgba(196,194,186,.28)'); g.addColorStop(1, 'rgba(196,194,186,0)'); ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2); });
      }
      for (let v = 0; v < 8; v++) {
        let x = r() * W, y = r() * H, a = r() * Math.PI * 2; const pts: [number, number][] = [[x, y]];
        for (let s = 0; s < 28; s++) { a += (r() - 0.5) * 0.7; x += Math.cos(a) * 14; y += Math.sin(a) * 14; pts.push([x, y]); }
        const lw = 0.6 + r() * 2.2, al = 0.15 + r() * 0.35;
        wrapDraw(ctx, W, H, () => { ctx.strokeStyle = `rgba(118,116,110,${al})`; ctx.lineWidth = lw; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); });
      }
      grout(ctx, W, H, 2, 2, 'rgba(150,145,135,.65)', 2);
    },
    relief: relief.grid(2, 2, 4),
  },
  {
    id: 'checker', name: 'หมากรุกขาวดำ 30×30', unit: [0.6, 0.6], dims: [30, 30], adhesive: true,
    price: { m2: 450, box: 0.99, labor: 350 }, rough: [0.25, 0.9], ns: 1, coat: 0.5,
    draw(ctx, W, H) {
      const s = W / 2;
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = (i + j) % 2 ? '#26292b' : '#efece4'; ctx.fillRect(i * s, j * s, s, s); }
      speckle(ctx, W, H, 1800, 9, ['rgba(128,128,128,.18)']); grout(ctx, W, H, 2, 2, 'rgba(130,128,122,.7)', 3);
    },
    relief: relief.grid(2, 2, 5),
  },
  {
    id: 'hex', name: 'ดินเผาหกเหลี่ยม', unit: [0.4, 0.3464], dims: [20, 23], area: 0.0346, adhesive: true,
    price: { m2: 950, box: 1.0, labor: 450 }, rough: [0.75, 0.95], ns: 1.4,
    draw(ctx, W, H) {
      const r = 100, q = Math.sqrt(3) * r, LW = 2 * q, LH = 3 * r;
      ctx.fillStyle = '#d6cfc1'; ctx.fillRect(0, 0, W, H); ctx.save(); ctx.scale(W / LW, H / LH);
      const tone = ['#b8643f', '#c2714b', '#ad5a37', '#c9805a'];
      for (let j = -1; j <= 3; j++) for (let i = -1; i <= 3; i++) {
        const cx = i * q + (j & 1 ? q / 2 : 0), cy = j * 1.5 * r;
        ctx.fillStyle = tone[((i % 2 + 2) % 2) * 2 + ((j % 2 + 2) % 2)]; ctx.beginPath();
        for (let k = 0; k < 6; k++) { const a = (Math.PI / 180) * (60 * k - 90), px = cx + (r - 5) * Math.cos(a), py = cy + (r - 5) * Math.sin(a); if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
        ctx.closePath(); ctx.fill();
      }
      ctx.restore(); speckle(ctx, W, H, 1500, 4, ['rgba(90,40,20,.18)', 'rgba(255,220,190,.12)']);
    },
    relief: 'invluma',
  },
  {
    id: 'terrazzo', name: 'หินขัด (เทอราซโซ)', unit: [1.2, 1.2], dims: [60, 60], adhesive: true,
    price: { m2: 1300, box: 1.44, labor: 400 }, rough: [0.2, 0.9], ns: 0.8, coat: 0.6,
    draw(ctx, W, H) {
      const r = rng(21); ctx.fillStyle = '#e7e2d8'; ctx.fillRect(0, 0, W, H);
      const cols = ['#8a8f8c', '#c9b9a3', '#3f4a4a', '#b7c4bf', '#d1c4b0', '#9c7e64', '#6f7b74'];
      for (let i = 0; i < 300; i++) {
        const x = r() * W, y = r() * H, s = 3 + r() * 12, n = 3 + Math.floor(r() * 3), rot = r() * 6.3, col = cols[Math.floor(r() * cols.length)];
        const pts: [number, number][] = []; for (let k = 0; k < n; k++) { const a = rot + (k / n) * Math.PI * 2, d = s * (0.6 + r() * 0.5); pts.push([Math.cos(a) * d, Math.sin(a) * d]); }
        wrapDraw(ctx, W, H, () => { ctx.fillStyle = col; ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(x + p[0], y + p[1]) : ctx.moveTo(x + p[0], y + p[1]))); ctx.closePath(); ctx.fill(); });
      }
      grout(ctx, W, H, 2, 2, 'rgba(160,152,140,.45)', 2);
    },
    relief: relief.grid(2, 2, 4),
  },
  {
    id: 'encaustic', name: 'กระเบื้องลายโบราณ', unit: [0.8, 0.8], dims: [20, 20], adhesive: true,
    price: { m2: 1500, box: 1.0, labor: 450 }, rough: [0.35, 0.9], ns: 1, coat: 0.35,
    draw(ctx, W, H) {
      const s = W / 4;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        ctx.save(); ctx.translate(i * s, j * s); ctx.fillStyle = '#ece5d5'; ctx.fillRect(0, 0, s, s);
        ctx.fillStyle = '#24476b'; for (const [cx, cy] of [[0, 0], [s, 0], [0, s], [s, s]]) { ctx.beginPath(); ctx.arc(cx, cy, s * 0.3, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = '#d4a43a'; ctx.beginPath(); ctx.moveTo(s / 2, s * 0.16); ctx.lineTo(s * 0.84, s / 2); ctx.lineTo(s / 2, s * 0.84); ctx.lineTo(s * 0.16, s / 2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ece5d5'; ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.13, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#24476b'; ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.06, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#24476b'; ctx.lineWidth = 2; ctx.strokeRect(s * 0.06, s * 0.06, s * 0.88, s * 0.88); ctx.restore();
      }
      speckle(ctx, W, H, 1200, 8, ['rgba(80,70,50,.15)']); grout(ctx, W, H, 4, 4, 'rgba(150,140,120,.8)', 2);
    },
    relief: relief.grid(4, 4, 4),
  },
  {
    id: 'concrete', name: 'ปูนขัดมัน', unit: [2, 2], dims: null, tint: true, adhesive: false,
    price: { m2: 0, labor: 650 }, rough: [0.35, 0.7], ns: 0.4, coat: 0.35,
    draw(ctx, W, H) {
      const r = rng(31); ctx.fillStyle = '#e4e3e0'; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 50; i++) {
        const x = r() * W, y = r() * H, rad = 30 + r() * 110, dark = r() < 0.5;
        wrapDraw(ctx, W, H, () => { const g = ctx.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, dark ? 'rgba(150,150,150,.18)' : 'rgba(255,255,255,.22)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2); });
      }
      speckle(ctx, W, H, 4000, 6, ['rgba(90,90,90,.18)', 'rgba(255,255,255,.3)']);
    },
    relief: 'luma',
  },
  {
    id: 'deck', name: 'ไม้เทียมระเบียง', unit: [1.2, 1.2], dims: [14, 240], adhesive: false, outdoor: true,
    price: { m2: 1200, box: 1.0, labor: 350 }, rough: [0.7, 0.95], ns: 1.4,
    draw(ctx, W, H) {
      const r = rng(61), n = 8, rh = H / n; ctx.fillStyle = '#2b2420'; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < n; i++) {
        const v = ['#8a6a4f', '#7f6148', '#937356', '#86664c'][i % 4]; ctx.fillStyle = v; ctx.fillRect(0, i * rh + 3, W, rh - 6);
        for (let k = 0; k < 6; k++) { ctx.fillStyle = 'rgba(40,25,15,.25)'; ctx.fillRect(0, i * rh + 6 + k * (rh - 12) / 6, W, 1); }
        ctx.fillStyle = 'rgba(30,20,12,.5)'; ctx.fillRect(r() * W, i * rh, 2, rh);
      }
    },
    relief: 'luma',
  },
  {
    id: 'paver', name: 'บล็อกปูพื้นภายนอก', unit: [0.8, 0.8], dims: [10, 20], adhesive: false, outdoor: true,
    price: { m2: 320, box: 1.0, labor: 250 }, rough: [0.85, 0.98], ns: 1.6,
    draw(ctx, W, H) {
      const r = rng(71), rows = 8, cols = 4, rh = H / rows, bw = W / cols; ctx.fillStyle = '#6f6a63'; ctx.fillRect(0, 0, W, H);
      for (let j = 0; j < rows; j++) for (let i = -1; i <= cols; i++) { const v = 150 + Math.floor(r() * 30); ctx.fillStyle = `rgb(${v},${v - 6},${v - 14})`; ctx.fillRect(i * bw + (j % 2 ? bw / 2 : 0) + 3, j * rh + 3, bw - 6, rh - 6); }
      speckle(ctx, W, H, 6000, 72, ['rgba(0,0,0,.12)', 'rgba(255,255,255,.12)']);
    },
    relief(ctx, W, H) { speckle(ctx, W, H, 8000, 73, ['#c8c8c8', '#e0e0e0']); relief.offset(4, 8, 7)(ctx, W, H); },
  },
  {
    id: 'grass', name: 'สนามหญ้า', unit: [1, 1], dims: null, adhesive: false, outdoor: true,
    price: { m2: 120, labor: 60 }, rough: [0.9, 1], ns: 2,
    draw(ctx, W, H) {
      ctx.fillStyle = '#4f7a35'; ctx.fillRect(0, 0, W, H);
      const r = rng(81);
      for (let i = 0; i < 9000; i++) { const x = r() * W, y = r() * H, g = 90 + Math.floor(r() * 80); ctx.strokeStyle = `rgba(${g - 50},${g + 30},${g - 60},.7)`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 4, y - 3 - r() * 5); ctx.stroke(); }
    },
    relief: 'luma',
  },
];

export const WALLS: WallDef[] = [
  {
    id: 'plain', name: 'ทาสีเรียบ', unit: [1, 1], price: { kind: 'paint' }, rough: [0.85, 0.95], ns: 0.25,
    draw(ctx, W, H) { ctx.fillStyle = '#f6f6f6'; ctx.fillRect(0, 0, W, H); speckle(ctx, W, H, 900, 2, ['rgba(0,0,0,.04)']); },
    relief(ctx, W, H) { speckle(ctx, W, H, 14000, 3, ['#d8d8d8', '#e8e8e8']); },
  },
  {
    id: 'tile3060', name: 'กระเบื้องผนัง 30×60', unit: [1.2, 1.2], price: { kind: 'tile', m2: 380, tile: 0.18, box: 1.44, labor: 350 }, rough: [0.12, 0.9], ns: 1,
    draw(ctx, W, H) {
      const r = rng(19); ctx.fillStyle = '#f4f4f4'; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 2; i++) for (let j = 0; j < 4; j++) { const v = 236 + Math.floor(r() * 14); ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect((i * W) / 2, (j * H) / 4, W / 2, H / 4); }
      grout(ctx, W, H, 2, 4, '#c9c9c9', 3);
    },
    relief: relief.grid(2, 4, 5),
  },
  {
    id: 'subway', name: 'กระเบื้องซับเวย์', unit: [0.6, 0.6], price: { kind: 'tile', m2: 750, tile: 0.01125, box: 1.0, labor: 450 }, rough: [0.08, 0.9], ns: 1.4,
    draw(ctx, W, H) {
      const rh = H / 8, bw = W / 4; ctx.fillStyle = '#c4c4c4'; ctx.fillRect(0, 0, W, H);
      for (let j = 0; j < 8; j++) for (let i = -1; i <= 4; i++) {
        const x = i * bw + (j % 2 ? bw / 2 : 0), y = j * rh, g = ctx.createLinearGradient(0, y, 0, y + rh);
        g.addColorStop(0, '#fdfdfd'); g.addColorStop(1, '#ececec'); ctx.fillStyle = g; ctx.fillRect(x + 2, y + 2, bw - 4, rh - 4);
      }
    },
    relief(ctx, W, H) {
      const rh = H / 8, bw = W / 4; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.filter = 'blur(3px)'; ctx.fillStyle = '#fff';
      for (let j = 0; j < 8; j++) for (let i = -1; i <= 4; i++) ctx.fillRect(i * bw + (j % 2 ? bw / 2 : 0) + 5, j * rh + 5, bw - 10, rh - 10);
      ctx.filter = 'none';
    },
  },
  {
    id: 'mosaic', name: 'โมเสก 2.5 ซม.', unit: [0.3, 0.3], price: { kind: 'tile', m2: 1100, tile: 0.09, tileLabel: 'แผ่นตาข่าย 30×30', box: 1.0, labor: 450 }, rough: [0.1, 0.9], ns: 1.2,
    draw(ctx, W, H) {
      const r = rng(23), n = 12, s = W / n; ctx.fillStyle = '#bdbdbd'; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const v = 200 + Math.floor(r() * 55); ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(i * s + 2, j * s + 2, s - 4, s - 4); }
    },
    relief: relief.grid(12, 12, 5),
  },
  {
    id: 'brick', name: 'อิฐโชว์แนว', unit: [0.9, 0.6], price: { kind: 'tile', m2: 850, tile: 0.0169, box: 1.0, labor: 400 }, rough: [0.85, 0.98], ns: 1.8,
    draw(ctx, W, H) {
      const r = rng(13), rh = H / 8, bw = W / 4; ctx.fillStyle = '#b9b9b9'; ctx.fillRect(0, 0, W, H);
      for (let j = 0; j < 8; j++) {
        const shades: number[] = []; for (let i = 0; i < 5; i++) shades.push(200 + Math.floor(r() * 45));
        for (let i = -1; i <= 4; i++) { const x = i * bw + (j % 2 ? bw / 2 : 0), v = shades[((i % 4) + 4) % 4]; ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(x + 3, j * rh + 3, bw - 6, rh - 6); }
      }
      speckle(ctx, W, H, 3000, 14, ['rgba(0,0,0,.08)', 'rgba(255,255,255,.15)']);
    },
    relief(ctx, W, H) { speckle(ctx, W, H, 8000, 15, ['#c8c8c8', '#e0e0e0']); relief.offset(4, 8, 8)(ctx, W, H); },
  },
  {
    id: 'stripes', name: 'วอลเปเปอร์ลายทาง', unit: [0.5, 0.5], price: { kind: 'roll', roll: 1200, rollM2: 5 }, rough: [0.8, 0.9], ns: 0.3,
    draw(ctx, W, H) { ctx.fillStyle = '#f7f7f7'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#e0e0e0'; ctx.fillRect(W / 2, 0, W / 2, H); ctx.fillStyle = '#d2d2d2'; ctx.fillRect(W / 2 - 3, 0, 3, H); ctx.fillRect(W - 3, 0, 3, H); },
    relief(ctx, W, H) { speckle(ctx, W, H, 14000, 5, ['#dcdcdc', '#eeeeee']); },
  },
  {
    id: 'slats', name: 'ระแนงไม้แนวตั้ง', unit: [0.6, 0.6], price: { kind: 'area', m2: 1500, label: 'ระแนงไม้ (รวมติดตั้ง)' }, rough: [0.55, 0.95], ns: 2,
    draw(ctx, W, H) {
      const n = 8, sw = W / n; ctx.fillStyle = '#7d7d7d'; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < n; i++) { const g = ctx.createLinearGradient(i * sw, 0, i * sw + sw, 0); g.addColorStop(0, '#e8e8e8'); g.addColorStop(0.5, '#fafafa'); g.addColorStop(1, '#d6d6d6'); ctx.fillStyle = g; ctx.fillRect(i * sw + 4, 0, sw - 8, H); }
    },
    relief(ctx, W, H) {
      const n = 8, sw = W / n; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < n; i++) { const g = ctx.createLinearGradient(i * sw, 0, i * sw + sw, 0); g.addColorStop(0, '#555'); g.addColorStop(0.2, '#fff'); g.addColorStop(0.8, '#fff'); g.addColorStop(1, '#555'); ctx.fillStyle = g; ctx.fillRect(i * sw + 4, 0, sw - 8, H); }
    },
  },
  {
    id: 'stone', name: 'หินกาบภายนอก', unit: [1.0, 1.0], price: { kind: 'tile', m2: 950, tile: 0.02, box: 1.0, labor: 450 }, rough: [0.9, 1], ns: 2.2,
    draw(ctx, W, H) {
      const r = rng(91); ctx.fillStyle = '#8f8a83'; ctx.fillRect(0, 0, W, H);
      let y = 0; while (y < H) { const rh = 24 + r() * 26; let x = -r() * 60; while (x < W) { const bw = 50 + r() * 90, v = 175 + Math.floor(r() * 60); ctx.fillStyle = `rgb(${v},${v - 4},${v - 10})`; ctx.fillRect(x + 3, y + 3, bw - 6, rh - 6); x += bw; } y += rh; }
      speckle(ctx, W, H, 5000, 92, ['rgba(0,0,0,.1)', 'rgba(255,255,255,.15)']);
    },
    relief: 'luma',
  },
];

export const PAINTS = ['#f4f2ee', '#e6e0d2', '#d8d2c8', '#c9c2b8', '#9a8e82', '#5a514a', '#d6e0d9', '#c7d4de', '#e8d9c4', '#2f3437'];
export const PAINT = { gallon: 1200, cover: 35, coats: 2, labor: 80, primer: 900 };

export const floorById = (id: string) => FLOORS.find((f) => f.id === id) ?? FLOORS[0];
export const wallById = (id: string) => WALLS.find((w) => w.id === id) ?? WALLS[0];


/* ---- building shell (tinted by the material colour) ---- */
export const ROOF_TILE: Surface = {
  id: 'roof-tile', name: 'กระเบื้องหลังคาคอนกรีต', unit: [1.32, 1.36], rough: [0.6, 0.95], ns: 2.4,
  draw(ctx, W, H) {
    const cols = 4, rows = 4, tw = W / cols, th = H / rows, r = rng(91);
    ctx.fillStyle = '#4a4a4a';
    ctx.fillRect(0, 0, W, H);
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const x = i * tw, y = j * th, v = 205 + Math.floor(r() * 30);
        // two rolls per tile: light crest, darker trough
        const g = ctx.createLinearGradient(x, 0, x + tw, 0);
        for (const [t, k] of [[0, 0.62], [0.25, 1], [0.5, 0.62], [0.75, 1], [1, 0.62]] as const) g.addColorStop(t, `rgb(${Math.round(v * k)},${Math.round(v * k)},${Math.round(v * k)})`);
        ctx.fillStyle = g;
        ctx.fillRect(x, y, tw, th - 5);
        // overlap shadow of the tile course above
        const s = ctx.createLinearGradient(0, y + th - 14, 0, y + th);
        s.addColorStop(0, 'rgba(0,0,0,0)');
        s.addColorStop(1, 'rgba(0,0,0,.55)');
        ctx.fillStyle = s;
        ctx.fillRect(x, y + th - 14, tw, 14);
      }
    speckle(ctx, W, H, 9000, 92, ['rgba(0,0,0,.10)', 'rgba(255,255,255,.10)']);
  },
  relief: 'luma',
};

export const METAL_SHEET: Surface = {
  id: 'metal-sheet', name: 'เมทัลชีท', unit: [0.76, 1], rough: [0.35, 0.5], ns: 1.6,
  draw(ctx, W, H) {
    const n = 4, sw = W / n;
    for (let i = 0; i < n; i++) {
      const g = ctx.createLinearGradient(i * sw, 0, (i + 1) * sw, 0);
      g.addColorStop(0, '#cfcfcf'); g.addColorStop(0.08, '#f2f2f2'); g.addColorStop(0.16, '#bdbdbd'); g.addColorStop(0.2, '#e4e4e4'); g.addColorStop(1, '#e4e4e4');
      ctx.fillStyle = g;
      ctx.fillRect(i * sw, 0, sw, H);
    }
  },
  relief: 'luma',
};

export const ASPHALT: Surface = {
  id: 'asphalt', name: 'ถนนลาดยาง', unit: [3, 3], rough: [0.92, 1], ns: 1.2,
  draw(ctx, W, H) {
    ctx.fillStyle = '#5a5a5a'; ctx.fillRect(0, 0, W, H);
    speckle(ctx, W, H, 26000, 93, ['#4a4a4a', '#6c6c6c', '#3e3e3e', '#7a7a7a']);
  },
  relief: 'luma',
};

export const PAVING: Surface = {
  id: 'paving', name: 'ทางเท้า', unit: [1.2, 1.2], rough: [0.85, 1], ns: 1.4,
  draw(ctx, W, H) {
    const r = rng(94); ctx.fillStyle = '#9a958c'; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const v = 190 + Math.floor(r() * 25); ctx.fillStyle = `rgb(${v},${v - 4},${v - 10})`; ctx.fillRect(i * W / 4 + 2, j * H / 4 + 2, W / 4 - 4, H / 4 - 4); }
    speckle(ctx, W, H, 6000, 95, ['rgba(0,0,0,.1)', 'rgba(255,255,255,.1)']);
  },
  relief: 'luma',
};

/** Finishes offered for the outside of the house (subset of wall patterns). */
export const EXT_WALLS = ['plain', 'brick', 'stone', 'slats'];
export const EXT_COLORS = ['#ece7df', '#f6f4ef', '#d8d2c8', '#b8afa3', '#8c8378', '#5a514a', '#2f3437', '#c9b49a', '#a9b8b0'];
export const ROOF_COLORS = ['#5a4a42', '#7a3b2e', '#3d4248', '#6b6f6a', '#2b2b2b', '#8a6a4f', '#4a5a6a'];

/** Ripples for pool water (only the normal map is used). */
export const WATER: Surface = {
  id: 'water', name: 'น้ำ', unit: [2.5, 2.5], rough: [0.04, 0.06], ns: 0.9,
  draw(ctx, W, H) {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, W, H);
    const r = rng(97);
    wrapDraw(ctx, W, H, () => {
      for (let i = 0; i < 70; i++) {
        const x = r() * W, y = r() * H, rr = 12 + r() * 46;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
        const v = r() > 0.5 ? 255 : 0;
        g.addColorStop(0, `rgba(${v},${v},${v},.18)`);
        g.addColorStop(1, 'rgba(128,128,128,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(x, y, rr, rr * 0.6, r() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  },
  relief: 'luma',
};
