/** Materials and geometry helpers used by the furniture builders. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { sharedTex } from './textures';

const v2 = (n: number) => new THREE.Vector2(n, n);

export const MAT = {
  wood: (c: string) => {
    const t = sharedTex();
    return new THREE.MeshStandardMaterial({ color: c, map: t.wood, normalMap: t.woodN, normalScale: v2(0.35), roughness: 0.55 });
  },
  fabric: (c: string) => {
    const t = sharedTex();
    return new THREE.MeshStandardMaterial({ color: c, map: t.fabric, normalMap: t.fabricN, normalScale: v2(0.8), roughness: 1 });
  },
  terry: (c: string) => {
    const t = sharedTex();
    return new THREE.MeshStandardMaterial({ color: c, map: t.fabric, normalMap: t.fabricN, normalScale: v2(1.6), roughness: 1 });
  },
  leather: (c: string) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.5, sheen: 0.3 }),
  ceramic: (c: string) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04 }),
  stone: (c: string) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.2, clearcoat: 0.7, clearcoatRoughness: 0.1 }),
  matte: (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }),
  paint: (c: string) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.35, clearcoat: 0.4, clearcoatRoughness: 0.2 }),
  chrome: () => new THREE.MeshStandardMaterial({ color: '#eef0f2', metalness: 1, roughness: 0.08 }),
  brushed: (c = '#2b2b2b') => new THREE.MeshStandardMaterial({ color: c, metalness: 0.85, roughness: 0.35 }),
  steel: () => new THREE.MeshStandardMaterial({ color: '#c8cbce', metalness: 0.9, roughness: 0.28 }),
  glass: () =>
    new THREE.MeshPhysicalMaterial({ color: '#e7f3f5', metalness: 0, roughness: 0.02, transparent: true, opacity: 0.18, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide }),
  window: () =>
    new THREE.MeshPhysicalMaterial({ color: '#cfe3ea', metalness: 0.1, roughness: 0.03, transparent: true, opacity: 0.35, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide, name: 'window' }),
  mirror: () => new THREE.MeshStandardMaterial({ color: '#f4f7f8', metalness: 1, roughness: 0.02 }),
  leaf: (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, side: THREE.DoubleSide }),
  glow: (c: string, i = 0.5) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i, roughness: 1, side: THREE.DoubleSide }),
  screen: () => new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffffff', emissiveMap: sharedTex().screen, emissiveIntensity: 0.55, roughness: 0.15, metalness: 0.2 }),
};

export function shade(c: string, l: number): string {
  const k = new THREE.Color(c);
  k.offsetHSL(0, 0, l);
  return '#' + k.getHexString();
}

type G = THREE.Group;
type M = THREE.Material;

export function add(g: G, geo: THREE.BufferGeometry, mat: M, x: number, y: number, z: number) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  g.add(m);
  return m;
}
/** Rounded box centred at (x,y,z). */
export function rb(g: G, w: number, h: number, d: number, r: number, mat: M, x: number, y: number, z: number) {
  r = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  return add(g, r > 0.002 ? new RoundedBoxGeometry(w, h, d, 3, r) : new THREE.BoxGeometry(w, h, d), mat, x, y, z);
}
export function cy(g: G, rt: number, rbot: number, h: number, mat: M, x: number, y: number, z: number, seg = 40) {
  return add(g, new THREE.CylinderGeometry(rt, rbot, h, seg), mat, x, y, z);
}
export function lathe(g: G, prof: [number, number][], mat: M, x: number, y: number, z: number, seg = 64) {
  return add(g, new THREE.LatheGeometry(prof.map((p) => new THREE.Vector2(p[0], p[1])), seg), mat, x, y, z);
}
export function tube(g: G, points: [number, number, number][], r: number, mat: M) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return add(g, new THREE.TubeGeometry(curve, 48, r, 12), mat, 0, 0, 0);
}
export function sphere(g: G, r: number, mat: M, x: number, y: number, z: number, detail = 1) {
  return add(g, new THREE.IcosahedronGeometry(r, detail), mat, x, y, z);
}
export function noShadow<T extends THREE.Object3D>(o: T): T {
  o.userData.noShadow = true;
  return o;
}
