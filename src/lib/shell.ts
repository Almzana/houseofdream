/** Building-shell measurements shared by the 3D builder and the bill of quantities. */
import { DEFAULT_EXT, DEFAULT_SITE, LEVEL_H, type Exterior, type House, type Room } from '../types';
import { isExterior, wallSegments, type Segment, type WallOpening } from './walls';

/**
 * Built height of a wall run on storey l. Outside walls of lower storeys reach the next floor (and
 * all the way up beside a double-height room); partitions stop at the storey height.
 */
export function wallH(s: Segment, l: number, top: number) {
  if (isExterior(s)) return Math.max(s.h, l < top ? LEVEL_H : 0);
  return l < top ? Math.min(s.h, LEVEL_H) : s.h;
}

export const WALL_T = 0.2; // exterior wall thickness (built outwards from the room edge)
export const PART_T = 0.1; // partition thickness (centred on the shared edge)
export const OVERHANG = 0.6; // roof eaves beyond the wall face
export const levelY = (l: number) => l * LEVEL_H;

const lv = (r: Room) => r.level ?? 0;

export function levelsOf(rooms: Room[]): number[] {
  const s = new Set(rooms.map(lv));
  if (!s.size) s.add(0);
  return [...s].sort((a, b) => a - b);
}

export function inRoom(r: Room, x: number, z: number, pad = 0) {
  return Math.abs(x - r.x) <= r.w / 2 + pad && Math.abs(z - r.z) <= r.d / 2 + pad;
}

/** Bounding box of the indoor rooms of one storey. */
export function footprint(rooms: Room[], level: number) {
  const list = rooms.filter((r) => (!r.outdoor || r.type === 'void') && lv(r) === level);
  if (!list.length) return null;
  return {
    x0: Math.min(...list.map((r) => r.x - r.w / 2)),
    x1: Math.max(...list.map((r) => r.x + r.w / 2)),
    z0: Math.min(...list.map((r) => r.z - r.d / 2)),
    z1: Math.max(...list.map((r) => r.z + r.d / 2)),
    h: Math.max(...list.map((r) => r.h)),
  };
}

/** Roof over the top storey: outer wall faces and the height where it sits. */
export function roofPlan(house: House) {
  const indoor = house.rooms.filter((r) => !r.outdoor);
  if (!indoor.length) return null;
  const top = Math.max(...indoor.map(lv));
  const f = footprint(house.rooms, top)!;
  return { level: top, x0: f.x0 - WALL_T, x1: f.x1 + WALL_T, z0: f.z0 - WALL_T, z1: f.z1 + WALL_T, base: levelY(top) + f.h };
}

/** Openings (doors/windows) taken from the items, for one storey or all. */
export function openingsOf(house: House, lookup: (t: string) => { opening?: { w: number; y0: number; y1: number; door?: boolean } } | undefined): WallOpening[] {
  const out: WallOpening[] = [];
  for (const it of house.items) {
    const o = lookup(it.t)?.opening;
    if (o) out.push({ id: it.id, x: it.x, z: it.z, w: o.w, y0: o.y0, y1: o.y1, door: o.door, level: it.l ?? 0 });
  }
  return out;
}

/** Quantities for the outside of the house. */
export function shellStats(house: House, lookup: Parameters<typeof openingsOf>[1]) {
  const ext: Exterior = { ...DEFAULT_EXT, ...house.ext };
  const ops = openingsOf(house, lookup);
  const levels = levelsOf(house.rooms);
  const top = Math.max(...levels);
  let wallA = 0;
  let openA = 0;
  for (const l of levels) {
    for (const s of wallSegments(house.rooms, ops, l)) {
      if (!isExterior(s) || s.void) continue;
      const h = wallH(s, l, top);
      wallA += (s.s1 - s.s0) * h;
      openA += s.gaps.reduce((a, g) => a + (g.b - g.a) * (g.y1 - g.y0), 0);
    }
  }
  const plan = roofPlan(house);
  let roofA = 0;
  if (plan && ext.roof !== 'none') {
    const o = ext.roof === 'flat' ? 0.3 : OVERHANG;
    const flat = (plan.x1 - plan.x0 + 2 * o) * (plan.z1 - plan.z0 + 2 * o);
    roofA = ext.roof === 'flat' ? flat : flat / Math.cos((ext.pitch * Math.PI) / 180);
  }
  const all = house.rooms;
  let fence = 0;
  if (ext.fence && all.length) {
    const lot = lotOf(house);
    fence = 2 * (lot.x1 - lot.x0 + lot.z1 - lot.z0) - gatesOf(house, lot).reduce((a, g) => a + g[1] - g[0], 0);
  }
  return { wallA: Math.max(0, wallA - openA), roofA, fence, ext };
}

/** Plot boundary around everything that was drawn. */
/** Plot boundary: the drawn rooms plus the clear margins set for the land (default 2 m all round). */
export function lotOf(house: House) {
  const r = house.rooms;
  const m = { ...DEFAULT_SITE, ...house.site };
  if (!r.length) return { x0: -6, x1: 6, z0: -6, z1: 6 };
  return {
    x0: Math.min(...r.map((o) => o.x - o.w / 2)) - m.left,
    x1: Math.max(...r.map((o) => o.x + o.w / 2)) + m.right,
    z0: Math.min(...r.map((o) => o.z - o.d / 2)) - m.back,
    z1: Math.max(...r.map((o) => o.z + o.d / 2)) + m.front,
  };
}

/** Openings in the front fence (+z side): one per garage, plus a gate in front of the entrance. */
export function gatesOf(house: House, lot: ReturnType<typeof lotOf>): [number, number][] {
  const gates: [number, number][] = house.rooms
    .filter((r) => r.type === 'garage' && lv(r) === 0)
    .map((r) => [r.x - r.w / 2 + 0.2, r.x + r.w / 2 - 0.2]);
  const door = house.items.find((i) => i.t === 'frontdoor' && (i.l ?? 0) === 0);
  if (door) {
    const g: [number, number] = [door.x - 0.7, door.x + 0.7];
    if (!gates.some(([a, b]) => g[1] > a && g[0] < b)) gates.push(g);
  }
  return gates
    .map(([a, b]) => [Math.max(a, lot.x0 + 0.3), Math.min(b, lot.x1 - 0.3)] as [number, number])
    .filter(([a, b]) => b - a > 0.5)
    .sort((a, b) => a[0] - b[0]);
}
