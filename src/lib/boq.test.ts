import { describe, expect, it } from 'vitest';
import { houseBoq, roomBoq, shellBoq } from './boq';
import type { Room } from '../types';

const room = (o: Partial<Room> = {}): Room => ({
  id: 'r1', name: 'ห้องน้ำ', type: 'bathroom', x: 0, z: 0, w: 2, d: 3, h: 2.5,
  floor: 'antislip', floorScale: 1, floorTint: '#ccc', wallPat: 'plain', wallColor: '#fff', ...o,
});

describe('roomBoq', () => {
  it('computes areas with a door deducted from the walls', () => {
    const b = roomBoq(room());
    expect(b.floorA).toBeCloseTo(6);
    expect(b.perim).toBeCloseTo(10);
    expect(b.wallA).toBeCloseTo(10 * 2.5 - 1.6);
  });

  it('counts 30×30 tiles with 10% waste', () => {
    const b = roomBoq(room());
    const qty = b.floor.lines.find((l) => l[0] === 'จำนวน')![1];
    expect(qty.startsWith(String(Math.ceil((6 * 1.1) / 0.09)))).toBe(true);
    expect(b.floor.cost).toBeGreaterThan(0);
  });

  it('paints 2 coats at 35 m² per gallon', () => {
    const b = roomBoq(room());
    const paint = b.wall.lines.find((l) => l[0].startsWith('สีทา'))![1];
    expect(paint.startsWith(String(Math.ceil((23.4 * 2) / 35)))).toBe(true);
  });

  it('has no walls outdoors', () => {
    const b = roomBoq(room({ outdoor: true, floor: 'grass' }));
    expect(b.wallA).toBe(0);
    expect(b.wall.cost).toBe(0);
  });
});

describe('houseBoq', () => {
  it('groups items and sums totals', () => {
    const b = houseBoq(
      { rooms: [room()], items: [{ id: 'a', t: 'x', x: 0, z: 0, r: 0, c: '' }, { id: 'b', t: 'x', x: 0, z: 0, r: 0, c: '' }] },
      () => ({ name: 'X', price: 1000 }),
    );
    expect(b.items).toEqual([{ t: 'x', name: 'X', n: 2, unit: 1000, total: 2000 }]);
    expect(b.totals.all).toBeCloseTo(b.totals.floor + b.totals.wall + b.totals.shell + 2000);
    expect(b.totals.area).toBeCloseTo(6);
  });
});

describe('shellBoq', () => {
  it('measures the roof, the facade minus openings and the fence', () => {
    const door = { opening: { w: 1, y0: 0, y1: 2, door: true } };
    const s = shellBoq(
      { rooms: [room()], items: [{ id: 'd', t: 'door', x: 0, z: 1.5, r: Math.PI, c: '' }], ext: { roof: 'hip', roofColor: '#000', pitch: 30, wallPat: 'plain', wallColor: '#fff', fence: true } },
      (t) => (t === 'door' ? { name: 'ประตู', price: 0, ...door } : undefined),
    );
    // 2 × 3 m room, 2.5 m walls, one 1 × 2 m door
    expect(s.wallA).toBeCloseTo(2 * (2 + 3) * 2.5 - 2);
    // outer wall faces (+0.2 each side) plus 0.6 m eaves, sloped at 30°
    expect(s.roofA).toBeCloseTo(((2.4 + 1.2) * (3.4 + 1.2)) / Math.cos(Math.PI / 6));
    // plot = rooms + 2 m all round
    expect(s.fence).toBeCloseTo(2 * (6 + 7));
    expect(s.cost).toBeGreaterThan(0);
  });
});
