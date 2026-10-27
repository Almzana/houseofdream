import { create } from 'zustand';
import type { Engine } from './engine/Engine';
import type { Pt } from './lib/pose';

/** The live engine instance (one per page). */
let engine: Engine | null = null;
export const setEngine = (e: Engine | null) => (engine = e);
export const getEngine = () => engine;

/** Photo-to-room session (kept in memory only; photos are never stored). */
interface PhotoState {
  img: HTMLImageElement | null;
  url: string;
  roomId: string | null;
  pts: Pt[] | null;
  calibOpen: boolean;
  active: boolean;
  original: boolean;
  picked: { floor: string; wall: string } | null;
  f: number | null;
  markDepth: number | null;
  set: (p: Partial<PhotoState>) => void;
}

export const usePhoto = create<PhotoState>((set) => ({
  img: null,
  url: '',
  roomId: null,
  pts: null,
  calibOpen: false,
  active: false,
  original: false,
  picked: null,
  f: null,
  markDepth: null,
  set: (p) => set(p),
}));

/** Average colours of the lower (floor) and upper (wall) bands of a photo. */
export function sampleColours(img: HTMLImageElement) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, 0, 0, 64, 64);
  const avg = (y0: number, h: number) => {
    const d = x.getImageData(4, y0, 56, h).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    return '#' + [r, g, b].map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('');
  };
  return { floor: avg(50, 14), wall: avg(6, 22) };
}

export function readImage(file: File): Promise<{ img: HTMLImageElement; url: string }> {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) return reject(new Error('not an image'));
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => resolve({ img, url: fr.result as string });
      img.onerror = reject;
      img.src = fr.result as string;
    };
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}
