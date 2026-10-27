import { describe, expect, it } from 'vitest';
import { catalogById } from './catalog';
import { generateHouse } from './generate';
import { construct } from '../lib/construction';
import { checkThaiCode } from '../lib/thaicode';
import { houseBoq } from '../lib/boq';
import { LEVEL_H, applyStorey, stairSteps } from '../types';

const lookup = (t: string) => catalogById.get(t);

describe.each(['luxury', 'ultra'] as const)('%s villa', (tier) => {
  const h = generateHouse({ floors: 2, bedrooms: 5, bathrooms: 5, garage: true, garden: true, roof: 'hip', tier });
  const indoor = h.rooms.filter((r) => !r.outdoor);

  it('has tall storeys, a lift on every floor and a pool', () => {
    expect(h.tier).toBe(tier);
    expect(h.storey).toBe(tier === 'ultra' ? 3.9 : 3.6);
    const floors = new Set(indoor.map((r) => r.level ?? 0)).size;
    expect(floors).toBe(tier === 'ultra' ? 3 : 2);
    expect(indoor.filter((r) => r.type === 'lift')).toHaveLength(floors);
    expect(h.rooms.some((r) => r.type === 'pool')).toBe(true);
    expect(h.rooms.some((r) => r.type === 'void')).toBe(true);
  });

  it('passes the Thai building-code checks', () => {
    const bad = checkThaiCode(h, lookup).filter((c) => c.status === 'fail' || c.status === 'warn');
    expect(bad.map((c) => c.title)).toEqual([]);
  });

  it('stairs need a landing at this storey height', () => {
    applyStorey(h);
    expect(LEVEL_H).toBe(h.storey);
    const s = stairSteps();
    expect(s.landing).toBeGreaterThan(0);
    expect(s.rise).toBeLessThanOrEqual(0.19);
  });

  it('gets a heavier frame and villa systems', () => {
    const { comps } = construct(h, lookup);
    const has = (k: string) => comps.some((c) => c.kind === k);
    expect(comps.filter((c) => c.kind === 'pile').every((c) => c.spec.startsWith('เสาเข็มเจาะ'))).toBe(true);
    expect(comps.some((c) => c.kind === 'slab' && c.name.includes('Post-tension'))).toBe(true);
    for (const k of ['shaft', 'liftcar', 'pooltank', 'poolplant', 'vrv', 'solar', 'ev', 'smoke', 'lightning', 'cctv']) expect(has(k), k).toBe(true);
    expect(has('genset')).toBe(tier === 'ultra');
    expect(comps.filter((c) => c.kind === 'acout')).toHaveLength(0);
    for (const c of comps) {
      const nums = c.box ? [...c.box.p, ...c.box.s] : [...c.line!.a, ...c.line!.b];
      expect(nums.every(Number.isFinite), c.name).toBe(true);
    }
  });

  it('costs what a villa costs per square metre', () => {
    const b = houseBoq(h, lookup);
    const area = indoor.filter((r) => r.type !== 'void').reduce((a, r) => a + r.w * r.d, 0);
    const perM2 = b.totals.all / area;
    if (tier === 'luxury') expect(perM2).toBeGreaterThan(35000), expect(perM2).toBeLessThan(65000);
    else expect(perM2).toBeGreaterThan(60000);
  });
});

it('a standard house keeps the 3 m storey and plain structure', () => {
  const h = generateHouse({ floors: 2, bedrooms: 3, bathrooms: 2, garage: true, garden: true, roof: 'hip' });
  expect(h.storey ?? 3).toBe(3);
  const { comps } = construct(h, lookup);
  expect(comps.some((c) => c.layer === 'systems')).toBe(false);
  expect(comps.some((c) => c.kind === 'plank')).toBe(true);
});
