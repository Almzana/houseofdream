import * as THREE from 'three';
import { MAT, add, cy, lathe, noShadow, rb, shade, sphere, tube } from '../engine/kit';
import { ctx2d, mkCanvas, rng } from '../engine/canvas';
import { sharedTex } from '../engine/textures';

export type CatId = 'bath' | 'kitchen' | 'living' | 'bedroom' | 'dining' | 'office' | 'doors' | 'lights' | 'decor' | 'outdoor';

export const CATEGORIES: { id: CatId; name: string }[] = [
  { id: 'living', name: 'ห้องนั่งเล่น' },
  { id: 'bedroom', name: 'ห้องนอน' },
  { id: 'kitchen', name: 'ห้องครัว' },
  { id: 'dining', name: 'ห้องกินข้าว' },
  { id: 'bath', name: 'ห้องน้ำ' },
  { id: 'office', name: 'ห้องทำงาน' },
  { id: 'doors', name: 'ประตู / หน้าต่าง' },
  { id: 'lights', name: 'โคมไฟ / แสงสว่าง' },
  { id: 'decor', name: 'ตกแต่ง / ต้นไม้' },
  { id: 'outdoor', name: 'นอกบ้าน / สวน' },
];

export interface CatalogItem {
  id: string;
  cats: CatId[];
  name: string;
  size: string;
  /** typical Thai retail price (THB) */
  price: number;
  colors: string[];
  /** wall items snap onto the nearest wall (local z = 0 is the wall face); ceiling items follow the room height */
  mount?: 'wall' | 'ceiling';
  /** light source: brightness in lumens, position in the model, spot half-angle (rad) */
  light?: { kind: 'point' | 'spot'; lm: number; at: [number, number, number]; angle?: number; aim?: [number, number, number] };
  /** wall items that cut a hole: width, sill and head height (m); doors can be walked through */
  opening?: { w: number; y0: number; y1: number; door?: boolean };
  /** straight stair: width × run (m); climbs one storey towards local -z */
  stair?: { w: number; len: number };
  build: (c: string, g: THREE.Group) => void;
}

const WOOD = ['#c9a27a', '#a47a52', '#5b4130', '#e9e2d6'];
const CERAMIC = ['#f7f7f5', '#2b2b2b', '#e8dcc8', '#b9c2bd'];
const SOFA = ['#8d8479', '#5f6b6e', '#3e3a37', '#c9bba6', '#8a5a45', '#6e7a63'];
const CABINET = ['#f1eee8', '#c9a27a', '#4a5450', '#2b2b2b', '#a8b5ab'];

let artTex: THREE.CanvasTexture | null = null;
function art() {
  if (artTex) return artTex;
  const c = mkCanvas(256, 192);
  const x = ctx2d(c);
  const r = rng(5);
  x.fillStyle = '#efe9df';
  x.fillRect(0, 0, 256, 192);
  const cols = ['#b5653f', '#2f4858', '#d9a441', '#8b9a83', '#1e1e1e'];
  for (let i = 0; i < 7; i++) {
    x.fillStyle = cols[i % cols.length];
    x.globalAlpha = 0.85;
    x.beginPath();
    x.arc(r() * 256, r() * 192, 18 + r() * 50, 0, Math.PI * (1 + r()));
    x.fill();
  }
  x.globalAlpha = 1;
  x.fillStyle = '#1e1e1e';
  x.fillRect(30, 140, 190, 3);
  artTex = new THREE.CanvasTexture(c);
  artTex.colorSpace = THREE.SRGBColorSpace;
  return artTex;
}

/** Pivot for a door leaf; dir = +1 when the leaf extends towards +x from the hinge. */
function hinge(g: THREE.Group, x: number, dir: number) {
  const h = new THREE.Group();
  h.position.x = x;
  h.userData.hinge = dir;
  g.add(h);
  return h;
}

/** shared kitchen carcass: 0.9 m tall base unit with stone top */
function baseUnit(g: THREE.Group, c: string, w: number) {
  const m = MAT.wood(c);
  rb(g, w, 0.08, 0.54, 0.005, MAT.matte('#1d1b19'), 0, 0.04, -0.02);
  rb(g, w, 0.78, 0.58, 0.008, m, 0, 0.47, 0);
  const n = Math.max(1, Math.round(w / 0.6));
  for (let i = 1; i < n; i++) rb(g, 0.004, 0.74, 0.01, 0.001, MAT.matte('#1d1b19'), -w / 2 + (i * w) / n, 0.47, 0.291);
  rb(g, w - 0.04, 0.012, 0.02, 0.005, MAT.brushed(), 0, 0.82, 0.3);
  rb(g, w + 0.02, 0.04, 0.62, 0.008, MAT.stone('#e9e6e0'), 0, 0.88, 0.01);
}

export const CATALOG: CatalogItem[] = [
  /* ---------------- living ---------------- */
  { id: 'sofa', cats: ['living'], name: 'โซฟา 3 ที่นั่ง', size: '200×90 ซม.', price: 15900, colors: SOFA,
    build(c, g) {
      const m = MAT.fabric(c), cu = MAT.fabric(shade(c, 0.04)), lg = MAT.wood('#5b4130');
      rb(g, 2, 0.22, 0.9, 0.04, m, 0, 0.26, 0); rb(g, 2, 0.5, 0.2, 0.06, m, 0, 0.6, -0.35);
      rb(g, 0.18, 0.36, 0.9, 0.07, m, -0.91, 0.55, 0); rb(g, 0.18, 0.36, 0.9, 0.07, m, 0.91, 0.55, 0);
      for (const x of [-0.55, 0, 0.55]) rb(g, 0.56, 0.15, 0.64, 0.06, cu, x, 0.445, 0.07);
      for (const x of [-0.55, 0, 0.55]) rb(g, 0.54, 0.4, 0.16, 0.08, cu, x, 0.68, -0.2).rotation.x = -0.12;
      rb(g, 0.42, 0.42, 0.13, 0.1, MAT.fabric('#c9a27a'), -0.6, 0.66, -0.08).rotation.set(-0.2, 0.25, 0.1);
      for (const x of [-0.9, 0.9]) for (const z of [-0.38, 0.38]) cy(g, 0.022, 0.016, 0.15, lg, x, 0.075, z, 16);
    } },
  { id: 'sectional', cats: ['living'], name: 'โซฟาตัวแอล', size: '260×160 ซม.', price: 32900, colors: SOFA,
    build(c, g) {
      const m = MAT.fabric(c), cu = MAT.fabric(shade(c, 0.04));
      rb(g, 2.6, 0.24, 0.92, 0.04, m, 0, 0.2, -0.34); rb(g, 0.92, 0.24, 0.7, 0.04, m, 0.84, 0.2, 0.45);
      rb(g, 2.6, 0.5, 0.2, 0.06, m, 0, 0.55, -0.7); rb(g, 0.18, 0.34, 0.92, 0.07, m, -1.21, 0.48, -0.34);
      for (let i = 0; i < 3; i++) rb(g, 0.66, 0.14, 0.66, 0.06, cu, -0.95 + i * 0.68, 0.38, -0.3);
      rb(g, 0.86, 0.14, 1.32, 0.06, cu, 0.84, 0.38, 0.12);
      for (let i = 0; i < 4; i++) rb(g, 0.6, 0.4, 0.16, 0.08, cu, -0.95 + i * 0.64, 0.62, -0.56).rotation.x = -0.12;
    } },
  { id: 'armchair', cats: ['living', 'bedroom'], name: 'อาร์มแชร์', size: '85×85 ซม.', price: 5900, colors: ['#c58f4e', '#5f6b6e', '#7b8c6a', '#d8cdbd'],
    build(c, g) {
      const m = MAT.fabric(c), lg = MAT.wood('#5b4130');
      rb(g, 0.85, 0.22, 0.8, 0.04, m, 0, 0.3, 0); rb(g, 0.85, 0.48, 0.16, 0.06, m, 0, 0.64, -0.33);
      rb(g, 0.14, 0.3, 0.8, 0.06, m, -0.36, 0.55, 0); rb(g, 0.14, 0.3, 0.8, 0.06, m, 0.36, 0.55, 0);
      rb(g, 0.58, 0.12, 0.62, 0.05, MAT.fabric(shade(c, 0.04)), 0, 0.465, 0.06);
      for (const x of [-0.36, 0.36]) for (const z of [-0.33, 0.33]) cy(g, 0.022, 0.016, 0.19, lg, x, 0.095, z, 16);
    } },
  { id: 'coffee', cats: ['living'], name: 'โต๊ะกลางหินอ่อน', size: 'ø80 ซม.', price: 4590, colors: ['#ecebe6', '#2b2b2b', '#c9a27a'],
    build(c, g) {
      const top = c === '#c9a27a' ? MAT.wood(c) : MAT.stone(c);
      cy(g, 0.4, 0.4, 0.03, top, 0, 0.42, 0, 96);
      for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; cy(g, 0.012, 0.012, 0.41, MAT.brushed(), Math.cos(a) * 0.28, 0.2, Math.sin(a) * 0.28, 12); }
    } },
  { id: 'sidetable', cats: ['living', 'bedroom'], name: 'โต๊ะข้าง', size: 'ø45 ซม.', price: 1590, colors: WOOD,
    build(c, g) { cy(g, 0.225, 0.225, 0.025, MAT.wood(c), 0, 0.55, 0, 64); cy(g, 0.03, 0.03, 0.53, MAT.brushed(), 0, 0.27, 0, 16); cy(g, 0.17, 0.17, 0.015, MAT.brushed(), 0, 0.008, 0, 48); } },
  { id: 'tv', cats: ['living', 'bedroom'], name: 'ทีวี 55" + ชั้นวาง', size: '180×40 ซม.', price: 18900, colors: WOOD,
    build(c, g) {
      const m = MAT.wood(c);
      rb(g, 1.8, 0.4, 0.4, 0.012, m, 0, 0.26, 0);
      for (const x of [-0.6, 0, 0.6]) rb(g, 0.003, 0.36, 0.01, 0.001, MAT.matte('#1d1b19'), x, 0.26, 0.201);
      for (const x of [-0.85, 0.85]) for (const z of [-0.16, 0.16]) cy(g, 0.012, 0.01, 0.06, MAT.brushed(), x, 0.03, z, 12);
      rb(g, 0.32, 0.02, 0.2, 0.006, MAT.brushed(), 0, 0.47, -0.05); rb(g, 0.05, 0.12, 0.04, 0.01, MAT.brushed(), 0, 0.53, -0.08);
      rb(g, 1.24, 0.72, 0.03, 0.006, MAT.matte('#121212'), 0, 1.0, -0.06);
      add(g, new THREE.PlaneGeometry(1.22, 0.69), MAT.screen(), 0, 1.0, -0.044);
      rb(g, 0.9, 0.06, 0.08, 0.02, MAT.matte('#1b1b1b'), 0, 0.49, 0.1);
    } },
  { id: 'bookshelf', cats: ['living', 'office'], name: 'ชั้นหนังสือ', size: '90×30 ซม.', price: 2990, colors: ['#c9a27a', '#2b2b2b', '#e9e2d6'],
    build(c, g) {
      const m = MAT.wood(c), r = rng(42);
      rb(g, 0.03, 1.8, 0.3, 0.005, m, -0.435, 0.9, 0); rb(g, 0.03, 1.8, 0.3, 0.005, m, 0.435, 0.9, 0); rb(g, 0.9, 1.8, 0.015, 0.003, m, 0, 0.9, -0.142);
      const bc = ['#8a3f2e', '#2c4f6e', '#c99a3a', '#3e5e4a', '#e8e2d4', '#5b4a6e', '#1f2a2e', '#b6a48d'];
      for (let i = 0; i < 5; i++) {
        const y = 0.02 + i * 0.44; rb(g, 0.84, 0.025, 0.28, 0.004, m, 0, y, 0);
        if (i < 4) { let x = -0.4; while (x < 0.34) { const bw = 0.025 + r() * 0.035, bh = 0.22 + r() * 0.12; if (r() > 0.18) rb(g, bw, bh, 0.2, 0.003, MAT.matte(bc[Math.floor(r() * bc.length)]), x + bw / 2, y + 0.013 + bh / 2, 0.02); x += bw + 0.004; } }
      }
    } },
  { id: 'rug', cats: ['living', 'bedroom', 'decor'], name: 'พรม', size: '200×140 ซม.', price: 2490, colors: ['#b98b6e', '#8d8479', '#8e9e86', '#c9bba6', '#4a4440'],
    build(c, g) {
      const s = sharedTex();
      const m = new THREE.MeshStandardMaterial({ color: c, roughness: 1, map: s.rug, normalMap: s.fabricN, normalScale: new THREE.Vector2(1.5, 1.5) });
      noShadow(rb(g, 2, 0.014, 1.4, 0.006, m, 0, 0.007, 0));
    } },
  { id: 'floorlamp', cats: ['lights', 'living', 'decor'], name: 'โคมไฟตั้งพื้น', size: 'ø40 ซม.', price: 2490, colors: ['#f3ead8', '#2b2b2b', '#c58f4e'], light: { kind: 'point', lm: 800, at: [0, 1.5, 0] },
    build(c, g) {
      const mt = MAT.brushed();
      lathe(g, [[0, 0], [0.16, 0], [0.16, 0.015], [0.03, 0.03], [0, 0.03]], mt, 0, 0, 0, 48); cy(g, 0.01, 0.01, 1.45, mt, 0, 0.75, 0, 12);
      noShadow(lathe(g, [[0.21, 0], [0.13, 0.3]], MAT.glow(c, 0.45), 0, 1.4, 0, 64));
    } },
  /* ---------------- bedroom ---------------- */
  { id: 'bed', cats: ['bedroom'], name: 'เตียง 5 ฟุต', size: '160×200 ซม.', price: 12900, colors: ['#9aa7b0', '#c9a27a', '#8e9e86', '#e6dfd3'],
    build(c, g) {
      const fr = MAT.fabric('#8d8479'), wh = MAT.fabric('#f4f2ee'), bl = MAT.fabric(c);
      rb(g, 1.7, 0.3, 2.1, 0.04, fr, 0, 0.2, 0); rb(g, 1.6, 0.24, 2, 0.06, wh, 0, 0.47, 0); rb(g, 1.66, 0.08, 1.4, 0.04, bl, 0, 0.6, 0.33);
      rb(g, 1.7, 1, 0.1, 0.05, fr, 0, 0.6, -1.02);
      for (const x of [-0.4, 0.4]) rb(g, 0.62, 0.15, 0.4, 0.07, wh, x, 0.66, -0.74).rotation.x = -0.25;
    } },
  { id: 'bed6', cats: ['bedroom'], name: 'เตียง 6 ฟุต', size: '180×200 ซม.', price: 16900, colors: ['#e6dfd3', '#9aa7b0', '#c9a27a', '#8e9e86'],
    build(c, g) {
      const fr = MAT.wood('#a47a52'), wh = MAT.fabric('#f4f2ee'), bl = MAT.fabric(c);
      rb(g, 1.9, 0.28, 2.1, 0.02, fr, 0, 0.2, 0); rb(g, 1.8, 0.26, 2, 0.06, wh, 0, 0.47, 0); rb(g, 1.86, 0.08, 1.35, 0.04, bl, 0, 0.61, 0.35);
      rb(g, 1.9, 0.9, 0.06, 0.01, fr, 0, 0.6, -1.03); rb(g, 1.86, 0.06, 0.4, 0.03, MAT.fabric(shade(c, -0.12)), 0, 0.66, 0.85);
      for (const x of [-0.45, 0.45]) rb(g, 0.7, 0.16, 0.42, 0.07, wh, x, 0.67, -0.74).rotation.x = -0.25;
    } },
  { id: 'singlebed', cats: ['bedroom'], name: 'เตียงเดี่ยว 3.5 ฟุต', size: '105×200 ซม.', price: 6900, colors: ['#c9bba6', '#9aa7b0', '#d8b4a0', '#8e9e86'],
    build(c, g) {
      const fr = MAT.wood('#e9e2d6'), wh = MAT.fabric('#f4f2ee');
      rb(g, 1.1, 0.28, 2.05, 0.02, fr, 0, 0.19, 0); rb(g, 1.05, 0.22, 2, 0.06, wh, 0, 0.44, 0); rb(g, 1.09, 0.07, 1.4, 0.035, MAT.fabric(c), 0, 0.565, 0.3);
      rb(g, 1.1, 0.8, 0.05, 0.01, fr, 0, 0.55, -1.02); rb(g, 0.6, 0.14, 0.38, 0.07, wh, 0, 0.62, -0.74).rotation.x = -0.25;
    } },
  { id: 'nightstand', cats: ['bedroom'], name: 'ตู้ข้างเตียง + โคมไฟ', size: '45×40 ซม.', price: 3290, colors: WOOD, light: { kind: 'point', lm: 250, at: [0.08, 0.84, -0.05] },
    build(c, g) {
      rb(g, 0.45, 0.48, 0.4, 0.01, MAT.wood(c), 0, 0.3, 0); rb(g, 0.43, 0.003, 0.01, 0.001, MAT.matte('#1d1b19'), 0, 0.38, 0.201);
      rb(g, 0.12, 0.012, 0.015, 0.005, MAT.brushed('#c9a45c'), 0, 0.45, 0.21);
      for (const x of [-0.19, 0.19]) for (const z of [-0.16, 0.16]) cy(g, 0.012, 0.01, 0.06, MAT.brushed(), x, 0.03, z, 12);
      lathe(g, [[0, 0], [0.06, 0], [0.07, 0.08], [0.05, 0.2], [0.015, 0.24], [0, 0.24]], MAT.ceramic('#d8d2c8'), 0.08, 0.54, -0.05, 40);
      noShadow(lathe(g, [[0.11, 0], [0.08, 0.16]], MAT.glow('#f3ead8', 0.5), 0.08, 0.76, -0.05, 48));
    } },
  { id: 'wardrobe', cats: ['bedroom'], name: 'ตู้เสื้อผ้า', size: '120×60 ซม.', price: 7900, colors: CABINET,
    build(c, g) {
      rb(g, 1.2, 1.95, 0.6, 0.01, MAT.wood(c), 0, 1.03, 0); rb(g, 1.16, 0.06, 0.56, 0.005, MAT.matte('#2b2b2b'), 0, 0.03, 0);
      rb(g, 0.004, 1.88, 0.01, 0.001, MAT.matte('#1d1b19'), 0, 1.03, 0.302);
      for (const x of [-0.04, 0.04]) rb(g, 0.015, 0.5, 0.02, 0.006, MAT.brushed('#c9a45c'), x, 1.1, 0.315);
    } },
  { id: 'wardrobe2', cats: ['bedroom'], name: 'ตู้เสื้อผ้าบานเลื่อน', size: '200×60 ซม.', price: 14900, colors: CABINET,
    build(c, g) {
      rb(g, 2, 2.2, 0.6, 0.01, MAT.wood(c), 0, 1.13, 0); rb(g, 1.96, 0.06, 0.56, 0.005, MAT.matte('#2b2b2b'), 0, 0.03, 0);
      rb(g, 0.99, 2.08, 0.02, 0.004, MAT.mirror(), -0.5, 1.13, 0.31); rb(g, 0.99, 2.08, 0.02, 0.004, MAT.wood(shade(c, -0.05)), 0.5, 1.13, 0.33);
    } },
  { id: 'dresser', cats: ['bedroom'], name: 'โต๊ะเครื่องแป้ง', size: '90×45 ซม.', price: 4990, colors: WOOD,
    build(c, g) {
      const m = MAT.wood(c);
      rb(g, 0.9, 0.03, 0.45, 0.008, m, 0, 0.75, 0); rb(g, 0.86, 0.14, 0.42, 0.008, m, 0, 0.66, 0);
      for (const x of [-0.42, 0.42]) for (const z of [-0.19, 0.19]) cy(g, 0.018, 0.012, 0.6, m, x, 0.3, z, 12);
      const mir = cy(g, 0.3, 0.3, 0.015, MAT.mirror(), 0, 1.25, -0.2, 64); mir.rotation.x = Math.PI / 2; mir.scale.z = 1.3;
      const fr = cy(g, 0.315, 0.315, 0.012, m, 0, 1.25, -0.21, 64); fr.rotation.x = Math.PI / 2; fr.scale.z = 1.3;
      cy(g, 0.18, 0.18, 0.06, MAT.fabric('#e6dfd3'), 0, 0.45, 0.35, 32); cy(g, 0.02, 0.02, 0.42, MAT.brushed('#c9a45c'), 0, 0.21, 0.35, 12);
    } },
  /* ---------------- kitchen ---------------- */
  { id: 'kbase', cats: ['kitchen'], name: 'ตู้ล่าง + ท็อปหิน', size: '120×60 ซม.', price: 12900, colors: CABINET,
    build(c, g) { baseUnit(g, c, 1.2); } },
  { id: 'ksink', cats: ['kitchen'], name: 'ตู้ซิงค์ + ก๊อก', size: '120×60 ซม.', price: 16900, colors: CABINET,
    build(c, g) {
      baseUnit(g, c, 1.2);
      rb(g, 0.62, 0.006, 0.42, 0.02, MAT.steel(), 0, 0.903, 0.02); rb(g, 0.56, 0.004, 0.36, 0.02, MAT.matte('#3a3c3e'), 0, 0.906, 0.02);
      const ch = MAT.chrome(); cy(g, 0.025, 0.03, 0.02, ch, 0, 0.91, -0.22, 24);
      tube(g, [[0, 0.91, -0.22], [0, 1.25, -0.22], [0, 1.32, -0.12], [0, 1.25, -0.04], [0, 1.15, -0.02]], 0.012, ch);
    } },
  { id: 'kstove', cats: ['kitchen'], name: 'ตู้เตา + เตาไฟฟ้า + เตาอบ', size: '90×60 ซม.', price: 24900, colors: CABINET,
    build(c, g) {
      baseUnit(g, c, 0.9);
      rb(g, 0.6, 0.008, 0.5, 0.004, new THREE.MeshPhysicalMaterial({ color: '#111', roughness: 0.05, clearcoat: 1 }), 0, 0.904, 0.02);
      for (const [x, z, r] of [[-0.14, -0.1, 0.09], [0.14, -0.1, 0.07], [-0.14, 0.13, 0.07], [0.14, 0.13, 0.09]]) {
        const t = add(g, new THREE.TorusGeometry(r, 0.004, 6, 48), MAT.matte('#555'), x, 0.909, z); t.rotation.x = Math.PI / 2;
      }
      rb(g, 0.6, 0.5, 0.01, 0.004, new THREE.MeshPhysicalMaterial({ color: '#141414', roughness: 0.05, clearcoat: 1 }), 0, 0.42, 0.295);
      rb(g, 0.5, 0.015, 0.02, 0.007, MAT.steel(), 0, 0.63, 0.31);
    } },
  { id: 'hood', cats: ['kitchen'], name: 'เครื่องดูดควัน', size: '90 ซม.', price: 8900, colors: ['#c8cbce', '#2b2b2b', '#f1eee8'], mount: 'wall',
    build(c, g) {
      const m = c === '#c8cbce' ? MAT.steel() : MAT.paint(c);
      rb(g, 0.9, 0.06, 0.5, 0.008, m, 0, 1.68, 0.25); rb(g, 0.3, 0.75, 0.25, 0.006, m, 0, 2.08, 0.13);
      rb(g, 0.7, 0.004, 0.36, 0.002, MAT.matte('#555'), 0, 1.648, 0.26);
    } },
  { id: 'kupper', cats: ['kitchen'], name: 'ตู้แขวน', size: '120×35 ซม.', price: 7900, colors: CABINET, mount: 'wall',
    build(c, g) {
      rb(g, 1.2, 0.7, 0.35, 0.008, MAT.wood(c), 0, 1.85, 0.175);
      rb(g, 0.004, 0.66, 0.01, 0.001, MAT.matte('#1d1b19'), 0, 1.85, 0.351);
      rb(g, 1.16, 0.012, 0.02, 0.005, MAT.brushed(), 0, 1.52, 0.36);
    } },
  { id: 'fridge', cats: ['kitchen'], name: 'ตู้เย็น 2 ประตู', size: '70×70 ซม.', price: 18900, colors: ['#c8cbce', '#2b2b2b', '#f4f4f2'],
    build(c, g) {
      const m = c === '#c8cbce' ? MAT.steel() : MAT.paint(c);
      rb(g, 0.7, 1.8, 0.7, 0.03, m, 0, 0.9, 0); rb(g, 0.68, 0.006, 0.01, 0.002, MAT.matte('#222'), 0, 1.2, 0.351);
      for (const y of [0.85, 1.45]) rb(g, 0.02, 0.4, 0.03, 0.01, MAT.brushed('#999'), -0.28, y, 0.37);
    } },
  { id: 'island', cats: ['kitchen', 'dining'], name: 'เกาะกลางครัว', size: '180×90 ซม.', price: 29900, colors: CABINET,
    build(c, g) {
      rb(g, 1.7, 0.86, 0.8, 0.008, MAT.wood(c), 0, 0.43, 0);
      const s = MAT.stone('#ecebe6');
      rb(g, 1.84, 0.05, 0.92, 0.006, s, 0, 0.885, 0); rb(g, 0.05, 0.86, 0.92, 0.006, s, -0.895, 0.43, 0); rb(g, 0.05, 0.86, 0.92, 0.006, s, 0.895, 0.43, 0);
    } },
  { id: 'barstool', cats: ['kitchen', 'dining'], name: 'เก้าอี้บาร์', size: 'ø38 ซม.', price: 1990, colors: ['#3e3a37', '#c9a27a', '#8a5a45', '#5f6b6e'],
    build(c, g) {
      cy(g, 0.19, 0.18, 0.06, MAT.leather(c), 0, 0.68, 0, 40);
      for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; const l = cy(g, 0.012, 0.012, 0.68, MAT.brushed(), Math.cos(a) * 0.15, 0.33, Math.sin(a) * 0.15, 10); l.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12); }
      const ring = add(g, new THREE.TorusGeometry(0.17, 0.008, 8, 40), MAT.brushed(), 0, 0.25, 0); ring.rotation.x = Math.PI / 2;
    } },
  /* ---------------- dining ---------------- */
  { id: 'dining', cats: ['dining'], name: 'โต๊ะกินข้าว 6 ที่', size: '160×90 ซม.', price: 6900, colors: WOOD,
    build(c, g) { const m = MAT.wood(c); rb(g, 1.6, 0.04, 0.9, 0.01, m, 0, 0.75, 0); for (const x of [-0.72, 0.72]) for (const z of [-0.36, 0.36]) cy(g, 0.03, 0.02, 0.73, m, x, 0.365, z, 16); } },
  { id: 'roundtable', cats: ['dining'], name: 'โต๊ะกลม 4 ที่', size: 'ø110 ซม.', price: 5490, colors: ['#e9e2d6', '#c9a27a', '#2b2b2b'],
    build(c, g) { cy(g, 0.55, 0.55, 0.035, MAT.wood(c), 0, 0.75, 0, 96); lathe(g, [[0.3, 0], [0.3, 0.02], [0.06, 0.08], [0.05, 0.6], [0.12, 0.74], [0, 0.74]], MAT.wood(c), 0, 0, 0, 48); } },
  { id: 'chair', cats: ['dining', 'office'], name: 'เก้าอี้ไม้', size: '45×50 ซม.', price: 1490, colors: ['#c9a27a', '#2b2b2b', '#e9e2d6', '#7b8c6a'],
    build(c, g) {
      const m = MAT.wood(c); rb(g, 0.45, 0.04, 0.45, 0.012, m, 0, 0.45, 0); rb(g, 0.43, 0.24, 0.025, 0.01, m, 0, 0.75, -0.205).rotation.x = -0.08;
      for (const x of [-0.19, 0.19]) for (const z of [-0.19, 0.19]) cy(g, 0.016, 0.013, 0.45, m, x, 0.225, z, 12);
      for (const x of [-0.19, 0.19]) cy(g, 0.013, 0.013, 0.42, m, x, 0.65, -0.2, 12);
    } },
  { id: 'sideboard', cats: ['dining', 'living'], name: 'ตู้ไซด์บอร์ด', size: '160×45 ซม.', price: 9900, colors: WOOD,
    build(c, g) {
      const m = MAT.wood(c); rb(g, 1.6, 0.6, 0.45, 0.01, m, 0, 0.5, 0);
      for (const x of [-0.4, 0, 0.4]) rb(g, 0.003, 0.56, 0.01, 0.001, MAT.matte('#1d1b19'), x, 0.5, 0.226);
      for (const x of [-0.72, 0.72]) for (const z of [-0.17, 0.17]) cy(g, 0.015, 0.01, 0.2, MAT.brushed('#c9a45c'), x, 0.1, z, 12);
      lathe(g, [[0, 0], [0.07, 0], [0.09, 0.08], [0.05, 0.22], [0.04, 0.3], [0, 0.3]], MAT.ceramic('#c9bba6'), 0.5, 0.8, 0, 40);
    } },
  { id: 'pendant', cats: ['lights', 'dining', 'kitchen', 'decor'], name: 'โคมไฟห้อย', size: 'ø40 ซม.', price: 2290, colors: ['#2b2b2b', '#c9a45c', '#f1eee8'], light: { kind: 'point', lm: 900, at: [0, 1.6, 0] },
    build(c, g) {
      cy(g, 0.004, 0.004, 0.6, MAT.matte('#111'), 0, 2.15, 0, 6);
      lathe(g, [[0.02, 0.22], [0.08, 0.2], [0.17, 0.08], [0.2, 0], [0.195, 0], [0.165, 0.075], [0.075, 0.19], [0.015, 0.21]], new THREE.MeshStandardMaterial({ color: c, metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide }), 0, 1.63, 0, 48);
      noShadow(sphere(g, 0.05, MAT.glow('#fff1d6', 1.4), 0, 1.66, 0, 2));
    } },
  /* ---------------- bathroom ---------------- */
  { id: 'toilet', cats: ['bath'], name: 'ชักโครก', size: '38×70 ซม.', price: 4500, colors: CERAMIC,
    build(c, g) {
      const m = MAT.ceramic(c);
      lathe(g, [[0, 0], [0.14, 0], [0.15, 0.04], [0.155, 0.18], [0.19, 0.3], [0.205, 0.37], [0.2, 0.395], [0.18, 0.402], [0.15, 0.385], [0.09, 0.31], [0, 0.28]], m, 0, 0, 0.06).scale.z = 1.28;
      const seat = add(g, new THREE.TorusGeometry(0.168, 0.024, 16, 64), m, 0, 0.41, 0.06); seat.rotation.x = Math.PI / 2; seat.scale.set(1, 1.28, 1);
      cy(g, 0.192, 0.192, 0.018, m, 0, 0.432, 0.06, 64).scale.z = 1.28;
      rb(g, 0.42, 0.38, 0.17, 0.035, m, 0, 0.6, -0.26); rb(g, 0.44, 0.03, 0.19, 0.012, m, 0, 0.805, -0.26); cy(g, 0.03, 0.03, 0.01, MAT.chrome(), 0, 0.825, -0.26, 32);
    } },
  { id: 'vanity', cats: ['bath'], name: 'อ่างล้างหน้า + ตู้', size: '80×48 ซม.', price: 8900, colors: WOOD,
    build(c, g) {
      rb(g, 0.8, 0.46, 0.46, 0.012, MAT.wood(c), 0, 0.56, 0); rb(g, 0.78, 0.004, 0.01, 0.001, MAT.matte('#1d1b19'), 0, 0.56, 0.231); rb(g, 0.5, 0.014, 0.02, 0.006, MAT.brushed(), 0, 0.76, 0.24);
      rb(g, 0.8, 0.035, 0.48, 0.008, MAT.ceramic('#efede8'), 0, 0.808, 0.01);
      lathe(g, [[0, 0], [0.1, 0], [0.17, 0.02], [0.21, 0.07], [0.22, 0.13], [0.214, 0.136], [0.2, 0.085], [0.16, 0.04], [0, 0.03]], MAT.ceramic('#f7f7f5'), 0, 0.826, 0.04).scale.x = 1.15;
      const ch = MAT.chrome(); cy(g, 0.025, 0.03, 0.02, ch, 0, 0.835, -0.17, 24);
      tube(g, [[0, 0.84, -0.17], [0, 1.02, -0.17], [0, 1.08, -0.13], [0, 1.07, -0.06], [0, 1.03, -0.04]], 0.011, ch);
    } },
  { id: 'bathtub', cats: ['bath'], name: 'อ่างอาบน้ำตั้งพื้น', size: '170×75 ซม.', price: 24900, colors: CERAMIC,
    build(c, g) {
      lathe(g, [[0, 0], [0.32, 0], [0.37, 0.04], [0.4, 0.3], [0.41, 0.56], [0.405, 0.585], [0.385, 0.585], [0.37, 0.55], [0.355, 0.3], [0.31, 0.1], [0, 0.08]], MAT.ceramic(c), 0, 0, 0, 80).scale.set(2.1, 1, 0.92);
      const ch = MAT.chrome(); tube(g, [[-0.98, 0, 0], [-0.98, 0.85, 0], [-0.98, 0.95, 0.06], [-0.9, 0.97, 0.04], [-0.82, 0.9, 0]], 0.014, ch); cy(g, 0.06, 0.06, 0.01, ch, -0.98, 0.005, 0, 24);
    } },
  { id: 'shower', cats: ['bath'], name: 'ฝักบัว Rain + ฉากกระจก', size: '90×90 ซม.', price: 18900, colors: ['#eef0f2', '#2b2b2b', '#c9a45c'],
    build(c, g) {
      const fr = c === '#eef0f2' ? MAT.chrome() : MAT.brushed(c);
      noShadow(rb(g, 0.9, 0.05, 0.9, 0.01, MAT.ceramic('#f7f7f5'), 0, 0.025, 0)); noShadow(rb(g, 0.6, 0.006, 0.06, 0.003, MAT.brushed('#3a3a3a'), 0.1, 0.052, -0.38));
      noShadow(rb(g, 0.9, 1.95, 0.008, 0.003, MAT.glass(), 0, 1.02, 0.445)); noShadow(rb(g, 0.008, 1.95, 0.9, 0.003, MAT.glass(), -0.445, 1.02, 0));
      rb(g, 0.9, 0.02, 0.02, 0.004, fr, 0, 2.0, 0.445); rb(g, 0.02, 0.02, 0.9, 0.004, fr, -0.445, 2.0, 0); rb(g, 0.02, 1.95, 0.02, 0.004, fr, -0.445, 1.02, 0.445);
      cy(g, 0.012, 0.012, 1.95, fr, 0.38, 1.02, -0.42, 16); rb(g, 0.012, 0.012, 0.2, 0.004, fr, 0.38, 1.98, -0.33);
      noShadow(rb(g, 0.25, 0.012, 0.25, 0.006, fr, 0.38, 1.96, -0.25)); rb(g, 0.08, 0.14, 0.04, 0.01, fr, 0.38, 1.05, -0.41);
    } },
  { id: 'mirror', cats: ['bath', 'bedroom', 'decor'], name: 'กระจกทรงกลม', size: 'ø66 ซม.', price: 2490, colors: ['#2b2b2b', '#c9a27a', '#c9a45c', '#f4f2ee'], mount: 'wall',
    build(c, g) {
      noShadow(add(g, new THREE.TorusGeometry(0.322, 0.012, 16, 96), MAT.brushed(c), 0, 1.5, 0.012));
      cy(g, 0.32, 0.32, 0.008, MAT.mirror(), 0, 1.5, 0.008, 96).rotation.x = Math.PI / 2;
    } },
  { id: 'towel', cats: ['bath'], name: 'ราวแขวนผ้า + ผ้าขนหนู', size: '60 ซม.', price: 1290, colors: ['#f4f2ee', '#9aa7b0', '#d9b99b', '#8e9e86'], mount: 'wall',
    build(c, g) {
      const ch = MAT.chrome(); for (const y of [1.1, 0.85]) cy(g, 0.01, 0.01, 0.6, ch, 0, y, 0.06, 16).rotation.z = Math.PI / 2;
      for (const x of [-0.3, 0.3]) rb(g, 0.03, 0.3, 0.03, 0.01, ch, x, 0.975, 0.015);
      const tm = MAT.terry(c); rb(g, 0.42, 0.5, 0.03, 0.012, tm, -0.04, 0.86, 0.08); rb(g, 0.42, 0.18, 0.03, 0.012, tm, -0.04, 1.03, 0.045);
    } },
  { id: 'heater', cats: ['bath'], name: 'เครื่องทำน้ำอุ่น', size: '22×34 ซม.', price: 3990, colors: ['#f4f4f2', '#2b2b2b'], mount: 'wall',
    build(c, g) { rb(g, 0.22, 0.34, 0.09, 0.02, MAT.paint(c), 0, 1.55, 0.045); rb(g, 0.1, 0.05, 0.005, 0.004, MAT.screen(), 0, 1.62, 0.092); cy(g, 0.012, 0.012, 0.4, MAT.chrome(), 0.05, 1.18, 0.05, 12); } },
  { id: 'washer', cats: ['bath', 'kitchen'], name: 'เครื่องซักผ้าฝาหน้า', size: '60×60 ซม.', price: 12900, colors: ['#f4f4f2', '#2b2b2b', '#9aa3a8'],
    build(c, g) {
      rb(g, 0.6, 0.85, 0.58, 0.03, MAT.paint(c), 0, 0.425, 0); add(g, new THREE.TorusGeometry(0.2, 0.025, 20, 64), MAT.chrome(), 0, 0.42, 0.295);
      noShadow(add(g, new THREE.CircleGeometry(0.19, 64), new THREE.MeshPhysicalMaterial({ color: '#1f2a30', roughness: 0.05, clearcoat: 1 }), 0, 0.42, 0.3));
      rb(g, 0.56, 0.1, 0.01, 0.004, MAT.paint(shade(c, -0.06)), 0, 0.78, 0.291); cy(g, 0.03, 0.03, 0.02, MAT.chrome(), 0.18, 0.78, 0.3, 32).rotation.x = Math.PI / 2;
    } },
  { id: 'basket', cats: ['bath'], name: 'ตะกร้าผ้าสาน', size: 'ø40 ซม.', price: 590, colors: ['#c9a77c', '#e9e2d6', '#5b4130'],
    build(c, g) { lathe(g, [[0, 0], [0.17, 0], [0.19, 0.3], [0.2, 0.55], [0.19, 0.55], [0.18, 0.3], [0.16, 0.02], [0, 0.02]], MAT.fabric(c), 0, 0, 0, 40); } },
  { id: 'bathmat', cats: ['bath'], name: 'พรมเช็ดเท้า', size: '60×40 ซม.', price: 390, colors: ['#f4f2ee', '#9aa7b0', '#d9b99b', '#4a4440'],
    build(c, g) { noShadow(rb(g, 0.6, 0.018, 0.4, 0.008, MAT.terry(c), 0, 0.009, 0)); } },
  /* ---------------- office ---------------- */
  { id: 'desk', cats: ['office', 'bedroom'], name: 'โต๊ะทำงาน + จอ', size: '120×60 ซม.', price: 3490, colors: ['#c9a27a', '#e9e2d6', '#2b2b2b'],
    build(c, g) {
      rb(g, 1.2, 0.03, 0.6, 0.008, MAT.wood(c), 0, 0.74, 0); for (const x of [-0.56, 0.56]) for (const z of [-0.26, 0.26]) rb(g, 0.035, 0.72, 0.035, 0.008, MAT.brushed(), x, 0.36, z);
      rb(g, 0.2, 0.012, 0.15, 0.004, MAT.brushed(), 0, 0.76, -0.17); rb(g, 0.04, 0.2, 0.03, 0.01, MAT.brushed(), 0, 0.86, -0.18); rb(g, 0.62, 0.37, 0.025, 0.005, MAT.matte('#121212'), 0, 1.06, -0.16);
      add(g, new THREE.PlaneGeometry(0.6, 0.34), MAT.screen(), 0, 1.06, -0.146); rb(g, 0.42, 0.015, 0.14, 0.005, MAT.matte('#d9d9d9'), 0, 0.76, 0.1);
      lathe(g, [[0, 0], [0.04, 0], [0.04, 0.09], [0.037, 0.09], [0.037, 0.006], [0, 0.006]], MAT.ceramic('#f4f2ee'), 0.4, 0.755, 0.05, 32);
    } },
  { id: 'officechair', cats: ['office'], name: 'เก้าอี้สำนักงาน', size: '60×60 ซม.', price: 3990, colors: ['#2b2b2b', '#5f6b6e', '#8d8479'],
    build(c, g) {
      rb(g, 0.5, 0.08, 0.48, 0.03, MAT.fabric(c), 0, 0.48, 0); rb(g, 0.46, 0.6, 0.06, 0.03, MAT.fabric(c), 0, 0.86, -0.24).rotation.x = -0.12;
      cy(g, 0.025, 0.025, 0.3, MAT.chrome(), 0, 0.3, 0, 16);
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const l = rb(g, 0.3, 0.025, 0.04, 0.01, MAT.matte('#222'), Math.cos(a) * 0.15, 0.08, Math.sin(a) * 0.15); l.rotation.y = -a; sphere(g, 0.025, MAT.matte('#111'), Math.cos(a) * 0.29, 0.03, Math.sin(a) * 0.29); }
      for (const x of [-0.27, 0.27]) rb(g, 0.04, 0.03, 0.26, 0.01, MAT.matte('#222'), x, 0.66, 0.02);
    } },
  /* ---------------- doors & windows ---------------- */
  { id: 'door', cats: ['doors'], name: 'ประตูบานเปิด', size: '90×210 ซม.', price: 5900, colors: ['#f1eee8', '#a47a52', '#5b4130', '#2b2b2b'], mount: 'wall', opening: { w: 0.96, y0: 0, y1: 2.13, door: true },
    build(c, g) {
      const fr = MAT.wood(c === '#2b2b2b' ? '#2b2b2b' : '#f1eee8'), leaf = MAT.wood(c);
      for (const x of [-0.45, 0.45]) rb(g, 0.06, 2.1, 0.14, 0.004, fr, x, 1.05, 0); rb(g, 0.96, 0.06, 0.14, 0.004, fr, 0, 2.1, 0);
      // leaf hangs on a hinge at the left jamb so it can swing open
      const h = hinge(g, -0.42, 1);
      rb(h, 0.84, 2.04, 0.04, 0.004, leaf, 0.42, 1.02, 0);
      for (const z of [-0.03, 0.03]) { rb(h, 0.12, 0.018, 0.02, 0.008, MAT.brushed(), 0.72, 1.0, z * 1.6); cy(h, 0.025, 0.025, 0.02, MAT.brushed(), 0.78, 1.0, z, 20).rotation.x = Math.PI / 2; }
    } },
  { id: 'slidingdoor', cats: ['doors'], name: 'ประตูกระจกบานเลื่อน', size: '180×220 ซม.', price: 14900, colors: ['#2b2b2b', '#c8cbce', '#f1eee8'], mount: 'wall', opening: { w: 1.9, y0: 0, y1: 2.225, door: true },
    build(c, g) {
      const al = MAT.brushed(c);
      for (const x of [-0.9, 0.9]) rb(g, 0.05, 2.2, 0.12, 0.004, al, x, 1.1, 0); rb(g, 1.85, 0.05, 0.12, 0.004, al, 0, 2.2, 0); rb(g, 1.85, 0.03, 0.12, 0.004, al, 0, 0.015, 0);
      for (const [x, z] of [[-0.43, -0.025], [0.43, 0.025]]) {
        noShadow(rb(g, 0.86, 2.12, 0.012, 0.002, MAT.window(), x, 1.1, z));
        for (const xx of [x - 0.42, x + 0.42]) rb(g, 0.035, 2.14, 0.035, 0.004, al, xx, 1.1, z);
      }
    } },
  { id: 'window', cats: ['doors'], name: 'หน้าต่างบานเลื่อน', size: '120×120 ซม.', price: 6900, colors: ['#2b2b2b', '#c8cbce', '#f1eee8'], mount: 'wall', opening: { w: 1.25, y0: 0.875, y1: 2.125 },
    build(c, g) {
      const al = MAT.brushed(c);
      for (const x of [-0.6, 0.6]) rb(g, 0.05, 1.2, 0.12, 0.004, al, x, 1.5, 0); for (const y of [0.9, 2.1]) rb(g, 1.25, 0.05, 0.12, 0.004, al, 0, y, 0);
      rb(g, 0.035, 1.16, 0.12, 0.004, al, 0, 1.5, 0); noShadow(rb(g, 1.16, 1.16, 0.01, 0.002, MAT.window(), 0, 1.5, 0));
      rb(g, 1.35, 0.03, 0.2, 0.006, MAT.stone('#e9e6e0'), 0, 0.875, 0.04);
    } },
  { id: 'frontdoor', cats: ['doors'], name: 'ประตูหน้าบ้านบานคู่', size: '160×240 ซม.', price: 32000, colors: ['#6b4a33', '#a47a52', '#2b2b2b', '#3e4a45'], mount: 'wall', opening: { w: 1.66, y0: 0, y1: 2.43, door: true },
    build(c, g) {
      const fr = MAT.brushed('#2b2b2b'), leaf = MAT.wood(c);
      for (const x of [-0.81, 0.81]) rb(g, 0.05, 2.43, 0.18, 0.004, fr, x, 1.215, 0); rb(g, 1.67, 0.05, 0.18, 0.004, fr, 0, 2.405, 0);
      for (const s of [-1, 1]) {
        // each leaf hinges on its outer jamb
        const h = hinge(g, s * 0.785, -s);
        rb(h, 0.77, 2.36, 0.05, 0.004, leaf, -s * 0.39, 1.19, 0);
        // vertical grooves + long pull handle
        for (const k of [0.2, 0.4, 0.6]) rb(h, 0.006, 2.2, 0.012, 0.001, MAT.matte('#1d1b19'), -s * k * 0.77, 1.19, 0.027);
        rb(h, 0.025, 1.1, 0.025, 0.01, MAT.brushed('#c9a45c'), -s * 0.725, 1.15, 0.07);
        rb(h, 0.025, 1.1, 0.025, 0.01, MAT.brushed('#c9a45c'), -s * 0.725, 1.15, -0.07);
      }
    } },
  { id: 'archway', cats: ['doors'], name: 'ช่องเปิดโล่ง (ไม่มีบาน)', size: '200×240 ซม.', price: 4500, colors: ['#f1eee8', '#a47a52', '#2b2b2b'], mount: 'wall', opening: { w: 2.0, y0: 0, y1: 2.4, door: true },
    build(c, g) {
      const m = MAT.wood(c);
      for (const x of [-1.0, 1.0]) rb(g, 0.03, 2.4, 0.12, 0.004, m, x, 1.2, 0);
      rb(g, 2.03, 0.03, 0.12, 0.004, m, 0, 2.4, 0);
    } },
  { id: 'bigwindow', cats: ['doors'], name: 'หน้าต่างกระจกบานใหญ่', size: '200×180 ซม.', price: 13900, colors: ['#2b2b2b', '#c8cbce', '#f1eee8'], mount: 'wall', opening: { w: 2.05, y0: 0.5, y1: 2.35 },
    build(c, g) {
      const al = MAT.brushed(c);
      for (const x of [-1.0, 1.0]) rb(g, 0.05, 1.85, 0.12, 0.004, al, x, 1.425, 0); for (const y of [0.525, 2.325]) rb(g, 2.05, 0.05, 0.12, 0.004, al, 0, y, 0);
      for (const x of [-0.33, 0.33]) rb(g, 0.035, 1.8, 0.12, 0.004, al, x, 1.425, 0);
      noShadow(rb(g, 1.98, 1.78, 0.01, 0.002, MAT.window(), 0, 1.425, 0));
      rb(g, 2.15, 0.03, 0.22, 0.006, MAT.stone('#e9e6e0'), 0, 0.5, 0.05);
    } },
  { id: 'stair', cats: ['doors', 'living'], name: 'บันไดขึ้นชั้นบน', size: '100×400 ซม.', price: 85000, colors: ['#a47a52', '#e9e6e0', '#5b4130', '#2b2b2b'], stair: { w: 1.0, len: 4.0 },
    build(c, g) {
      const n = 16, rise = 3.0 / n, go = 4.0 / n, base = MAT.matte('#d9d4cc'), tread = c === '#e9e6e0' ? MAT.stone(c) : MAT.wood(c);
      for (let i = 0; i < n; i++) {
        const z = 2.0 - (i + 0.5) * go, top = (i + 1) * rise;
        rb(g, 1.0, top - 0.03, go, 0.002, base, 0, (top - 0.03) / 2, z);
        rb(g, 1.0, 0.03, go + 0.02, 0.004, tread, 0, top - 0.015, z - 0.01);
      }
      // glass balustrade with a steel handrail on the open side
      const slope = Math.atan2(3.0, 4.0), len = Math.hypot(3.0, 4.0);
      const glass = noShadow(rb(g, 0.012, 0.9, len, 0.002, MAT.glass(), 0.49, 1.5 + 0.45, 0));
      glass.rotation.x = slope;
      const rail = cy(g, 0.022, 0.022, len, MAT.steel(), 0.49, 1.5 + 0.95, 0, 16);
      rail.rotation.x = Math.PI / 2 + slope;
    } },
  /* ---------------- lighting ---------------- */
  { id: 'downlight', cats: ['lights'], name: 'ดาวน์ไลท์ฝังฝ้า', size: 'ø12 ซม. · 9W', price: 390, colors: ['#f4f2ee', '#2b2b2b', '#c9a45c'], mount: 'ceiling', light: { kind: 'spot', lm: 750, at: [0, 2.66, 0], angle: 0.6 },
    build(c, g) {
      cy(g, 0.065, 0.065, 0.012, MAT.matte(c), 0, 2.694, 0, 32);
      noShadow(cy(g, 0.045, 0.045, 0.004, MAT.glow('#fff4e0', 2.2), 0, 2.686, 0, 32));
    } },
  { id: 'ceilinglamp', cats: ['lights', 'bedroom', 'living'], name: 'โคมไฟเพดาน LED', size: 'ø50 ซม. · 24W', price: 1590, colors: ['#f4f2ee', '#c9a27a', '#2b2b2b'], mount: 'ceiling', light: { kind: 'point', lm: 2000, at: [0, 2.52, 0] },
    build(c, g) {
      cy(g, 0.25, 0.25, 0.03, MAT.wood(c), 0, 2.685, 0, 48);
      noShadow(lathe(g, [[0, 0], [0.23, 0], [0.23, 0.03], [0.2, 0.07], [0, 0.08]], MAT.glow('#fff3df', 1.1), 0, 2.59, 0, 48)).rotation.x = Math.PI;
    } },
  { id: 'walllight', cats: ['lights', 'outdoor', 'living'], name: 'โคมไฟผนัง Up-Down', size: '10×20 ซม. · 6W', price: 890, colors: ['#2b2b2b', '#c9a45c', '#f4f2ee'], mount: 'wall', light: { kind: 'point', lm: 450, at: [0, 1.85, 0.16] },
    build(c, g) {
      rb(g, 0.1, 0.2, 0.1, 0.01, MAT.brushed(c), 0, 1.85, 0.06);
      for (const y of [1.745, 1.955]) noShadow(cy(g, 0.035, 0.035, 0.006, MAT.glow('#fff0d6', 2.5), 0, y, 0.06, 24));
    } },
  { id: 'trackspot', cats: ['lights', 'living', 'decor'], name: 'ไฟส่องเฉพาะจุด (Track)', size: '100 ซม. · 3 หัว', price: 2490, colors: ['#2b2b2b', '#f4f2ee'], mount: 'ceiling', light: { kind: 'spot', lm: 1200, at: [0, 2.5, 0.2], angle: 0.4, aim: [0, 0.6, 1.4] },
    build(c, g) {
      rb(g, 1, 0.03, 0.04, 0.01, MAT.brushed(c), 0, 2.685, 0);
      for (const x of [-0.35, 0, 0.35]) {
        const h = cy(g, 0.035, 0.03, 0.12, MAT.brushed(c), x, 2.58, 0.05, 20);
        h.rotation.x = 0.5;
        noShadow(cy(g, 0.025, 0.025, 0.004, MAT.glow('#fff4e0', 2), x, 2.52, 0.08, 20)).rotation.x = 0.5;
      }
    } },
  { id: 'gardenlight', cats: ['lights', 'outdoor'], name: 'ไฟสนามทรงเสา', size: 'สูง 60 ซม. · 5W', price: 1190, colors: ['#2b2b2b', '#7d8186'], light: { kind: 'point', lm: 300, at: [0, 0.55, 0] },
    build(c, g) {
      cy(g, 0.05, 0.06, 0.5, MAT.brushed(c), 0, 0.25, 0, 20);
      noShadow(cy(g, 0.045, 0.045, 0.08, MAT.glow('#fff0d6', 1.6), 0, 0.54, 0, 20));
      cy(g, 0.07, 0.07, 0.03, MAT.brushed(c), 0, 0.6, 0, 20);
    } },
  { id: 'curtain', cats: ['doors', 'decor'], name: 'ผ้าม่าน', size: '170×240 ซม.', price: 3490, colors: ['#e6dfd3', '#c9bba6', '#8d8479', '#5f6b6e'], mount: 'wall',
    build(c, g) {
      const m = MAT.fabric(c); for (let i = 0; i < 12; i++) rb(g, 0.15, 2.36, 0.035, 0.015, m, -0.78 + i * 0.142, 1.2, 0.09 + (i % 2 ? 0.03 : 0));
      cy(g, 0.012, 0.012, 1.8, MAT.brushed(), 0, 2.42, 0.1, 12).rotation.z = Math.PI / 2;
    } },
  /* ---------------- decor ---------------- */
  { id: 'plant', cats: ['decor', 'bath', 'living'], name: 'ต้นลิ้นมังกร', size: 'ø30 ซม.', price: 690, colors: ['#d8d2c8', '#b7643f', '#2b2b2b', '#f4f2ee'],
    build(c, g) {
      const r = rng(5);
      lathe(g, [[0, 0], [0.11, 0], [0.15, 0.05], [0.16, 0.3], [0.15, 0.32], [0.14, 0.31], [0, 0.29]], new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.55, clearcoat: 0.3 }), 0, 0, 0, 48);
      const greens = ['#2f5a32', '#3f6b3a', '#4b7a40'];
      for (let i = 0; i < 14; i++) {
        const hgt = 0.45 + r() * 0.5, wid = 0.05 + r() * 0.03, s = new THREE.Shape();
        s.moveTo(-wid / 2, 0); s.quadraticCurveTo(-wid * 0.75, hgt * 0.55, 0, hgt); s.quadraticCurveTo(wid * 0.75, hgt * 0.55, wid / 2, 0); s.lineTo(-wid / 2, 0);
        const lf = add(g, new THREE.ShapeGeometry(s, 8), MAT.leaf(greens[i % 3]), (r() - 0.5) * 0.14, 0.3, (r() - 0.5) * 0.14);
        lf.rotation.set((r() - 0.5) * 0.35, r() * Math.PI, (r() - 0.5) * 0.35);
      }
    } },
  { id: 'fiddle', cats: ['decor', 'living'], name: 'ต้นไทรใบสัก', size: 'ø45 ซม.', price: 1490, colors: ['#f4f2ee', '#2b2b2b', '#c9a77c'],
    build(c, g) {
      const r = rng(12);
      lathe(g, [[0, 0], [0.16, 0], [0.2, 0.36], [0.19, 0.37], [0, 0.35]], MAT.matte(c), 0, 0, 0, 40); cy(g, 0.02, 0.03, 1.1, MAT.wood('#6b4a33'), 0, 0.9, 0, 10);
      const greens = ['#2f5a32', '#3a6a35', '#477a3e'];
      for (let i = 0; i < 26; i++) {
        const s = new THREE.Shape(), L = 0.22 + r() * 0.1, W = 0.14 + r() * 0.05;
        s.moveTo(0, 0); s.bezierCurveTo(W / 2, L * 0.2, W / 2, L * 0.9, 0, L); s.bezierCurveTo(-W / 2, L * 0.9, -W / 2, L * 0.2, 0, 0);
        const y = 0.9 + r() * 0.8, a = r() * Math.PI * 2, lf = add(g, new THREE.ShapeGeometry(s, 6), MAT.leaf(greens[i % 3]), Math.cos(a) * 0.08, y, Math.sin(a) * 0.08);
        lf.rotation.set(-0.6 - r() * 0.6, a, 0);
      }
    } },
  { id: 'art', cats: ['decor', 'living', 'bedroom'], name: 'ภาพแขวนผนัง', size: '80×60 ซม.', price: 1890, colors: ['#2b2b2b', '#c9a27a', '#f4f2ee'], mount: 'wall',
    build(c, g) { rb(g, 0.84, 0.64, 0.03, 0.004, MAT.wood(c), 0, 1.5, 0.015); add(g, new THREE.PlaneGeometry(0.76, 0.56), new THREE.MeshStandardMaterial({ map: art(), roughness: 0.9 }), 0, 1.5, 0.032); } },
  { id: 'vase', cats: ['decor'], name: 'แจกันเซรามิก', size: 'ø20 ซม.', price: 590, colors: ['#c9bba6', '#2f3437', '#b7643f', '#f4f2ee'],
    build(c, g) { lathe(g, [[0, 0], [0.07, 0], [0.1, 0.1], [0.06, 0.3], [0.045, 0.38], [0.055, 0.42], [0, 0.42]], MAT.ceramic(c), 0, 0, 0, 48); } },
  /* ---------------- outdoor ---------------- */
  { id: 'tree', cats: ['outdoor'], name: 'ต้นไม้ใหญ่', size: 'ø250 ซม.', price: 4500, colors: ['#4f7a35', '#3a6a2c', '#7a8f3a'],
    build(c, g) {
      const r = rng(31); cy(g, 0.09, 0.15, 1.8, MAT.wood('#6b4a33'), 0, 0.9, 0, 12);
      const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, flatShading: true });
      for (let i = 0; i < 8; i++) { const a = r() * 6.28, d = 0.2 + r() * 0.6; sphere(g, 0.55 + r() * 0.35, m, Math.cos(a) * d, 2.1 + r() * 0.8, Math.sin(a) * d, 1); }
    } },
  { id: 'shrub', cats: ['outdoor'], name: 'กระบะต้นไม้', size: '120×40 ซม.', price: 2900, colors: ['#9b9790', '#2b2b2b', '#c9a77c'],
    build(c, g) {
      rb(g, 1.2, 0.45, 0.4, 0.01, MAT.matte(c), 0, 0.225, 0); const m = new THREE.MeshStandardMaterial({ color: '#3f6b3a', roughness: 0.85, flatShading: true });
      for (const x of [-0.42, -0.14, 0.14, 0.42]) sphere(g, 0.22, m, x, 0.58, 0, 1);
    } },
  { id: 'outdoorset', cats: ['outdoor'], name: 'ชุดโต๊ะสนาม', size: 'ø140 ซม.', price: 7900, colors: ['#a47a52', '#2b2b2b', '#e9e2d6'],
    build(c, g) {
      const m = MAT.wood(c); cy(g, 0.4, 0.4, 0.03, m, 0, 0.72, 0, 64); cy(g, 0.04, 0.04, 0.7, m, 0, 0.36, 0, 12); cy(g, 0.25, 0.25, 0.02, m, 0, 0.01, 0, 40);
      for (const s of [-1, 1]) {
        const ch = new THREE.Group(); ch.position.set(s * 0.7, 0, 0); ch.rotation.y = s * Math.PI / 2; g.add(ch);
        rb(ch, 0.46, 0.04, 0.46, 0.01, m, 0, 0.44, 0); rb(ch, 0.46, 0.4, 0.03, 0.01, m, 0, 0.7, 0.22).rotation.x = 0.15;
        for (const x of [-0.2, 0.2]) for (const z of [-0.2, 0.2]) rb(ch, 0.035, 0.44, 0.035, 0.008, m, x, 0.22, z);
      }
    } },
  { id: 'lounger', cats: ['outdoor'], name: 'เก้าอี้อาบแดด', size: '70×190 ซม.', price: 5900, colors: ['#e9e2d6', '#5f6b6e', '#c9a27a'],
    build(c, g) {
      const w = MAT.wood('#a47a52'); rb(g, 0.66, 0.06, 1.3, 0.01, w, 0, 0.3, 0.25); for (const x of [-0.3, 0.3]) for (const z of [-0.35, 0.85]) rb(g, 0.05, 0.3, 0.05, 0.01, w, x, 0.15, z);
      rb(g, 0.62, 0.08, 1.25, 0.03, MAT.fabric(c), 0, 0.37, 0.25); const back = rb(g, 0.62, 0.08, 0.7, 0.03, MAT.fabric(c), 0, 0.55, -0.62); back.rotation.x = 0.7;
    } },
  { id: 'car', cats: ['outdoor'], name: 'รถยนต์ (จอดในบ้าน)', size: '180×450 ซม.', price: 0, colors: ['#f4f4f2', '#9aa3a8', '#1e1e1e', '#8a2a2a'],
    build(c, g) {
      const body = new THREE.MeshPhysicalMaterial({ color: c, metalness: 0.6, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 });
      rb(g, 1.8, 0.55, 4.4, 0.18, body, 0, 0.55, 0); rb(g, 1.6, 0.5, 2.3, 0.22, body, 0, 1.0, -0.15);
      noShadow(rb(g, 1.62, 0.36, 2.0, 0.16, new THREE.MeshPhysicalMaterial({ color: '#1b2328', roughness: 0.05, metalness: 0.3, clearcoat: 1 }), 0, 1.05, -0.15));
      for (const x of [-0.82, 0.82]) for (const z of [-1.4, 1.35]) { cy(g, 0.33, 0.33, 0.22, MAT.matte('#151515'), x, 0.33, z, 32).rotation.z = Math.PI / 2; cy(g, 0.2, 0.2, 0.23, MAT.chrome(), x, 0.33, z, 24).rotation.z = Math.PI / 2; }
      for (const x of [-0.6, 0.6]) noShadow(rb(g, 0.3, 0.08, 0.04, 0.02, MAT.glow('#fff6e0', 0.8), x, 0.65, 2.2));
      for (const x of [-0.6, 0.6]) noShadow(rb(g, 0.3, 0.08, 0.04, 0.02, MAT.glow('#c0262c', 0.6), x, 0.7, -2.2));
    } },
];

export const catalogById = new Map(CATALOG.map((c) => [c.id, c]));
