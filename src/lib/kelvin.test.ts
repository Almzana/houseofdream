import { describe, expect, it } from 'vitest';
import { kelvinRGB, kelvinName } from './kelvin';

describe('kelvinRGB', () => {
  it('is warm at 2700 K and close to neutral at 6500 K', () => {
    const [r, , b] = kelvinRGB(2700);
    expect(r).toBe(255);
    expect(b).toBeLessThan(180);
    const d = kelvinRGB(6500);
    expect(Math.max(...d) - Math.min(...d)).toBeLessThan(20);
  });
  it('names the common bulb colours', () => {
    expect(kelvinName(3000)).toBe('วอร์มไวท์');
    expect(kelvinName(4000)).toBe('คูลไวท์');
    expect(kelvinName(6500)).toBe('เดย์ไลท์');
  });
});
