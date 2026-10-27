/**
 * Camera recovery from marked floor corners in a single photo.
 * Pinhole model, principal point at the image centre, image y pointing down.
 * Points are normalised image coordinates (0..1, may lie outside the frame).
 */
export type Vec3 = [number, number, number];
export type Pt = [number, number];

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.sqrt(dot(a, a));
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: Vec3) => scale(a, 1 / len(a));
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const vec = { dot, len, scale, sub, norm, cross };

/** 8-dof homography mapping plane points (a,b) to image points (u,v); h33 = 1. */
export function solveH(src: Pt[], dst: Pt[]): number[] | null {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [a, c] = src[i];
    const [u, v] = dst[i];
    A.push([a, c, 1, 0, 0, 0, -u * a, -u * c]);
    b.push(u);
    A.push([0, 0, 0, a, c, 1, -v * a, -v * c]);
    b.push(v);
  }
  const n = 8;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    [b[i], b[p]] = [b[p], b[i]];
    if (Math.abs(A[i][i]) < 1e-12) return null;
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
    x[i] = s / A[i][i];
  }
  return x.every(Number.isFinite) ? x : null;
}

export const rect = (w: number, d: number): Pt[] => [
  [-w / 2, -d / 2],
  [w / 2, -d / 2],
  [w / 2, d / 2],
  [-w / 2, d / 2],
];

const toPx = (P: Pt[], W: number, H: number): Pt[] =>
  P.slice(0, 4).map((p) => [(p[0] - 0.5) * W, (p[1] - 0.5) * H] as Pt);

/** Focal length (px) from the right angle between the floor edges; falls back to a typical phone main lens. */
export function focalFromCorners(P: Pt[], W: number, H: number): number {
  const Mx = Math.max(W, H);
  const h = solveH(rect(1, 1), toPx(P, W, H));
  if (h && Math.abs(h[6] * h[7]) > 1e-14) {
    const v = -(h[0] * h[1] + h[3] * h[4]) / (h[6] * h[7]);
    if (v > 0) {
      const f = Math.sqrt(v);
      if (f > 0.4 * Mx && f < 3 * Mx) return f;
    }
  }
  return 0.75 * Mx;
}

export interface Pose {
  f: number;
  r1: Vec3; // world x axis in camera coords
  ry: Vec3; // world y axis (up)
  r2: Vec3; // world z axis
  t: Vec3;
  C: Vec3; // camera centre in world coords
}

export function poseFrom(P: Pt[], W: number, H: number, src: Pt[], f: number): Pose | null {
  const h = solveH(src, toPx(P, W, H));
  if (!h) return null;
  const k1: Vec3 = [h[0] / f, h[3] / f, h[6]];
  const k2: Vec3 = [h[1] / f, h[4] / f, h[7]];
  const k3: Vec3 = [h[2] / f, h[5] / f, 1];
  let lam = 2 / (len(k1) + len(k2));
  if (k3[2] * lam < 0) lam = -lam;
  const r1 = norm(scale(k1, lam));
  let r2 = scale(k2, lam);
  const t = scale(k3, lam);
  r2 = norm(sub(r2, scale(r1, dot(r2, r1))));
  const ry = cross(r2, r1);
  const C: Vec3 = [-dot(r1, t), -dot(ry, t), -dot(r2, t)];
  if (!C.every(Number.isFinite) || !(C[1] > 0)) return null;
  return { f, r1, ry, r2, t, C };
}

export interface RoomEstimate {
  w: number;
  d: number; // depth of the marked rectangle
  h: number;
  f: number;
  camZ: number; // camera z in the marked rectangle's centred coords
}

/**
 * Room size from one photo: aspect from the metric rectangle, scale from the
 * camera height, ceiling height from point 5 (ceiling corner above point 1).
 */
export function estimateRoom(P: Pt[], W: number, H: number, camH: number): RoomEstimate | null {
  const f = focalFromCorners(P, W, H);
  const h = solveH(rect(1, 1), toPx(P, W, H));
  if (!h) return null;
  const a = len([h[0] / f, h[3] / f, h[6]]) / len([h[1] / f, h[4] / f, h[7]]);
  const p1 = poseFrom(P, W, H, rect(a, 1), f);
  if (!p1) return null;
  const s = camH / p1.C[1];
  const w = a * s;
  const d = s;
  const p = poseFrom(P, W, H, rect(w, d), f);
  if (!p) return null;
  let hh = 2.6;
  if (P[4]) {
    const v5 = (P[4][1] - 0.5) * H;
    let best = Infinity;
    for (let y = 1.8; y <= 5.001; y += 0.01) {
      const X: Vec3 = [-w / 2, y, -d / 2];
      const c: Vec3 = [0, 1, 2].map(
        (k) => p.r1[k] * X[0] + p.ry[k] * X[1] + p.r2[k] * X[2] + p.t[k],
      ) as Vec3;
      if (c[2] <= 0) continue;
      const e = Math.abs((f * c[1]) / c[2] - v5);
      if (e < best) {
        best = e;
        hh = y;
      }
    }
  }
  return { w, d, h: hh, f, camZ: p.C[2] };
}
