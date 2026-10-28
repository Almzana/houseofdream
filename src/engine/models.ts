import * as THREE from 'three';
import { catalogById } from '../data/catalog';
import { LEVEL_H } from '../types';
import { mergeStatic } from './merge';

/**
 * One built model per item type and colour. Every placed item is a clone of it: the geometry is
 * shared (built once, uploaded once), the materials are the item's own because the engine tints
 * them per room and lights lamp shades one by one.
 */
const protos = new Map<string, THREE.Group>();

/** The shared model mesh each placed item mesh was cloned from (lets identical parts be batched). */
export const protoOf = new WeakMap<THREE.Mesh, THREE.Mesh>();

function make(t: string, color: string): THREE.Group {
  const def = catalogById.get(t);
  const g = new THREE.Group();
  if (!def) return g;
  def.build(color || def.colors[0], g);
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = !m.userData.noShadow;
      m.receiveShadow = true;
    }
  });
  // a sofa is ~20 rounded boxes: draw it in a few calls instead
  mergeStatic(g);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.userData.sharedGeo = true;
  });
  return g;
}

function proto(t: string, color: string) {
  // stairs are built for the current storey height
  const key = `${t}|${color}${catalogById.get(t)?.stair ? `|${LEVEL_H}` : ''}`;
  let p = protos.get(key);
  if (!p) protos.set(key, (p = make(t, color)));
  return p;
}

/** Build an item type's shared model ahead of time; true if it had to be built. */
export function prepareModel(t: string, color: string) {
  const n = protos.size;
  proto(t, color);
  return protos.size > n;
}

/** Build a furniture model; meshes cast/receive shadows unless flagged. */
export function buildModel(t: string, color: string): THREE.Group {
  const p = proto(t, color);
  const g = p.clone(true);
  const own = new Map<THREE.Material, THREE.Material>();
  const mine = (m: THREE.Material) => own.get(m) ?? own.set(m, m.clone()).get(m)!;
  // clone() keeps the hierarchy order, so the two traversals pair each copy with its original
  const originals: THREE.Mesh[] = [];
  p.traverse((o) => (o as THREE.Mesh).isMesh && originals.push(o as THREE.Mesh));
  let i = 0;
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    protoOf.set(m, originals[i++]);
    m.material = Array.isArray(m.material) ? m.material.map(mine) : mine(m.material);
  });
  return g;
}

/** Dispose an object's materials, and its geometry unless it is shared with other items. */
export function disposeModel(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry && !m.userData.sharedGeo) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}
