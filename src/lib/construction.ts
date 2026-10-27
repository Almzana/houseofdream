/**
 * How the house would actually be built, worked out from the plan: piles, footings and ground
 * beams; columns, beams and floor slabs; brick walls with lintels; roof framing; ceiling frames;
 * water supply, hot water, soil/grey drainage with septic tank; and the electrical installation
 * (meter, consumer unit, circuits, switches, sockets, air-conditioning).
 *
 * Everything is plain data (boxes and straight members) so it can be tested, priced, and drawn.
 */
import { DEFAULT_EXT, LEVEL_H, applyStorey, type BuildSpec, type House, type Room, type Tier } from '../types';

/** Structural sizes by tier: a villa's long spans and tall storeys need a heavier frame. */
const STRUCT: Record<Tier, { piles: number; bored?: string; pileD: number; pileLen: number; foot: number; footT: number; ksc: number; bar: string; col: number; colBars: string; beamW: number; beamH: number; beamBars: string; pt?: number }> = {
  standard: { piles: 2, pileD: 0.18, pileLen: 6, foot: 1.0, footT: 0.3, ksc: 240, bar: 'DB12', col: 0.2, colBars: '4-DB12', beamW: 0.2, beamH: 0.4, beamBars: '4-DB12 ปลอก RB6 @0.15' },
  luxury: { piles: 2, bored: 'เสาเข็มเจาะ ø0.50 ม. ลึก 18 ม.', pileD: 0.5, pileLen: 18, foot: 1.5, footT: 0.5, ksc: 280, bar: 'DB16', col: 0.3, colBars: '8-DB16', beamW: 0.25, beamH: 0.55, beamBars: '6-DB16 ปลอก RB9 @0.15', pt: 0.2 },
  ultra: { piles: 3, bored: 'เสาเข็มเจาะ ø0.60 ม. ลึก 21 ม.', pileD: 0.6, pileLen: 21, foot: 2.0, footT: 0.7, ksc: 320, bar: 'DB20', col: 0.4, colBars: '12-DB20', beamW: 0.3, beamH: 0.65, beamBars: '8-DB20 ปลอก DB10 @0.15', pt: 0.25 },
};
import { OVERHANG, WALL_T, inRoom, levelY, levelsOf, lotOf, openingsOf, roofPlan, wallH } from './shell';
import { isExterior, wallPieces, wallSegments, type Segment } from './walls';

export type Layer = 'found' | 'frame' | 'walls' | 'roof' | 'ceiling' | 'plumb' | 'elec' | 'systems';
export type V3 = [number, number, number];

export type Kind =
  | 'pile' | 'footing' | 'column' | 'gbeam' | 'beam' | 'slab' | 'plank'
  | 'brick' | 'lintel'
  | 'rafter' | 'purlin' | 'ridge' | 'post'
  | 'cframe'
  | 'cold' | 'hot' | 'soil' | 'grey' | 'vent' | 'tank' | 'pump' | 'septic' | 'pit' | 'wmeter' | 'grease'
  | 'wire-light' | 'wire-power' | 'wire-ac' | 'wire-heavy' | 'wire-main'
  | 'panel' | 'emeter' | 'switch' | 'socket' | 'acin' | 'acout' | 'ground'
  | 'shaft' | 'liftcar' | 'pooltank' | 'poolplant' | 'poolpipe' | 'vrv' | 'refpipe'
  | 'solar' | 'inverter' | 'ev' | 'genset' | 'ats' | 'smoke' | 'firepanel' | 'lightning' | 'cctv' | 'rack';

type Dev = { p: V3; level: number; drop: boolean };

export interface Comp {
  layer: Layer;
  level: number;
  kind: Kind;
  name: string;
  spec: string;
  /** box centred at p, size s, turned r about y */
  box?: { p: V3; s: V3; r?: number };
  /** member from a to b with a w×h cross-section */
  line?: { a: V3; b: V3; w: number; h?: number };
}

export interface Lookup {
  (t: string): { opening?: { w: number; y0: number; y1: number; door?: boolean }; light?: unknown; mount?: string } | undefined;
}

export const DEFAULT_SPEC: BuildSpec = { block: 'red', pipe: 'ppr', wire: 'thw', pile: 'i18' };

export const SPEC_NAMES = {
  block: { red: 'อิฐมอญ (ก่อครึ่งแผ่น)', aac: 'อิฐมวลเบา 7.5 ซม.' },
  pipe: { ppr: 'ท่อ PPR (เชื่อมความร้อน)', pvc: 'ท่อ PVC ชั้น 13.5' },
  wire: { thw: 'สาย THW ร้อยท่อ', vaf: 'สาย VAF ตีกิ๊บ' },
  pile: { i18: 'เข็มตอก ไอ 18×18 ยาว 6 ม.', spun: 'เข็มสปัน ø25 ซม. ยาว 6 ม.' },
} as const;

const lv = (r: { level?: number; l?: number }) => r.level ?? r.l ?? 0;
const len = (a: V3, b: V3) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

/* ------------------------------------------------------------------ helpers */

/** Members along a Manhattan path through the given points. */
function path(out: Comp[], base: Omit<Comp, 'line'>, pts: V3[], w: number) {
  for (let i = 0; i < pts.length - 1; i++) {
    if (len(pts[i], pts[i + 1]) < 0.01) continue;
    out.push({ ...base, line: { a: pts[i], b: pts[i + 1], w } });
  }
}

/** A segment's endpoints and centreline in world coordinates. */
function segLine(s: Segment, shift = 0): { a: [number, number]; b: [number, number] } {
  const c = s.c + shift;
  return s.axis === 'x' ? { a: [s.s0, c], b: [s.s1, c] } : { a: [c, s.s0], b: [c, s.s1] };
}

/** Side that is outdoors for an exterior segment (+1 / −1), 0 for partitions. */
const outSide = (s: Segment) => (!s.minus ? -1 : !s.plus ? 1 : 0);

/* ------------------------------------------------------------------ main */

export function construct(house: House, lookup: Lookup, spec: BuildSpec = { ...DEFAULT_SPEC, ...house.build }) {
  applyStorey(house);
  const tier: Tier = house.tier ?? 'standard';
  const out: Comp[] = [];
  const rooms = house.rooms;
  const indoor = rooms.filter((r) => !r.outdoor);
  const levels = levelsOf(rooms);
  const top = indoor.length ? Math.max(...indoor.map(lv)) : 0;
  const ops = openingsOf(house, lookup);
  const segsBy = new Map(levels.map((l) => [l, wallSegments(rooms, ops, l)]));
  const ext = { ...DEFAULT_EXT, ...house.ext };

  /* ---------- columns where walls meet, and along long outside walls ---------- */
  const cols: { x: number; z: number; top: number }[] = [];
  const addCol = (x: number, z: number, t: number) => {
    const near = cols.find((c) => Math.hypot(c.x - x, c.z - z) < 1.2);
    if (near) near.top = Math.max(near.top, t);
    else cols.push({ x, z, top: t });
  };
  for (const l of levels) {
    for (const s of segsBy.get(l)!) {
      if (s.void) continue;
      const t = levelY(l) + wallH(s, l, top);
      const { a, b } = segLine(s, outSide(s) * (WALL_T / 2));
      addCol(a[0], a[1], t);
      addCol(b[0], b[1], t);
      const L = s.s1 - s.s0;
      if (isExterior(s) && L > 4.5) {
        const n = Math.ceil(L / 4);
        for (let i = 1; i < n; i++) addCol(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, t);
      }
    }
  }
  const pileName = SPEC_NAMES.pile[spec.pile];
  const S = STRUCT[tier];
  for (const c of cols) {
    const offs = S.piles === 3 ? [[-0.45, -0.3], [0.45, -0.3], [0, 0.45]] : [[-0.25 * S.foot, 0], [0.25 * S.foot, 0]];
    for (const [dx, dz] of offs) {
      out.push({ layer: 'found', level: 0, kind: 'pile', name: 'เสาเข็ม', spec: S.bored ?? pileName, box: { p: [c.x + dx, -1.5 - S.pileLen / 2, c.z + dz], s: S.bored ? [S.pileD, S.pileLen, S.pileD] : spec.pile === 'spun' ? [0.25, 6, 0.25] : [0.18, 6, 0.18] } });
    }
    out.push({ layer: 'found', level: 0, kind: 'footing', name: 'ฐานราก F1', spec: `คอนกรีต ${S.ksc} ksc · ${S.foot.toFixed(2)}×${S.foot.toFixed(2)}×${S.footT.toFixed(2)} ม. · เหล็ก ${S.bar} @0.15`, box: { p: [c.x, -1.5 + S.footT / 2, c.z], s: [S.foot, S.footT, S.foot] } });
    out.push({ layer: 'frame', level: 0, kind: 'column', name: 'เสา C1', spec: `คอนกรีตเสริมเหล็ก ${S.col.toFixed(2)}×${S.col.toFixed(2)} ม. · ${S.colBars} ปลอก RB9 @0.15 · สูง ${(c.top + 1.2).toFixed(2)} ม.`, box: { p: [c.x, (c.top - 1.2) / 2, c.z], s: [S.col, c.top + 1.2, S.col] } });
  }

  /* ---------- beams: ground beams under ground-floor walls, floor beams, ring beams ---------- */
  const beam = (s: Segment, y: number, kind: 'gbeam' | 'beam', level: number, name: string) => {
    const { a, b } = segLine(s, outSide(s) * (WALL_T / 2));
    out.push({ layer: kind === 'gbeam' ? 'found' : 'frame', level, kind, name, spec: `คอนกรีตเสริมเหล็ก ${S.beamW.toFixed(2)}×${S.beamH.toFixed(2)} ม. · ${S.beamBars}`, line: { a: [a[0], y, a[1]], b: [b[0], y - (S.beamH - 0.4) / 2, b[1]], w: S.beamW, h: S.beamH } });
  };
  for (const s of segsBy.get(0) ?? []) beam(s, -0.2, 'gbeam', 0, 'คานคอดิน GB1');
  for (const l of levels) {
    if (l === 0) continue;
    for (const s of segsBy.get(l)!) beam(s, levelY(l) - 0.2, 'beam', l, `คานชั้น ${l + 1} B1`);
    for (const s of segsBy.get(l - 1)!) if (isExterior(s)) beam(s, levelY(l) - 0.2, 'beam', l, `คานชั้น ${l + 1} B1`);
  }
  const plan = roofPlan(house);
  for (const s of segsBy.get(top) ?? []) if (isExterior(s)) beam(s, (plan?.base ?? levelY(top) + 2.7) - 0.2, 'beam', top, 'คานรัดหลังคา RB1');

  /* ---------- slabs ---------- */
  for (const r of rooms) {
    const L = lv(r);
    if (L === 0) {
      out.push({ layer: 'frame', level: 0, kind: 'slab', name: r.outdoor ? 'พื้นคอนกรีตลานจอด/ลาน' : 'พื้นวางบนดิน', spec: 'คอนกรีต 210 ksc หนา 0.10 ม. · ตะแกรง wire mesh ø4 @0.20 · ทรายรองพื้น 5 ซม.', box: { p: [r.x, -0.05, r.z], s: [r.w, 0.1, r.d] } });
    } else if (r.outdoor) {
      out.push({ layer: 'frame', level: L, kind: 'slab', name: 'พื้นระเบียงหล่อในที่', spec: 'คอนกรีตเสริมเหล็ก หนา 0.12 ม. · DB12 @0.20', box: { p: [r.x, levelY(L) - 0.06, r.z], s: [r.w, 0.12, r.d] } });
    } else if (S.pt) {
      // villas: post-tensioned flat slabs span the big rooms without beams in the way
      out.push({ layer: 'frame', level: L, kind: 'slab', name: 'พื้นคอนกรีตอัดแรงภายหลัง (Post-tension)', spec: `หนา ${S.pt.toFixed(2)} ม. · ลวดอัดแรง 12.7 มม. · คอนกรีต 320 ksc`, box: { p: [r.x, levelY(L) - S.pt / 2, r.z], s: [r.w, S.pt, r.d] } });
    } else {
      // hollow-core planks span the short way, 35 cm wide
      const alongX = r.w >= r.d;
      const span = alongX ? r.d : r.w, run = alongX ? r.w : r.d;
      const n = Math.max(1, Math.round(run / 0.35));
      for (let i = 0; i < n; i++) {
        const o = -run / 2 + ((i + 0.5) * run) / n;
        out.push({
          layer: 'frame', level: L, kind: 'plank', name: 'แผ่นพื้นสำเร็จรูป (Hollow Core)', spec: `กว้าง 0.35 ม. หนา 5 ซม. · ช่วงพาด ${span.toFixed(2)} ม. · เทคอนกรีตทับหน้า 5 ซม.`,
          box: { p: [r.x + (alongX ? o : 0), levelY(L) - 0.075, r.z + (alongX ? 0 : o)], s: alongX ? [run / n - 0.01, 0.05, span] : [span, 0.05, run / n - 0.01] },
        });
      }
      out.push({ layer: 'frame', level: L, kind: 'slab', name: 'คอนกรีตทับหน้า', spec: 'หนา 5 ซม. · ตะแกรง wire mesh ø4 @0.20', box: { p: [r.x, levelY(L) - 0.025, r.z], s: [r.w, 0.05, r.d] } });
    }
  }

  /* ---------- walls: brick infill, lintels and sills at openings ---------- */
  const blockName = SPEC_NAMES.block[spec.block];
  for (const l of levels) {
    for (const s of segsBy.get(l)!) {
      if (s.void) continue;
      const exterior = isExterior(s);
      const H = wallH(s, l, top);
      const shift = outSide(s) * (WALL_T / 2);
      for (const [a, b, y0, y1] of wallPieces({ ...s, h: H })) {
        const yy0 = Math.max(y0, 0), yy1 = Math.min(y1, H - 0.4); // beam sits on top
        if (yy1 - yy0 < 0.05) continue;
        const mid = (a + b) / 2, c = s.c + shift;
        out.push({
          layer: 'walls', level: l, kind: 'brick', name: exterior ? 'ผนังภายนอก' : 'ผนังกั้นห้อง', spec: `${blockName} · ฉาบปูนสองด้าน`,
          box: { p: s.axis === 'x' ? [mid, levelY(l) + (yy0 + yy1) / 2, c] : [c, levelY(l) + (yy0 + yy1) / 2, mid], s: s.axis === 'x' ? [b - a, yy1 - yy0, 0.1] : [0.1, yy1 - yy0, b - a] },
        });
      }
      for (const g of s.gaps) {
        const c = s.c + shift, a = g.a - 0.15, b = g.b + 0.15, mid = (a + b) / 2;
        const put = (y: number, name: string) => out.push({
          layer: 'walls', level: l, kind: 'lintel', name, spec: 'คอนกรีตเสริมเหล็ก 0.10×0.10 ม. · 2-RB9',
          box: { p: s.axis === 'x' ? [mid, levelY(l) + y, c] : [c, levelY(l) + y, mid], s: s.axis === 'x' ? [b - a, 0.1, 0.1] : [0.1, 0.1, b - a] },
        });
        if (g.y1 < H - 0.5) put(g.y1 + 0.05, 'ทับหลัง (เอ็นเหนือวงกบ)');
        if (g.y0 > 0.05) put(g.y0 - 0.05, 'เอ็นใต้วงกบหน้าต่าง');
      }
    }
  }

  /* ---------- roof framing ---------- */
  if (plan && ext.roof !== 'none') {
    const W0 = plan.x1 - plan.x0, D0 = plan.z1 - plan.z0, long = W0 >= D0;
    const W = long ? W0 : D0, D = long ? D0 : W0;
    const cx = (plan.x0 + plan.x1) / 2, cz = (plan.z0 + plan.z1) / 2;
    // local (along long side, across) → world
    const P = (x: number, y: number, z: number): V3 => (long ? [cx + x, plan.base + y, cz + z] : [cx + z, plan.base + y, cz - x]);
    const steel = (kind: Kind, name: string, sp: string, a: V3, b: V3, w = 0.1, h = 0.05) => out.push({ layer: 'roof', level: top, kind, name, spec: sp, line: { a, b, w, h } });
    if (ext.roof === 'flat') {
      for (let x = -W / 2; x <= W / 2 + 1e-6; x += 1.2) steel('rafter', 'ตงหลังคา', 'เหล็กรูปพรรณ C 100×50×20×2.3 มม.', P(x, 0.1, -D / 2), P(x, 0.1, D / 2));
    } else {
      const tp = Math.tan((ext.pitch * Math.PI) / 180), o = OVERHANG;
      const X = W / 2 + o, Z = D / 2 + o, e = -o * tp, topY = e + Z * tp;
      const hip = ext.roof === 'hip';
      const rx = hip ? Math.max(0, X - Z) : X;
      const C = 'เหล็กรูปพรรณ C 100×50×20×2.3 มม. · ทากันสนิม';
      if (rx > 0) steel('ridge', 'อกไก่', C, P(-rx, topY, 0), P(rx, topY, 0), 0.12, 0.1);
      // common rafters on the long faces (and jack rafters ending on the hips)
      for (const zs of [-1, 1]) {
        for (let x = -X + 0.5; x <= X - 0.5 + 1e-6; x += 1.0) {
          const ax = Math.abs(x);
          let b: V3;
          if (ax <= rx) b = P(x, topY, 0);
          else {
            const t = (X - ax) / Math.max(1e-6, X - rx);
            b = P(x, e + t * (topY - e), zs * Z * (1 - t));
          }
          steel('rafter', 'จันทัน', C, P(x, e, zs * Z), b);
        }
        // purlins every 0.6 m up the slope
        for (let f = 0.08; f < 0.97; f += 0.6 / (Z / Math.cos(Math.atan(tp)))) {
          const xr = hip ? X - f * (X - rx) : X;
          steel('purlin', 'แป', 'เหล็กกล่อง 50×25×1.2 มม. @0.60 ม.', P(-xr, e + f * (topY - e) + 0.06, zs * Z * (1 - f)), P(xr, e + f * (topY - e) + 0.06, zs * Z * (1 - f)), 0.05, 0.025);
        }
      }
      if (hip) {
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) steel('rafter', 'ตะเฆ่สัน', C, P(sx * X, e, sz * Z), P(sx * rx, topY, 0), 0.12, 0.1);
          // rafters on the hip ends
          for (let z = -Z + 0.5; z <= Z - 0.5 + 1e-6; z += 1.0) {
            const t = (Z - Math.abs(z)) / Z;
            steel('rafter', 'จันทันพราง', C, P(sx * X, e, z), P(sx * (X - t * (X - rx)), e + t * (topY - e), z * (1 - t)));
          }
        }
      }
      // king posts from the ring beam up to the ridge
      for (let x = -rx; x <= rx + 1e-6; x += Math.max(1.5, (2 * rx) / Math.max(1, Math.round((2 * rx) / 2)))) steel('post', 'ดั้ง', C, P(x, 0, 0), P(x, topY, 0), 0.1, 0.1);
    }
  }

  /* ---------- ceiling frames ---------- */
  for (const r of indoor) {
    const y = levelY(lv(r)) + r.h;
    const nX = Math.max(1, Math.round(r.w / 0.6)), nZ = Math.max(1, Math.round(r.d / 0.6));
    const name = 'โครงคร่าวฝ้า', sp = 'โครงซีลาย + แผ่นยิปซัม 9 มม. @0.60×0.60 ม.';
    for (let i = 0; i <= nX; i++) out.push({ layer: 'ceiling', level: lv(r), kind: 'cframe', name, spec: sp, line: { a: [r.x - r.w / 2 + (i * r.w) / nX, y, r.z - r.d / 2], b: [r.x - r.w / 2 + (i * r.w) / nX, y, r.z + r.d / 2], w: 0.03, h: 0.02 } });
    for (let j = 0; j <= nZ; j++) out.push({ layer: 'ceiling', level: lv(r), kind: 'cframe', name, spec: sp, line: { a: [r.x - r.w / 2, y + 0.02, r.z - r.d / 2 + (j * r.d) / nZ], b: [r.x + r.w / 2, y + 0.02, r.z - r.d / 2 + (j * r.d) / nZ], w: 0.03, h: 0.02 } });
  }

  /* ---------- plumbing ---------- */
  const lot = lotOf(house);
  const fp = indoor.length
    ? { x0: Math.min(...indoor.map((r) => r.x - r.w / 2)), x1: Math.max(...indoor.map((r) => r.x + r.w / 2)), z0: Math.min(...indoor.map((r) => r.z - r.d / 2)), z1: Math.max(...indoor.map((r) => r.z + r.d / 2)) }
    : { x0: -2, x1: 2, z0: -2, z1: 2 };
  const pipeName = SPEC_NAMES.pipe[spec.pipe];
  const ceilY = (l: number) => (l < top ? levelY(l + 1) - 0.15 : (plan?.base ?? levelY(l) + 2.7) + 0.15);
  const FIX: Record<string, { y: number; drain: 'soil' | 'grey'; name: string }> = {
    toilet: { y: 0.2, drain: 'soil', name: 'ชักโครก' },
    vanity: { y: 0.55, drain: 'grey', name: 'อ่างล้างหน้า' },
    shower: { y: 1.0, drain: 'grey', name: 'ฝักบัว / ฟลอร์เดรน' },
    bathtub: { y: 0.6, drain: 'grey', name: 'อ่างอาบน้ำ' },
    ksink: { y: 0.55, drain: 'grey', name: 'ซิงค์ล้างจาน' },
    washer: { y: 1.0, drain: 'grey', name: 'เครื่องซักผ้า' },
  };
  const fixtures = house.items.filter((i) => FIX[i.t]);
  const tankP: V3 = [fp.x1 + 1.0, 0, fp.z0 + 0.9];
  const septicP: V3 = [fp.x0 - 1.0, -1.0, fp.z0 + 1.2];
  const pitP: V3 = [fp.x0 - 1.0, -0.6, (fp.z0 + fp.z1) / 2];
  const meterW: V3 = [lot.x1 - 1.2, 0.5, lot.z1 - 0.3];
  if (fixtures.length) {
    out.push({ layer: 'plumb', level: 0, kind: 'wmeter', name: 'มาตรวัดน้ำ', spec: 'ขนาด 1/2" (การประปา)', box: { p: meterW, s: [0.25, 0.2, 0.15] } });
    out.push({ layer: 'plumb', level: 0, kind: 'tank', name: 'ถังเก็บน้ำ', spec: 'ถังสแตนเลส/PE 1,000 ลิตร', box: { p: [tankP[0], 0.75, tankP[2]], s: [1.05, 1.5, 1.05] } });
    out.push({ layer: 'plumb', level: 0, kind: 'pump', name: 'ปั๊มน้ำอัตโนมัติ', spec: 'แรงดันคงที่ 300 วัตต์', box: { p: [tankP[0], 0.25, tankP[2] + 0.9], s: [0.45, 0.5, 0.35] } });
    out.push({ layer: 'plumb', level: 0, kind: 'septic', name: 'ถังบำบัดน้ำเสีย', spec: 'ถังบำบัดสำเร็จรูป 1,600 ลิตร', box: { p: septicP, s: [1.2, 1.6, 1.2] } });
    out.push({ layer: 'plumb', level: 0, kind: 'pit', name: 'บ่อพักน้ำทิ้ง', spec: 'บ่อพักคอนกรีต ø0.60 ม.', box: { p: pitP, s: [0.6, 0.8, 0.6] } });
    const cold = { layer: 'plumb' as Layer, kind: 'cold' as Kind, name: 'ท่อน้ำดี', spec: `${pipeName} ขนาด 1/2"–3/4"` };
    // mains: meter → tank (buried), pump → up into the ceiling space of each storey
    path(out, { ...cold, level: 0, name: 'ท่อเมนประปา' }, [meterW, [meterW[0], -0.3, meterW[2]], [tankP[0], -0.3, meterW[2]], [tankP[0], -0.3, tankP[2]], [tankP[0], 0.2, tankP[2]]], 0.035);
    const usedLevels = [...new Set(fixtures.map(lv))];
    const riser: V3 = [fp.x1 - 0.15, 0.3, fp.z0 + 0.15];
    path(out, { ...cold, level: 0, name: 'ท่อจ่ายจากปั๊ม' }, [[tankP[0], 0.3, tankP[2] + 0.9], [riser[0], 0.3, tankP[2] + 0.9], [riser[0], 0.3, riser[2]], [riser[0], ceilY(Math.max(...usedLevels)), riser[2]]], 0.035);
    for (const it of fixtures) {
      const f = FIX[it.t], L = lv(it), yC = ceilY(L);
      const at: V3 = [it.x, levelY(L) + f.y, it.z];
      path(out, { ...cold, level: L, name: `ท่อน้ำดี → ${f.name}` }, [[riser[0], yC, riser[2]], [it.x, yC, riser[2]], [it.x, yC, it.z], at], 0.025);
      // drains: straight down to under the ground slab, then to the septic tank / drain pit
      const d = f.drain === 'soil' ? { kind: 'soil' as Kind, name: `ท่อโสโครก (${f.name})`, spec: 'PVC 4" ชั้น 8.5 · ลาดเอียง 1:50' } : { kind: 'grey' as Kind, name: `ท่อน้ำทิ้ง (${f.name})`, spec: 'PVC 2" ชั้น 8.5 · ลาดเอียง 1:100' };
      const w = f.drain === 'soil' ? 0.11 : 0.06;
      const to = f.drain === 'soil' ? septicP : pitP;
      const yB = f.drain === 'soil' ? -0.55 : -0.4;
      path(out, { layer: 'plumb', level: L, ...d }, [[it.x, levelY(L) + 0.02, it.z], [it.x, yB, it.z], [it.x, yB, fp.z0 - 0.6], [to[0], yB, fp.z0 - 0.6], [to[0], yB, to[2]]], w);
      if (it.t === 'ksink') {
        out.push({ layer: 'plumb', level: 0, kind: 'grease', name: 'บ่อดักไขมัน', spec: 'ถังดักไขมันสำเร็จรูป 30 ลิตร (ครัว) ก่อนลงบ่อพัก', box: { p: [it.x, -0.3, fp.z0 - 0.6], s: [0.5, 0.45, 0.4] } });
      }
      if (it.t === 'toilet') {
        // vent stack up through the roof
        const vy = (plan?.base ?? levelY(top) + 2.7) + 1.2;
        out.push({ layer: 'plumb', level: L, kind: 'vent', name: 'ท่ออากาศ (Vent)', spec: 'PVC 1½" ชั้น 8.5 · ทะลุหลังคา', line: { a: [it.x + 0.15, levelY(L) + 0.05, it.z - 0.25], b: [it.x + 0.15, vy, it.z - 0.25], w: 0.045 } });
      }
    }
    // hot water: heater to the shower in the same bathroom
    for (const h of house.items.filter((i) => i.t === 'heater')) {
      const sh = fixtures.filter((f) => f.t === 'shower' && lv(f) === lv(h)).sort((a, b) => Math.hypot(a.x - h.x, a.z - h.z) - Math.hypot(b.x - h.x, b.z - h.z))[0];
      if (!sh) continue;
      const y = levelY(lv(h)) + 1.4;
      path(out, { layer: 'plumb', level: lv(h), kind: 'hot', name: 'ท่อน้ำร้อน', spec: `${pipeName} ทนความร้อน 1/2" · หุ้มฉนวน` }, [[h.x, y, h.z], [sh.x, y, h.z], [sh.x, y, sh.z], [sh.x, levelY(lv(h)) + 1.0, sh.z]], 0.03);
    }
    // septic tank and drain pit out to the street drain
    const outName = { layer: 'plumb' as Layer, level: 0, kind: 'grey' as Kind, name: 'ท่อระบายลงท่อสาธารณะ', spec: 'PVC 4" ชั้น 8.5' };
    path(out, outName, [[septicP[0], -0.6, septicP[2]], [pitP[0], -0.6, pitP[2]]], 0.11);
    path(out, outName, [[pitP[0], -0.6, pitP[2]], [pitP[0], -0.6, lot.z1 + 1.6]], 0.11);
  }

  /* ---------- electrical ---------- */
  const wireName = SPEC_NAMES.wire[spec.wire];
  const door = house.items.find((i) => i.t === 'frontdoor' && lv(i) === 0) ?? house.items.find((i) => lookup(i.t)?.opening?.door && lv(i) === 0);
  const nIn = door ? [Math.sin(door.r), Math.cos(door.r)] : [0, 1];
  const panelP: V3 = door ? [door.x + Math.cos(door.r) * 1.3 + nIn[0] * 0.08, 1.6, door.z - Math.sin(door.r) * 1.3 + nIn[1] * 0.08] : [fp.x0 + 0.5, 1.6, fp.z1 - 0.1];
  const meterE: V3 = [lot.x0 + 1.2, 1.5, lot.z1 - 0.2];
  out.push({ layer: 'elec', level: 0, kind: 'emeter', name: 'มิเตอร์ไฟฟ้า', spec: '15(45)A 1 เฟส 2 สาย (การไฟฟ้า)', box: { p: meterE, s: [0.22, 0.32, 0.14] } });
  out.push({ layer: 'elec', level: 0, kind: 'panel', name: 'ตู้ควบคุมไฟฟ้า (Consumer Unit)', spec: 'เมน 50A + กันดูด RCBO 30mA · 12 ช่อง', box: { p: panelP, s: door && Math.abs(Math.sin(door.r)) > 0.5 ? [0.12, 0.45, 0.35] : [0.35, 0.45, 0.12] } });
  // earthing: copper rod driven next to the house, bonded to the consumer unit
  const rodP: V3 = [panelP[0] + (door ? -Math.sin(door.r) : 0) * 0.6, -1.2, panelP[2] + (door ? -Math.cos(door.r) : -1) * 0.6];
  out.push({ layer: 'elec', level: 0, kind: 'ground', name: 'หลักดิน', spec: 'แท่งทองแดง ø5/8" ยาว 2.40 ม. · ค่าความต้านทานดิน ≤ 5 โอห์ม', box: { p: rodP, s: [0.03, 2.4, 0.03] } });
  path(out, { layer: 'elec', level: 0, kind: 'ground', name: 'สายดิน', spec: 'THW สีเขียว 10 ตร.มม. ร้อยท่อ' }, [[panelP[0], panelP[1] - 0.25, panelP[2]], [panelP[0], -0.1, panelP[2]], [rodP[0], -0.1, rodP[2]]], 0.02);
  path(out, { layer: 'elec', level: 0, kind: 'wire-main', name: 'สายเมนเข้าบ้าน', spec: 'THW 2×16 + G 10 ตร.มม. ร้อยท่อ HDPE ฝังดิน' }, [meterE, [meterE[0], -0.4, meterE[2]], [panelP[0], -0.4, meterE[2]], [panelP[0], -0.4, panelP[2]], panelP], 0.04);

  const circuits: { kind: Kind; name: string; spec: string; level: number; devs: Dev[] }[] = [];
  const roomOf = (x: number, z: number, l: number) => indoor.find((r) => lv(r) === l && inRoom(r, x, z));
  const ceilingAt = (l: number, x: number, z: number) => {
    const r = roomOf(x, z, l);
    return levelY(l) + (r ? r.h : 2.7) + 0.08;
  };

  // lighting: lamps per storey, switch by the door of each room
  for (const l of levels) {
    const lamps = house.items.filter((i) => lv(i) === l && lookup(i.t)?.light);
    const devs: Dev[] = lamps.map((i) => ({ p: [i.x, ceilingAt(l, i.x, i.z), i.z], level: l, drop: false }));
    for (const r of indoor.filter((o) => lv(o) === l)) {
      if (!lamps.some((i) => inRoom(r, i.x, i.z))) devs.push({ p: [r.x, levelY(l) + r.h, r.z], level: l, drop: false });
      const d = house.items.find((i) => lv(i) === l && lookup(i.t)?.opening?.door && inRoom(r, i.x, i.z, 0.12));
      if (!d) continue;
      // switch 25 cm beside the door, on this room's side, 1.20 m up
      const along: [number, number] = [Math.cos(d.r), -Math.sin(d.r)];
      const w = (lookup(d.t)?.opening?.w ?? 0.9) / 2 + 0.2;
      let sx = d.x + along[0] * w, sz = d.z + along[1] * w;
      const inward = inRoom(r, d.x + Math.sin(d.r) * 0.3, d.z + Math.cos(d.r) * 0.3) ? 1 : -1;
      sx += Math.sin(d.r) * 0.03 * inward;
      sz += Math.cos(d.r) * 0.03 * inward;
      out.push({ layer: 'elec', level: l, kind: 'switch', name: `สวิตช์ไฟ ${r.name}`, spec: 'สวิตช์ทางเดียว 16A สูง 1.20 ม.', box: { p: [sx, levelY(l) + 1.2, sz], s: [0.08, 0.12, 0.08] } });
      devs.push({ p: [sx, levelY(l) + 1.2, sz], level: l, drop: true });
    }
    if (devs.length) circuits.push({ kind: 'wire-light', name: `วงจรแสงสว่าง ชั้น ${l + 1}`, spec: `${wireName} 2×1.5 ตร.มม. · เบรกเกอร์ 16A`, level: l, devs });
  }

  // sockets along the walls of each room, avoiding doorways
  const SOCKETS: Partial<Record<Room['type'], number>> = { living: 6, bedroom: 4, office: 5, kitchen: 4, dining: 2, laundry: 1, hall: 1, garage: 1, balcony: 1 };
  const powerDevs = new Map<number, Dev[]>();
  for (const r of rooms) {
    const n = SOCKETS[r.type];
    if (!n) continue;
    const l = lv(r);
    const y = levelY(l) + (r.type === 'kitchen' ? 1.1 : 0.3);
    const per = 2 * (r.w + r.d);
    const doors = house.items.filter((i) => lv(i) === l && lookup(i.t)?.opening && inRoom(r, i.x, i.z, 0.12));
    for (let k = 0; k < n; k++) {
      let t = ((k + 0.5) / n) * per;
      let p: [number, number] = [0, 0];
      for (let tries = 0; tries < 6; tries++) {
        const tt = ((t % per) + per) % per;
        p = tt < r.w ? [r.x - r.w / 2 + tt, r.z - r.d / 2 + 0.03] : tt < r.w + r.d ? [r.x + r.w / 2 - 0.03, r.z - r.d / 2 + (tt - r.w)] : tt < 2 * r.w + r.d ? [r.x + r.w / 2 - (tt - r.w - r.d), r.z + r.d / 2 - 0.03] : [r.x - r.w / 2 + 0.03, r.z + r.d / 2 - (tt - 2 * r.w - r.d)];
        if (!doors.some((d) => Math.hypot(d.x - p[0], d.z - p[1]) < (lookup(d.t)?.opening?.w ?? 1) / 2 + 0.3)) break;
        t += 0.7;
      }
      out.push({ layer: 'elec', level: l, kind: 'socket', name: `เต้ารับ ${r.name}`, spec: `เต้ารับคู่มีกราวด์ 16A สูง ${(y - levelY(l)).toFixed(2)} ม.`, box: { p: [p[0], y, p[1]], s: [0.12, 0.08, 0.12] } });
      powerDevs.set(l, [...(powerDevs.get(l) ?? []), { p: [p[0], y, p[1]], level: l, drop: true }]);
    }
  }
  for (const [l, devs] of powerDevs) {
    for (let i = 0; i < devs.length; i += 8) circuits.push({ kind: 'wire-power', name: `วงจรเต้ารับ ชั้น ${l + 1} #${i / 8 + 1}`, spec: `${wireName} 2×2.5 + G ตร.มม. · เบรกเกอร์ 20A`, level: l, devs: devs.slice(i, i + 8) });
  }

  // air-conditioning in bedrooms and the living room, on an outside wall
  const lux = tier !== 'standard';
  const cooled = lux ? ['bedroom', 'living', 'office', 'dining', 'theater', 'gym', 'library', 'kitchen', 'maid', 'wine', 'closet'] : ['bedroom', 'living', 'office'];
  const vrvIn: V3[] = [];
  for (const r of indoor.filter((o) => cooled.includes(o.type))) {
    const l0 = lv(r);
    if (lux) {
      // VRV: 4-way cassettes in the ceiling, refrigerant pipes back to the condensers
      const n = Math.max(1, Math.round((r.w * r.d) / 30));
      for (let k = 0; k < n; k++) {
        const p: V3 = [r.x - r.w / 2 + (r.w * (k + 0.5)) / n, levelY(l0) + Math.min(r.h, LEVEL_H - 0.3) - 0.15, r.z];
        out.push({ layer: 'elec', level: l0, kind: 'acin', name: `แอร์ VRV ${r.name}`, spec: `VRV Cassette 4 ทิศทาง ${(Math.round((r.w * r.d * 800) / n / 1000) * 1000).toLocaleString('en-US')} BTU · ฝังฝ้า`, box: { p, s: [0.84, 0.25, 0.84] } });
        circuits.push({ kind: 'wire-ac', name: `วงจรแอร์ ${r.name}`, spec: `${wireName} 2×2.5 + G ตร.มม. · เบรกเกอร์ 16A`, level: l0, devs: [{ p, level: l0, drop: true }] });
        vrvIn.push(p);
      }
      continue;
    }
    const l = lv(r);
    const s = (segsBy.get(l) ?? []).filter((x) => isExterior(x) && (x.plus === r.id || x.minus === r.id) && x.s1 - x.s0 > 1.2).sort((a, b) => b.s1 - b.s0 - (a.s1 - a.s0))[0];
    if (!s) continue;
    const o = outSide(s), along = (s.s0 + s.s1) / 2;
    const at = (d: number): [number, number] => (s.axis === 'x' ? [along, s.c + o * d] : [s.c + o * d, along]);
    const [ix, iz] = at(-0.15), [ox, oz] = at(0.55);
    const btu = r.w * r.d > 20 ? '18,000' : r.w * r.d > 14 ? '12,000' : '9,000';
    out.push({ layer: 'elec', level: l, kind: 'acin', name: `แอร์ ${r.name}`, spec: `เครื่องปรับอากาศ Inverter ${btu} BTU`, box: { p: [ix, levelY(l) + 2.3, iz], s: s.axis === 'x' ? [0.9, 0.3, 0.22] : [0.22, 0.3, 0.9] } });
    out.push({ layer: 'elec', level: l, kind: 'acout', name: `คอยล์ร้อน ${r.name}`, spec: `คอนเดนซิ่งยูนิต ${btu} BTU · ท่อทองแดงหุ้มฉนวน`, box: { p: [ox, levelY(l) + (l ? 0.5 : 0.3), oz], s: s.axis === 'x' ? [0.8, 0.55, 0.3] : [0.3, 0.55, 0.8] } });
    circuits.push({ kind: 'wire-ac', name: `วงจรแอร์ ${r.name}`, spec: `${wireName} 2×4 + G ตร.มม. · เบรกเกอร์ 20A`, level: l, devs: [{ p: [ix, levelY(l) + 2.3, iz], level: l, drop: true }] });
  }
  // dedicated circuits: water heaters, cooker, washer, pump
  for (const it of house.items) {
    const d: Record<string, [string, string]> = { heater: ['เครื่องทำน้ำอุ่น', '2×6 + G ตร.มม. · RCBO 32A'], kstove: ['เตาไฟฟ้า/เตาอบ', '2×6 + G ตร.มม. · เบรกเกอร์ 32A'], washer: ['เครื่องซักผ้า', '2×2.5 + G ตร.มม. · RCBO 20A'] };
    const x = d[it.t];
    if (!x) continue;
    const l = lv(it);
    circuits.push({ kind: 'wire-heavy', name: `วงจร${x[0]}`, spec: `${wireName} ${x[1]}`, level: l, devs: [{ p: [it.x, levelY(l) + (it.t === 'heater' ? 1.6 : 1.0), it.z], level: l, drop: true }] });
  }
  if (fixtures.length) circuits.push({ kind: 'wire-heavy', name: 'วงจรปั๊มน้ำ', spec: `${wireName} 2×2.5 + G ตร.มม. · เบรกเกอร์ 20A`, level: 0, devs: [{ p: [tankP[0], 0.4, tankP[2] + 0.9], level: 0, drop: true }] });

  if (lux) luxurySystems({ house, tier, out, circuits, indoor, fp, plan, top, panelP, vrvIn, wireName });

  // route each circuit: up from the panel into the ceiling space, then device to device
  circuits.forEach((c, ci) => {
    const yRun = (l: number) => ceilY(l) - 0.05 - ci * 0.012;
    let cur: V3 = [panelP[0], panelP[1] + 0.25, panelP[2]];
    const pts: V3[] = [cur];
    // nearest-neighbour chain
    const left = [...c.devs];
    while (left.length) {
      left.sort((a, b) => Math.hypot(a.p[0] - cur[0], a.p[2] - cur[2]) - Math.hypot(b.p[0] - cur[0], b.p[2] - cur[2]));
      const d = left.shift()!;
      const y = yRun(d.level);
      pts.push([cur[0], y, cur[2]], [d.p[0], y, cur[2]], [d.p[0], y, d.p[2]]);
      if (d.drop) {
        out.push({ layer: 'elec', level: d.level, kind: c.kind, name: c.name, spec: c.spec, line: { a: [d.p[0], y, d.p[2]], b: d.p, w: 0.025 } });
      }
      cur = [d.p[0], y, d.p[2]];
    }
    path(out, { layer: 'elec', level: c.level, kind: c.kind, name: c.name, spec: c.spec }, pts, 0.025);
  });

  const qty = quantities(out, spec);
  if (lux) {
    const inA = indoor.filter((r) => r.type !== 'void').reduce((a, r) => a + r.w * r.d, 0);
    const outA = rooms.filter((r) => r.outdoor && r.type !== 'pool').reduce((a, r) => a + r.w * r.d, 0);
    qty.push(
      { group: 'งานตกแต่ง', name: tier === 'ultra' ? 'ตกแต่งภายใน Ultra Luxury (บิวท์อิน ไม้วีเนียร์ หินอ่อน ฝ้าหลุม ไฟซ่อน)' : 'ตกแต่งภายใน Luxury (บิวท์อิน ฝ้าหลุม ไฟซ่อน)', qty: +inA.toFixed(1), unit: 'ตร.ม.', rate: tier === 'ultra' ? 35000 : 12000 },
      { group: 'งานตกแต่ง', name: 'ประตูหน้าต่างอลูมิเนียม Thermal break + กระจก Low-E (ต่อพื้นที่ใช้สอย)', qty: +inA.toFixed(1), unit: 'ตร.ม.', rate: tier === 'ultra' ? 3800 : 2400 },
      { group: 'งานตกแต่ง', name: 'งานภูมิสถาปัตย์ (สวน ไฟสวน ระบบรดน้ำ)', qty: +outA.toFixed(1), unit: 'ตร.ม.', rate: tier === 'ultra' ? 4500 : 2800 },
    );
  }
  return { comps: out, quantities: qty, circuits: circuits.length };
}

/* ------------------------------------------------------------------ villa systems */

/** Lift shaft, pool tank and plant, VRV condensers, solar carport, EV charger, generator, fire alarm, lightning protection, CCTV. */
function luxurySystems(a: {
  house: House; tier: Tier; out: Comp[]; circuits: { kind: Kind; name: string; spec: string; level: number; devs: Dev[] }[]; indoor: Room[];
  fp: { x0: number; x1: number; z0: number; z1: number }; plan: ReturnType<typeof roofPlan>; top: number; panelP: V3; vrvIn: V3[]; wireName: string;
}) {
  const { house, tier, out, circuits, indoor, fp, plan, top, panelP, vrvIn, wireName } = a;
  const sys = (kind: Kind, level: number, name: string, spec: string, p: V3, sz: V3) => out.push({ layer: 'systems', level, kind, name, spec, box: { p, s: sz } });

  /* lift: RC shaft from the pit to the overrun, car waiting at the ground floor */
  const lift0 = indoor.find((r) => r.type === 'lift' && lv(r) === 0);
  if (lift0) {
    const hi = Math.max(...indoor.filter((r) => r.type === 'lift' && Math.abs(r.x - lift0.x) < 0.3 && Math.abs(r.z - lift0.z) < 0.3).map(lv));
    const y0 = -1.4, y1 = levelY(hi + 1) + 0.6, t = 0.2, w = lift0.w - 0.2, d = lift0.d - 0.2, H = y1 - y0;
    const sp = `ผนังคอนกรีตเสริมเหล็ก หนา 0.20 ม. · DB12 @0.20 สองชั้น · สูง ${H.toFixed(2)} ม.`;
    // three sides; the landing doors face the corridor (+z)
    for (const [dx, dz, sx, sz] of [[0, -d / 2, w, t], [-w / 2, 0, t, d], [w / 2, 0, t, d]] as const)
      out.push({ layer: 'frame', level: 0, kind: 'shaft', name: 'ผนังปล่องลิฟต์', spec: sp, box: { p: [lift0.x + dx, (y0 + y1) / 2, lift0.z + dz], s: [sx, H, sz] } });
    out.push({ layer: 'found', level: 0, kind: 'shaft', name: 'บ่อลิฟต์ (Lift pit)', spec: 'คอนกรีตกันซึม หนา 0.30 ม. · ลึก 1.40 ม. · กันซึม Crystalline', box: { p: [lift0.x, y0 - 0.15, lift0.z], s: [w + 0.4, 0.3, d + 0.4] } });
    sys('liftcar', 0, 'ลิฟต์บ้าน (Home lift)', `ลิฟต์ไม่มีห้องเครื่อง (MRL) 400 กก. 5 คน · ${hi + 1} ชั้น · 0.4 ม./วินาที · ARD พาลงชั้นใกล้สุดเมื่อไฟดับ`, [lift0.x, 1.15, lift0.z - 0.1], [Math.min(1.2, w - 0.3), 2.2, Math.min(1.3, d - 0.4)]);
    sys('liftcar', hi, 'มอเตอร์ลิฟต์ Gearless', 'Permanent magnet synchronous · ติดตั้งบนสุดของปล่อง', [lift0.x, y1 - 0.4, lift0.z], [0.6, 0.4, 0.5]);
    circuits.push({ kind: 'wire-heavy', name: 'วงจรลิฟต์', spec: `${wireName} 4×6 + G ตร.มม. · 3 เฟส · เบรกเกอร์ 32A`, level: hi, devs: [{ p: [lift0.x, levelY(hi) + 0.3, lift0.z - d / 2 + 0.1], level: hi, drop: true }] });
  }

  /* pool: RC tank on piles, overflow channel, pipes to the plant */
  for (const r of house.rooms.filter((o) => o.type === 'pool')) {
    const D = 1.5, t = 0.25, x0 = r.x - r.w / 2, z0 = r.z - r.d / 2;
    const sp = 'คอนกรีตเสริมเหล็ก 280 ksc หนา 0.25 ม. · DB16 @0.15 สองชั้น · กันซึม Crystalline + PU';
    out.push({ layer: 'found', level: 0, kind: 'pooltank', name: 'พื้นสระว่ายน้ำ', spec: sp, box: { p: [r.x, -D - t / 2, r.z], s: [r.w + 2 * t, t, r.d + 2 * t] } });
    const walls: [V3, V3][] = [
      [[r.x, -D / 2, z0 - t / 2], [r.w + 2 * t, D, t]], [[r.x, -D / 2, z0 + r.d + t / 2], [r.w + 2 * t, D, t]],
      [[x0 - t / 2, -D / 2, r.z], [t, D, r.d]], [[x0 + r.w + t / 2, -D / 2, r.z], [t, D, r.d]],
    ];
    for (const [p, sz] of walls) out.push({ layer: 'found', level: 0, kind: 'pooltank', name: 'ผนังสระว่ายน้ำ', spec: sp, box: { p, s: sz } });
    for (let x = x0 + 1; x < x0 + r.w; x += 3)
      for (let z = z0 + 1; z < z0 + r.d; z += 3)
        out.push({ layer: 'found', level: 0, kind: 'pile', name: 'เสาเข็มสระว่ายน้ำ', spec: 'เสาเข็มเจาะ ø0.35 ม. ลึก 12 ม.', box: { p: [x, -D - 0.25 - 6, z], s: [0.35, 12, 0.35] } });
    const plant: V3 = [x0 - 1.4, 0.6, r.z];
    sys('poolplant', 0, 'ห้องเครื่องสระว่ายน้ำ', 'ปั๊มกรอง 1.5 HP ×2 · ถังกรองทราย ø0.75 ม. · ระบบเกลือคลอรีน · ฮีทปั๊ม · ถังพักน้ำล้น (Balancing tank)', plant, [1.6, 1.2, 2.2]);
    const pipe = (name: string, sp2: string, pts: V3[]) => path(out, { layer: 'systems', level: 0, kind: 'poolpipe', name, spec: sp2 }, pts, 0.06);
    pipe('ท่อดูดน้ำก้นสระ (Main drain)', 'PVC 3" ชั้น 13.5', [[r.x, -D + 0.05, r.z], [r.x, -D + 0.05, z0 - 0.5], [plant[0], -D + 0.05, z0 - 0.5], [plant[0], 0, plant[2]]]);
    pipe('รางน้ำล้นรอบสระ (Overflow)', 'รางน้ำล้น + PVC 4"', [[x0, -0.1, z0 - 0.15], [x0 + r.w, -0.1, z0 - 0.15], [x0 + r.w, -0.1, z0 + r.d + 0.15], [x0, -0.1, z0 + r.d + 0.15], [x0, -0.1, z0 - 0.15]]);
    for (let x = x0 + 1.5; x < x0 + r.w - 0.5; x += 3) pipe('หัวจ่ายน้ำเข้าสระ (Inlet)', 'PVC 2" ชั้น 13.5', [[x, -0.5, z0 + r.d], [x, -0.5, z0 + r.d + 0.4], [plant[0] + 0.8, -0.5, z0 + r.d + 0.4]]);
    circuits.push({ kind: 'wire-heavy', name: 'วงจรระบบสระว่ายน้ำ', spec: `${wireName} 4×10 + G ตร.มม. · RCBO 30mA`, level: 0, devs: [{ p: plant, level: 0, drop: true }] });
  }

  /* VRV condensers behind the house, refrigerant pipes up to each cassette */
  if (vrvIn.length) {
    const at = (i: number): V3 => [fp.x0 + 2 + i * 1.5, 0.84, fp.z0 - 1.2];
    for (let i = 0; i * 10 < vrvIn.length; i++)
      sys('vrv', 0, `คอนเดนซิ่ง VRV #${i + 1}`, `VRV Inverter 3 เฟส 16 HP · ต่อเครื่องภายใน ${Math.min(10, vrvIn.length - i * 10)} เครื่อง`, at(i), [1.24, 1.68, 0.77]);
    vrvIn.forEach((p, k) => {
      const o = at(Math.floor(k / 10)), y = p[1] + 0.14;
      path(out, { layer: 'systems', level: 0, kind: 'refpipe', name: 'ท่อน้ำยาแอร์ VRV', spec: 'ท่อทองแดง + ฉนวน Armaflex 3/4" · Refnet joint' }, [[o[0], o[1] + 0.84, o[2]], [o[0], y, o[2]], [o[0], y, p[2]], [p[0], y, p[2]], p], 0.04);
    });
  }

  /* solar carport over the motor court, inverter and EV wall box */
  const court = house.rooms.find((r) => r.type === 'garage');
  if (court) {
    const PW = 1.13, PL = 2.28, nx = Math.floor((court.w - 0.4) / PW), nz = Math.max(1, Math.floor((court.d * 0.5) / PL));
    const cx0 = court.x - (nx * PW) / 2, cz0 = court.z - court.d / 2 + 0.3;
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nz; j++)
        sys('solar', 0, 'แผงโซลาร์เซลล์', 'Mono PERC 550 W · หลังคาโรงจอดรถ (Solar carport)', [cx0 + (i + 0.5) * PW, 2.75, cz0 + (j + 0.5) * PL], [PW - 0.03, 0.04, PL - 0.03]);
    for (const x of [cx0 + 0.2, cx0 + nx * PW - 0.2])
      for (const z of [cz0 + 0.2, cz0 + nz * PL - 0.2])
        out.push({ layer: 'frame', level: 0, kind: 'column', name: 'เสาโครงโซลาร์คาร์พอร์ต', spec: 'เหล็กกล่อง 150×150×4.5 มม. · ฐานคอนกรีต', box: { p: [x, 1.36, z], s: [0.15, 2.72, 0.15] } });
    sys('inverter', 0, 'อินเวอร์เตอร์โซลาร์', `Hybrid inverter ${((nx * nz * 550) / 1000).toFixed(1)} kWp · แบตเตอรี่ LFP 15 kWh · On-grid (ขออนุญาตการไฟฟ้า)`, [fp.x1 + 0.15, 1.4, fp.z0 + 1.5], [0.2, 0.7, 0.5]);
    const ev: V3 = [court.x - court.w / 2 + 0.5, 1.2, court.z - court.d / 2 + 0.15];
    sys('ev', 0, 'เครื่องชาร์จรถยนต์ไฟฟ้า (EV Charger)', 'Wall box 7.4 kW Type 2 · มิเตอร์ TOU · RCD Type B', ev, [0.25, 0.4, 0.15]);
    circuits.push({ kind: 'wire-heavy', name: 'วงจร EV Charger', spec: `${wireName} 2×10 + G ตร.มม. · RCBO 40A Type B`, level: 0, devs: [{ p: ev, level: 0, drop: true }] });
  }

  /* standby generator and automatic transfer switch (ultra) */
  if (tier === 'ultra') {
    const g: V3 = [fp.x1 + 2.0, 0.85, fp.z0 + 3.5];
    sys('genset', 0, 'เครื่องกำเนิดไฟฟ้าสำรอง', 'Diesel generator 60 kVA ตู้เก็บเสียง · ถังน้ำมันใช้งาน 8 ชม.', g, [1.2, 1.7, 2.6]);
    sys('ats', 0, 'ตู้สลับแหล่งจ่ายไฟอัตโนมัติ (ATS)', 'ATS 4P 125A · สลับภายใน 10 วินาที', [fp.x1 + 0.15, 1.4, g[2]], [0.25, 0.7, 0.5]);
  }

  /* fire alarm: smoke detectors (heat detector in kitchens), panel next to the main board */
  for (const r of indoor) {
    if (r.type === 'void' || r.type === 'lift' || r.type === 'bathroom') continue;
    const l = lv(r), heat = r.type === 'kitchen';
    sys('smoke', l, `${heat ? 'ตรวจจับความร้อน' : 'ตรวจจับควัน'} ${r.name}`, heat ? 'Heat detector อัตรากระทำ 57°C' : 'Photoelectric smoke detector · ครอบคลุม ≤ 80 ตร.ม.', [r.x + 0.4, levelY(l) + r.h - 0.03, r.z + 0.4], [0.12, 0.05, 0.12]);
  }
  sys('firepanel', 0, 'ตู้ควบคุมแจ้งเหตุเพลิงไหม้', 'Addressable fire alarm panel · กระดิ่ง + ไฟกะพริบทุกชั้น · แบตเตอรี่สำรอง 24 ชม.', [panelP[0], panelP[1] - 0.6, panelP[2]], [0.4, 0.5, 0.12]);
  sys('rack', 0, 'ตู้ Rack Smart Home / CCTV / Wi-Fi', 'NVR 16 ช่อง · Wi-Fi Mesh ทุกชั้น · ควบคุมไฟ ม่าน แอร์ ผ่านแอป (KNX)', [fp.x1 - 0.4, 1.0, fp.z0 + 0.4], [0.6, 2.0, 0.6]);

  /* CCTV at the corners of the house and at the gate */
  for (const [x, z] of [[fp.x0, fp.z0], [fp.x1, fp.z0], [fp.x0, fp.z1], [fp.x1, fp.z1]])
    sys('cctv', 0, 'กล้องวงจรปิด', 'IP camera 4 MP PoE · อินฟราเรด 30 ม. · บันทึก 30 วัน', [x, 2.9, z], [0.12, 0.12, 0.25]);
  if (court) sys('cctv', 0, 'กล้องวงจรปิดประตูรั้ว', 'IP camera 4 MP + อ่านป้ายทะเบียน (LPR)', [court.x + court.w / 2 - 0.3, 2.6, court.z + court.d / 2 - 0.2], [0.12, 0.12, 0.25]);

  /* lightning protection: air terminals at the roof corners, down conductors to earth rods */
  if (plan) {
    const y = plan.base + 0.05;
    const corners: [number, number][] = [[plan.x0, plan.z0], [plan.x1, plan.z0], [plan.x1, plan.z1], [plan.x0, plan.z1]];
    const cond = { layer: 'systems' as Layer, level: top, kind: 'lightning' as Kind, name: 'ตัวนำล่อฟ้ารอบหลังคา', spec: 'สายทองแดงเปลือย 50 ตร.มม. (วสท. / IEC 62305)' };
    path(out, cond, [...corners, corners[0]].map(([x, z]): V3 => [x, y, z]), 0.02);
    for (const [x, z] of corners) {
      sys('lightning', top, 'หัวล่อฟ้า', 'Air terminal ทองแดง ø16 มม. สูง 1.0 ม.', [x, y + 0.5, z], [0.03, 1.0, 0.03]);
      path(out, { ...cond, level: 0, name: 'ตัวนำลงดิน' }, [[x, y, z], [x, -0.6, z]], 0.02);
      sys('lightning', 0, 'หลักดินล่อฟ้า', 'แท่งทองแดง ø5/8" ยาว 3 ม. · ความต้านทานดิน ≤ 10 โอห์ม', [x, -1.8, z], [0.03, 2.4, 0.03]);
    }
  }
}

/* ------------------------------------------------------------------ quantities */

const vol = (c: Comp) => (c.box ? c.box.s[0] * c.box.s[1] * c.box.s[2] : c.line ? len(c.line.a, c.line.b) * c.line.w * (c.line.h ?? c.line.w) : 0);
const area = (c: Comp) => (c.box ? Math.max(c.box.s[0], c.box.s[2]) * c.box.s[1] : 0);
const footprint = (c: Comp) => (c.box ? c.box.s[0] * c.box.s[2] : 0);
const length = (c: Comp) => (c.line ? len(c.line.a, c.line.b) : 0);

export interface QtyLine {
  group: string;
  name: string;
  qty: number;
  unit: string;
  rate: number;
}

/** Bill of quantities for structure and services, with rough Thai-market rates (THB). */
export function quantities(comps: Comp[], spec: BuildSpec): QtyLine[] {
  const sum = (k: Kind | Kind[], f: (c: Comp) => number) => comps.filter((c) => ([] as Kind[]).concat(k).includes(c.kind)).reduce((a, c) => a + f(c), 0);
  const count = (k: Kind) => comps.filter((c) => c.kind === k).length;
  const wire = spec.wire === 'thw' ? 1.35 : 1; // THW in conduit costs more than clipped VAF
  const pipe = spec.pipe === 'ppr' ? 85 : 45;
  const concrete = sum(['footing', 'column', 'gbeam', 'beam', 'lintel', 'shaft'], vol);
  const bored = comps.filter((c) => c.kind === 'pile' && c.spec.startsWith('เสาเข็มเจาะ'));
  const boredBy = new Map<string, number>();
  for (const c of bored) boredBy.set(c.spec, (boredBy.get(c.spec) ?? 0) + 1);
  const vrv = comps.filter((c) => c.kind === 'acin' && c.spec.startsWith('VRV')).length;
  const poolA = sum('pooltank', (c) => (c.name === 'พื้นสระว่ายน้ำ' ? footprint(c) : 0));
  const wallA = sum('brick', area);
  const L: QtyLine[] = [
    { group: 'ฐานราก', name: SPEC_NAMES.pile[spec.pile], qty: count('pile') - bored.length, unit: 'ต้น', rate: spec.pile === 'spun' ? 3200 : 2000 },
    ...[...boredBy].map(([name, n]): QtyLine => ({ group: 'ฐานราก', name, qty: n, unit: 'ต้น', rate: name.includes('0.60') ? 38000 : name.includes('0.50') ? 26000 : 9500 })),
    { group: 'ฐานราก', name: 'งานดินขุด-ถม', qty: Math.ceil(count('footing') * 1.6 * 1.6 * 1.5), unit: 'ลบ.ม.', rate: 250 },
    { group: 'โครงสร้าง', name: 'คอนกรีตโครงสร้าง (ฐาน เสา คาน ทับหลัง) รวมเหล็กและไม้แบบ', qty: +concrete.toFixed(2), unit: 'ลบ.ม.', rate: 7800 },
    { group: 'โครงสร้าง', name: 'เหล็กเสริม (โดยประมาณ 100 กก./ลบ.ม.)', qty: Math.round(concrete * 100), unit: 'กก.', rate: 0 },
    { group: 'โครงสร้าง', name: 'พื้นวางบนดิน คอนกรีต 10 ซม.', qty: +sum('slab', (c) => (c.name === 'พื้นวางบนดิน' || c.name === 'พื้นคอนกรีตลานจอด/ลาน' ? footprint(c) : 0)).toFixed(1), unit: 'ตร.ม.', rate: 520 },
    { group: 'โครงสร้าง', name: 'แผ่นพื้นสำเร็จรูป + คอนกรีตทับหน้า', qty: +sum('plank', footprint).toFixed(1), unit: 'ตร.ม.', rate: 690 },
    { group: 'โครงสร้าง', name: 'พื้นระเบียงหล่อในที่', qty: +sum('slab', (c) => (c.name === 'พื้นระเบียงหล่อในที่' ? footprint(c) : 0)).toFixed(1), unit: 'ตร.ม.', rate: 1150 },
    { group: 'ผนัง', name: `${SPEC_NAMES.block[spec.block]} (${spec.block === 'red' ? '138' : '8.3'} ก้อน/ตร.ม.)`, qty: +wallA.toFixed(1), unit: 'ตร.ม.', rate: spec.block === 'red' ? 370 : 445 },
    { group: 'ผนัง', name: 'ฉาบปูนเรียบสองด้าน', qty: +(wallA * 2).toFixed(1), unit: 'ตร.ม.', rate: 165 },
    { group: 'หลังคา/ฝ้า', name: 'โครงหลังคาเหล็ก (จันทัน แป อกไก่ ตะเฆ่ ดั้ง)', qty: +sum(['rafter', 'purlin', 'ridge', 'post'], length).toFixed(0), unit: 'ม.', rate: 0 },
    { group: 'หลังคา/ฝ้า', name: 'ฝ้ายิปซัม 9 มม. + โครงซีลาย', qty: +comps.filter((c) => c.kind === 'cframe').reduce((a, c) => a + length(c) * 0.3, 0).toFixed(1), unit: 'ตร.ม.', rate: 380 },
    { group: 'ประปา', name: `ท่อน้ำดี/น้ำร้อน ${SPEC_NAMES.pipe[spec.pipe]}`, qty: +sum(['cold', 'hot'], length).toFixed(1), unit: 'ม.', rate: pipe },
    { group: 'ประปา', name: 'ท่อโสโครก PVC 4"', qty: +sum('soil', length).toFixed(1), unit: 'ม.', rate: 220 },
    { group: 'ประปา', name: 'ท่อน้ำทิ้ง PVC 2"–4"', qty: +sum('grey', length).toFixed(1), unit: 'ม.', rate: 140 },
    { group: 'ประปา', name: 'ท่ออากาศ PVC 1½"', qty: +sum('vent', length).toFixed(1), unit: 'ม.', rate: 70 },
    { group: 'ประปา', name: 'ถังเก็บน้ำ 1,000 ลิตร', qty: count('tank'), unit: 'ใบ', rate: 5900 },
    { group: 'ประปา', name: 'ปั๊มน้ำอัตโนมัติ', qty: count('pump'), unit: 'ตัว', rate: 5500 },
    { group: 'ประปา', name: 'ถังบำบัดน้ำเสีย 1,600 ลิตร', qty: count('septic'), unit: 'ใบ', rate: 9500 },
    { group: 'ประปา', name: 'บ่อพักน้ำทิ้ง', qty: count('pit'), unit: 'บ่อ', rate: 1800 },
    { group: 'ประปา', name: 'บ่อดักไขมัน', qty: count('grease'), unit: 'ชุด', rate: 2200 },
    { group: 'ประปา', name: 'ขอติดตั้งมาตรวัดน้ำ', qty: count('wmeter'), unit: 'ชุด', rate: 4500 },
    { group: 'ไฟฟ้า', name: 'ขอติดตั้งมิเตอร์ไฟฟ้า 15(45)A', qty: count('emeter'), unit: 'ชุด', rate: 6000 },
    { group: 'ไฟฟ้า', name: 'ตู้ควบคุมไฟฟ้า + เบรกเกอร์ลูกย่อย', qty: count('panel'), unit: 'ชุด', rate: 9500 },
    { group: 'ไฟฟ้า', name: 'หลักดิน + สายดิน', qty: comps.filter((c) => c.kind === 'ground' && c.box).length, unit: 'ชุด', rate: 1500 },
    { group: 'ไฟฟ้า', name: 'สายเมน THW 16 ตร.มม. + ท่อฝังดิน', qty: +sum('wire-main', length).toFixed(1), unit: 'ม.', rate: 160 },
    { group: 'ไฟฟ้า', name: 'สายวงจรแสงสว่าง 1.5 ตร.มม.', qty: +sum('wire-light', length).toFixed(1), unit: 'ม.', rate: Math.round(28 * wire) },
    { group: 'ไฟฟ้า', name: 'สายวงจรเต้ารับ 2.5 ตร.มม.', qty: +sum('wire-power', length).toFixed(1), unit: 'ม.', rate: Math.round(42 * wire) },
    { group: 'ไฟฟ้า', name: 'สายวงจรแอร์ 4 ตร.มม.', qty: +sum('wire-ac', length).toFixed(1), unit: 'ม.', rate: Math.round(62 * wire) },
    { group: 'ไฟฟ้า', name: 'สายวงจรเฉพาะ (น้ำอุ่น เตา ซักผ้า ปั๊ม)', qty: +sum('wire-heavy', length).toFixed(1), unit: 'ม.', rate: Math.round(85 * wire) },
    { group: 'ไฟฟ้า', name: 'จุดสวิตช์', qty: count('switch'), unit: 'จุด', rate: 300 },
    { group: 'ไฟฟ้า', name: 'จุดเต้ารับ', qty: count('socket'), unit: 'จุด', rate: 380 },
    { group: 'ไฟฟ้า', name: 'เครื่องปรับอากาศ (รวมติดตั้ง)', qty: count('acin') - vrv, unit: 'ชุด', rate: 17900 },
    { group: 'โครงสร้าง', name: 'พื้นคอนกรีตอัดแรงภายหลัง (Post-tension)', qty: +sum('slab', (c) => (c.name.includes('Post-tension') ? footprint(c) : 0)).toFixed(1), unit: 'ตร.ม.', rate: 2300 },
    { group: 'ระบบอาคาร', name: 'ลิฟต์บ้าน MRL 400 กก. (รวมติดตั้ง)', qty: comps.filter((c) => c.kind === 'liftcar' && c.name.startsWith('ลิฟต์')).length, unit: 'ชุด', rate: 2600000 },
    { group: 'ระบบอาคาร', name: 'สระว่ายน้ำ (โครงสร้าง กันซึม กระเบื้องโมเสก รางน้ำล้น)', qty: +poolA.toFixed(1), unit: 'ตร.ม.', rate: 32000 },
    { group: 'ระบบอาคาร', name: 'ระบบกรองสระว่ายน้ำ + ฮีทปั๊ม', qty: count('poolplant'), unit: 'ชุด', rate: 280000 },
    { group: 'ระบบอาคาร', name: 'แอร์ VRV (เครื่องภายใน + ท่อน้ำยา + ส่วนแบ่งคอนเดนซิ่ง)', qty: vrv, unit: 'เครื่อง', rate: 78000 },
    { group: 'ระบบอาคาร', name: 'แผงโซลาร์เซลล์ 550 W + โครงคาร์พอร์ต', qty: count('solar'), unit: 'แผง', rate: 9800 },
    { group: 'ระบบอาคาร', name: 'Hybrid inverter + แบตเตอรี่ LFP 15 kWh', qty: count('inverter'), unit: 'ชุด', rate: 260000 },
    { group: 'ระบบอาคาร', name: 'เครื่องชาร์จรถยนต์ไฟฟ้า 7.4 kW', qty: count('ev'), unit: 'ชุด', rate: 45000 },
    { group: 'ระบบอาคาร', name: 'เครื่องกำเนิดไฟฟ้าสำรอง 60 kVA', qty: count('genset'), unit: 'ชุด', rate: 650000 },
    { group: 'ระบบอาคาร', name: 'ตู้ ATS 125A', qty: count('ats'), unit: 'ชุด', rate: 85000 },
    { group: 'ระบบอาคาร', name: 'อุปกรณ์ตรวจจับควัน/ความร้อน', qty: count('smoke'), unit: 'จุด', rate: 2400 },
    { group: 'ระบบอาคาร', name: 'ตู้ควบคุมแจ้งเหตุเพลิงไหม้', qty: count('firepanel'), unit: 'ชุด', rate: 65000 },
    { group: 'ระบบอาคาร', name: 'ระบบป้องกันฟ้าผ่า (หัวล่อฟ้า ตัวนำ หลักดิน)', qty: comps.filter((c) => c.kind === 'lightning' && c.name === 'หัวล่อฟ้า').length, unit: 'จุด', rate: 22000 },
    { group: 'ระบบอาคาร', name: 'กล้องวงจรปิด IP 4 MP', qty: count('cctv'), unit: 'ตัว', rate: 7500 },
    { group: 'ระบบอาคาร', name: 'Smart home + Wi-Fi Mesh + NVR', qty: count('rack'), unit: 'ระบบ', rate: 450000 },
  ];
  return L.filter((l) => l.qty > 0);
}
