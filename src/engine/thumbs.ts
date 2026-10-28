/**
 * Catalogue thumbnails rendered from the real 3D models with a small offscreen
 * renderer, generated in idle time and cached in localStorage.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildModel, disposeModel } from './models';
import { catalogById } from '../data/catalog';

const KEY = 'baan3d.thumbs.v3';
const SIZE = 320;
const cache = new Map<string, string>();
const listeners = new Set<() => void>();
let queue: string[] = [];
let ctx: { r: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.PerspectiveCamera; sun: THREE.DirectionalLight; ground: THREE.Mesh } | null = null;
let running = false;

try {
  // older thumbnail caches are dead weight in storage (and in memory once parsed)
  for (const old of ['baan3d.thumbs.v1', 'baan3d.thumbs.v2']) localStorage.removeItem(old);
  const raw = localStorage.getItem(KEY);
  if (raw) Object.entries(JSON.parse(raw) as Record<string, string>).forEach(([k, v]) => cache.set(k, v));
} catch {
  /* storage blocked: thumbnails are regenerated */
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(cache)));
  } catch {
    /* quota exceeded: keep in memory only */
  }
}

function setup() {
  if (ctx) return ctx;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(SIZE, SIZE, false);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 0.95;
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(r);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose();
  const sun = new THREE.DirectionalLight(0xfff4e6, 1.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target, new THREE.HemisphereLight(0xffffff, 0x887766, 0.5));
  // transparent floor that only shows the item's shadow
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.22 }));
  ground.receiveShadow = true;
  scene.add(ground);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  ctx = { r, scene, cam, sun, ground };
  return ctx;
}

/** Give back the second WebGL context and its buffers once the queue is empty. */
function release() {
  if (!ctx) return;
  ctx.scene.environment?.dispose();
  ctx.r.dispose();
  ctx.r.forceContextLoss();
  ctx = null;
}

/** Point the sun and shadow floor at an item of the given bounds. */
export function stageLights(sun: THREE.DirectionalLight, ground: THREE.Mesh, centre: THREE.Vector3, minY: number, radius: number, wall: boolean) {
  ground.visible = !wall;
  ground.position.set(centre.x, minY, centre.z);
  ground.scale.setScalar(radius * 8);
  sun.position.copy(centre).add(new THREE.Vector3(radius * 1.4, radius * 3, radius * 2));
  sun.target.position.copy(centre);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -radius * 1.8;
  sc.right = sc.top = radius * 1.8;
  sc.near = 0.01;
  sc.far = radius * 8;
  sc.updateProjectionMatrix();
}

function renderOne(t: string, color: string): string {
  const { r, scene, cam, sun, ground } = setup();
  const g = buildModel(t, color);
  g.traverse((o) => {
    if ((o as THREE.PointLight).isPointLight) (o as THREE.PointLight).intensity = 0;
  });
  scene.add(g);
  const box = new THREE.Box3().setFromObject(g);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 0.15);
  stageLights(sun, ground, centre, box.min.y, radius, catalogById.get(t)?.mount === 'wall');
  const dist = radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * 0.92;
  const dir = new THREE.Vector3(0.75, 0.55, 1).normalize();
  cam.position.copy(centre).addScaledVector(dir, dist);
  cam.near = dist / 50;
  cam.far = dist * 4;
  cam.updateProjectionMatrix();
  cam.lookAt(centre);
  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/webp', 0.86);
  scene.remove(g);
  disposeModel(g);
  return url;
}

const key = (t: string, c: string) => `${t}|${c}`;

export function getThumb(t: string, c: string): string | undefined {
  return cache.get(key(t, c));
}

export function requestThumbs(list: { t: string; c: string }[]) {
  for (const { t, c } of list) {
    const k = key(t, c);
    if (!cache.has(k) && !queue.includes(k)) queue.push(k);
  }
  pump();
}

function pump() {
  if (running || !queue.length) return;
  running = true;
  const idle: (cb: () => void) => void = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ?? ((cb) => setTimeout(cb, 16));
  const step = () => {
    const start = performance.now();
    while (queue.length && performance.now() - start < 24) {
      const k = queue.shift()!;
      const [t, c] = k.split('|');
      try {
        cache.set(k, renderOne(t, c));
      } catch {
        cache.set(k, '');
      }
    }
    listeners.forEach((l) => l());
    if (queue.length) idle(step);
    else {
      running = false;
      persist();
      release();
    }
  };
  idle(step);
}

export function onThumbs(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
