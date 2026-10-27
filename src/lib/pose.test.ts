import { describe, expect, it } from 'vitest';
import { estimateRoom, poseFrom, vec, type Pt, type Vec3 } from './pose';

/** Project world points through a known camera to build a synthetic "photo". */
function synthetic(C: Vec3, T: Vec3, f: number, W: number, H: number, pts: Vec3[]): Pt[] {
  const zc = vec.norm(vec.sub(T, C));
  const xc = vec.norm(vec.cross(zc, [0, 1, 0]));
  const yc = vec.cross(zc, xc);
  return pts.map((P) => {
    const q = vec.sub(P, C);
    const Z = vec.dot(q, zc);
    return [(f * vec.dot(q, xc)) / Z / W + 0.5, (f * vec.dot(q, yc)) / Z / H + 0.5];
  });
}

describe('estimateRoom', () => {
  const W = 3000;
  const H = 4000;
  const f = 3060;
  const [w, d, h] = [2.2, 2.8, 2.6];

  it('recovers room size when the real corners are marked', () => {
    const C: Vec3 = [0.25, 1.45, 1.9];
    const P = synthetic(C, [-0.3, 0.7, -1.4], f, W, H, [
      [-w / 2, 0, -d / 2],
      [w / 2, 0, -d / 2],
      [w / 2, 0, d / 2],
      [-w / 2, 0, d / 2],
      [-w / 2, h, -d / 2],
    ]);
    const e = estimateRoom(P, W, H, 1.45)!;
    expect(e.w).toBeCloseTo(w, 2);
    expect(e.d).toBeCloseTo(d, 2);
    expect(e.h).toBeCloseTo(h, 1);
    expect(e.f).toBeCloseTo(f, -1);
  });

  it('recovers the camera pose for a partial floor rectangle', () => {
    const C: Vec3 = [0.2, 1.45, 1.3];
    const zn = 0.1;
    const P = synthetic(C, [-0.3, 0.6, -1.4], f, W, H, [
      [-w / 2, 0, -d / 2],
      [w / 2, 0, -d / 2],
      [w / 2, 0, zn],
      [-w / 2, 0, zn],
      [-w / 2, h, -d / 2],
    ]);
    const e = estimateRoom(P, W, H, 1.45)!;
    expect(e.d).toBeCloseTo(zn + d / 2, 2);
    const p = poseFrom(P, W, H, [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, zn], [-w / 2, zn]], e.f)!;
    expect(p.C[0]).toBeCloseTo(C[0], 2);
    expect(p.C[1]).toBeCloseTo(C[1], 2);
    expect(p.C[2]).toBeCloseTo(C[2], 2);
  });

  it('rejects degenerate input', () => {
    const P: Pt[] = [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5], [0.5, 0.5]];
    expect(estimateRoom(P, W, H, 1.45)).toBeNull();
  });
});
