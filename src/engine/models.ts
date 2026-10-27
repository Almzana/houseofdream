import * as THREE from 'three';
import { catalogById } from '../data/catalog';
import { mergeStatic } from './merge';

/** Build a furniture model; meshes cast/receive shadows unless flagged. */
export function buildModel(t: string, color: string): THREE.Group {
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
  return g;
}

/** Dispose geometries and materials (shared textures are left alone). */
export function disposeModel(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}
