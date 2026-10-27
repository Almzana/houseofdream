import * as THREE from 'three';
import { ctx2d, lumaRelief, makeMaps, mkCanvas, rng, speckle } from './canvas';
import type { Surface } from '../data/surfaces';

let anisotropy = 4;
export function setAnisotropy(n: number) {
  anisotropy = n;
}

export function texFrom(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

/* ---- surface swatches: painted lazily, maps built on first use ---- */
const painted = new Map<string, HTMLCanvasElement>();
const thumbs = new Map<string, string>();
interface SurfaceMaps {
  map: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
  rough: THREE.CanvasTexture;
}
const mapsCache = new Map<string, SurfaceMaps>();

/** Custom uploads replace the painted canvas for a surface id. */
export function setCustomCanvas(id: string, c: HTMLCanvasElement) {
  painted.set(id, c);
  thumbs.delete(id);
  const old = mapsCache.get(id);
  if (old) Object.values(old).forEach((t) => t.dispose());
  mapsCache.delete(id);
}

function paint(s: Surface): HTMLCanvasElement {
  let c = painted.get(s.id);
  if (!c) {
    c = mkCanvas(1024);
    const x = ctx2d(c);
    x.scale(2, 2);
    s.draw(x, 512, 512);
    painted.set(s.id, c);
  }
  return c;
}

export function surfaceThumb(s: Surface): string {
  let t = thumbs.get(s.id);
  if (!t) {
    const small = mkCanvas(160);
    ctx2d(small).drawImage(paint(s), 0, 0, 160, 160);
    t = small.toDataURL('image/jpeg', 0.85);
    thumbs.set(s.id, t);
  }
  return t;
}

/** Base map + normal + roughness for a surface (shared; clone the base map to change repeat). */
export function surfaceMaps(s: Surface): SurfaceMaps {
  let m = mapsCache.get(s.id);
  if (!m) {
    const c = paint(s);
    let rc: HTMLCanvasElement;
    if (typeof s.relief === 'function') {
      rc = mkCanvas(512);
      const x = ctx2d(rc);
      x.fillStyle = '#fff';
      x.fillRect(0, 0, 512, 512);
      s.relief(x, 512, 512);
    } else rc = lumaRelief(c, s.relief === 'invluma');
    const maps = makeMaps(rc, s.ns * 1.6, s.rough);
    m = { map: texFrom(c), normal: texFrom(maps.normal, false), rough: texFrom(maps.rough, false) };
    mapsCache.set(s.id, m);
  }
  return m;
}

/** Colour, normal and roughness maps of a surface sharing one repeat (UVs in metres → repeat = 1 / unit). */
export function surfaceSet(s: Surface, rx = 1 / s.unit[0], ry = 1 / s.unit[1]) {
  const m = surfaceMaps(s);
  const rep = (t: THREE.Texture) => {
    const c = t.clone();
    c.needsUpdate = true;
    c.repeat.set(rx, ry);
    return c;
  };
  return { map: rep(m.map), normalMap: rep(m.normal), roughnessMap: rep(m.rough) };
}

/* ---- furniture textures ---- */
function woodCanvas() {
  const c = mkCanvas(512);
  const x = ctx2d(c);
  const r = rng(77);
  x.fillStyle = '#ececec';
  x.fillRect(0, 0, 512, 512);
  for (let k = 0; k < 160; k++) {
    const y = r() * 512, amp = 2 + r() * 6, per = 1 + Math.floor(r() * 3), v = 120 + Math.floor(r() * 80);
    x.strokeStyle = `rgba(${v},${v},${v},${0.12 + r() * 0.25})`;
    x.lineWidth = 0.6 + r() * 2.5;
    x.beginPath();
    for (let xx = 0; xx <= 512; xx += 16) {
      const yy = y + Math.sin((xx / 512) * Math.PI * 2 * per + k) * amp;
      if (xx) x.lineTo(xx, yy);
      else x.moveTo(xx, yy);
    }
    x.stroke();
  }
  return c;
}
function fabricCanvas() {
  const c = mkCanvas(256);
  const x = ctx2d(c);
  const n = 32, s = 256 / n, r = rng(9);
  x.fillStyle = '#d0d0d0';
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const v = 215 + Math.floor(r() * 35);
      x.fillStyle = `rgb(${v},${v},${v})`;
      if ((i + j) % 2) x.fillRect(i * s, j * s + 1, s, s - 2);
      else x.fillRect(i * s + 1, j * s, s - 2, s);
    }
  speckle(x, 256, 256, 1500, 4, ['rgba(0,0,0,.08)', 'rgba(255,255,255,.25)']);
  return c;
}

let shared: {
  wood: THREE.CanvasTexture;
  woodN: THREE.CanvasTexture;
  fabric: THREE.CanvasTexture;
  fabricN: THREE.CanvasTexture;
  rug: THREE.CanvasTexture;
  screen: THREE.CanvasTexture;
  leaf: THREE.CanvasTexture;
} | null = null;

export function sharedTex() {
  if (shared) return shared;
  const wc = woodCanvas();
  const wm = makeMaps(lumaRelief(wc), 0.8, [0.45, 0.7]);
  const fc = fabricCanvas();
  const fm = makeMaps(fc, 2.2, [0.9, 1]);
  const fabric = texFrom(fc);
  fabric.repeat.set(6, 6);

  const rc = mkCanvas(512);
  const rx = ctx2d(rc);
  rx.fillStyle = '#ededed'; rx.fillRect(0, 0, 512, 512);
  rx.fillStyle = '#bdbdbd'; rx.fillRect(18, 18, 476, 476);
  rx.fillStyle = '#f2f2f2'; rx.fillRect(40, 40, 432, 432);
  rx.strokeStyle = '#cfcfcf'; rx.lineWidth = 6;
  for (let i = -512; i < 512; i += 48) { rx.beginPath(); rx.moveTo(40 + i, 40); rx.lineTo(472 + i, 472); rx.stroke(); }
  rx.fillStyle = '#bdbdbd'; rx.fillRect(40, 40, 432, 10); rx.fillRect(40, 462, 432, 10);
  speckle(rx, 512, 512, 9000, 3, ['rgba(0,0,0,.07)', 'rgba(255,255,255,.2)']);

  const sc = mkCanvas(512, 288);
  const sx = ctx2d(sc);
  const g = sx.createLinearGradient(0, 0, 0, 288);
  g.addColorStop(0, '#3a5a78'); g.addColorStop(0.55, '#c9a27c'); g.addColorStop(0.56, '#31424f'); g.addColorStop(1, '#141c22');
  sx.fillStyle = g; sx.fillRect(0, 0, 512, 288);
  sx.fillStyle = 'rgba(255,236,200,.85)'; sx.beginPath(); sx.arc(360, 150, 22, 0, Math.PI * 2); sx.fill();
  const screen = new THREE.CanvasTexture(sc);
  screen.colorSpace = THREE.SRGBColorSpace;

  const lc = mkCanvas(64, 256);
  const lx = ctx2d(lc);
  const lg = lx.createLinearGradient(0, 0, 64, 0);
  lg.addColorStop(0, '#c9c9a0'); lg.addColorStop(0.12, '#ffffff'); lg.addColorStop(0.5, '#e6e6e6'); lg.addColorStop(0.88, '#ffffff'); lg.addColorStop(1, '#c9c9a0');
  lx.fillStyle = lg; lx.fillRect(0, 0, 64, 256);
  for (let y = 10; y < 256; y += 18) { lx.fillStyle = 'rgba(80,110,60,.18)'; lx.fillRect(8, y, 48, 6); }
  const leaf = new THREE.CanvasTexture(lc);
  leaf.colorSpace = THREE.SRGBColorSpace;

  shared = {
    wood: texFrom(wc),
    woodN: texFrom(wm.normal, false),
    fabric,
    fabricN: texFrom(fm.normal, false),
    rug: texFrom(rc),
    screen,
    leaf,
  };
  return shared;
}
