/**
 * Furniture drawn in batches. Placed items are clones of one model per type and colour
 * (models.ts), so every copy of a part shares its geometry: all copies of that part are drawn
 * by one InstancedMesh instead of one draw call each. A house with 150 downlights and 20
 * bookcases goes from thousands of draw calls to a few hundred.
 *
 * The item objects stay in the scene for picking, dragging and the path tracer; only their
 * batched parts are hidden from drawing. Each frame the batches copy the items' visibility and
 * placement, so the engine's per-frame rules (storey shown, far-away interiors, cut-away
 * walls) work unchanged.
 */
import * as THREE from 'three';
import { protoOf } from './models';

interface Batch {
  inst: THREE.InstancedMesh;
  members: { mesh: THREE.Mesh; owner: THREE.Object3D }[];
}

export class Instancer {
  readonly root = new THREE.Group();
  private batches: Batch[] = [];
  private hidden: THREE.Mesh[] = [];
  /** one material per base material and daylight step (rooms differ in how much sky they see) */
  private tinted = new Map<string, THREE.Material>();
  private enabled = true;

  /**
   * Regroup the given items. `tint` is the item's daylight factor; items for which `own` is true
   * (lamps, doors that swing, the selected item) are left to draw themselves.
   */
  setItems(items: { group: THREE.Object3D; tint: number; own: boolean; glow?: THREE.Material[]; lamp?: string }[]) {
    this.release();
    if (!this.enabled) return;
    const groups = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material; cast: boolean; recv: boolean; members: Batch['members'] }>();
    for (const it of items) {
      if (it.own) continue;
      const f = Math.round(it.tint * 10) / 10;
      it.group.traverse((o) => {
        const m = o as THREE.Mesh;
        const p = m.isMesh ? protoOf.get(m) : undefined;
        if (!p || Array.isArray(p.material) || Array.isArray(m.material) || !m.visible) return;
        // a lamp's glowing shade follows the lamp's own state: batch it only with lamps set the
        // same way, drawing with the first one's material (the engine updates it in place)
        const glow = !!it.glow?.includes(m.material);
        const key = glow ? `${p.geometry.uuid}|glow|${it.lamp}|${m.castShadow}` : `${p.geometry.uuid}|${p.material.uuid}|${f}|${m.castShadow}|${m.receiveShadow}`;
        let g = groups.get(key);
        if (!g) groups.set(key, (g = { geo: p.geometry, mat: glow ? m.material : this.tint(p.material, f), cast: m.castShadow, recv: m.receiveShadow, members: [] }));
        g.members.push({ mesh: m, owner: it.group });
      });
    }
    for (const g of groups.values()) {
      // a part that appears once gains nothing from batching
      if (g.members.length < 2) continue;
      const inst = new THREE.InstancedMesh(g.geo, g.mat, g.members.length);
      inst.castShadow = g.cast;
      inst.receiveShadow = g.recv;
      // the batch spans the whole house; culling it as one sphere would only cost time
      inst.frustumCulled = false;
      inst.userData.noPick = true;
      this.root.add(inst);
      this.batches.push({ inst, members: g.members });
      for (const { mesh } of g.members) {
        mesh.visible = false;
        this.hidden.push(mesh);
      }
    }
    this.sync();
  }

  private tint(base: THREE.Material, f: number) {
    const key = `${base.uuid}|${f}`;
    let m = this.tinted.get(key);
    if (!m) {
      m = base.clone();
      const s = m as THREE.MeshStandardMaterial;
      if (s.envMapIntensity !== undefined) s.envMapIntensity = (base as THREE.MeshStandardMaterial).envMapIntensity * f;
      this.tinted.set(key, m);
    }
    return m;
  }

  /** Copy each member's visibility and world placement into its batch. */
  sync() {
    for (const { inst, members } of this.batches) {
      let n = 0;
      for (const { mesh, owner } of members) {
        if (!owner.visible) continue;
        inst.setMatrixAt(n++, mesh.matrixWorld);
      }
      if (n !== inst.count || n) {
        inst.count = n;
        inst.instanceMatrix.needsUpdate = true;
      }
      inst.visible = n > 0;
    }
  }

  /** Off for the path tracer (it reads the items themselves), back on afterwards. */
  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) this.release();
  }

  /** Every material the batches draw with (for night-time window glow). */
  materials() {
    return [...this.tinted.values()];
  }

  private release() {
    for (const m of this.hidden) m.visible = true;
    this.hidden = [];
    for (const { inst } of this.batches) {
      this.root.remove(inst);
      inst.dispose();
    }
    this.batches = [];
  }
}
