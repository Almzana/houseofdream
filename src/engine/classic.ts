/**
 * Neoclassical dress for the shell: plinth, string courses, cornice, rusticated quoins,
 * pilasters, arched or hooded window surrounds, wrought-iron Juliet railings, stone
 * balustrades, Tuscan columns, a mansard roof with dormers, and the formal garden
 * (clipped hedges, topiaries, a tiered fountain, pillared gate wall).
 * Everything is built as merged geometry so a whole facade stays a handful of draw calls.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type Part = { geo: THREE.BufferGeometry; mats: THREE.Material };

export interface ClassicMats {
  trim: THREE.Material;
  stone: THREE.Material;
  iron: THREE.Material;
  glass: THREE.Material;
  hedge: THREE.Material;
  water: THREE.Material;
}

export function classicMats(): ClassicMats {
  return {
    trim: new THREE.MeshStandardMaterial({ color: '#f3eee5', roughness: 0.75, envMapIntensity: 0.6 }),
    stone: new THREE.MeshStandardMaterial({ color: '#d3c9b8', roughness: 0.9, envMapIntensity: 0.5 }),
    iron: new THREE.MeshStandardMaterial({ color: '#1d1d1f', roughness: 0.45, metalness: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ color: '#2a333c', roughness: 0.12, metalness: 0.35, envMapIntensity: 1.2 }),
    hedge: new THREE.MeshStandardMaterial({ color: '#2f5527', roughness: 1 }),
    water: new THREE.MeshPhysicalMaterial({ color: '#5f98ab', roughness: 0.04, metalness: 0.1, clearcoat: 1, envMapIntensity: 1.4 }),
  };
}

const SAME = ['position', 'normal', 'uv'] as const;

/** Parts → one mesh with a draw group per material. */
export function merged(parts: Part[]): THREE.Mesh {
  const by = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    for (const k of Object.keys(g.attributes)) if (!(SAME as readonly string[]).includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.clearGroups();
    by.set(p.mats, [...(by.get(p.mats) ?? []), g]);
  }
  const mats = [...by.keys()];
  if (!mats.length) return new THREE.Mesh(new THREE.BufferGeometry(), []);
  const per = mats.map((m) => mergeGeometries(by.get(m)!, false)!);
  const mesh = new THREE.Mesh(mergeGeometries(per, true)!, mats);
  per.forEach((g) => g.dispose());
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

const boxAt = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) =>
  new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);

/* ------------------------------------------------------------------ walls */

export interface OrnamentWall {
  /** wall run in the wall group's local x */
  la: number;
  lb: number;
  /** outdoors is towards local z = o; the outside face is at z = o·wallT */
  o: 1 | -1;
  wallT: number;
  H: number;
  level: number;
  storeyH: number;
  /** the wall carries the roof (main cornice) rather than another storey */
  capped: boolean;
  corner0: boolean;
  corner1: boolean;
  gaps: { la: number; lb: number; y0: number; y1: number; door: boolean }[];
  /** a balcony floor lies outside at this point along the wall */
  balcony: (along: number) => boolean;
}

/** Mouldings on the outside face of one exterior wall run. */
export function wallOrnament(out: Part[], m: ClassicMats, w: OrnamentWall) {
  const { la, lb, o, wallT, H, level, storeyH, capped, gaps } = w;
  const zf = o * wallT;
  const slab = (x0: number, x1: number, y0: number, y1: number, d: number, mat: THREE.Material) => {
    if (x1 - x0 < 0.02 || y1 - y0 < 0.005) return;
    out.push({ geo: boxAt(x0, x1, y0, y1, zf, zf + o * d), mats: mat });
  };
  // a horizontal band that wraps the outside corners and stops at openings it would cross
  const band = (y0: number, y1: number, d: number, mat: THREE.Material) => {
    let runs: [number, number][] = [[la - (w.corner0 ? wallT + d : 0), lb + (w.corner1 ? wallT + d : 0)]];
    for (const g of gaps) {
      if (g.y0 >= y1 || g.y1 <= y0) continue;
      const a = g.la - 0.17, b = g.lb + 0.17;
      runs = runs.flatMap(([p, q]) => (b <= p || a >= q ? [[p, q]] : ([[p, a], [b, q]] as [number, number][]).filter(([u, v]) => v - u > 0.02)));
    }
    for (const [p, q] of runs) slab(p, q, y0, y1, d, mat);
  };

  const base = level === 0 ? 0.68 : 0;
  if (level === 0) {
    band(0, 0.6, 0.05, m.stone);
    band(0.6, 0.68, 0.08, m.trim);
  }
  // string course at every floor line the wall passes, main cornice where the roof sits
  const lines: number[] = [];
  for (let y = storeyH; y <= H + 0.01; y += storeyH) if (!(capped && y > H - 0.5)) lines.push(y);
  for (const y of lines) {
    band(y - 0.3, y - 0.1, 0.05, m.trim);
    band(y - 0.1, y, 0.12, m.trim);
  }
  if (capped) {
    band(H - 0.5, H - 0.3, 0.05, m.trim);
    band(H - 0.3, H - 0.18, 0.13, m.trim);
    band(H - 0.18, H, 0.28, m.trim);
  }
  const ceilings = [...lines.map((y) => y - 0.3), ...(capped ? [H - 0.5] : [])].sort((a, b) => a - b);
  const bandAbove = (y: number) => ceilings.find((c) => c > y + 0.01) ?? H;

  // rusticated quoins at the outside corners
  const qTop = bandAbove(base) - 0.02;
  for (const [end, dir, on] of [[la, 1, w.corner0], [lb, -1, w.corner1]] as const) {
    if (!on) continue;
    const x = end - dir * wallT;
    let k = 0;
    for (let y = base; y + 0.28 <= qTop; y += 0.32, k++) {
      const wq = k % 2 ? 0.34 : 0.52;
      slab(Math.min(x, x + dir * wq), Math.max(x, x + dir * wq), y, y + 0.28, 0.04, m.trim);
    }
  }

  // pilasters between widely spaced openings
  const sorted = [...gaps].sort((a, b) => a.la - b.la);
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i].lb, b = sorted[i + 1].la;
    if (b - a < 1.4) continue;
    const mid = (a + b) / 2;
    slab(mid - 0.21, mid + 0.21, base, bandAbove(base), 0.05, m.trim);
    slab(mid - 0.26, mid + 0.26, bandAbove(base) - 0.14, bandAbove(base), 0.08, m.trim);
  }

  // window and door surrounds
  for (const g of gaps) {
    const wd = g.lb - g.la, r = wd / 2, mid = (g.la + g.lb) / 2;
    slab(g.la - 0.16, g.la, g.y0, g.y1, 0.04, m.trim);
    slab(g.lb, g.lb + 0.16, g.y0, g.y1, 0.04, m.trim);
    if (g.y0 > 0.1) {
      slab(g.la - 0.22, g.lb + 0.22, g.y0 - 0.08, g.y0, 0.12, m.trim);
      slab(g.la - 0.1, g.la + 0.06, g.y0 - 0.3, g.y0 - 0.08, 0.05, m.trim);
      slab(g.lb - 0.06, g.lb + 0.1, g.y0 - 0.3, g.y0 - 0.08, 0.05, m.trim);
    }
    const room = bandAbove(g.y1) - g.y1;
    if (wd <= 2.4 && r + 0.22 <= room) {
      // arched head: moulded ring, glazed fanlight with glazing bars, keystone
      const R = r + 0.16;
      const sh = new THREE.Shape();
      sh.absarc(0, 0, R, 0, Math.PI, false);
      sh.lineTo(-r, 0);
      sh.absarc(0, 0, r, Math.PI, 0, true);
      sh.lineTo(R, 0);
      const ring = new THREE.ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: false, curveSegments: 20 });
      ring.translate(mid, g.y1, o > 0 ? zf : zf - 0.05);
      out.push({ geo: ring, mats: m.trim });
      const fan = new THREE.CircleGeometry(r, 24, 0, Math.PI);
      if (o < 0) fan.rotateY(Math.PI);
      out.push({ geo: fan.translate(mid, g.y1, zf + o * 0.006), mats: m.glass });
      for (const t of [Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]) {
        const bar = new THREE.BoxGeometry(0.03, r, 0.02).translate(0, r / 2, 0).rotateZ(t - Math.PI / 2);
        out.push({ geo: bar.translate(mid, g.y1, zf + o * 0.015), mats: m.trim });
      }
      out.push({ geo: new THREE.BoxGeometry(0.03, 0.03, 0.02).translate(mid, g.y1 + 0.01, zf + o * 0.015), mats: m.trim });
      slab(g.la - 0.02, g.lb + 0.02, g.y1 - 0.02, g.y1 + 0.03, 0.03, m.trim);
      slab(mid - 0.1, mid + 0.1, g.y1 + r - 0.04, g.y1 + R + 0.06, 0.08, m.trim);
    } else if (room >= 0.42) {
      // hood mould: frieze, cornice and keystone
      slab(g.la - 0.16, g.lb + 0.16, g.y1, g.y1 + 0.2, 0.04, m.trim);
      slab(g.la - 0.3, g.lb + 0.3, g.y1 + 0.2, g.y1 + 0.34, 0.14, m.trim);
      slab(mid - 0.11, mid + 0.11, g.y1 - 0.04, g.y1 + 0.3, 0.07, m.trim);
    } else if (room >= 0.16) {
      slab(g.la - 0.16, g.lb + 0.16, g.y1, g.y1 + 0.14, 0.04, m.trim);
      slab(mid - 0.09, mid + 0.09, g.y1 - 0.04, g.y1 + 0.14, 0.07, m.trim);
    }
    // Juliet balcony: wrought-iron railing across tall upper-floor openings
    if (level > 0 && g.y0 < 0.7 && !w.balcony(mid)) {
      const z0 = zf + o * 0.1, z1 = zf + o * 0.13;
      const x0 = g.la - 0.08, x1 = g.lb + 0.08;
      out.push({ geo: boxAt(x0 - 0.05, x1 + 0.05, 0, 0.08, zf, zf + o * 0.22), mats: m.trim });
      out.push({ geo: boxAt(x0, x1, 0.98, 1.02, z0, z1 + o * 0.02), mats: m.iron });
      out.push({ geo: boxAt(x0, x1, 0.14, 0.17, z0, z1), mats: m.iron });
      out.push({ geo: boxAt(x0, x1, 0.82, 0.84, z0, z1), mats: m.iron });
      for (let x = x0; x <= x1 + 1e-6; x += 0.11) out.push({ geo: boxAt(x - 0.008, x + 0.008, 0.08, 0.98, z0, z1), mats: m.iron });
      for (let x = x0 + 0.11; x < x1; x += 0.22) {
        const ring = new THREE.TorusGeometry(0.055, 0.007, 4, 12).translate(x + 0.055, 0.73, 0);
        out.push({ geo: ring.translate(0, 0, (z0 + z1) / 2), mats: m.iron });
      }
    }
  }
}

/* ------------------------------------------------------------------ balustrade, columns */

/** Stone balustrade along local x (centred), standing on y = 0, about 0.98 m high. */
export function balustrade(out: Part[], m: ClassicMats, len: number, at: THREE.Matrix4) {
  const push = (g: THREE.BufferGeometry, mat: THREE.Material) => out.push({ geo: g.applyMatrix4(at), mats: mat });
  push(boxAt(-len / 2, len / 2, 0, 0.14, -0.13, 0.13), m.trim);
  push(boxAt(-len / 2 - 0.01, len / 2 + 0.01, 0.8, 0.92, -0.15, 0.15), m.trim);
  const n = Math.max(1, Math.round(len / 0.27));
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + ((i + 0.5) * len) / n;
    push(new THREE.CylinderGeometry(0.04, 0.065, 0.36, 8).translate(x, 0.32, 0), m.trim);
    push(new THREE.CylinderGeometry(0.065, 0.04, 0.3, 8).translate(x, 0.65, 0), m.trim);
  }
  const k = Math.max(1, Math.round(len / 3.2));
  for (let i = 0; i <= k; i++) {
    const x = Math.max(-len / 2 + 0.16, Math.min(len / 2 - 0.16, -len / 2 + (i * len) / k));
    push(boxAt(x - 0.16, x + 0.16, 0, 0.92, -0.16, 0.16), m.trim);
    push(boxAt(x - 0.2, x + 0.2, 0.92, 0.98, -0.2, 0.2), m.trim);
  }
}

/** Tuscan column standing on y = 0, h high, at (x, z). */
export function column(out: Part[], m: ClassicMats, x: number, z: number, h: number) {
  const p = (g: THREE.BufferGeometry) => out.push({ geo: g.translate(x, 0, z), mats: m.trim });
  p(boxAt(-0.34, 0.34, 0, 0.14, -0.34, 0.34));
  p(new THREE.CylinderGeometry(0.29, 0.31, 0.12, 24).translate(0, 0.2, 0));
  p(new THREE.CylinderGeometry(0.22, 0.26, h - 0.52, 24).translate(0, 0.26 + (h - 0.52) / 2, 0));
  p(new THREE.CylinderGeometry(0.29, 0.23, 0.12, 24).translate(0, h - 0.2, 0));
  p(boxAt(-0.34, 0.34, h - 0.14, h, -0.34, 0.34));
}

/* ------------------------------------------------------------------ mansard roof */

/** Mansard in the roof group's local frame: W along x, D along z, base at y = 0. */
export function mansard(g: THREE.Group, m: ClassicMats, W: number, D: number, MH: number, slate: THREE.Material, wallMat: THREE.Material) {
  const parts: Part[] = [];
  const o = 0.3;
  parts.push({ geo: boxAt(-W / 2 - o, W / 2 + o, 0, 0.25, -D / 2 - o, D / 2 + o), mats: wallMat });
  parts.push({ geo: boxAt(-W / 2 - o - 0.06, W / 2 + o + 0.06, 0.17, 0.27, -D / 2 - o - 0.06, D / 2 + o + 0.06), mats: m.trim });
  const k = (MH - 0.25) / Math.tan((72 * Math.PI) / 180);
  const X0 = W / 2 + 0.05, Z0 = D / 2 + 0.05, X1 = X0 - k, Z1 = Z0 - k, y0 = 0.25, y1 = MH;
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const quads: [THREE.Vector3[], THREE.Vector3][] = [
    [[V(-X0, y0, Z0), V(X0, y0, Z0), V(X1, y1, Z1), V(-X1, y1, Z1)], V(1, 0, 0)],
    [[V(X0, y0, -Z0), V(-X0, y0, -Z0), V(-X1, y1, -Z1), V(X1, y1, -Z1)], V(-1, 0, 0)],
    [[V(X0, y0, Z0), V(X0, y0, -Z0), V(X1, y1, -Z1), V(X1, y1, Z1)], V(0, 0, -1)],
    [[V(-X0, y0, -Z0), V(-X0, y0, Z0), V(-X1, y1, Z1), V(-X1, y1, -Z1)], V(0, 0, 1)],
  ];
  const pos: number[] = [], uv: number[] = [];
  for (const [p, t] of quads) {
    const n = p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0])).normalize();
    const up = n.clone().cross(t).normalize();
    if (up.y < 0) up.negate();
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(p[i].x, p[i].y, p[i].z);
      uv.push(p[i].dot(t), -p[i].dot(up));
    }
  }
  const slope = new THREE.BufferGeometry();
  slope.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  slope.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  slope.computeVertexNormals();
  parts.push({ geo: slope, mats: slate });
  // flat top in zinc, with a moulded kerb
  parts.push({ geo: boxAt(-X1, X1, y1 - 0.02, y1 + 0.1, -Z1, Z1), mats: m.stone });
  parts.push({ geo: boxAt(-X1 - 0.08, X1 + 0.08, y1 + 0.02, y1 + 0.12, -Z1 - 0.08, -Z1 + 0.06), mats: m.trim });
  parts.push({ geo: boxAt(-X1 - 0.08, X1 + 0.08, y1 + 0.02, y1 + 0.12, Z1 - 0.06, Z1 + 0.08), mats: m.trim });
  parts.push({ geo: boxAt(-X1 - 0.08, -X1 + 0.06, y1 + 0.02, y1 + 0.12, -Z1, Z1), mats: m.trim });
  parts.push({ geo: boxAt(X1 - 0.06, X1 + 0.08, y1 + 0.02, y1 + 0.12, -Z1, Z1), mats: m.trim });

  // arched dormers along every side long enough to take them
  const dormer = (along: number, side: 1 | -1, onX: boolean) => {
    const at = new THREE.Matrix4();
    // local dormer frame: x along the roof edge, +z out of the roof
    if (onX) at.makeRotationY(side > 0 ? 0 : Math.PI).setPosition(along, 0, side * (Z0 - 0.04));
    else at.makeRotationY(side > 0 ? Math.PI / 2 : -Math.PI / 2).setPosition(side * (X0 - 0.04), 0, along);
    const p = (geo: THREE.BufferGeometry, mat: THREE.Material) => parts.push({ geo: geo.applyMatrix4(at), mats: mat });
    const hw = 0.62, yb = 0.5, yt = 1.55;
    p(boxAt(-hw, hw, yb, yt, -1.0, 0), m.trim);
    p(new THREE.CylinderGeometry(hw + 0.08, hw + 0.08, 1.1, 18, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2).translate(0, yt, -0.5), slate);
    p(new THREE.PlaneGeometry(0.86, 0.85).translate(0, (yb + yt) / 2 + 0.05, 0.005), m.glass);
    p(new THREE.CircleGeometry(0.43, 16, 0, Math.PI).translate(0, yt - 0.05 + 0.08, 0.005), m.glass);
    p(boxAt(-hw - 0.06, hw + 0.06, yb - 0.08, yb, -0.05, 0.08), m.trim);
    for (const x of [-hw, hw]) p(boxAt(x - 0.07, x + 0.07, yb, yt, -0.02, 0.05), m.trim);
    p(boxAt(-0.015, 0.015, yb, yt + 0.4, 0, 0.02), m.trim);
    p(boxAt(-0.43, 0.43, (yb + yt) / 2 + 0.05 - 0.015, (yb + yt) / 2 + 0.05 + 0.015, 0, 0.02), m.trim);
  };
  const along = (L: number) => {
    const n = Math.floor((L - 3) / 4.2);
    return Array.from({ length: Math.max(0, n) }, (_, i) => -((n - 1) * 4.2) / 2 + i * 4.2);
  };
  for (const s of [-1, 1] as const) {
    for (const x of along(2 * X0)) dormer(x, s, true);
    for (const z of along(2 * Z0)) dormer(z, s, false);
  }
  g.add(merged(parts));
}

/** Flat roof edged with a balustrade (the parapet of a classical villa). */
export function balustradedDeck(g: THREE.Group, m: ClassicMats, W: number, D: number, deck: THREE.Material, wallMat: THREE.Material) {
  const parts: Part[] = [];
  const o = 0.3;
  parts.push({ geo: boxAt(-W / 2 - o, W / 2 + o, 0, 0.25, -D / 2 - o, D / 2 + o), mats: wallMat });
  parts.push({ geo: boxAt(-W / 2 - o + 0.3, W / 2 + o - 0.3, 0.25, 0.27, -D / 2 - o + 0.3, D / 2 + o - 0.3), mats: deck });
  parts.push({ geo: boxAt(-W / 2 - o - 0.06, W / 2 + o + 0.06, 0.17, 0.27, -D / 2 - o - 0.06, D / 2 + o + 0.06), mats: m.trim });
  const X = W / 2 + o - 0.16, Z = D / 2 + o - 0.16;
  for (const s of [-1, 1]) {
    balustrade(parts, m, 2 * X, new THREE.Matrix4().setPosition(0, 0.27, s * Z));
    balustrade(parts, m, 2 * Z, new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(s * X, 0.27, 0));
  }
  g.add(merged(parts));
}

/* ------------------------------------------------------------------ garden */

/** Clipped box hedges with gaps for paths, inner parterre, cone topiaries at the corners. */
export function parterre(out: Part[], m: ClassicMats, x: number, z: number, w: number, d: number) {
  const hedge = (x0: number, x1: number, z0: number, z1: number, h = 0.6) => out.push({ geo: boxAt(x0, x1, 0, h, z0, z1), mats: m.hedge });
  const ring = (inset: number, h: number) => {
    const x0 = x - w / 2 + inset, x1 = x + w / 2 - inset, z0 = z - d / 2 + inset, z1 = z + d / 2 - inset, t = 0.45, gap = 0.7;
    if (x1 - x0 < 2 || z1 - z0 < 2) return false;
    for (const zz of [z0, z1 - t]) {
      hedge(x0, x - gap, zz, zz + t, h);
      hedge(x + gap, x1, zz, zz + t, h);
    }
    for (const xx of [x0, x1 - t]) {
      hedge(xx, xx + t, z0 + t, z - gap, h);
      hedge(xx, xx + t, z + gap, z1 - t, h);
    }
    return true;
  };
  ring(0.35, 0.65);
  const inner = ring(1.8, 0.45);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
    out.push({ geo: new THREE.ConeGeometry(0.42, 1.7, 14).translate(x + sx * (w / 2 - 0.6), 0.85, z + sz * (d / 2 - 0.6)), mats: m.hedge });
  if (inner) {
    out.push({ geo: new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6).translate(x, 0.45, z), mats: m.stone });
    out.push({ geo: new THREE.SphereGeometry(0.5, 16, 12).translate(x, 1.25, z), mats: m.hedge });
  }
}

/** Three-tier stone fountain with water in its basins. */
export function fountain(out: Part[], m: ClassicMats, x: number, z: number) {
  const p = (g: THREE.BufferGeometry, mat: THREE.Material) => out.push({ geo: g.translate(x, 0, z), mats: mat });
  p(new THREE.CylinderGeometry(2.1, 2.2, 0.5, 48).translate(0, 0.25, 0), m.trim);
  p(new THREE.CylinderGeometry(1.9, 1.9, 0.02, 48).translate(0, 0.42, 0), m.water);
  p(new THREE.CylinderGeometry(0.3, 0.42, 1.0, 20).translate(0, 0.9, 0), m.trim);
  p(new THREE.CylinderGeometry(1.0, 0.45, 0.25, 32).translate(0, 1.5, 0), m.trim);
  p(new THREE.CylinderGeometry(0.88, 0.88, 0.02, 32).translate(0, 1.6, 0), m.water);
  p(new THREE.CylinderGeometry(0.16, 0.22, 0.6, 16).translate(0, 1.9, 0), m.trim);
  p(new THREE.CylinderGeometry(0.5, 0.25, 0.16, 24).translate(0, 2.25, 0), m.trim);
  p(new THREE.CylinderGeometry(0.42, 0.42, 0.02, 24).translate(0, 2.32, 0), m.water);
  p(new THREE.SphereGeometry(0.13, 12, 10).translate(0, 2.48, 0), m.trim);
}

/** Masonry wall with pillars, ball finials and wrought-iron railings between them, along local x. */
export function gateWall(out: Part[], m: ClassicMats, len: number, at: THREE.Matrix4, wallMat: THREE.Material) {
  const push = (g: THREE.BufferGeometry, mat: THREE.Material) => out.push({ geo: g.applyMatrix4(at), mats: mat });
  push(boxAt(-len / 2, len / 2, 0, 0.6, -0.16, 0.16), wallMat);
  push(boxAt(-len / 2, len / 2, 0.6, 0.68, -0.2, 0.2), m.trim);
  const n = Math.max(1, Math.ceil(len / 3));
  for (let i = 0; i <= n; i++) {
    const x = -len / 2 + (i * len) / n;
    push(boxAt(x - 0.25, x + 0.25, 0, 2.1, -0.25, 0.25), wallMat);
    push(boxAt(x - 0.31, x + 0.31, 2.1, 2.22, -0.31, 0.31), m.trim);
    push(new THREE.SphereGeometry(0.17, 12, 10).translate(x, 2.42, 0), m.trim);
  }
  for (let x = -len / 2 + 0.3; x < len / 2 - 0.3; x += 0.13) push(boxAt(x - 0.009, x + 0.009, 0.68, 1.92, -0.009, 0.009), m.iron);
  for (const y of [0.78, 1.85]) push(boxAt(-len / 2, len / 2, y - 0.02, y + 0.02, -0.02, 0.02), m.iron);
}
