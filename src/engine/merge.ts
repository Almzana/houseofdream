/**
 * Draw-call reduction: furniture and the building shell are built from many small parts.
 * Parts that share a material (and shadow setting) are merged into one mesh, so the GPU gets
 * a handful of draw calls per object instead of dozens. Moving parts (door leaves on hinges)
 * stay separate.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const ATTRS = ['position', 'normal', 'uv'] as const;

/** Same attribute layout for every part so they can be merged. */
function normalise(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(n.attributes)) if (!(ATTRS as readonly string[]).includes(k)) n.deleteAttribute(k);
  if (!n.attributes.normal) n.computeVertexNormals();
  if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
  n.clearGroups();
  n.morphAttributes = {};
  return n;
}

const movable = (o: THREE.Object3D, root: THREE.Object3D) => {
  for (let p = o.parent; p && p !== root; p = p.parent) if (p.userData.hinge) return true;
  return false;
};

/** Merge the static parts of `root` that share a material. Returns the number of meshes removed. */
export function mergeStatic(root: THREE.Object3D, opts: { minParts?: number } = {}): number {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const buckets = new Map<string, { mat: THREE.Material; cast: boolean; recv: boolean; layers: number; parts: THREE.Mesh[] }>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material) || !m.visible || movable(m, root) || m.userData.keep) return;
    const key = `${m.material.uuid}|${m.castShadow}|${m.receiveShadow}|${m.layers.mask}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { mat: m.material, cast: m.castShadow, recv: m.receiveShadow, layers: m.layers.mask, parts: [] }));
    b.parts.push(m);
  });
  let removed = 0;
  const local = new THREE.Matrix4();
  for (const b of buckets.values()) {
    if (b.parts.length < (opts.minParts ?? 2)) continue;
    const geos = b.parts.map((m) => {
      const g = normalise(m.geometry);
      g.applyMatrix4(local.multiplyMatrices(inv, m.matrixWorld));
      return g;
    });
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.recv;
    mesh.layers.mask = b.layers;
    if (!b.cast) mesh.userData.noShadow = true;
    for (const m of b.parts) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    root.add(mesh);
    removed += b.parts.length - 1;
  }
  return removed;
}

/** One shadow-only mesh from every caster under `root` (material doesn't matter for shadows). */
export function mergeShadowCasters(root: THREE.Object3D, layer: number): THREE.Mesh | null {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const geos: THREE.BufferGeometry[] = [];
  const local = new THREE.Matrix4();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.castShadow) return;
    const g = new THREE.BufferGeometry();
    const src = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
    g.setAttribute('position', src.attributes.position.clone());
    g.applyMatrix4(local.multiplyMatrices(inv, m.matrixWorld));
    geos.push(g);
    if (src !== m.geometry) src.dispose();
  });
  if (!geos.length) return null;
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  if (!merged) return null;
  const mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.layers.set(layer);
  return mesh;
}
