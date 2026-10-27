/**
 * Wall layout of one storey, worked out from the room rectangles.
 * Every room edge is split where neighbours change, so a wall between two
 * rooms becomes one partition and a wall with nothing behind it becomes an
 * exterior wall. Doors and windows standing on a wall line cut openings.
 */

export interface WallRoom {
  id: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  outdoor?: boolean;
  level?: number;
}

export interface WallOpening {
  id: string;
  x: number;
  z: number;
  w: number;
  y0: number;
  y1: number;
  door?: boolean;
  level: number;
}

export interface Gap {
  a: number;
  b: number;
  y0: number;
  y1: number;
  door: boolean;
  id: string;
}

export interface Segment {
  /** 'x': runs along x at z = c · 'z': runs along z at x = c */
  axis: 'x' | 'z';
  c: number;
  s0: number;
  s1: number;
  /** room on the +c side and on the −c side (null = outside) */
  plus: string | null;
  minus: string | null;
  h: number;
  gaps: Gap[];
}

const EPS = 1e-3;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

interface Edge {
  s0: number;
  s1: number;
  side: 1 | -1;
  room: WallRoom;
}

export function wallSegments(rooms: WallRoom[], openings: WallOpening[], level: number): Segment[] {
  const lines = new Map<string, { axis: 'x' | 'z'; c: number; edges: Edge[] }>();
  const push = (axis: 'x' | 'z', c: number, s0: number, s1: number, side: 1 | -1, room: WallRoom) => {
    const k = `${axis}|${c.toFixed(2)}`;
    let l = lines.get(k);
    if (!l) lines.set(k, (l = { axis, c: r3(c), edges: [] }));
    l.edges.push({ s0: r3(s0), s1: r3(s1), side, room });
  };
  for (const r of rooms) {
    if (r.outdoor || (r.level ?? 0) !== level) continue;
    const x0 = r.x - r.w / 2, x1 = r.x + r.w / 2, z0 = r.z - r.d / 2, z1 = r.z + r.d / 2;
    push('x', z0, x0, x1, 1, r);
    push('x', z1, x0, x1, -1, r);
    push('z', x0, z0, z1, 1, r);
    push('z', x1, z0, z1, -1, r);
  }

  const out: Segment[] = [];
  for (const { axis, c, edges } of lines.values()) {
    const cuts = [...new Set(edges.flatMap((e) => [e.s0, e.s1]))].sort((a, b) => a - b);
    let cur: Segment | null = null;
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i], b = cuts[i + 1];
      if (b - a < EPS) continue;
      const mid = (a + b) / 2;
      const on = (side: 1 | -1) => edges.find((e) => e.side === side && e.s0 <= mid && e.s1 >= mid)?.room ?? null;
      const p = on(1), m = on(-1);
      if (!p && !m) {
        cur = null;
        continue;
      }
      const h = Math.max(p?.h ?? 0, m?.h ?? 0);
      if (cur && cur.plus === (p?.id ?? null) && cur.minus === (m?.id ?? null) && Math.abs(cur.s1 - a) < EPS && cur.h === h) {
        cur.s1 = b;
      } else {
        cur = { axis, c, s0: a, s1: b, plus: p?.id ?? null, minus: m?.id ?? null, h, gaps: [] };
        out.push(cur);
      }
    }
  }

  for (const o of openings) {
    if (o.level !== level) continue;
    for (const s of out) {
      const perp = s.axis === 'x' ? o.z : o.x;
      const along = s.axis === 'x' ? o.x : o.z;
      if (Math.abs(perp - s.c) > 0.12) continue;
      const a = Math.max(s.s0, along - o.w / 2), b = Math.min(s.s1, along + o.w / 2);
      if (b - a < 0.05) continue;
      s.gaps.push({ a, b, y0: o.y0, y1: Math.min(o.y1, s.h), door: !!o.door, id: o.id });
    }
  }
  for (const s of out) s.gaps.sort((g, h) => g.a - h.a);
  return out;
}

export const isExterior = (s: Segment) => !s.plus || !s.minus;

/** Rectangles [a, b, y0, y1] (along-wall × height) of solid wall left around the gaps. */
export function wallPieces(s: Segment): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  let x = s.s0;
  for (const g of s.gaps) {
    if (g.a > x + EPS) out.push([x, g.a, 0, s.h]);
    const a = Math.max(x, g.a);
    if (g.b > a + EPS) {
      if (g.y0 > EPS) out.push([a, g.b, 0, g.y0]);
      if (g.y1 < s.h - EPS) out.push([a, g.b, g.y1, s.h]);
    }
    x = Math.max(x, g.b);
  }
  if (s.s1 > x + EPS) out.push([x, s.s1, 0, s.h]);
  return out;
}

/** Closest point on a wall line that blocks walking (doors are passable). */
export function blocks(s: Segment, along: number) {
  if (along < s.s0 - 0.02 || along > s.s1 + 0.02) return false;
  return !s.gaps.some((g) => g.door && along > g.a + 0.12 && along < g.b - 0.12);
}
