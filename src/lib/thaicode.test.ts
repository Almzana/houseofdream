import { describe, expect, it } from 'vitest';
import { checkThaiCode, electricalLoad } from './thaicode';
import type { House, Room } from '../types';

const room = (id: string, type: Room['type'], x0: number, z0: number, x1: number, z1: number, extra: Partial<Room> = {}): Room => ({
  id, name: id, type, x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, h: 2.7,
  floor: 'oak', floorScale: 1, floorTint: '#ccc', wallPat: 'plain', wallColor: '#fff', ...extra,
});
const lookup = (t: string) =>
  ({
    door: { opening: { w: 0.96, y0: 0, y1: 2.13, door: true } },
    window: { opening: { w: 1.25, y0: 0.875, y1: 2.125 } },
    heater: {},
  })[t];

// a 4 × 4 m bedroom with a window on the back wall and a door at the front
const base = (extra: Partial<House> = {}): House => ({
  rooms: [room('bed', 'bedroom', 0, 0, 4, 4)],
  items: [
    { id: 'd', t: 'door', x: 1, z: 4, r: Math.PI, c: '' },
    { id: 'w', t: 'window', x: 2, z: 0, r: 0, c: '' },
  ],
  ext: { roof: 'hip', roofColor: '#000', pitch: 30, wallPat: 'plain', wallColor: '#fff', fence: true },
  ...extra,
});
const find = (h: House, title: string) => checkThaiCode(h, lookup).find((c) => c.title.startsWith(title));

describe('checkThaiCode', () => {
  it('needs 2 m between a window wall and the boundary', () => {
    expect(find(base({ site: { left: 2, right: 2, back: 2.5, front: 2, road: 6 } }), 'ระยะร่นด้านหลัง')?.status).toBe('pass');
    // 1 m: the window wall is too close; only 0.8 m from the wall's outer face
    expect(find(base({ site: { left: 2, right: 2, back: 1, front: 2, road: 6 } }), 'ช่องเปิดด้านหลัง')?.status).toBe('fail');
  });

  it('allows a blank wall closer, but not under 50 cm', () => {
    expect(find(base({ site: { left: 0.4, right: 2, back: 2.5, front: 2, road: 6 } }), 'ผนังทึบด้านซ้าย')?.status).toBe('warn');
    expect(find(base({ site: { left: 1, right: 2, back: 2.5, front: 2, road: 6 } }), 'ระยะร่นด้านซ้าย')?.status).toBe('pass');
  });

  it('applies the road setback by road width', () => {
    // 4 m road: 3 m from its centreline = 1 m from the boundary
    expect(find(base({ site: { left: 2, right: 2, back: 2.5, front: 1.5, road: 4 } }), 'ระยะร่นจากถนน')?.status).toBe('pass');
    expect(find(base({ site: { left: 2, right: 2, back: 2.5, front: 0.5, road: 4 } }), 'ระยะร่นจากถนน')?.status).toBe('fail');
  });

  it('flags a low ceiling in a habitable room and a room without a door', () => {
    const h = base({ rooms: [room('bed', 'bedroom', 0, 0, 4, 4, { h: 2.4 }), room('box', 'office', 4, 0, 7, 4)] });
    expect(find(h, 'ฝ้าเตี้ยเกินไป')?.roomId).toBe('bed');
    expect(find(h, 'ไม่มีประตูเข้า')?.roomId).toBe('box');
  });

  it('asks for windows of at least 10% of the floor', () => {
    // doors to outside count too: with the door the room has 22 %, the window alone ≈ 9.8 %
    expect(find(base(), 'ช่องเปิดไม่พอ')).toBeUndefined();
    expect(find(base({ items: [{ id: 'w', t: 'window', x: 2, z: 0, r: 0, c: '' }] }), 'ช่องเปิดไม่พอ')?.status).toBe('fail');
  });

  it('wants a stair when there is an upper floor', () => {
    const h = base({ rooms: [room('bed', 'bedroom', 0, 0, 4, 4), room('up', 'bedroom', 0, 0, 4, 4, { level: 1 })] });
    expect(find(h, 'ไม่มีบันได')?.status).toBe('fail');
  });
});

describe('electricalLoad', () => {
  it('sizes the meter from the load', () => {
    const small = electricalLoad(base(), lookup);
    expect(small.meter).toBe('15(45)A');
    const big = electricalLoad(base({ items: [...base().items, ...Array.from({ length: 4 }, (_, i) => ({ id: `h${i}`, t: 'heater', x: 0, z: 0, r: 0, c: '' }))] }), lookup);
    expect(big.connected).toBeGreaterThan(small.connected + 17000);
  });
});

describe('house designer output', () => {
  it('passes the Thai building checks for every common layout', async () => {
    const { generateHouse } = await import('../data/generate');
    const { catalogById } = await import('../data/catalog');
    const lk = (t: string) => catalogById.get(t);
    for (const floors of [1, 2] as const) {
      for (const bedrooms of [2, 3, 4, 5]) {
        for (const roof of ['hip', 'gable', 'flat'] as const) {
          const h = generateHouse({ floors, bedrooms, bathrooms: 2, garage: true, garden: true, roof });
          const fails = checkThaiCode(h, lk).filter((c) => c.status === 'fail').map((c) => `${floors}F ${bedrooms}BR ${roof}: ${c.title} (${c.detail})`);
          expect(fails).toEqual([]);
        }
      }
    }
  });
});
