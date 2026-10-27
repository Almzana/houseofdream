import { describe, expect, it } from 'vitest';
import { blocks, isExterior, wallPieces, wallSegments, type WallRoom } from './walls';

const room = (id: string, x0: number, z0: number, x1: number, z1: number, extra: Partial<WallRoom> = {}): WallRoom => ({
  id, x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, h: 2.7, ...extra,
});

describe('wallSegments', () => {
  it('turns a shared edge into one partition and the rest into exterior walls', () => {
    const segs = wallSegments([room('a', 0, 0, 4, 3), room('b', 4, 0, 7, 3)], [], 0);
    const part = segs.filter((s) => !isExterior(s));
    expect(part).toHaveLength(1);
    expect(part[0]).toMatchObject({ axis: 'z', c: 4, s0: 0, s1: 3, plus: 'b', minus: 'a' });
    // north and south lines each split per room, plus the two end walls
    expect(segs.filter(isExterior)).toHaveLength(6);
  });

  it('splits a long wall where the neighbour on the other side ends', () => {
    const segs = wallSegments([room('big', 0, 0, 6, 4), room('small', 0, 4, 2, 6)], [], 0);
    const line = segs.filter((s) => s.axis === 'x' && s.c === 4).sort((a, b) => a.s0 - b.s0);
    expect(line.map((s) => [s.s0, s.s1, s.plus, s.minus])).toEqual([
      [0, 2, 'small', 'big'],
      [2, 6, null, 'big'],
    ]);
  });

  it('ignores outdoor rooms and other storeys', () => {
    const segs = wallSegments([room('a', 0, 0, 4, 4), room('g', 4, 0, 8, 4, { outdoor: true }), room('u', 0, 0, 4, 4, { level: 1 })], [], 0);
    expect(segs.every((s) => s.plus !== 'g' && s.minus !== 'g' && s.plus !== 'u' && s.minus !== 'u')).toBe(true);
    expect(segs.find((s) => s.axis === 'z' && s.c === 4)).toMatchObject({ plus: null, minus: 'a' });
  });

  it('cuts door and window openings and leaves the wall around them', () => {
    const segs = wallSegments([room('a', 0, 0, 4, 3)], [
      { id: 'd', x: 1, z: 3, w: 1, y0: 0, y1: 2.1, door: true, level: 0 },
      { id: 'w', x: 3, z: 3.05, w: 1, y0: 0.9, y1: 2.1, level: 0 },
    ], 0);
    const south = segs.find((s) => s.axis === 'x' && s.c === 3)!;
    expect(south.gaps.map((g) => g.id)).toEqual(['d', 'w']);
    expect(wallPieces(south)).toEqual([
      [0, 0.5, 0, 2.7],
      [0.5, 1.5, 2.1, 2.7],
      [1.5, 2.5, 0, 2.7],
      [2.5, 3.5, 0, 0.9],
      [2.5, 3.5, 2.1, 2.7],
      [3.5, 4, 0, 2.7],
    ]);
    expect(blocks(south, 1)).toBe(false);
    expect(blocks(south, 3)).toBe(true);
    expect(blocks(south, 2)).toBe(true);
  });
});
