/**
 * The building shell: thick walls with real door/window openings, roof,
 * slabs, carport, balcony railings and the plot around the house
 * (lawn, fence, footpath, street, trees).
 */
import * as THREE from 'three';
import { catalogById } from '../data/catalog';
import { ASPHALT, METAL_SHEET, PAVING, ROOF_TILE, floorById, wallById, type Surface } from '../data/surfaces';
import { DEFAULT_EXT, LEVEL_H, type Exterior, type House, type Room } from '../types';
import { MANSARD_H, OVERHANG, PART_T, WALL_T, gatesOf, inRoom, levelY, levelsOf, lotOf, openingsOf, roofPlan, wallH } from '../lib/shell';
import { wallPieces, wallSegments, type Segment } from '../lib/walls';
import { buildModel } from './models';
import { surfaceSet } from './textures';
import { mergeShadowCasters, mergeStatic } from './merge';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { balustrade, balustradedDeck, classicMats, column, fountain, gateWall, mansard, merged, parterre, wallOrnament, type ClassicMats, type Part as CPart } from './classic';

/** height walls are cut down to in the "low" cutaway */
export const LOW = 0.38;

export interface WallView {
  seg: Segment;
  level: number;
  group: THREE.Group;
  /** the wall run as one mesh (one draw per material), and its cut-down version for the cutaway */
  full: THREE.Mesh;
  low: THREE.Mesh;
  /** outward direction for exterior walls, null for partitions */
  out: THREE.Vector3 | null;
  centre: THREE.Vector3;
}
export interface Structure {
  group: THREE.Group;
  walls: WallView[];
  roof: THREE.Group;
  site: THREE.Group;
  /** slabs, carports and railings per storey */
  extras: Map<number, THREE.Group>;
  segs: Map<number, Segment[]>;
  top: number;
  /** shadow-only copies (layer 1) that keep casting while the visible parts are cut away or lifted */
  shadows: THREE.Group;
  /** inside-face wall material of each room (for per-room daylight) */
  roomMats: Map<string, THREE.Material>;
  /** independently rebuilt pieces: one per storey of walls, the slabs/railings, the roof, the plot */
  pieces: Piece[];
}

interface Piece {
  kind: string;
  key: string;
  root: THREE.Object3D;
  shadow: THREE.Mesh | null;
  walls?: WallView[];
  extras?: Map<number, THREE.Group>;
}

/** Layer that only the shadow pass sees. */
export const SHADOW_LAYER = 1;

/** A shadow-casting copy of an object on the shadow layer; the original stops casting. */
export function shadowProxy(o: THREE.Object3D) {
  const c = o.clone();
  c.traverse((n) => {
    n.layers.set(SHADOW_LAYER);
    const m = n as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = !m.userData.noShadow;
      m.receiveShadow = false;
    }
  });
  o.traverse((n) => {
    if ((n as THREE.Mesh).isMesh) n.castShadow = false;
  });
  return c;
}

const lookup = (t: string) => catalogById.get(t);
const lv = (r: Room) => r.level ?? 0;

/*
 * Materials live as long as the page: pieces of the shell are rebuilt independently, and a
 * rebuilt storey must not dispose a material that a kept roof or plot still draws with (that
 * would make three.js compile its shader again on the next frame).
 */
const mats = new Map<string, THREE.Material>();
function keep<T extends THREE.Material>(key: string, make: () => T): T {
  let m = mats.get(key) as T | undefined;
  if (!m) mats.set(key, (m = make()));
  return m;
}

function surfMat(s: Surface, color: string, extra: THREE.MeshStandardMaterialParameters = {}, rx?: number, ry?: number) {
  return keep(`surf|${s.id}|${color}|${JSON.stringify(extra)}|${rx}|${ry}`, () => new THREE.MeshStandardMaterial({ ...surfaceSet(s, rx, ry), color, roughness: 1, envMapIntensity: 0.5, ...extra }));
}

let classicShared: ClassicMats | null = null;
const classicSet = () => (classicShared ??= classicMats());

/** Free a piece's geometry (materials are shared, see above; furniture clones own theirs). */
function disposePiece(p: Piece) {
  p.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (m.userData.sharedGeo) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
    else m.geometry.dispose();
  });
  p.shadow?.geometry.dispose();
}

/** Dispose what `next` did not take over from `old` (all of it when next is null). */
export function releaseStructure(old: Structure, next: Structure | null) {
  for (const p of old.pieces) if (!next?.pieces.includes(p)) disposePiece(p);
}

const roomSig = (r: Room) => [r.id, r.type, r.x, r.z, r.w, r.d, r.h, r.level ?? 0, !!r.outdoor, r.wallPat, r.wallColor];

type Part = { geo: THREE.BufferGeometry; mats: THREE.Material | THREE.Material[] };

/** Many boxes (with a material per face) → one mesh with one draw group per material. */
function assemble(parts: Part[]): THREE.Mesh {
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const take = (m: THREE.Material, g: THREE.BufferGeometry) => byMat.set(m, [...(byMat.get(m) ?? []), g]);
  for (const p of parts) {
    const flat = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    if (Array.isArray(p.mats)) {
      for (const gr of p.geo.groups) {
        const sub = new THREE.BufferGeometry();
        for (const k of ['position', 'normal', 'uv']) {
          const a = flat.attributes[k] as THREE.BufferAttribute;
          sub.setAttribute(k, new THREE.BufferAttribute(a.array.slice(gr.start * a.itemSize, (gr.start + gr.count) * a.itemSize), a.itemSize));
        }
        take(p.mats[gr.materialIndex ?? 0], sub);
      }
    } else {
      const sub = new THREE.BufferGeometry();
      for (const k of ['position', 'normal', 'uv']) sub.setAttribute(k, flat.attributes[k]);
      take(p.mats, sub);
    }
    p.geo.dispose();
  }
  const mats = [...byMat.keys()];
  if (!mats.length) return new THREE.Mesh(new THREE.BufferGeometry(), []);
  const perMat = mats.map((m) => mergeGeometries(byMat.get(m)!, false)!);
  const geo = mergeGeometries(perMat, true)!;
  perMat.forEach((g) => g.dispose());
  const mesh = new THREE.Mesh(geo, mats);
  mesh.receiveShadow = true;
  return mesh;
}

/** UVs in metres so patterns line up across pieces and around openings. */
function metreUV(g: THREE.BufferGeometry, yOff: number) {
  const p = g.attributes.position, n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i) + yOff, z = p.getZ(i);
    const nx = Math.abs(n.getX(i)), nz = Math.abs(n.getZ(i));
    const [u, v] = nz > 0.5 ? [x, y] : nx > 0.5 ? [z, y] : [x, z];
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function shadowed<T extends THREE.Object3D>(o: T, cast = true): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = cast && !c.userData.noShadow;
      c.receiveShadow = true;
    }
  });
  return o;
}

function box(w: number, h: number, d: number, mat: THREE.Material | THREE.Material[], x: number, y: number, z: number, parent?: THREE.Object3D) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent?.add(m);
  return m;
}

function beam(p0: THREE.Vector3, p1: THREE.Vector3, r: number, mat: THREE.Material, parent: THREE.Object3D) {
  const d = p1.clone().sub(p0);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 10), mat);
  m.position.copy(p0).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  parent.add(m);
  return m;
}

/**
 * Build the shell. With `prev`, every piece whose inputs are unchanged is reused, so moving a
 * window rebuilds one storey of walls instead of the walls, roof, garden and fence of the house.
 */
export function buildStructure(house: House, prev?: Structure | null): Structure {
  const steps = structureSteps(house, prev);
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

/** The same build, pausing after each piece so a caller can spread it over several frames. */
export function* structureSteps(house: House, prev?: Structure | null): Generator<void, Structure> {
  const ext: Exterior = { ...DEFAULT_EXT, ...house.ext };
  const group = new THREE.Group();
  const shadows = new THREE.Group();
  const rooms = house.rooms;
  const levels = levelsOf(rooms);
  const indoor = rooms.filter((r) => !r.outdoor);
  const top = indoor.length ? Math.max(...indoor.map(lv)) : 0;
  const ops = openingsOf(house, lookup);
  const byId = new Map(rooms.map((r) => [r.id, r]));

  const extMat = surfMat(wallById(ext.wallPat), ext.wallColor, { envMapIntensity: 0.6 });
  const reveal = keep('reveal', () => new THREE.MeshStandardMaterial({ color: '#f1eee8', roughness: 0.9, envMapIntensity: 0.5 }));
  const cap = keep('cap', () => new THREE.MeshStandardMaterial({ color: '#3b3531', roughness: 0.85 }));
  const skirt = keep('skirt', () => new THREE.MeshStandardMaterial({ color: '#f4f2ee', roughness: 0.5 }));
  const glassM = keep('glass', () => new THREE.MeshPhysicalMaterial({ color: '#dfeef0', roughness: 0.05, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }));
  const steel = keep('steel', () => new THREE.MeshStandardMaterial({ color: '#2f3134', metalness: 0.7, roughness: 0.4 }));
  const classic = ext.style === 'classic';
  const cm = classic ? classicSet() : null;
  // one material per room (daylight tints each room on its own), kept while the room's finish is unchanged
  const roomMat = (id: string) => {
    const r = byId.get(id)!;
    return keep(`room|${id}|${r.wallPat}|${r.wallColor}`, () => new THREE.MeshStandardMaterial({ ...surfaceSet(wallById(r.wallPat)), color: r.wallColor, roughness: 1, envMapIntensity: 0.5 }));
  };
  const roomMats = new Map(indoor.map((r) => [r.id, roomMat(r.id)]));

  const old = new Map((prev?.pieces ?? []).map((p) => [p.kind, p]));
  const pieces: Piece[] = [];
  const take = (kind: string, key: string, make: () => Omit<Piece, 'kind' | 'key'>): Piece => {
    const o = old.get(kind);
    const p = o && o.key === key ? o : { kind, key, ...make() };
    pieces.push(p);
    group.add(p.root);
    if (p.shadow) shadows.add(p.shadow);
    return p;
  };

  /* ---------------- walls ---------------- */
  const walls: WallView[] = [];
  const segs = new Map<number, Segment[]>();
  const segMemo = new Map<number, Segment[]>();
  const segsAt = (l: number) => segMemo.get(l) ?? segMemo.set(l, wallSegments(rooms, ops, l)).get(l)!;
  for (const l of levels) {
    const list = segsAt(l);
    segs.set(l, list);
    const levelKey = JSON.stringify([l, top, LEVEL_H, ext.style, ext.wallPat, ext.wallColor, rooms.filter((r) => lv(r) >= l && lv(r) <= l + 3).map(roomSig), ops.filter((o) => o.level === l)]);
    const piece = take(`walls${l}`, levelKey, () => {
    const lg = new THREE.Group();
    const lsh = new THREE.Group();
    const lw: WallView[] = [];
    const here = indoor.filter((r) => lv(r) === l);
    const inside = (x: number, z: number) => here.some((r) => inRoom(r, x, z));
    for (const s of list) {
      if (s.void) {
        // edge of a double-height space: glass balustrade with a steel handrail, no wall
        const len = s.s1 - s.s0, mid = (s.s0 + s.s1) / 2;
        const rg = new THREE.Group();
        if (s.axis === 'x') rg.position.set(mid, levelY(l), s.c);
        else {
          rg.position.set(s.c, levelY(l), mid);
          rg.rotation.y = Math.PI / 2;
        }
        box(len, 1.0, 0.012, glassM, 0, 0.55, 0, rg).userData.noShadow = true;
        box(len, 0.05, 0.07, steel, 0, 1.08, 0, rg);
        lg.add(rg);
        continue;
      }
      const H = wallH(s, l, top);
      const seg: Segment = { ...s, h: H };
      // o = which side is outdoors (+1/−1), 0 for partitions
      const o = !s.minus ? -1 : !s.plus ? 1 : 0;
      const [t0, t1] = o === 0 ? [-PART_T / 2, PART_T / 2] : o < 0 ? [-WALL_T, 0] : [0, WALL_T];
      const pt = (along: number, perp: number) => (s.axis === 'x' ? inside(along, perp) : inside(perp, along));
      // close the outside corner where an exterior wall turns
      const corner = (end: number, dir: number) => o !== 0 && !pt(end + dir * 0.1, s.c - o * 0.1) && !pt(end + dir * 0.1, s.c + o * 0.1);
      const ext0 = corner(s.s0, -1), ext1 = corner(s.s1, 1);
      const plusMat = s.plus ? roomMat(s.plus) : extMat;
      const minusMat = s.minus ? roomMat(s.minus) : extMat;
      const mats = [reveal, reveal, cap, reveal, plusMat, minusMat];

      const g = new THREE.Group();
      if (s.axis === 'x') g.position.set(0, levelY(l), s.c);
      else {
        g.position.set(s.c, levelY(l), 0);
        g.rotation.y = Math.PI / 2;
      }
      const fullParts: Part[] = [];
      const lowParts: Part[] = [];
      for (let [a, b, y0, y1] of wallPieces(seg)) {
        if (ext0 && Math.abs(a - s.s0) < 1e-3) a -= WALL_T;
        if (ext1 && Math.abs(b - s.s1) < 1e-3) b += WALL_T;
        // local x runs along +world x, or along −world z for 'z' walls
        const [la, lb] = s.axis === 'x' ? [a, b] : [-b, -a];
        const ph = y1 - y0;
        const geo = new THREE.BoxGeometry(lb - la, ph, t1 - t0);
        geo.translate((la + lb) / 2, ph / 2, (t0 + t1) / 2);
        metreUV(geo, y0);
        fullParts.push({ geo: geo.clone().translate(0, y0, 0), mats });
        if (y0 < LOW) lowParts.push({ geo: geo.clone().scale(1, Math.min(1, (LOW - y0) / ph), 1).translate(0, y0, 0), mats });
        geo.dispose();
        if (y0 < 1e-3) {
          for (const [side, z] of [[s.plus, t1 + 0.006], [s.minus, t0 - 0.006]] as const) {
            if (!side) continue;
            const k = new THREE.BoxGeometry(lb - la, 0.08, 0.012).translate((la + lb) / 2, 0.04, z);
            fullParts.push({ geo: k, mats: skirt });
            lowParts.push({ geo: k.clone(), mats: skirt });
          }
        }
      }
      if (cm && o !== 0) {
        // neoclassical mouldings on the outside face (they go with the full wall, not the cutaway)
        const X = s.axis === 'x';
        // the storey (if any) whose walls stand on top of this one
        const lk = l + Math.max(1, Math.round(H / LEVEL_H));
        const capped = lk > top || !segsAt(lk).some((u) => u.axis === s.axis && Math.abs(u.c - s.c) < 0.05 && u.s0 < s.s1 - 0.1 && u.s1 > s.s0 + 0.1 && !u.void);
        const balconies = rooms.filter((r) => r.type === 'balcony' && lv(r) === l);
        const orn: CPart[] = [];
        wallOrnament(orn, cm, {
          la: X ? s.s0 : -s.s1, lb: X ? s.s1 : -s.s0, o: o as 1 | -1, wallT: WALL_T, H, level: l, storeyH: LEVEL_H, capped,
          corner0: X ? ext0 : ext1, corner1: X ? ext1 : ext0,
          gaps: s.gaps.map((gp) => ({ la: X ? gp.a : -gp.b, lb: X ? gp.b : -gp.a, y0: gp.y0, y1: gp.y1, door: gp.door })),
          balcony: (along) => {
            const w = X ? along : -along;
            const [px, pz] = X ? [w, s.c + o * 0.5] : [s.c + o * 0.5, w];
            return balconies.some((r) => inRoom(r, px, pz));
          },
        });
        fullParts.push(...orn);
      }
      const full = assemble(fullParts);
      const low = assemble(lowParts);
      low.visible = false;
      g.add(full, low);
      lg.add(g);
      // the shadow stand-in is always the full-height wall
      const pg = new THREE.Group();
      pg.position.copy(g.position);
      pg.rotation.copy(g.rotation);
      const pm = new THREE.Mesh(full.geometry, reveal);
      pm.castShadow = true;
      pg.add(pm);
      lsh.add(shadowProxy(pg));
      const mid = (s.s0 + s.s1) / 2;
      const centre = s.axis === 'x' ? new THREE.Vector3(mid, levelY(l) + H / 2, s.c) : new THREE.Vector3(s.c, levelY(l) + H / 2, mid);
      const out = o === 0 ? null : s.axis === 'x' ? new THREE.Vector3(0, 0, o) : new THREE.Vector3(o, 0, 0);
      lw.push({ seg, level: l, group: g, full, low, out, centre });
    }
    // the storey's walls shadow through one merged stand-in
    return { root: lg, shadow: mergeShadowCasters(lsh, SHADOW_LAYER), walls: lw };
    });
    walls.push(...piece.walls!);
    yield;
  }

  /* ---------------- slabs, carports, railings ---------------- */
  const extrasPiece = take('extras', JSON.stringify([rooms.map(roomSig), LEVEL_H, ext.style, top]), () => {
  const eg = new THREE.Group();
  const esh = new THREE.Group();
  const extras = new Map<number, THREE.Group>();
  const extra = (l: number) => {
    let g = extras.get(l);
    if (!g) {
      extras.set(l, (g = new THREE.Group()));
      eg.add(g);
    }
    return g;
  };
  const concrete = keep('concrete', () => new THREE.MeshStandardMaterial({ color: '#d6d1c8', roughness: 0.9 }));
  for (const r of indoor) {
    const l = lv(r);
    if (l >= top || r.h > LEVEL_H + 0.5) continue;
    // roof deck over any part of a lower storey that the storey above doesn't cover
    const above = indoor.filter((u) => lv(u) === l + 1);
    const pts = [[0, 0], [-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]].map(([a, b]) => [r.x + a * r.w, r.z + b * r.d]);
    if (pts.every(([x, z]) => above.some((u) => inRoom(u, x, z)))) continue;
    const s = box(r.w + 2 * WALL_T, 0.3, r.d + 2 * WALL_T, concrete, r.x, levelY(l) + LEVEL_H - 0.15, r.z, extra(l));
    s.castShadow = s.receiveShadow = true;
  }
  for (const r of rooms) {
    const l = lv(r);
    // a classical forecourt stays open to the sky (it has the fountain); garages elsewhere get a carport
    if (r.type === 'garage' && !(cm && r.w > 9) && !indoor.some((u) => lv(u) === l + 1 && inRoom(u, r.x, r.z))) {
      const g = extra(l);
      const y = levelY(l);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.1, 2.6, 0.1, steel, r.x + sx * (r.w / 2 - 0.12), y + 1.3, r.z + sz * (r.d / 2 - 0.12), g);
      const w = r.w + 0.3, d = r.d + 0.3;
      const sheet = surfMat(METAL_SHEET, '#7d8186', { metalness: 0.6, roughness: 0.6 }, w / METAL_SHEET.unit[0], d / METAL_SHEET.unit[1]);
      const roof = box(w, 0.05, d, [steel, steel, sheet, sheet, steel, steel], r.x, y + 2.65, r.z, g);
      roof.rotation.x = 0.03;
    }
    if (r.type === 'balcony' && cm) {
      // stone balustrade; where nothing is built below, the balcony rests on columns (a porte-cochère)
      const g = extra(l);
      const y = levelY(l);
      const parts: CPart[] = [];
      const near = (x: number, z: number) => indoor.some((u) => lv(u) === l && inRoom(u, x, z));
      const below = (x: number, z: number) => l > 0 && indoor.some((u) => lv(u) === l - 1 && inRoom(u, x, z));
      const edges: [number, number, number, number, number][] = [
        [r.x, r.z - r.d / 2, r.w, 0, -1], [r.x, r.z + r.d / 2, r.w, 0, 1], [r.x - r.w / 2, r.z, r.d, Math.PI / 2, -1], [r.x + r.w / 2, r.z, r.d, Math.PI / 2, 1],
      ];
      for (const [x, z, len, rot, sgn] of edges) {
        const ox = rot ? sgn * 0.15 : 0, oz = rot ? 0 : sgn * 0.15;
        if (near(x + ox, z + oz)) continue;
        balustrade(parts, cm, len - 0.1, new THREE.Matrix4().makeRotationY(rot).setPosition(x - ox, y, z - oz));
      }
      if (l > 0 && !below(r.x, r.z)) {
        const yb = levelY(l - 1), ent = 0.6;
        parts.push({ geo: new THREE.BoxGeometry(r.w, ent, r.d).translate(r.x, y - ent / 2, r.z), mats: cm.trim });
        parts.push({ geo: new THREE.BoxGeometry(r.w + 0.24, 0.14, r.d + 0.24).translate(r.x, y - 0.07, r.z), mats: cm.trim });
        const hCol = y - ent - yb;
        const cols: [number, number][] = [];
        const x0 = r.x - r.w / 2 + 0.4, x1 = r.x + r.w / 2 - 0.4, z0 = r.z - r.d / 2 + 0.4, z1 = r.z + r.d / 2 - 0.4;
        for (const [cx, cz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) if (!near(cx, cz) && !below(cx, cz) && !indoor.some((u) => lv(u) === l - 1 && inRoom(u, cx, cz + 0.6) && inRoom(u, cx, cz - 0.6))) cols.push([cx, cz]);
        // paired columns across the front, spaced about 3.5 m
        const front = cols.filter(([, cz]) => cz === z1);
        if (front.length === 2) {
          const n = Math.max(1, Math.round((x1 - x0) / 3.5));
          for (let i = 1; i < n; i++) cols.push([x0 + ((x1 - x0) * i) / n, z1]);
        }
        const k0 = parts.length;
        for (const [cx, cz] of cols) column(parts, cm, cx, cz, hCol);
        for (let i = k0; i < parts.length; i++) parts[i].geo.translate(0, yb, 0);
      }
      const mesh = merged(parts);
      g.add(mesh);
      continue;
    }
    if (r.type === 'balcony') {
      const g = extra(l);
      const y = levelY(l);
      const near = (x: number, z: number) => indoor.some((u) => lv(u) === l && inRoom(u, x, z));
      const edges: [number, number, number, number, number][] = [
        [r.x, r.z - r.d / 2, r.w, 0, -1], [r.x, r.z + r.d / 2, r.w, 0, 1], [r.x - r.w / 2, r.z, r.d, Math.PI / 2, -1], [r.x + r.w / 2, r.z, r.d, Math.PI / 2, 1],
      ];
      for (const [x, z, len, rot, sgn] of edges) {
        const ox = rot ? sgn * 0.15 : 0, oz = rot ? 0 : sgn * 0.15;
        if (near(x + ox, z + oz)) continue;
        const rg = new THREE.Group();
        rg.position.set(x - ox / 3, y, z - oz / 3);
        rg.rotation.y = rot;
        box(len, 0.95, 0.012, glassM, 0, 0.5, 0, rg).userData.noShadow = true;
        box(len, 0.05, 0.07, steel, 0, 1.0, 0, rg);
        g.add(rg);
      }
    }
  }
  for (const g of extras.values()) {
    shadowed(g);
    esh.add(shadowProxy(g));
  }
  return { root: eg, shadow: mergeShadowCasters(esh, SHADOW_LAYER), extras };
  });
  const extras = extrasPiece.extras!;
  yield;

  /* ---------------- roof ---------------- */
  const plan = roofPlan(house);
  const roof = take('roof', JSON.stringify([plan, ext, LEVEL_H]), () => {
    const g = new THREE.Group();
    if (plan && ext.roof !== 'none') buildRoof(g, plan, ext, extMat, cm);
    shadowed(g);
    const shadow = mergeShadowCasters(new THREE.Group().add(shadowProxy(g)), SHADOW_LAYER);
    mergeStatic(g);
    return { root: g, shadow };
  }).root as THREE.Group;
  yield;

  /* ---------------- site ---------------- */
  const doors = house.items.filter((i) => i.t === 'frontdoor').map((i) => [i.x, i.z, i.l ?? 0]);
  const site = take('site', JSON.stringify([rooms.map(roomSig), doors, house.site ?? null, ext, LEVEL_H]), () => {
    const g = buildSite(house, ext, extMat, cm);
    mergeStatic(g);
    return { root: g, shadow: null };
  }).root as THREE.Group;

  group.add(shadows);
  return { group, walls, roof, site, extras, segs, top, shadows, roomMats, pieces };
}

type Plan = NonNullable<ReturnType<typeof roofPlan>>;

function buildRoof(g: THREE.Group, plan: Plan, ext: Exterior, extMat: THREE.Material, cm: ClassicMats | null) {
  const W0 = plan.x1 - plan.x0, D0 = plan.z1 - plan.z0;
  const long = W0 >= D0;
  const W = long ? W0 : D0, D = long ? D0 : W0;
  g.position.set((plan.x0 + plan.x1) / 2, plan.base, (plan.z0 + plan.z1) / 2);
  if (!long) g.rotation.y = Math.PI / 2;

  if (ext.roof === 'mansard') {
    const slate = surfMat(ROOF_TILE, ext.roofColor, { envMapIntensity: 0.8, roughness: 0.75 }, 2, 2);
    mansard(g, cm ?? classicSet(), W, D, MANSARD_H, slate, extMat);
    return;
  }
  if (ext.roof === 'flat' && cm) {
    balustradedDeck(g, cm, W, D, keep('deck', () => new THREE.MeshStandardMaterial({ color: '#cfcac2', roughness: 0.95 })), extMat);
    return;
  }

  if (ext.roof === 'flat') {
    const o = 0.3;
    const deck = keep('deck', () => new THREE.MeshStandardMaterial({ color: '#cfcac2', roughness: 0.95 }));
    box(W + 2 * o, 0.25, D + 2 * o, [extMat, extMat, deck, deck, extMat, extMat], 0, 0.125, 0, g);
    const ph = 0.6, t = 0.15;
    for (const s of [-1, 1]) {
      box(W + 2 * o, ph, t, extMat, 0, 0.25 + ph / 2, s * (D / 2 + o - t / 2), g);
      box(t, ph, D + 2 * o - 2 * t, extMat, s * (W / 2 + o - t / 2), 0.25 + ph / 2, 0, g);
    }
    return;
  }

  const tp = Math.tan((ext.pitch * Math.PI) / 180);
  const o = OVERHANG;
  const X = W / 2 + o, Z = D / 2 + o;
  const e = -o * tp, top = e + Z * tp;
  const hip = ext.roof === 'hip';
  const rx = hip ? Math.max(0, X - Z) : X;
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const faces: [THREE.Vector3[], THREE.Vector3][] = [
    [[V(-X, e, -Z), V(X, e, -Z), V(rx, top, 0), V(-rx, top, 0)], V(1, 0, 0)],
    [[V(X, e, Z), V(-X, e, Z), V(-rx, top, 0), V(rx, top, 0)], V(-1, 0, 0)],
  ];
  if (hip) {
    faces.push([[V(-X, e, Z), V(-X, e, -Z), V(-rx, top, 0)], V(0, 0, -1)]);
    faces.push([[V(X, e, -Z), V(X, e, Z), V(rx, top, 0)], V(0, 0, 1)]);
  }
  const pos: number[] = [], uv: number[] = [], under: number[] = [];
  for (const [pts, t] of faces) {
    const n = pts[1].clone().sub(pts[0]).cross(pts[2].clone().sub(pts[0])).normalize();
    const ordered = n.y < 0 ? [...pts].reverse() : pts;
    const nn = n.y < 0 ? n.negate() : n;
    const up = nn.clone().cross(t).normalize();
    if (up.y < 0) up.negate();
    const tri = ordered.length === 4 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2];
    for (const i of tri) {
      const p = ordered[i];
      pos.push(p.x, p.y, p.z);
      uv.push(p.dot(t), -p.dot(up));
    }
    for (const i of [...tri].reverse()) {
      const p = ordered[i];
      under.push(p.x, p.y - 0.1, p.z);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const tiles = surfMat(ROOF_TILE, ext.roofColor, { envMapIntensity: 0.7 });
  g.add(new THREE.Mesh(geo, tiles));
  const ug = new THREE.BufferGeometry();
  ug.setAttribute('position', new THREE.Float32BufferAttribute(under, 3));
  ug.computeVertexNormals();
  const soffit = new THREE.Mesh(ug, new THREE.MeshStandardMaterial({ color: '#ece8e1', roughness: 0.9 }));
  soffit.castShadow = false;
  g.add(soffit);

  // fascia boards, ridge and hip caps
  const fascia = new THREE.MeshStandardMaterial({ color: '#f1eee8', roughness: 0.7 });
  const capM = new THREE.MeshStandardMaterial({ color: new THREE.Color(ext.roofColor).multiplyScalar(0.8), roughness: 0.7 });
  for (const s of [-1, 1]) box(2 * X, 0.2, 0.03, fascia, 0, e - 0.09, s * Z, g);
  if (hip) for (const s of [-1, 1]) box(0.03, 0.2, 2 * Z, fascia, s * X, e - 0.09, 0, g);
  else
    for (const s of [-1, 1]) for (const zs of [-1, 1]) beam(V(s * X, e - 0.05, zs * Z), V(s * X, top - 0.05, 0), 0.05, fascia, g);
  if (rx > 0) beam(V(-rx, top + 0.03, 0), V(rx, top + 0.03, 0), 0.075, capM, g);
  if (hip) for (const sx of [-1, 1]) for (const sz of [-1, 1]) beam(V(sx * X, e + 0.03, sz * Z), V(sx * rx, top + 0.03, 0), 0.06, capM, g);
  // gable end walls filling the triangle above the wall plates
  if (!hip) {
    const hh = (D / 2) * tp;
    for (const s of [-1, 1]) {
      const sh = new THREE.Shape([new THREE.Vector2(-D / 2, 0), new THREE.Vector2(D / 2, 0), new THREE.Vector2(0, hh)]);
      const tg = new THREE.ExtrudeGeometry(sh, { depth: WALL_T, bevelEnabled: false });
      tg.rotateY(Math.PI / 2);
      tg.translate(s > 0 ? W / 2 - WALL_T : -W / 2, 0, 0);
      g.add(new THREE.Mesh(tg, extMat));
    }
  }
}

function buildSite(house: House, ext: Exterior, extMat: THREE.Material, cm: ClassicMats | null) {
  const g = new THREE.Group();
  const lot = lotOf(house);
  const plane = (w: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const S = 240;
  // lawn, with holes where pools are dug in
  const lawn = new THREE.Shape([new THREE.Vector2(-S / 2, -S / 2), new THREE.Vector2(S / 2, -S / 2), new THREE.Vector2(S / 2, S / 2), new THREE.Vector2(-S / 2, S / 2)]);
  for (const p of house.rooms.filter((r) => r.type === 'pool' && (r.level ?? 0) === 0)) {
    const [x0, x1, z0, z1] = [p.x - p.w / 2 - 0.3, p.x + p.w / 2 + 0.3, p.z - p.d / 2 - 0.3, p.z + p.d / 2 + 0.3];
    lawn.holes.push(new THREE.Path([new THREE.Vector2(x0, -z0), new THREE.Vector2(x0, -z1), new THREE.Vector2(x1, -z1), new THREE.Vector2(x1, -z0)]));
  }
  const ground = new THREE.Mesh(new THREE.ShapeGeometry(lawn).rotateX(-Math.PI / 2), surfMat(floorById('grass'), '#d9e6cc', { envMapIntensity: 0.3 }, 1 / 2, 1 / 2));
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  ground.userData.ground = true;
  g.add(ground);

  // footpath, kerb and street along the front (+z)
  const fz = lot.z1;
  plane(S, 1.6, surfMat(PAVING, '#ffffff', {}, S / PAVING.unit[0], 1.6 / PAVING.unit[1]), 0, -0.012, fz + 0.8);
  const kerb = box(S, 0.15, 0.15, new THREE.MeshStandardMaterial({ color: '#b9b4ab', roughness: 0.9 }), 0, -0.05, fz + 1.65, g);
  kerb.receiveShadow = true;
  const RW = Math.max(3, house.site?.road ?? 6);
  const rc = fz + 1.7 + RW / 2;
  plane(S, RW, surfMat(ASPHALT, '#ffffff', { envMapIntensity: 0.2 }, S / ASPHALT.unit[0], RW / ASPHALT.unit[1]), 0, -0.1, rc);
  const dash = new THREE.MeshStandardMaterial({ color: '#f2efe6', roughness: 0.8 });
  for (let x = -S / 2; x < S / 2; x += 4) box(2, 0.005, 0.12, dash, x, -0.095, rc, g);

  // driveways and the path to the gate
  const gates = gatesOf(house, lot);
  const pave = surfMat(PAVING, '#ffffff', {}, 1 / PAVING.unit[0], 1 / PAVING.unit[1]);
  for (const [a, b] of gates) {
    const front = Math.max(lot.z0 + 2, ...house.rooms.filter((r) => (r.level ?? 0) === 0 && r.x + r.w / 2 > a && r.x - r.w / 2 < b).map((r) => r.z + r.d / 2));
    const len = fz - front;
    if (len <= 0.05) continue;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(b - a, len), pave);
    m.rotation.x = -Math.PI / 2;
    m.position.set((a + b) / 2, -0.008, front + len / 2);
    m.receiveShadow = true;
    // metre UVs on the driveway
    const uv = m.geometry.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (b - a), uv.getY(i) * len);
    g.add(m);
  }

  // classic: formal parterres in the gardens, a fountain on the forecourt's axis
  if (cm) {
    const parts: CPart[] = [];
    for (const r of house.rooms.filter((o) => o.type === 'garden' && (o.level ?? 0) === 0)) parterre(parts, cm, r.x, r.z, r.w, r.d);
    for (const r of house.rooms.filter((o) => o.type === 'garage' && (o.level ?? 0) === 0 && o.w > 9 && o.d > 9)) fountain(parts, cm, r.x, r.z + 0.5);
    if (parts.length) g.add(merged(parts));
  }

  // classic gate wall: pillars with ball finials and wrought-iron railings
  if (ext.fence && cm) {
    const parts: CPart[] = [];
    const run = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.6) return;
      gateWall(parts, cm, len, new THREE.Matrix4().makeRotationY(-Math.atan2(z1 - z0, x1 - x0)).setPosition((x0 + x1) / 2, 0, (z0 + z1) / 2), extMat);
    };
    run(lot.x0, lot.z0, lot.x1, lot.z0);
    run(lot.x0, lot.z0, lot.x0, lot.z1);
    run(lot.x1, lot.z0, lot.x1, lot.z1);
    let x = lot.x0;
    for (const [a, b] of gates) {
      run(x, lot.z1, a, lot.z1);
      x = b;
    }
    run(x, lot.z1, lot.x1, lot.z1);
    g.add(merged(parts));
  }

  // fence: low masonry wall + posts + aluminium slats, open at the gates
  if (ext.fence && !cm) {
    const slat = new THREE.MeshStandardMaterial({ color: '#2f3134', metalness: 0.6, roughness: 0.45 });
    const run = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.1) return;
      const rg = new THREE.Group();
      rg.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
      rg.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
      box(len, 0.55, 0.18, extMat, 0, 0.275, 0, rg);
      const n = Math.max(1, Math.ceil(len / 2.5));
      for (let i = 0; i <= n; i++) box(0.22, 1.6, 0.22, extMat, -len / 2 + (i * len) / n, 0.8, 0, rg);
      for (const y of [0.75, 0.95, 1.15, 1.35]) box(len, 0.08, 0.04, slat, 0, y, 0, rg);
      g.add(shadowed(rg));
    };
    run(lot.x0, lot.z0, lot.x1, lot.z0);
    run(lot.x0, lot.z0, lot.x0, lot.z1);
    run(lot.x1, lot.z0, lot.x1, lot.z1);
    let x = lot.x0;
    for (const [a, b] of gates) {
      run(x, lot.z1, a, lot.z1);
      x = b;
    }
    run(x, lot.z1, lot.x1, lot.z1);
  }

  // a few trees around the plot for scale
  const spots: [number, number][] = [
    [lot.x0 - 4, lot.z0 + 2], [lot.x1 + 5, lot.z0 - 1], [lot.x0 - 6, lot.z1 - 3], [lot.x1 + 4, lot.z1 - 4], [(lot.x0 + lot.x1) / 2, lot.z0 - 6], [lot.x0 + 3, fz + 10.5], [lot.x1 - 2, fz + 11],
  ];
  spots.forEach(([x, z], i) => {
    const t = buildModel('tree', ['#4f7a35', '#3a6a2c', '#5a7f3a'][i % 3]);
    t.position.set(x, 0, z);
    t.rotation.y = i * 1.7;
    t.scale.setScalar(1 + (i % 3) * 0.25);
    g.add(t);
  });
  return g;
}
