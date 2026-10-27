/**
 * 3D view of the construction model: every part type is merged into one mesh (few draw calls),
 * while a triangle → part table keeps each piece clickable for its name and spec.
 * Layers can be hidden and pulled apart ("exploded") to see what is inside.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Comp, Kind, Layer } from '../lib/construction';

const COLORS: Record<Kind, [string, number, number]> = {
  // colour, roughness, metalness
  pile: ['#8f8a80', 0.95, 0], footing: ['#a7a196', 0.9, 0], column: ['#bdb7ab', 0.85, 0], gbeam: ['#a7a196', 0.9, 0], beam: ['#c3bdb1', 0.85, 0],
  slab: ['#cfc9bd', 0.9, 0], plank: ['#d9d3c7', 0.85, 0], brick: ['#b4573c', 0.9, 0], lintel: ['#c3bdb1', 0.85, 0],
  rafter: ['#8b3b2b', 0.55, 0.45], purlin: ['#6f7378', 0.45, 0.6], ridge: ['#7a3326', 0.55, 0.45], post: ['#8b3b2b', 0.55, 0.45],
  cframe: ['#b8bec6', 0.4, 0.7],
  cold: ['#2f80ed', 0.35, 0], hot: ['#e5484d', 0.35, 0], soil: ['#d9822b', 0.45, 0], grey: ['#8a9099', 0.45, 0], vent: ['#a9afb8', 0.45, 0],
  tank: ['#dfe3e8', 0.25, 0.8], pump: ['#2f6fd0', 0.4, 0.3], septic: ['#3f7a55', 0.6, 0], pit: ['#8d8a83', 0.9, 0], wmeter: ['#2f80ed', 0.4, 0.2], grease: ['#5a6b7a', 0.6, 0],
  'wire-light': ['#f2c94c', 0.5, 0], 'wire-power': ['#e74c3c', 0.5, 0], 'wire-ac': ['#2d9cdb', 0.5, 0], 'wire-heavy': ['#f2994a', 0.5, 0], 'wire-main': ['#2b2b2b', 0.5, 0],
  shaft: ['#b9b3a7', 0.85, 0], liftcar: ['#c9ced4', 0.3, 0.8], pooltank: ['#9fb4b8', 0.85, 0], poolplant: ['#3d7ea6', 0.4, 0.3], poolpipe: ['#5bc0de', 0.4, 0], vrv: ['#d7dadc', 0.4, 0.4], refpipe: ['#c77d3a', 0.35, 0.7],
  solar: ['#1c2c4a', 0.15, 0.5], inverter: ['#e9eaec', 0.4, 0.2], ev: ['#27ae60', 0.4, 0.2], genset: ['#d9a400', 0.5, 0.4], ats: ['#e3e3e0', 0.5, 0.3], smoke: ['#ffffff', 0.4, 0], firepanel: ['#d63031', 0.45, 0.1], lightning: ['#b87333', 0.3, 0.9], cctv: ['#2d3436', 0.4, 0.3], rack: ['#2d3436', 0.5, 0.4],
  panel: ['#e3e3e0', 0.5, 0.3], emeter: ['#e8e8e5', 0.5, 0.1], switch: ['#fafafa', 0.4, 0], socket: ['#fafafa', 0.4, 0], acin: ['#f7f7f5', 0.35, 0], acout: ['#cfd2d4', 0.45, 0.4], ground: ['#2e9e4f', 0.35, 0.6],
};

export const LAYERS: { id: Layer; name: string; color: string }[] = [
  { id: 'found', name: 'ฐานราก · เสาเข็ม', color: '#8f8a80' },
  { id: 'frame', name: 'เสา · คาน · พื้น', color: '#c3bdb1' },
  { id: 'walls', name: 'ผนังก่อ · ทับหลัง', color: '#b4573c' },
  { id: 'roof', name: 'โครงหลังคา', color: '#8b3b2b' },
  { id: 'ceiling', name: 'โครงฝ้า', color: '#b8bec6' },
  { id: 'plumb', name: 'ประปา · สุขาภิบาล', color: '#2f80ed' },
  { id: 'elec', name: 'ไฟฟ้า · แอร์', color: '#f2c94c' },
  { id: 'systems', name: 'ระบบอาคาร · ลิฟต์ สระ โซลาร์ ความปลอดภัย', color: '#3d7ea6' },
];

const tmpM = new THREE.Matrix4();
const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), UPV = new THREE.Vector3(0, 1, 0);

function partGeometry(c: Comp): THREE.BufferGeometry {
  if (c.box) {
    const g = new THREE.BoxGeometry(...c.box.s);
    if (c.box.r) g.rotateY(c.box.r);
    g.translate(...c.box.p);
    return g;
  }
  const { a, b, w, h = w } = c.line!;
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const L = A.distanceTo(B);
  const g = new THREE.BoxGeometry(L, h, w);
  X.subVectors(B, A).normalize();
  Z.crossVectors(X, UPV);
  if (Z.lengthSq() < 1e-6) Z.set(0, 0, 1);
  Z.normalize();
  Y.crossVectors(Z, X).normalize();
  tmpM.makeBasis(X, Y, Z).setPosition(A.add(B).multiplyScalar(0.5));
  g.applyMatrix4(tmpM);
  return g;
}

export interface BuildPick {
  name: string;
  spec: string;
  layer: Layer;
  level: number;
}

export class BuildView {
  readonly group = new THREE.Group();
  private parts = new Map<string, { group: THREE.Group; layer: Layer; level: number }>();
  private meshes: { mesh: THREE.Mesh; comps: Comp[] }[] = [];
  private hidden = new Set<Layer>();
  private explode = 0;
  private top: number;

  constructor(comps: Comp[]) {
    this.top = Math.max(0, ...comps.map((c) => c.level));
    const byKey = new Map<string, Comp[]>();
    for (const c of comps) {
      const k = `${c.layer}|${c.level}|${c.kind}`;
      byKey.set(k, [...(byKey.get(k) ?? []), c]);
    }
    const mats = new Map<Kind, THREE.Material>();
    for (const [k, list] of byKey) {
      const [layer, level, kind] = k.split('|') as [Layer, string, Kind];
      const geos = list.map(partGeometry);
      const geo = mergeGeometries(geos, false)!;
      geos.forEach((g) => g.dispose());
      let mat = mats.get(kind);
      if (!mat) {
        const [col, rough, metal] = COLORS[kind];
        mats.set(kind, (mat = new THREE.MeshStandardMaterial({ color: col, roughness: rough, metalness: metal })));
      }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = layer !== 'elec' && layer !== 'ceiling';
      mesh.receiveShadow = true;
      const pk = `${layer}|${level}`;
      let part = this.parts.get(pk);
      if (!part) {
        part = { group: new THREE.Group(), layer, level: +level };
        this.parts.set(pk, part);
        this.group.add(part.group);
      }
      part.group.add(mesh);
      this.meshes.push({ mesh, comps: list });
    }
  }

  setLayers(hidden: Layer[]) {
    this.hidden = new Set(hidden);
    this.apply();
  }

  /** 0 = assembled · 1 = fully pulled apart (foundation down, storeys and roof up). */
  setExplode(e: number) {
    this.explode = e;
    this.apply();
  }

  private apply() {
    const e = this.explode;
    for (const p of this.parts.values()) {
      p.group.visible = !this.hidden.has(p.layer);
      let y = p.level * 2.4 * e;
      if (p.layer === 'found') y = -2.2 * e;
      if (p.layer === 'roof') y = (this.top + 1) * 2.4 * e + 1.2 * e;
      if (p.layer === 'ceiling') y += 0.8 * e;
      if (p.layer === 'plumb' || p.layer === 'elec') y += 0.4 * e;
      p.group.position.y = y;
    }
  }

  /** Lift applied to a storey's own furniture so it stays with its floor when exploded. */
  levelLift(level: number) {
    return level * 2.4 * this.explode;
  }

  pick(ray: THREE.Raycaster): BuildPick | null {
    const vis = this.meshes.filter((m) => m.mesh.parent?.visible);
    const hit = ray.intersectObjects(vis.map((m) => m.mesh), false)[0];
    if (!hit || hit.faceIndex == null) return null;
    const m = vis.find((x) => x.mesh === hit.object)!;
    // every part is a box: 12 triangles each, merged in order
    const c = m.comps[Math.floor(hit.faceIndex / 12)];
    return c ? { name: c.name, spec: c.spec, layer: c.layer, level: c.level } : null;
  }

  dispose() {
    for (const { mesh } of this.meshes) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
}

