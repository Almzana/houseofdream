/**
 * House designer: lays out a complete one- or two-storey house from a few
 * choices, with doors, windows, stairs and furniture in every room.
 * Plans are drawn with the back of the house at z = 0 and the street at +z.
 */
import { DEFAULT_EXT, TIER_STOREY, applyStorey, stairSteps, type Exterior, type House, type Item, type Room, type RoomType, type RoofStyle, type Tier } from '../types';
import { catalogById } from './catalog';
import { makeRoom, uid } from './templates';
import { openingsOf } from '../lib/shell';
import { isExterior, wallSegments } from '../lib/walls';

export interface GenOptions {
  floors: 1 | 2;
  bedrooms: number;
  bathrooms: number;
  garage: boolean;
  garden: boolean;
  roof: RoofStyle;
  /** standard family house, or a luxury / ultra-luxury villa */
  tier?: Tier;
  pool?: boolean;
}

type Side = 'n' | 's' | 'e' | 'w';
type Spec = [t: string, x: number, z: number, r?: number];
const P = Math.PI;

/* ------------------------------------------------------------------ furniture */

/** Furniture for a room in its own frame: entrance on the +z side, back wall at −z. */
function layout(type: RoomType, lw: number, ld: number, big: boolean): Spec[] {
  const B = -ld / 2, F = ld / 2, Lw = -lw / 2, Rw = lw / 2;
  const out: Spec[] = [];
  switch (type) {
    case 'bedroom': {
      const bed = lw * ld >= 24 && lw >= 4.4 ? 'kingbed' : big && lw >= 3.8 ? 'bed6' : lw >= 3 ? 'bed' : 'singlebed';
      const bw = bed === 'kingbed' ? 2.2 : bed === 'bed6' ? 1.8 : bed === 'bed' ? 1.6 : 1.05;
      const bx = bed === 'singlebed' ? Lw + 0.62 : 0;
      out.push([bed, bx, B + 1.07]);
      for (const s of [-1, 1]) {
        const x = bx + s * (bw / 2 + 0.3);
        if (x > Lw + 0.22 && x < Rw - 0.22) out.push(['nightstand', x, B + 0.25]);
      }
      const wd = big ? 'wardrobe2' : 'wardrobe', ww = big ? 2 : 1.2;
      if (ld - 2.3 > ww * 0.6 || lw - bw > 1.6) out.push([wd, Rw - 0.32, Math.max(B + 2.3, F - ww / 2 - 0.15), -P / 2]);
      if (bed === 'singlebed' && ld >= 3.4) out.push(['desk', Rw - 0.32, B + 0.75, -P / 2], ['officechair', Rw - 0.9, B + 0.75, -P / 2]);
      if (big && ld >= 3.8) out.push(['rug', 0, B + 2.1]);
      out.push(['art', bx, B, 0]);
      break;
    }
    case 'living': {
      const sec = lw >= 4.4 && ld >= 4.2;
      const sz = B + Math.min(ld - (sec ? 1.0 : 0.7), sec ? 3.6 : 3.2);
      out.push(['tv', 0, B + 0.22], [sec ? 'sectional' : 'sofa', 0, sz, P], ['coffee', 0, (B + 0.4 + sz) / 2], ['rug', 0, (B + 0.4 + sz) / 2 + 0.1]);
      out.push(['floorlamp', Rw - 0.35, sz + 0.25], ['fiddle', Lw + 0.4, B + 0.4], ['plant', Rw - 0.3, B + 0.3]);
      if (lw >= 5) out.push(['armchair', Lw + 0.7, (B + sz) / 2 + 0.3, P / 2]);
      out.push(['art', Lw, (B + sz) / 2, P / 2]);
      break;
    }
    case 'dining': {
      if (lw >= 2.6 && ld >= 3) {
        out.push(['dining', 0, 0, P / 2], ['pendant', 0, 0]);
        for (const z of [-0.6, 0, 0.6]) out.push(['chair', -0.5, z, P / 2], ['chair', 0.5, z, -P / 2]);
      } else {
        out.push(['roundtable', 0, 0], ['pendant', 0, 0], ['chair', 0, -0.7, 0], ['chair', 0, 0.7, P], ['chair', -0.7, 0, P / 2], ['chair', 0.7, 0, -P / 2]);
      }
      if (ld >= 3.8) out.push(['sideboard', 0, B + 0.25]);
      out.push(['vase', 0.2, -0.1]);
      break;
    }
    case 'kitchen': {
      let cur = Lw + 0.02;
      const put = (t: string, w: number, upper?: string) => {
        if (cur + w > Rw - 0.02) return;
        out.push([t, cur + w / 2, B + (t === 'fridge' ? 0.36 : 0.3)]);
        if (upper) out.push([upper, cur + w / 2, B]);
        cur += w;
      };
      put('fridge', 0.72);
      put('ksink', 1.2, 'kupper');
      put('kstove', 0.9, 'hood');
      put('kbase', 1.2, 'kupper');
      if (lw >= 3.2 && ld >= 3.9) {
        const iz = B + 0.6 + 1.15 + 0.45;
        out.push(['island', 0, iz], ['barstool', -0.45, iz + 0.75], ['barstool', 0.45, iz + 0.75], ['pendant', -0.45, iz], ['pendant', 0.45, iz]);
      }
      break;
    }
    case 'bathroom': {
      out.push(['toilet', Lw + 0.45, B + 0.38], ['shower', Rw - 0.47, B + 0.47], ['heater', Rw, B + 0.5, -P / 2]);
      const vz = Math.min(F - 0.55, B + 1.4);
      out.push(['vanity', Lw + 0.24, vz, P / 2], ['mirror', Lw, vz, P / 2], ['towel', Rw, Math.min(F - 0.5, B + 1.5), -P / 2], ['bathmat', Rw - 0.5, B + 1.15]);
      if (lw >= 2.6 && ld >= 3.2) out.push(['bathtub', 0.15, F - 0.5]);
      else out.push(['plant', Rw - 0.25, F - 0.25]);
      break;
    }
    case 'office':
      out.push(['desk', 0, B + 0.32], ['officechair', 0, B + 0.9], ['bookshelf', Rw - 0.17, 0, -P / 2], ['plant', Lw + 0.3, B + 0.3]);
      break;
    case 'laundry':
      out.push(['washer', Lw + 0.32, B + 0.32], ['basket', Lw + 0.95, B + 0.3]);
      break;
    case 'hall':
      if (lw >= 1.2 && ld >= 1.2) out.push(['plant', Rw - 0.3, B + 0.3]);
      break;
    case 'garage':
      out.push(['car', 0, 0.1]);
      break;
    case 'garden':
      out.push(['tree', lw * 0.28, -ld * 0.15], ['outdoorset', -lw * 0.22, 0.2]);
      if (lw > 4) out.push(['lounger', lw * 0.3, ld * 0.25, P / 2], ['shrub', -lw * 0.22, F - 0.35]);
      break;
    case 'balcony':
      out.push(['plant', Lw + 0.3, B + 0.3], ['plant', Rw - 0.3, B + 0.3]);
      if (ld >= 1.4 && lw >= 2.4) out.push(['outdoorset', 0, 0]);
      break;
    case 'theater':
      out.push(['screen', 0, B, 0]);
      for (const z of [B + 3.2, B + 4.5]) if (z < F - 0.6) out.push(['theaterseat', 0, z, P]);
      out.push(['plant', Lw + 0.35, F - 0.35]);
      break;
    case 'gym':
      for (let x = Lw + 0.7; x < Rw - 0.5; x += 1.1) out.push(['treadmill', x, B + 1.2]);
      out.push(['plant', Rw - 0.35, F - 0.35], ['towel', Lw, 0, P / 2]);
      break;
    case 'spa':
      out.push(['sauna', Lw + 1.0, B + 0.85], ['bathtub', Rw - 1.0, 0.3, P / 2], ['plant', Rw - 0.35, F - 0.35], ['towel', Lw, F - 0.8, P / 2]);
      break;
    case 'wine':
      for (let x = Lw + 0.7; x < Rw - 0.5; x += 1.25) out.push(['winerack', x, B + 0.25]);
      out.push(['roundtable', 0, 0.4], ['chair', 0, -0.3, 0], ['chair', 0, 1.1, P]);
      break;
    case 'closet':
      if (lw >= 3 && ld >= 2.8) out.push(['walkin', 0, B + 1.55]);
      else out.push(['wardrobe2', 0, B + 0.32]);
      out.push(['mirror', Lw, 0, P / 2]);
      break;
    case 'library':
      for (let x = Lw + 0.5; x < Rw - 0.4; x += 0.95) out.push(['bookshelf', x, B + 0.17]);
      out.push(['desk', 0, 0.3, P], ['officechair', 0, 0.9, P], ['armchair', Lw + 0.7, F - 0.9, P / 2], ['floorlamp', Lw + 0.35, F - 0.4]);
      break;
    case 'maid':
      out.push(['singlebed', Lw + 0.62, B + 1.07], ['wardrobe', Rw - 0.32, 0, -P / 2]);
      break;
    case 'lift':
      out.push(['liftcar', 0, 0]);
      break;
    case 'terrace':
      for (let x = Lw + 0.6; x < Rw - 0.5; x += 1.4) out.push(['lounger', x, F - 1.0, P]);
      out.push(['plant', Lw + 0.3, B + 0.3], ['plant', Rw - 0.3, B + 0.3]);
      break;
  }
  // signature pieces in large living and dining rooms
  if (type === 'living' && lw * ld >= 40) out.push(['piano', Rw - 1.3, F - 1.6, P * 0.85], ['chandelier', 0, (B + F) / 2]);
  if (type === 'dining' && lw * ld >= 25) out.push(['chandelier', 0, 0]);
  // ceiling lighting: a grid of downlights (≈ one per 3 m²) or a single ceiling lamp
  const grid = (dx: number, dz: number) => {
    const nx = Math.max(1, Math.round(lw / dx)), nz = Math.max(1, Math.round(ld / dz));
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) out.push(['downlight', Lw + ((i + 0.5) * lw) / nx, B + ((j + 0.5) * ld) / nz]);
  };
  switch (type) {
    case 'bedroom': case 'office': case 'maid': out.push(['ceilinglamp', 0, 0]); break;
    case 'theater': case 'gym': case 'spa': case 'wine': case 'closet': case 'library': case 'lift': grid(2.4, 2.4); break;
    case 'terrace': out.push(['gardenlight', Lw + 0.4, F - 0.4], ['gardenlight', Rw - 0.4, F - 0.4]); break;
    case 'living': case 'kitchen': grid(2.6, 2.6); break;
    case 'bathroom': case 'laundry': case 'hall': grid(3.2, 3.2); break;
    case 'garden': out.push(['gardenlight', Lw + 0.4, F - 0.4], ['gardenlight', Rw - 0.4, F - 0.4]); break;
    case 'balcony': out.push(['walllight', 0, B, 0]); break;
  }
  return out;
}

/** Furnish a room; `side` is the wall the room is entered from. */
export function furnish(room: Room, side: Side = 's'): Item[] {
  const turn = side === 's' ? 0 : side === 'n' ? P : side === 'e' ? P / 2 : -P / 2;
  const swap = side === 'e' || side === 'w';
  const lw = swap ? room.d : room.w, ld = swap ? room.w : room.d;
  const c = Math.cos(turn), s = Math.sin(turn);
  return layout(room.type, lw, ld, lw * ld >= 15).map(([t, x, z, r = 0]) => ({
    id: uid('i'), t, c: catalogById.get(t)?.colors[0] ?? '', l: room.level ?? 0,
    x: +(room.x + x * c + z * s).toFixed(3), z: +(room.z - x * s + z * c).toFixed(3), r: +(r + turn).toFixed(4),
  }));
}

/** Which side of a room its door is on (from door items standing on its edges). */
export function entranceSide(room: Room, items: Item[]): Side {
  let best: Side = 's', bd = Infinity;
  for (const it of items) {
    const o = catalogById.get(it.t)?.opening;
    if (!o?.door || (it.l ?? 0) !== (room.level ?? 0)) continue;
    const cands: [Side, number][] = [
      ['n', Math.abs(it.z - (room.z - room.d / 2)) + (Math.abs(it.x - room.x) > room.w / 2 ? 9 : 0)],
      ['s', Math.abs(it.z - (room.z + room.d / 2)) + (Math.abs(it.x - room.x) > room.w / 2 ? 9 : 0)],
      ['w', Math.abs(it.x - (room.x - room.w / 2)) + (Math.abs(it.z - room.z) > room.d / 2 ? 9 : 0)],
      ['e', Math.abs(it.x - (room.x + room.w / 2)) + (Math.abs(it.z - room.z) > room.d / 2 ? 9 : 0)],
    ];
    for (const [sd, d] of cands) if (d < bd && d < 0.2) { bd = d; best = sd; }
  }
  return best;
}

/**
 * Thai building rules want doors/windows to the outside of at least 10% of each habitable
 * room's floor: add windows on free stretches of its outside walls until it complies.
 */
function ensureVentilation(rooms: Room[], items: Item[]) {
  const lookup = (t: string) => catalogById.get(t);
  for (const r of rooms) {
    if (r.outdoor || !['living', 'bedroom', 'dining', 'office', 'kitchen', 'bathroom'].includes(r.type)) continue;
    const L = r.level ?? 0;
    for (let guard = 0; guard < 4; guard++) {
      const segs = wallSegments(rooms, openingsOf({ rooms, items }, lookup), L).filter((s) => isExterior(s) && (s.plus === r.id || s.minus === r.id));
      const open = segs.reduce((a, s) => a + s.gaps.reduce((b, g) => b + (g.b - g.a) * (g.y1 - g.y0), 0), 0);
      if (open >= 0.1 * r.w * r.d) break;
      // the longest free stretch on any outside wall of the room
      let best: { s: (typeof segs)[number]; at: number; room: number } | null = null;
      for (const s of segs) {
        let x = s.s0;
        for (const g of [...s.gaps, { a: s.s1, b: s.s1 }]) {
          const free = g.a - x - 0.3;
          if (free > 1.4 && (!best || free > best.room)) best = { s, at: (x + g.a) / 2, room: free };
          x = Math.max(x, g.b);
        }
      }
      if (!best) break;
      const { s, at } = best;
      const t = best.room > (r.type === 'bathroom' ? 2.0 : 2.6) && r.w * r.d > 8 ? 'bigwindow' : 'window';
      const inward = s.plus === r.id ? 1 : -1; // room side
      // wall items face into the room: r = 0 faces +z, π/2 faces +x
      const rot = s.axis === 'x' ? (inward > 0 ? 0 : P) : inward > 0 ? P / 2 : -P / 2;
      items.push({ id: uid('i'), t, x: s.axis === 'x' ? at : s.c, z: s.axis === 'x' ? s.c : at, r: rot, c: catalogById.get(t)?.colors[0] ?? '', l: L });
    }
  }
}

/* ------------------------------------------------------------------ layout */

interface Cell { type: RoomType; name: string; w: number; fixed?: boolean }

/** Lay a row of rooms from x = 0, stretching the flexible ones to fill W. */
function row(cells: Cell[], z0: number, z1: number, W: number, level: number): Room[] {
  const fixed = cells.filter((c) => c.fixed).reduce((a, c) => a + c.w, 0);
  const flex = cells.filter((c) => !c.fixed).reduce((a, c) => a + c.w, 0) || 1;
  const k = Math.max(0, W - fixed) / flex;
  let x = 0;
  return cells.map((c) => {
    const w = +(c.fixed ? c.w : c.w * k).toFixed(2);
    const r = makeRoom(c.type, x, z0, x + w, z1, c.name);
    r.level = level;
    x += w;
    return r;
  });
}

const sum = (c: Cell[]) => c.reduce((a, x) => a + x.w, 0);

export function generateHouse(o: GenOptions): House {
  if (o.tier && o.tier !== 'standard') return generateVilla(o.tier, o);
  applyStorey({ storey: TIER_STOREY.standard });
  const beds = Math.max(1, Math.min(6, o.bedrooms));
  const baths = Math.max(1, Math.min(5, o.bathrooms));
  const rooms: Room[] = [];
  const items: Item[] = [];
  const furnishOf = new Map<string, Side>();
  const add = (t: string, x: number, z: number, r: number, l = 0) => items.push({ id: uid('i'), t, x: +x.toFixed(3), z: +z.toFixed(3), r, c: catalogById.get(t)?.colors[0] ?? '', l });
  const edges = (r: Room) => ({ x0: r.x - r.w / 2, x1: r.x + r.w / 2, z0: r.z - r.d / 2, z1: r.z + r.d / 2 });
  /** door on the shared edge between a back-row room and the room in front of it */
  const doorBetween = (back: Room, t = 'door', at?: number) => {
    const e = edges(back);
    add(t, at ?? Math.min(e.x1 - 0.65, e.x0 + 0.7), e.z1, P, back.level ?? 0);
  };
  /** window near a corner of a wall: side n/s/e/w */
  const win = (r: Room, side: Side, t = 'window', pos = 0) => {
    const e = edges(r), L = r.level ?? 0;
    if (side === 'n') add(t, r.x + pos, e.z0, 0, L);
    if (side === 's') add(t, r.x + pos, e.z1, P, L);
    if (side === 'w') add(t, e.x0, r.z + pos, P / 2, L);
    if (side === 'e') add(t, e.x1, r.z + pos, -P / 2, L);
  };
  const cornerOff = (r: Room) => Math.max(0, r.w / 2 - 0.85);

  let depth = 0;
  let W = 10;
  const bedCells = (n: number, master: boolean): Cell[] =>
    Array.from({ length: n }, (_, i) => (master && i === n - 1 ? { type: 'bedroom', name: 'ห้องนอนใหญ่', w: 4.4 } : { type: 'bedroom', name: `ห้องนอน ${i + 2 - (master ? 0 : 1)}`, w: 3.5 }));

  if (o.floors === 1) {
    // back: bedrooms + baths · middle: corridor + laundry · front: living / dining / kitchen
    const back: Cell[] = [];
    const others = beds - 1;
    let common = baths - (baths >= 2 ? 1 : 0);
    for (let i = 0; i < others; i++) {
      back.push({ type: 'bedroom', name: `ห้องนอน ${i + 2}`, w: 3.5 });
      if (common > 0 && (i % 2 === 1 || i === others - 1)) { back.push({ type: 'bathroom', name: 'ห้องน้ำรวม', w: 2.2, fixed: true }); common--; }
    }
    if (common > 0) back.push({ type: 'bathroom', name: 'ห้องน้ำรวม', w: 2.2, fixed: true });
    if (baths >= 2) back.push({ type: 'bathroom', name: 'ห้องน้ำห้องนอนใหญ่', w: 2.4, fixed: true });
    back.push({ type: 'bedroom', name: 'ห้องนอนใหญ่', w: 4.4 });
    W = Math.max(10, sum(back));
    const B = row(back, 0, 4, W, 0);
    const mid = row([{ type: 'hall', name: 'ทางเดิน', w: 1 }, { type: 'laundry', name: 'ห้องซักล้าง', w: 2, fixed: true }], 4, 5.5, W, 0);
    const front = W >= 11
      ? row([{ type: 'living', name: 'ห้องนั่งเล่น', w: 0.45 }, { type: 'dining', name: 'ห้องกินข้าว', w: 0.25 }, { type: 'kitchen', name: 'ห้องครัว', w: 0.3 }], 5.5, 10.5, W, 0)
      : row([{ type: 'living', name: 'นั่งเล่น + ทานข้าว', w: 0.55 }, { type: 'kitchen', name: 'ห้องครัว', w: 0.45 }], 5.5, 10.5, W, 0);
    rooms.push(...B, ...mid, ...front);
    depth = 10.5;
    const [hall, laundry] = mid;
    for (const r of B) {
      doorBetween(r);
      win(r, 'n', 'window', r.type === 'bedroom' ? cornerOff(r) : 0);
      furnishOf.set(r.id, 's');
    }
    win(B[0], 'w');
    win(B[B.length - 1], 'e');
    add('door', edges(laundry).x0, laundry.z, -P / 2);
    win(laundry, 'e');
    furnishOf.set(laundry.id, 'w');
    furnishOf.set(hall.id, 's');
    const living = front[0], kitchen = front[front.length - 1];
    add('archway', living.x, edges(living).z0, 0);
    add('door', kitchen.x, edges(kitchen).z0, 0);
    add('frontdoor', edges(living).x0 + living.w * 0.68, edges(living).z1, P);
    add('bigwindow', edges(living).x0 + 1.35, edges(living).z1, P);
    furnishOf.set(living.id, 'e');
    if (front.length === 3) {
      const dining = front[1];
      add('archway', edges(dining).x0, dining.z, P / 2);
      add('archway', edges(dining).x1, dining.z, -P / 2);
      add(o.garden ? 'slidingdoor' : 'window', dining.x, edges(dining).z1, P);
      furnishOf.set(dining.id, 's');
    } else add('archway', edges(kitchen).x0, kitchen.z, P / 2);
    win(kitchen, 'e', 'window', -0.6);
    furnishOf.set(kitchen.id, 'n');
  } else {
    // ground: kitchen, laundry, guest bath, (guest bed), stair hall · living / dining
    const back: Cell[] = [
      { type: 'kitchen', name: 'ห้องครัว', w: 4 },
      { type: 'laundry', name: 'ห้องซักล้าง', w: 2, fixed: true },
      { type: 'bathroom', name: 'ห้องน้ำชั้นล่าง', w: 2.2, fixed: true },
    ];
    const guest = beds >= 4;
    if (guest) back.push({ type: 'bedroom', name: 'ห้องนอนผู้สูงอายุ', w: 3.4, fixed: true });
    back.push({ type: 'hall', name: 'โถงบันได', w: 2.6, fixed: true });
    const upBeds = beds - (guest ? 1 : 0);
    const upBaths = Math.max(1, baths - 1);
    const upFront: Cell[] = bedCells(Math.min(upBeds, Math.max(1, Math.ceil(upBeds / 2))), true);
    const upBack: Cell[] = [];
    for (let i = 0; i < upBeds - upFront.length; i++) upBack.push({ type: 'bedroom', name: `ห้องนอน ${upFront.length + i + 1}`, w: 3.5 });
    for (let i = 0; i < upBaths; i++) upBack.push({ type: 'bathroom', name: i === 0 ? 'ห้องน้ำชั้นบน' : `ห้องน้ำ ${i + 2}`, w: 2.2, fixed: true });
    upBack.push({ type: 'hall', name: 'โถงบันไดชั้นบน', w: 2.6, fixed: true });
    W = Math.max(10, sum(back), sum(upBack), sum(upFront));

    const G = row(back, 0, 4.2, W, 0);
    const GF = row([{ type: 'dining', name: 'ห้องกินข้าว', w: 0.4 }, { type: 'living', name: 'ห้องนั่งเล่น', w: 0.6 }], 4.2, 10.6, W, 0);
    const U = row(upBack, 0, 4.2, W, 1);
    const UH = row([{ type: 'hall', name: 'ทางเดินชั้นบน', w: 1 }], 4.2, 5.6, W, 1);
    const UF = row(upFront, 5.6, 10.6, W, 1);
    rooms.push(...G, ...GF, ...U, ...UH, ...UF);
    depth = 10.6;
    const [kitchen, laundry, gbath] = G;
    const stair = G[G.length - 1];
    const [dining, living] = GF;
    // ground doors and windows
    add('archway', Math.min(edges(kitchen).x1 - 1.1, edges(dining).x1 - 1.1), edges(kitchen).z1, P);
    add('door', edges(kitchen).x1, laundry.z + 0.9, -P / 2);
    doorBetween(gbath, 'door', edges(gbath).x0 + Math.min(0.7, gbath.w / 2));
    furnishOf.set(gbath.id, 's');
    furnishOf.set(laundry.id, 'w');
    win(kitchen, 'w', 'window', -0.6);
    win(laundry, 'n');
    win(gbath, 'n');
    furnishOf.set(kitchen.id, 's');
    if (guest) {
      const gb = G[3];
      doorBetween(gb);
      win(gb, 'n', 'window', cornerOff(gb));
      furnishOf.set(gb.id, 's');
    }
    add('archway', edges(stair).x1 - 1.05, edges(stair).z1, P);
    add('stair', edges(stair).x1 - 0.58, stair.z, 0);
    win(stair, 'e');
    add('archway', edges(dining).x1, dining.z, -P / 2);
    add('frontdoor', edges(living).x0 + living.w * 0.35, edges(living).z1, P);
    add('bigwindow', edges(living).x1 - 1.6, edges(living).z1, P);
    furnishOf.set(living.id, 'w');
    add(o.garden ? 'slidingdoor' : 'bigwindow', dining.x, edges(dining).z1, P);
    win(dining, 'w', 'window');
    furnishOf.set(dining.id, 's');
    // upper floor
    const [hall2] = UH;
    for (const r of U) {
      if (r === U[U.length - 1]) {
        add('archway', edges(r).x1 - 1.05, edges(r).z1, P, 1);
        continue;
      }
      doorBetween(r);
      win(r, 'n', 'window', r.type === 'bedroom' ? cornerOff(r) : 0);
      furnishOf.set(r.id, 's');
    }
    for (const r of UF) {
      add('door', Math.max(edges(r).x0 + 0.7, Math.min(edges(r).x1 - 0.7, r.x - r.w / 2 + 0.7)), edges(r).z0, 0, 1);
      furnishOf.set(r.id, 'n');
    }
    const master = UF[UF.length - 1];
    add('slidingdoor', master.x, edges(master).z1, P, 1);
    for (const r of UF.slice(0, -1)) win(r, 's', 'window', cornerOff(r));
    win(UF[0], 'w');
    win(master, 'e', 'window', 0.6);
    furnishOf.set(hall2.id, 's');
    const balc = makeRoom('balcony', edges(master).x0, 10.6, edges(master).x1, 12.1, 'ระเบียง');
    balc.level = 1;
    rooms.push(balc);
    furnishOf.set(balc.id, 'n');
  }

  // front yard: carport + garden
  const y0 = depth, y1 = depth + 5.5;
  if (o.garage) {
    const g = makeRoom('garage', 0, y0, 6, y1, 'โรงจอดรถ');
    rooms.push(g);
    furnishOf.set(g.id, 's');
  }
  if (o.garden) {
    const gx = o.garage ? 6 : 0;
    if (W - gx >= 3) {
      const g = makeRoom('garden', gx, y0, Math.max(W, gx + 4), y1, 'สวน');
      rooms.push(g);
      furnishOf.set(g.id, 's');
    }
  }

  ensureVentilation(rooms, items);
  for (const r of rooms) items.push(...furnish(r, furnishOf.get(r.id) ?? 's'));

  // centre the plan on the origin
  const cx = W / 2, cz = (depth + (o.garage || o.garden ? 5.5 : 0)) / 2;
  for (const r of rooms) { r.x = +(r.x - cx).toFixed(3); r.z = +(r.z - cz).toFixed(3); }
  for (const i of items) { i.x = +(i.x - cx).toFixed(3); i.z = +(i.z - cz).toFixed(3); }

  const ext: Exterior = { ...DEFAULT_EXT, roof: o.roof, ...(o.floors === 2 ? { wallColor: '#f3f0ea', roofColor: '#3d4248' } : {}) };
  return { rooms, items, ext };
}

/* ------------------------------------------------------------------ villas */

/**
 * Luxury (2 storeys) or ultra-luxury (3 storeys) villa: tall storeys, a double-height living
 * room under a void, en-suite bedrooms, a master suite with walk-in closet, lift and stair
 * stacked through every floor, staff rooms, and a pool terrace and motor court in front.
 */
function generateVilla(tier: Exclude<Tier, 'standard'>, o: GenOptions): House {
  const ultra = tier === 'ultra';
  const storey = TIER_STOREY[tier];
  applyStorey({ storey });
  const H = ultra ? 3.3 : 3.0; // floor to ceiling
  const Db = Math.max(5.5, stairSteps(storey).len + 0.5), Dc = 2.0, Df = ultra ? 7.0 : 6.5, DF = Dc + Df;
  const beds = Math.max(ultra ? 5 : 4, Math.min(8, o.bedrooms));
  const rooms: Room[] = [];
  const items: Item[] = [];
  const side = new Map<string, Side>();
  const add = (t: string, x: number, z: number, r: number, l = 0) => items.push({ id: uid('i'), t, x: +x.toFixed(3), z: +z.toFixed(3), r, c: catalogById.get(t)?.colors[0] ?? '', l });
  const E = (r: Room) => ({ x0: r.x - r.w / 2, x1: r.x + r.w / 2, z0: r.z - r.d / 2, z1: r.z + r.d / 2 });
  const lift: Cell = { type: 'lift', name: 'ลิฟต์', w: 2.4, fixed: true };
  const stair: Cell = { type: 'hall', name: 'โถงบันได', w: 3.2, fixed: true };
  const suite = (n: number): Cell[] => [{ type: 'bedroom', name: `ห้องนอน ${n}`, w: 4.6 }, { type: 'bathroom', name: `ห้องน้ำ ${n}`, w: 2.6, fixed: true }];

  // ---- rows (z = 0 at the back) ----
  const g0back: Cell[] = ultra
    ? [{ type: 'kitchen', name: 'ครัวโชว์ + ครัวไทย', w: 7 }, { type: 'maid', name: 'ห้องแม่บ้าน', w: 3.4, fixed: true }, { type: 'laundry', name: 'ห้องซักรีด', w: 2.6, fixed: true }, { type: 'bathroom', name: 'ห้องน้ำแขก', w: 2.4, fixed: true }, { type: 'wine', name: 'ห้องเก็บไวน์', w: 3.6, fixed: true }, lift, stair]
    : [{ type: 'kitchen', name: 'ครัวโชว์ + ครัวไทย', w: 6.5 }, { type: 'maid', name: 'ห้องแม่บ้าน', w: 3.2, fixed: true }, { type: 'laundry', name: 'ห้องซักรีด', w: 2.6, fixed: true }, { type: 'bathroom', name: 'ห้องน้ำแขก', w: 2.2, fixed: true }, lift, stair];
  const g0front: Cell[] = ultra
    ? [{ type: 'living', name: 'ห้องนั่งเล่น (ฝ้าสูง 2 ชั้น)', w: 9.5 }, { type: 'dining', name: 'ห้องอาหาร', w: 6 }, { type: 'hall', name: 'โถงต้อนรับ', w: 3.5, fixed: true }, { type: 'theater', name: 'ห้องโฮมเธียเตอร์', w: 6.5 }]
    : [{ type: 'living', name: 'ห้องนั่งเล่น (ฝ้าสูง 2 ชั้น)', w: 8 }, { type: 'dining', name: 'ห้องอาหาร', w: 5.5 }, { type: 'hall', name: 'โถงต้อนรับ', w: 3.2, fixed: true }, { type: 'office', name: 'ห้องครอบครัว / ทำงาน', w: 5.5 }];
  // bedrooms other than the master run along the back of the upper floors
  const upperBeds = ultra ? Math.max(3, beds - 2) : beds - 1;
  const l1back: Cell[] = [];
  for (let i = 0; i < upperBeds; i++) l1back.push(...suite(i + 2));
  l1back.push(lift, stair);
  const l2back: Cell[] = ultra ? [{ type: 'spa', name: 'สปา / ซาวน่า', w: 5 }, { type: 'gym', name: 'ห้องฟิตเนส', w: 6 }, { type: 'library', name: 'ห้องสมุด', w: 5 }, lift, stair] : [];
  const total = (c: Cell[]) => c.reduce((a, x) => a + x.w, 0);
  const W = Math.max(total(g0back), total(g0front), total(l1back), total(l2back), ultra ? 25 : 22);

  const make = (cells: Cell[], z0: number, z1: number, L: number) => row(cells, z0, z1, W, L).map((r) => ((r.h = H), r));
  const G0 = make(g0back, 0, Db, 0);
  const G0F = make(g0front, Db, Db + DF, 0);
  const living = G0F[0];
  living.h = storey + H; // double height under the void
  // upper front rows line up with the ground floor cells below them
  const over = (cells: [RoomType, string][]): Cell[] => cells.map(([type, name], i) => ({ type, name, w: G0F[i].w, fixed: true }));
  const L1 = make(l1back, 0, Db, 1);
  const L1H = make([{ type: 'hall', name: 'ทางเดินชั้น 2', w: 1 }], Db, Db + Dc, 1);
  const L1F = make(
    ultra
      ? over([['void', 'ช่องเปิดโล่ง'], ['bedroom', 'ห้องนอนแขก'], ['bathroom', 'ห้องน้ำแขก'], ['library', 'ห้องนั่งเล่นครอบครัว']])
      : over([['void', 'ช่องเปิดโล่ง'], ['bedroom', 'ห้องนอนใหญ่'], ['closet', 'ห้องแต่งตัว'], ['bathroom', 'ห้องน้ำห้องนอนใหญ่']]),
    Db + Dc, Db + DF, 1,
  );
  rooms.push(...G0, ...G0F, ...L1, ...L1H, ...L1F);
  let L2: Room[] = [], L2H: Room[] = [], L2F: Room[] = [];
  if (ultra) {
    L2 = make(l2back, 0, Db, 2);
    L2H = make([{ type: 'hall', name: 'ทางเดินชั้น 3', w: 1 }], Db, Db + Dc, 2);
    L2F = make(over([['bedroom', 'ห้องนอนใหญ่ (Master suite)'], ['closet', 'ห้องแต่งตัว'], ['bathroom', 'ห้องน้ำห้องนอนใหญ่'], ['office', 'ห้องทำงาน']]), Db + Dc, Db + DF, 2);
    rooms.push(...L2, ...L2H, ...L2F);
  }
  const D = Db + DF;

  // ---- doors ----
  [G0, L1, L2].forEach((back, L) => {
    for (const r of back) {
      const e = E(r);
      if (r.type === 'hall') add('archway', e.x1 - 1.05, e.z1, P, L);
      else if (r.type === 'lift') add('door', r.x, e.z1, P, L);
      else add('door', Math.min(e.x1 - 0.7, e.x0 + 0.75), e.z1, P, L);
      side.set(r.id, 's');
    }
  });
  // ground: open-plan living/dining, foyer with the front door, family room / theatre off it
  const [, dining, foyer, fam] = G0F;
  add('archway', E(living).x1, living.z - 1.2, -P / 2);
  add('archway', E(living).x1, living.z + 1.6, -P / 2);
  add('door', E(dining).x1, dining.z, -P / 2);
  add('door', E(foyer).x1, foyer.z + 0.5, -P / 2);
  add('frontdoor', foyer.x, E(foyer).z1, P);
  for (const x of [E(living).x0 + 1.8, E(living).x0 + 5.0]) if (x + 1.6 < E(living).x1) add('glasswall', x, E(living).z1, P);
  add('glasswall', dining.x, E(dining).z1, P);
  side.set(living.id, 'e');
  side.set(dining.id, 's');
  side.set(foyer.id, 's');
  side.set(fam.id, 'w');
  // upper floors: rooms off the corridor; suites open into their closet and bathroom
  (ultra ? [L1F, L2F] : [L1F]).forEach((F, i) => {
    const L = i + 1;
    for (const r of F) {
      if (r.type === 'void') continue;
      side.set(r.id, 'n');
      if (r.type === 'bedroom' || r.type === 'library' || r.type === 'office') add('door', E(r).x0 + 0.8, E(r).z0, 0, L);
    }
    for (let k = 1; k < F.length; k++) {
      const a = F[k - 1], b = F[k];
      const linked = (a.type === 'bedroom' && (b.type === 'closet' || b.type === 'bathroom')) || (a.type === 'closet' && b.type === 'bathroom');
      if (linked) add('door', E(a).x1, a.z + 0.8, -P / 2, L);
    }
    const bedroom = F.find((r) => r.type === 'bedroom');
    if (bedroom) {
      add('glasswall', bedroom.x, E(bedroom).z1, P, L);
      const b = makeRoom('balcony', E(bedroom).x0, D, E(bedroom).x1, D + 2.2, 'ระเบียง');
      b.level = L;
      rooms.push(b);
      side.set(b.id, 'n');
    }
  });
  for (const r of [...L1H, ...L2H]) side.set(r.id, 's');
  // the stair climbs from each storey's stair hall; the lift serves every floor
  const st0 = G0.find((r) => r.type === 'hall')!;
  add('stair', E(st0).x1 - 0.6, st0.z, 0);
  if (ultra) {
    const st1 = L1.find((r) => r.type === 'hall')!;
    add('stair', E(st1).x1 - 0.6, st1.z, 0, 1);
  }

  // ---- outside: motor court, pool terrace, garden ----
  const Y = 12, Gw = ultra ? 11 : 9;
  const court = makeRoom('garage', W - Gw, D, W, D + Y, 'ลานจอดรถ / Motor court');
  const terrace = makeRoom('terrace', 0, D, W - Gw, D + 3.2, 'Pool deck');
  rooms.push(court, terrace);
  side.set(terrace.id, 'n');
  if (o.pool !== false) rooms.push(makeRoom('pool', 0.8, D + 3.8, W - Gw - 0.8, D + (ultra ? 9.6 : 8.8), 'สระว่ายน้ำ'));
  const garden = makeRoom('garden', 0, D + (ultra ? 10.2 : 9.4), W - Gw, D + Y, 'สวน');
  rooms.push(garden);

  ensureVentilation(rooms, items);
  for (const r of rooms) {
    if (r.type === 'pool' || r.type === 'void' || r.type === 'garage') continue;
    if (r.type === 'lift' && (r.level ?? 0) > 0) continue;
    items.push(...furnish(r, side.get(r.id) ?? 's'));
  }
  // cars in the motor court
  for (let k = 0; k < (ultra ? 3 : 2); k++) add('car', E(court).x0 + 2 + k * 2.6, court.z - 1.5, 0);

  const cx = W / 2, cz = (D + Y) / 2;
  for (const r of rooms) { r.x = +(r.x - cx).toFixed(3); r.z = +(r.z - cz).toFixed(3); }
  for (const i of items) { i.x = +(i.x - cx).toFixed(3); i.z = +(i.z - cz).toFixed(3); }

  const ext: Exterior = { ...DEFAULT_EXT, roof: ultra ? 'flat' : o.roof, roofColor: '#3d4248', wallPat: ultra ? 'stone' : 'plain', wallColor: ultra ? '#d8d2c8' : '#f3f0ea' };
  return {
    rooms, items, ext, tier, storey,
    build: { block: 'aac', pipe: 'ppr', wire: 'thw', pile: 'spun' },
    site: { left: 4, right: 4, back: 4, front: 3, road: ultra ? 12 : 8 },
  };
}
