/** First-person walk-through: keyboard / on-screen pad movement, wall collision, stairs. */
import * as THREE from 'three';
import { catalogById } from '../data/catalog';
import { LEVEL_H, type House } from '../types';
import { inRoom, levelY } from '../lib/shell';
import { blocks, type Segment } from '../lib/walls';

const EYE = 1.6;
const R = 0.22;
const SPEED = 1.5;
const RUN = 3.2;
const TURN = 1.8;

export class Walker {
  pos = new THREE.Vector3();
  yaw = 0;
  pitch = -0.05;
  level = 0;
  keys = new Set<string>();
  /** on-screen pad: forward/back, strafe, turn (−1…1) */
  pad = { f: 0, s: 0, t: 0 };
  target: THREE.Vector3 | null = null;
  private y = 0;
  private dist = 0;
  private house: House;
  private segs: Map<number, Segment[]>;

  constructor(house: House, segs: Map<number, Segment[]>) {
    this.house = house;
    this.segs = segs;
  }

  setWorld(house: House, segs: Map<number, Segment[]>) {
    this.house = house;
    this.segs = segs;
  }

  /** Stand outside the front door looking in, or in the living room. */
  start() {
    const items = this.house.items.filter((i) => (i.l ?? 0) === 0);
    const door = items.find((i) => i.t === 'frontdoor') ?? items.find((i) => catalogById.get(i.t)?.opening?.door && this.onExterior(i.x, i.z));
    if (door) {
      const n = new THREE.Vector3(Math.sin(door.r), 0, Math.cos(door.r));
      this.pos.set(door.x, 0, door.z).addScaledVector(n, -4.2);
      this.yaw = Math.atan2(-n.x, -n.z);
    } else {
      const r = this.house.rooms.find((o) => o.type === 'living') ?? this.house.rooms[0];
      this.pos.set(r?.x ?? 0, 0, (r?.z ?? 0) + (r ? r.d / 2 - 0.6 : 0));
      this.yaw = 0;
    }
    this.level = 0;
    this.pitch = -0.05;
    this.y = 0;
  }

  /** Teleport into a room. */
  goTo(roomId: string) {
    const r = this.house.rooms.find((o) => o.id === roomId);
    if (!r) return;
    this.pos.set(r.x, 0, r.z + r.d / 2 - 0.5);
    this.level = r.level ?? 0;
    this.y = levelY(this.level);
    this.yaw = 0;
    this.target = null;
  }

  private onExterior(x: number, z: number) {
    for (const s of this.segs.get(0) ?? []) {
      if (s.plus && s.minus) continue;
      const perp = s.axis === 'x' ? z : x, along = s.axis === 'x' ? x : z;
      if (Math.abs(perp - s.c) < 0.15 && along >= s.s0 && along <= s.s1) return true;
    }
    return false;
  }

  look(dx: number, dy: number) {
    this.yaw -= dx * 0.004;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.004, -1.2, 1.2);
  }

  private blocked(x: number, z: number) {
    for (const s of this.segs.get(this.level) ?? []) {
      const perp = s.axis === 'x' ? z : x, along = s.axis === 'x' ? x : z;
      if (Math.abs(perp - s.c) > R + 0.1) continue;
      if (along < s.s0 - R || along > s.s1 + R) continue;
      if (blocks(s, THREE.MathUtils.clamp(along, s.s0, s.s1))) return true;
    }
    return false;
  }

  /** Floor height under (x, z): follows stairs and drops off edges. */
  private ground(x: number, z: number): number {
    for (const it of this.house.items) {
      const st = catalogById.get(it.t)?.stair;
      if (!st) continue;
      const L = it.l ?? 0;
      if (L !== this.level && L !== this.level - 1) continue;
      const dx = x - it.x, dz = z - it.z, c = Math.cos(it.r), s = Math.sin(it.r);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) > st.w / 2 || Math.abs(lz) > st.len / 2) continue;
      const p = THREE.MathUtils.clamp((st.len / 2 - lz) / st.len, 0, 1);
      this.level = p > 0.5 ? L + 1 : L;
      return levelY(L) + p * LEVEL_H;
    }
    while (this.level > 0 && !this.house.rooms.some((r) => (r.level ?? 0) === this.level && inRoom(r, x, z, 0.3))) this.level--;
    return levelY(this.level);
  }

  /** Advance by dt seconds; returns true when the view changed. */
  update(dt: number): boolean {
    const k = this.keys;
    const run = k.has('shift');
    let f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0) + this.pad.f;
    let st = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0) + this.pad.s;
    const turn = (k.has('arrowleft') || k.has('q') ? 1 : 0) - (k.has('arrowright') || k.has('e') ? 1 : 0) + this.pad.t;
    if (turn) this.yaw += turn * TURN * dt;
    if (this.target && (f || st)) this.target = null;
    if (this.target) {
      const d = this.target.clone().sub(this.pos).setY(0);
      if (d.length() < 0.15) this.target = null;
      else {
        this.yaw = THREE.MathUtils.lerp(this.yaw, Math.atan2(-d.x, -d.z), Math.min(1, dt * 6));
        f = 1;
      }
    }
    const moving = f !== 0 || st !== 0;
    if (moving) {
      const len = Math.hypot(f, st);
      f /= Math.max(1, len);
      st /= Math.max(1, len);
      const v = (run ? RUN : SPEED) * dt;
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const dx = (fx * f + Math.cos(this.yaw) * st) * v;
      const dz = (fz * f - Math.sin(this.yaw) * st) * v;
      let hit = false;
      if (!this.blocked(this.pos.x + dx, this.pos.z)) this.pos.x += dx;
      else hit = true;
      if (!this.blocked(this.pos.x, this.pos.z + dz)) this.pos.z += dz;
      else hit = true;
      if (hit && this.target) this.target = null;
      this.dist += Math.hypot(dx, dz);
    }
    const gy = this.ground(this.pos.x, this.pos.z);
    const oldY = this.y;
    this.y = Math.abs(gy - this.y) > 0.5 ? THREE.MathUtils.lerp(this.y, gy, Math.min(1, dt * 8)) : gy;
    return moving || turn !== 0 || Math.abs(oldY - this.y) > 1e-4;
  }

  apply(cam: THREE.PerspectiveCamera) {
    const bob = Math.sin(this.dist * 7) * 0.02;
    cam.position.set(this.pos.x, this.y + EYE + bob, this.pos.z);
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  get eyeLevel() {
    return this.level;
  }
}
