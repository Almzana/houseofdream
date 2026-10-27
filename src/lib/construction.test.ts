import { describe, expect, it } from 'vitest';
import { construct } from './construction';
import type { House, Room } from '../types';

const room = (id: string, type: Room['type'], x0: number, z0: number, x1: number, z1: number, extra: Partial<Room> = {}): Room => ({
  id, name: id, type, x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, h: 2.7,
  floor: 'oak', floorScale: 1, floorTint: '#ccc', wallPat: 'plain', wallColor: '#fff', ...extra,
});
const lookup = (t: string) =>
  ({
    door: { opening: { w: 0.96, y0: 0, y1: 2.13, door: true } },
    window: { opening: { w: 1.25, y0: 0.875, y1: 2.125 } },
    ceilinglamp: { light: {}, mount: 'ceiling' },
  })[t];

const house: House = {
  rooms: [room('bed', 'bedroom', 0, 0, 4, 4), room('bath', 'bathroom', 4, 0, 6, 4)],
  items: [
    { id: 'd1', t: 'door', x: 1, z: 4, r: Math.PI, c: '' },
    { id: 'w1', t: 'window', x: 2, z: 0, r: 0, c: '' },
    { id: 'l1', t: 'ceilinglamp', x: 2, z: 2, r: 0, c: '' },
    { id: 't1', t: 'toilet', x: 4.5, z: 0.4, r: 0, c: '' },
    { id: 'v1', t: 'vanity', x: 5.5, z: 2, r: 0, c: '' },
  ],
};

describe('construct', () => {
  const { comps, quantities } = construct(house, lookup);
  const kinds = (k: string) => comps.filter((c) => c.kind === k);

  it('puts a footing and two piles under every column', () => {
    const cols = kinds('column').length;
    expect(cols).toBeGreaterThanOrEqual(6); // corners + the shared wall ends
    expect(kinds('footing')).toHaveLength(cols);
    expect(kinds('pile')).toHaveLength(cols * 2);
  });

  it('runs ground beams under every wall', () => {
    const run = kinds('gbeam').reduce((a, c) => a + Math.hypot(c.line!.b[0] - c.line!.a[0], c.line!.b[2] - c.line!.a[2]), 0);
    // perimeter 2×(6+4) plus the 4 m partition
    expect(run).toBeCloseTo(24, 0);
  });

  it('frames openings with lintels and leaves the wall open there', () => {
    expect(kinds('lintel').length).toBeGreaterThanOrEqual(3); // door head, window head and sill
    const bricks = kinds('brick').reduce((a, c) => a + Math.max(c.box!.s[0], c.box!.s[2]) * c.box!.s[1], 0);
    const gross = 24 * (2.7 - 0.4);
    expect(bricks).toBeLessThan(gross);
  });

  it('drains the toilet to the septic tank and the basin to the drain pit', () => {
    expect(kinds('soil').length).toBeGreaterThan(0);
    expect(kinds('grey').length).toBeGreaterThan(0);
    expect(kinds('septic')).toHaveLength(1);
    expect(kinds('vent')).toHaveLength(1);
  });

  it('wires a switch by the bedroom door and sockets round the room', () => {
    expect(kinds('switch').length).toBeGreaterThanOrEqual(1);
    expect(kinds('socket')).toHaveLength(4);
    expect(kinds('panel')).toHaveLength(1);
    expect(kinds('wire-light').length).toBeGreaterThan(0);
  });

  it('prices the bill of quantities', () => {
    const pile = quantities.find((q) => q.group === 'ฐานราก' && q.unit === 'ต้น')!;
    expect(pile.qty).toBe(kinds('pile').length);
    expect(quantities.every((q) => q.qty > 0)).toBe(true);
  });
});
