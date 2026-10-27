/** Colour of a white light source at a colour temperature (K), as sRGB 0–255 (Tanner Helland's fit). */
export function kelvinRGB(k: number): [number, number, number] {
  const t = Math.min(40000, Math.max(1000, k)) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v)));
  return [c(r), c(g), c(b)];
}

export const kelvinCss = (k: number) => `rgb(${kelvinRGB(k).join(',')})`;

/** Everyday name for a colour temperature. */
export const kelvinName = (k: number) => (k < 3300 ? 'วอร์มไวท์' : k < 5000 ? 'คูลไวท์' : 'เดย์ไลท์');
