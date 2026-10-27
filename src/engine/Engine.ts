import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { GradientEquirectTexture, WebGLPathTracer } from 'three-gpu-pathtracer';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { catalogById, type CatalogItem } from '../data/catalog';
import { floorById } from '../data/surfaces';
import type { House, Item, Quality, Room, ViewMode, WallMode } from '../types';
import { inRoom, levelY } from '../lib/shell';
import { kelvinRGB } from '../lib/kelvin';
import { buildModel, disposeModel } from './models';
import { setAnisotropy, surfaceSet } from './textures';
import { ctx2d, mkCanvas } from './canvas';
import { LOW, buildStructure, shadowProxy, type Structure, type WallView } from './structure';
import { Walker } from './walk';
import type { Pose } from '../lib/pose';

export interface EngineEvents {
  selectItem: (id: string | null) => void;
  selectRoom: (id: string | null) => void;
  itemMoved: (id: string, x: number, z: number, r: number) => void;
  roomMoved: (id: string, x: number, z: number) => void;
  view: (azimuth: number, polar: number) => void;
}

interface RoomView {
  key: string;
  room: Room;
  group: THREE.Group;
  floor: THREE.Mesh;
  floorMat: THREE.MeshPhysicalMaterial;
  ceiling: THREE.Mesh | null;
  label: THREE.Sprite;
  /** shadow-only copy of an upper floor's slab (kept casting while that storey is hidden) */
  proxy?: THREE.Object3D;
}
interface ItemView {
  key: string;
  item: Item;
  group: THREE.Group;
  spec?: NonNullable<CatalogItem['light']>;
  lampPos?: THREE.Vector3;
  lampAim?: THREE.Vector3;
  glow?: THREE.MeshStandardMaterial[];
}
/** A light source as data; the light pool turns the most relevant ones into real lights. */
interface Lamp {
  id: string;
  kind: 'point' | 'spot';
  pos: THREE.Vector3;
  aim: THREE.Vector3;
  angle: number;
  level: number;
  power: number;
  color: THREE.Color;
  distance: number;
}
const POOL_POINT = 10;
const POOL_SPOT = 4;

const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
const lvl = (o: { level?: number; l?: number }) => o.level ?? o.l ?? 0;
const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.05, 400);
  readonly controls: OrbitControls;
  private host: HTMLElement;
  private ev: EngineEvents;
  private sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
  private hemi = new THREE.HemisphereLight(0xffffff, 0x8d8370, 0.5);
  private sunDir = new THREE.Vector3(0.45, 0.8, 0.4).normalize();
  private sky = new Sky();
  private night = false;
  private nightBg = new THREE.Color('#0d1322');
  private roomsGroup = new THREE.Group();
  private roomShadows = new THREE.Group();
  private itemsGroup = new THREE.Group();
  private rooms = new Map<string, RoomView>();
  private items = new Map<string, ItemView>();
  private house: House = { rooms: [], items: [] };
  private structure: Structure | null = null;
  private structKey = '';
  private wallOf = new Map<string, WallView>();
  private lowWalls = new Set<WallView>();
  private shadowMat = new THREE.ShadowMaterial({ opacity: 0.32 });
  private helper: THREE.BoxHelper | null = null;
  private roomHelper: THREE.LineSegments | null = null;
  private selItem: string | null = null;
  private selRoom: string | null = null;
  private wallMode: WallMode = 'auto';
  private mode: ViewMode = 'outside';
  private level = 0;
  private planMode = false;
  private dirty = true;
  /** ambient occlusion + bloom (high quality only) */
  private composer: EffectComposer;
  private ao: GTAOPass;
  private bloom: UnrealBloomPass;
  private fx = true;
  private raf = 0;
  private last = performance.now();
  private tween: { p0: THREE.Vector3; t0: THREE.Vector3; p1: THREE.Vector3; t1: THREE.Vector3; s: number; d: number } | null = null;
  private roofAnim: { from: number; to: number; s: number } | null = null;
  private roofLift = 0;
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private plane = new THREE.Plane(UP, 0);
  private drag: { kind: 'item' | 'room'; id: string; off: THREE.Vector3; startX: number; startY: number; moved: boolean; obj: THREE.Object3D; level: number; carry: { g: THREE.Object3D; dx: number; dz: number }[] } | null = null;
  private down: { x: number; y: number } | null = null;
  private ro: ResizeObserver;
  private lastView = '';
  private walker: Walker | null = null;
  private look: { x: number; y: number; id: number } | null = null;
  /* view cube */
  private cubeScene = new THREE.Scene();
  private cubeCam = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);
  private cube: THREE.Mesh;
  private cubeSize = 96;
  /* photo-matched view */
  private photo: { roomId: string; tex: THREE.Texture; aspect: number; original: boolean } | null = null;

  constructor(host: HTMLElement, ev: EngineEvents) {
    this.host = host;
    this.ev = ev;
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.9;
    r.shadowMap.enabled = true;
    r.shadowMap.autoUpdate = false;
    // filtered PCF: soft enough edges at a fraction of PCFSoft's cost
    r.shadowMap.type = THREE.PCFShadowMap;
    r.autoClear = false;
    this.renderer = r;
    setAnisotropy(Math.min(8, r.capabilities.getMaxAnisotropy()));
    host.prepend(r.domElement);
    Object.assign(r.domElement.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', touchAction: 'none', display: 'block' });

    const pm = new THREE.PMREMGenerator(r);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pm.dispose();
    this.sky.scale.setScalar(380);
    const su = this.sky.material.uniforms;
    // the stock sky is tuned for exposure 0.5; scale it so it stays blue at ours
    su.skyGain = { value: 0.22 };
    this.sky.material.fragmentShader = 'uniform float skyGain;\n' + this.sky.material.fragmentShader.replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( retColor * skyGain, 1.0 );');
    su.turbidity.value = 2;
    su.rayleigh.value = 3;
    su.mieCoefficient.value = 0.004;
    su.mieDirectionalG.value = 0.82;
    this.scene.fog = new THREE.Fog(0xcfd8de, 70, 230);
    this.scene.add(this.sky, this.hemi);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 2.5;

    this.scene.add(this.sun, this.sun.target, this.roomsGroup, this.itemsGroup, this.roomShadows);
    this.buildPool();

    const c = new OrbitControls(this.camera, r.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.09;
    c.maxPolarAngle = Math.PI / 2.02;
    c.minDistance = 0.8;
    c.maxDistance = 90;
    c.screenSpacePanning = false;
    // middle button orbits too (wheel still zooms, right button pans)
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    r.domElement.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); }); // stop browser autoscroll
    c.addEventListener('change', () => this.invalidate());
    this.controls = c;

    this.cube = this.makeCube();
    this.cubeScene.add(this.cube, new THREE.AmbientLight(0xffffff, 2.4));

    host.addEventListener('pointerdown', this.onDown, true);
    r.domElement.addEventListener('pointermove', this.onMove);
    r.domElement.addEventListener('pointerup', this.onUp);
    r.domElement.addEventListener('pointercancel', this.onUp);
    r.domElement.addEventListener('dblclick', this.onDbl);
    r.domElement.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    window.addEventListener('blur', this.onBlur);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    // post-processing: contact shadows in corners and under furniture, glow around lamps
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.ao = new GTAOPass(this.scene, this.camera, 2, 2);
    this.ao.blendIntensity = 0.9;
    this.ao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.6, thickness: 1.2, scale: 1, samples: 16 });
    this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    this.composer.addPass(this.ao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.22, 0.3, 0.95);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.setTime(15);
    this.resize();
    this.loop();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.stopRealistic();
    this.ro.disconnect();
    this.host.removeEventListener('pointerdown', this.onDown, true);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('blur', this.onBlur);
    this.controls.dispose();
    this.rooms.forEach((v) => disposeModel(v.group));
    this.items.forEach((v) => disposeModel(v.group));
    if (this.structure) disposeModel(this.structure.group);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  invalidate() {
    this.dirty = true;
  }

  setQuality(q: Quality) {
    // beyond 1.5× the extra pixels cost far more than they show
    this.renderer.setPixelRatio(q === 'high' ? Math.min(window.devicePixelRatio || 1, this.pixelCap) : Math.min(1, this.pixelCap));
    this.renderer.shadowMap.enabled = q === 'high';
    this.fx = q === 'high';
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    this.resize();
  }

  setWallMode(m: WallMode) {
    this.wallMode = m;
    this.invalidate();
  }

  setPlanMode(on: boolean) {
    this.planMode = on;
    if (on) this.view('top');
    this.invalidate();
  }

  /* ------------------------------------------------------- view mode / storey */
  setViewMode(m: ViewMode) {
    if (m === this.mode) return;
    this.stopRealistic(true);
    const was = this.mode;
    this.mode = m;
    this.assignPool(true);
    this.markShadows();
    if (was === 'walk') this.exitWalk();
    if (m === 'walk') this.enterWalk();
    const lift = m === 'inside' ? 1 : 0;
    if (lift !== this.roofLift || this.roofAnim) this.roofAnim = { from: this.roofLift, to: lift, s: performance.now() };
    this.invalidate();
  }

  setLevel(l: number) {
    this.level = l;
    this.assignPool(true);
    this.markShadows();
    this.invalidate();
  }

  /** Hour of the day 0–24: sun path, sky colour, night lighting. */
  setTime(h: number) {
    const t = (h - 6) / 12.5;
    const sinE = Math.sin(Math.PI * t) * Math.sin(THREE.MathUtils.degToRad(76));
    const cosE = Math.sqrt(Math.max(0, 1 - sinE * sinE));
    this.sunDir.set(Math.cos(Math.PI * t) * cosE, sinE, 0.45 * cosE).normalize();
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    const day = smooth(-0.06, 0.3, sinE);
    const low = smooth(0, 0.45, sinE);
    this.sun.intensity = 3.1 * smooth(0, 0.18, sinE);
    this.sun.color.set('#ff9b5c').lerp(new THREE.Color('#fff1dc'), low);
    this.hemi.intensity = 0.03 + 0.12 * day;
    this.hemi.color.set('#40507a').lerp(new THREE.Color('#ffffff'), day);
    this.scene.environmentIntensity = 0.04 + 0.72 * day;
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(this.nightBg).lerp(new THREE.Color(low > 0.2 ? '#aebdc4' : '#d9a988'), day);
    this.sky.visible = sinE > -0.12;
    this.scene.background = this.sky.visible ? null : this.nightBg;
    this.renderer.toneMappingExposure = 0.9 + (1 - day) * 0.25;
    this.night = sinE < 0.06;
    this.nightness = 1 - day;
    this.applyNight();
    this.fitShadow();
    this.invalidate();
  }

  private applyNight() {

    this.applyLights();
    this.itemsGroup.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined;
      if (m && m.name === 'window') {
        m.emissive.set('#ffcf8a');
        m.emissiveIntensity = this.night ? 0.55 : 0;
      }
    });
  }

  /* ---------------------------------------------------------------- lamps */
  // Every lamp is plain data. A fixed pool of real lights is handed to the lamps that matter
  // most for the current view (nearest the focus, on a visible storey): a constant light count
  // means no shader recompiles and keeps per-pixel lighting cheap however many lamps exist.
  private lamps: Lamp[] = [];
  private roomLamps: Lamp[] = [];
  private poolGroup = new THREE.Group();
  private poolPoint: THREE.PointLight[] = [];
  private poolSpot: THREE.SpotLight[] = [];
  /** the selected lamp is given one of these so its shadows show where its light falls */
  private shadowPoint = new THREE.PointLight(0xffffff, 0, 8, 2);
  private shadowSpot = new THREE.SpotLight(0xffffff, 0, 9, 0.6, 0.55, 2);
  private poolFocus = new THREE.Vector3(1e9, 0, 0);
  private poolSel = '';

  private buildPool() {
    const add = (l: THREE.PointLight | THREE.SpotLight) => {
      l.power = 0;
      this.poolGroup.add(l);
      if ((l as THREE.SpotLight).isSpotLight) this.poolGroup.add((l as THREE.SpotLight).target);
    };
    for (let i = 0; i < POOL_POINT; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 8, 2);
      this.poolPoint.push(l);
      add(l);
    }
    for (let i = 0; i < POOL_SPOT; i++) {
      const l = new THREE.SpotLight(0xffffff, 0, 9, 0.6, 0.55, 2);
      this.poolSpot.push(l);
      add(l);
    }
    const sp = this.shadowPoint, ss = this.shadowSpot;
    sp.castShadow = ss.castShadow = true;
    sp.shadow.mapSize.set(512, 512);
    sp.shadow.bias = -0.002;
    sp.shadow.camera.near = 0.05;
    ss.shadow.mapSize.set(1024, 1024);
    ss.shadow.bias = -0.0006;
    ss.shadow.normalBias = 0.02;
    ss.shadow.camera.near = 0.05;
    ss.shadow.camera.far = 8;
    add(sp);
    add(ss);
    this.scene.add(this.poolGroup);
  }

  /** Remember a lamp item's spec and the glowing parts of its model. */
  private attachLight(v: ItemView) {
    const spec = catalogById.get(v.item.t)?.light;
    if (!spec) return;
    v.spec = spec;
    v.glow = [];
    v.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && m.emissive && m.emissiveIntensity > 0 && m.emissive.getHex() !== 0) {
        m.userData.glow ??= m.emissiveIntensity;
        v.glow!.push(m);
      }
    });
  }

  /** World position (and aim) of a lamp's light, following its fixture. */
  private syncLight(v: ItemView) {
    if (!v.spec) return;
    v.group.updateMatrixWorld();
    const [x, y, z] = v.spec.at;
    const [ax, ay, az] = v.spec.aim ?? [x, 0, z];
    (v.lampPos ??= new THREE.Vector3()).set(x, y, z).applyMatrix4(v.group.matrixWorld);
    (v.lampAim ??= new THREE.Vector3()).set(ax, ay, az).applyMatrix4(v.group.matrixWorld);
  }

  /** Lamp brightness/colour from each item's lumens and colour temperature. */
  private applyLights() {
    // by day lamps add almost nothing next to the sun, so skip their cost until dusk
    this.poolGroup.visible = this.nightness > 0.3 && !this.pt;
    // eye adaptation: lamps matter at night, barely in daylight
    const k = 0.3 * (0.14 + 0.86 * this.nightness);
    const lit = new Set<string>();
    this.lamps = [];
    this.items.forEach((v) => {
      const spec = v.spec;
      if (!spec) return;
      const on = !v.item.off;
      const lm = v.item.lm ?? spec.lm;
      const [r, g, b] = kelvinRGB(v.item.k ?? 3000);
      const color = new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
      for (const m of v.glow ?? []) {
        m.emissive.copy(color);
        m.emissiveIntensity = on ? (m.userData.glow as number) * Math.min(2, lm / spec.lm) : 0;
      }
      if (!on || !v.lampPos) return;
      const room = this.house.rooms.find((o) => !o.outdoor && lvl(o) === lvl(v.item) && inRoom(o, v.item.x, v.item.z));
      if (room) lit.add(room.id);
      // three.js gives a spot the intensity power/π (a point light gets power/4π): scale so equal lumens look equal
      this.lamps.push({
        id: v.item.id, kind: spec.kind, pos: v.lampPos, aim: v.lampAim!, angle: spec.angle ?? 0.6, level: lvl(v.item),
        power: lm * k * (spec.kind === 'spot' ? 0.3 : 1), color,
        // keep each light's reach to about its room so it doesn't glow through walls into the next one
        distance: room ? Math.min(8, Math.max(room.w, room.d) * 0.9 + 1.5) : 6,
      });
    });
    // rooms without any lamp of their own get a plain ceiling light at night
    if (this.night) for (const rl of this.roomLamps) if (!lit.has(rl.id)) this.lamps.push({ ...rl, power: 1600 * k });
    this.assignPool(true);
    if (this.pt) this.buildPtLights();
    this.invalidate();
  }

  private levelVisible = (l: number) => this.mode !== 'inside' || !!this.photo || l <= this.level;

  /** Hand the pooled lights to the lamps that matter most right now. */
  private assignPool(force = false) {
    const focus = this.walker ? this.walker.pos : this.controls.target;
    if (!force && focus.distanceToSquared(this.poolFocus) < 2.25) return;
    this.poolFocus.copy(focus);
    const cand = this.lamps.filter((l) => l.power > 0 && this.levelVisible(l.level));
    const sel = cand.find((l) => l.id === this.selItem && this.renderer.shadowMap.enabled);
    const score = (l: Lamp) => l.power / (1 + l.pos.distanceToSquared(focus));
    const pick = (kind: Lamp['kind'], n: number) => cand.filter((l) => l !== sel && l.kind === kind).sort((a, b) => score(b) - score(a)).slice(0, n);
    const set = (light: THREE.PointLight | THREE.SpotLight, l?: Lamp) => {
      if (!l) {
        light.power = 0;
        return;
      }
      light.position.copy(l.pos);
      light.color.copy(l.color);
      light.power = l.power;
      light.distance = l.distance;
      if ((light as THREE.SpotLight).isSpotLight) {
        const s = light as THREE.SpotLight;
        s.angle = l.angle;
        s.target.position.copy(l.aim);
        s.target.updateMatrixWorld();
      }
      light.updateMatrixWorld();
    };
    const pts = pick('point', POOL_POINT), sps = pick('spot', POOL_SPOT);
    this.poolPoint.forEach((p, i) => set(p, pts[i]));
    this.poolSpot.forEach((p, i) => set(p, sps[i]));
    set(this.shadowPoint, sel?.kind === 'point' ? sel : undefined);
    set(this.shadowSpot, sel?.kind === 'spot' ? sel : undefined);
    const selKey = sel ? `${sel.id}|${sel.pos.toArray().join()}` : '';
    if (selKey !== this.poolSel) {
      this.poolSel = selKey;
      this.markShadows();
    }
  }

  /** Ceiling fixtures are modelled for a 2.7 m ceiling; lift/lower them to the room's height. */
  private placeCeilingItems() {
    this.items.forEach((v) => {
      if (catalogById.get(v.item.t)?.mount !== 'ceiling') return;
      const room = this.house.rooms.find((o) => !o.outdoor && lvl(o) === lvl(v.item) && inRoom(o, v.item.x, v.item.z));
      v.group.position.y = levelY(lvl(v.item)) + (room ? room.h - 2.7 : 0);
    });
  }

  /** Live preview while a light slider is dragged (the store is updated on release). */
  previewLight(id: string, p: Partial<Pick<Item, 'lm' | 'k' | 'off'>>) {
    const v = this.items.get(id);
    if (!v) return;
    v.item = { ...v.item, ...p };
    this.applyLights();
  }

  private nightness = 0;

  /* ------------------------------------------------------- shadow cache */
  private shadowDirty = true;
  private stillSince = 0;
  private refined = false;
  /** renders nothing on screen; used to redraw shadow maps including the shadow-only layer */
  private probeCam = new THREE.PerspectiveCamera(1, 1, 0.1, 0.2);
  private probeRT = new THREE.WebGLRenderTarget(1, 1);

  markShadows() {
    this.shadowDirty = true;
    this.invalidate();
  }

  /**
   * Redraw the shadow maps. Walls, roof and slabs cast through invisible stand-ins on layer 1,
   * so a lifted roof or cut-down wall still blocks the sun like the real building would.
   */
  private updateShadows() {
    const r = this.renderer;
    this.probeCam.layers.enableAll();
    this.probeCam.position.set(0, -5000, 0);
    this.probeCam.lookAt(0, -6000, 0);
    this.probeCam.updateMatrixWorld();
    const prev = r.getRenderTarget();
    r.shadowMap.needsUpdate = true;
    r.setRenderTarget(this.probeRT);
    r.render(this.scene, this.probeCam);
    r.setRenderTarget(prev);
    this.shadowDirty = false;
  }

  /** The path tracer sees every lamp as a real light, not just the pooled ones. */
  private ptLights = new THREE.Group();
  private buildPtLights() {
    this.ptLights.children.forEach((c) => (c as THREE.Light).dispose?.());
    this.ptLights.clear();
    for (const l of this.lamps) {
      if (!this.levelVisible(l.level) || l.power <= 0) continue;
      let light: THREE.PointLight | THREE.SpotLight;
      if (l.kind === 'spot') {
        const s = new THREE.SpotLight(l.color, 1, l.distance, l.angle, 0.55, 2);
        s.target.position.copy(l.aim);
        this.ptLights.add(s.target);
        light = s;
      } else light = new THREE.PointLight(l.color, 1, l.distance, 2);
      light.position.copy(l.pos);
      light.power = l.power;
      this.ptLights.add(light);
    }
    if (!this.ptLights.parent) this.scene.add(this.ptLights);
    this.ptLights.updateMatrixWorld(true);
    this.pt?.updateLights();
  }

  /* ------------------------------------------------- path-traced render */
  private pt: WebGLPathTracer | null = null;
  private ptSaved: { env: THREE.Texture | null; bg: THREE.Scene['background']; envI: number; fog: THREE.Scene['fog']; grad: GradientEquirectTexture } | null = null;
  private ptFrame = 0;
  private ptSplit: { orig: THREE.Mesh; parts: THREE.Mesh[] }[] = [];
  readonly ptTarget = 400;
  /** progress of the realistic render; samples = −1 when it stopped, −3 while its shader compiles */
  onRender: ((samples: number, target: number) => void) | null = null;

  get rendering() {
    return !!this.pt;
  }

  /**
   * Realistic picture: traces light rays as they bounce between surfaces
   * (sunlight through windows, lamp light off walls and floors, colour bleeding, soft shadows).
   */
  async startRealistic() {
    if (this.pt || this.photo) return;
    // loaded on demand so the app itself starts fast
    const lib = await import('three-gpu-pathtracer');
    if (this.pt) return;
    this.render();
    const day = 1 - this.nightness;
    const grad = new lib.GradientEquirectTexture(256);
    grad.topColor.set('#0b1020').lerp(new THREE.Color('#5b8fd2'), day);
    grad.bottomColor.set('#07090e').lerp(new THREE.Color('#e4ecf0'), day);
    grad.exponent = 1.6;
    grad.update();
    this.ptSaved = { env: this.scene.environment, bg: this.scene.background, envI: this.scene.environmentIntensity, fog: this.scene.fog, grad };
    this.scene.environment = grad;
    this.scene.background = grad;
    this.scene.environmentIntensity = 0.02 + 0.98 * day;
    this.scene.fog = null;
    this.sky.visible = false;
    this.rooms.forEach((v) => (v.label.visible = false));
    if (this.helper) this.helper.visible = false;
    if (this.roomHelper) this.roomHelper.visible = false;
    // shadow-only stand-ins would show up as real geometry to the path tracer
    if (this.structure) this.structure.shadows.visible = false;
    this.roomShadows.visible = false;

    // box/cylinder/extrude geometries carry material groups; with a single material the
    // rasteriser ignores them but the path tracer would index other materials — drop them
    // and meshes with a material per face (walls) are split into one mesh per material,
    // because this version of the path tracer assumes one material per mesh when merging
    const multi: THREE.Mesh[] = [];
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (Array.isArray(m.material)) multi.push(m);
      else if (m.geometry.groups.length) m.geometry.clearGroups();
    });
    this.ptSplit = [];
    for (const m of multi) {
      if (!m.visible || !m.parent) continue;
      const g = m.geometry;
      const mats = m.material as THREE.Material[];
      const parts = g.groups.map((gr) => {
        const sub = new THREE.BufferGeometry();
        for (const [k, a] of Object.entries(g.attributes)) sub.setAttribute(k, a);
        sub.setIndex(Array.from(g.index!.array.slice(gr.start, gr.start + gr.count)));
        const p = new THREE.Mesh(sub, mats[gr.materialIndex ?? 0]);
        p.position.copy(m.position);
        p.quaternion.copy(m.quaternion);
        p.scale.copy(m.scale);
        m.parent!.add(p);
        return p;
      });
      m.visible = false;
      this.ptSplit.push({ orig: m, parts });
    }
    const r = this.renderer;
    const pt = new lib.WebGLPathTracer(r);
    pt.bounces = 6;
    pt.transmissiveBounces = 6;
    pt.filterGlossyFactor = 0.5;
    pt.multipleImportanceSampling = true;
    pt.textureSize.set(512, 512);
    pt.tiles.set(3, 3);
    pt.renderDelay = 0;
    pt.minSamples = 1;
    pt.fadeDuration = 300;
    pt.dynamicLowRes = true;
    pt.rasterizeSceneCallback = (s, c) => {
      r.clear();
      r.render(s, c);
    };
    this.pt = pt;
    this.applyLights();
    pt.setScene(this.scene, this.camera);
    this.ptFrame = 0;
    this.onRender?.(0, this.ptTarget);
  }

  stopRealistic(notify = false) {
    const pt = this.pt;
    if (!pt) return;
    this.pt = null;
    // the bundled dispose() refers to a field that doesn't exist; free the parts directly
    const a = pt as unknown as Record<string, { dispose?: () => void; material?: Record<string, { dispose?: () => void }> & { dispose?: () => void } } | undefined>;
    for (const k of ['_pathTracer', '_lowResPathTracer']) {
      const m = a[k]?.material;
      if (m) for (const u of ['bvh', 'attributesArray', 'materialIndexAttribute', 'materials', 'textures', 'lights', 'envMapInfo']) m[u]?.dispose?.();
      a[k]?.dispose?.();
    }
    a._quad?.dispose?.();
    for (const { orig, parts } of this.ptSplit) {
      for (const p of parts) {
        p.removeFromParent();
        p.geometry.dispose();
      }
      orig.visible = true;
    }
    this.ptSplit = [];
    const s = this.ptSaved!;
    this.scene.environment = s.env;
    this.scene.background = s.bg;
    this.scene.environmentIntensity = s.envI;
    this.scene.fog = s.fog;
    s.grad.dispose();
    this.ptSaved = null;
    if (this.helper) this.helper.visible = true;
    if (this.roomHelper) this.roomHelper.visible = true;
    if (this.structure) this.structure.shadows.visible = true;
    this.roomShadows.visible = true;
    this.ptLights.children.forEach((c) => (c as THREE.Light).dispose?.());
    this.ptLights.clear();
    this.ptLights.removeFromParent();
    this.setTime(this.lastHour);
    if (notify) this.onRender?.(-1, this.ptTarget);
    this.invalidate();
  }

  /** PNG of what is on screen (the realistic render when it is running). */
  snapshot(): string {
    const el = this.renderer.domElement;
    if (this.pt) {
      const paused = this.pt.pausePathTracing;
      this.pt.pausePathTracing = true;
      this.pt.renderSample();
      const url = el.toDataURL('image/png');
      this.pt.pausePathTracing = paused;
      return url;
    }
    this.render();
    return el.toDataURL('image/png');
  }

  private roomLightKey = '';
  /** A plain ceiling light for rooms that have no lamp of their own. */
  private buildRoomLights() {
    const lamps = this.house.items.filter((i) => catalogById.get(i.t)?.light);
    const dark = this.house.rooms.filter((r) => !r.outdoor && !lamps.some((i) => lvl(i) === lvl(r) && inRoom(r, i.x, i.z)));
    const key = dark.map((r) => [r.id, r.x, r.z, r.w, r.d, r.h, lvl(r)].join()).join('|');
    if (key === this.roomLightKey) return;
    this.roomLightKey = key;
    this.roomLamps = dark.map((r): Lamp => {
      const pos = new THREE.Vector3(r.x, levelY(lvl(r)) + r.h - 0.3, r.z);
      return { id: r.id, kind: 'point', pos, aim: pos.clone().setY(levelY(lvl(r))), angle: 0, level: lvl(r), power: 0, color: new THREE.Color(0xffd6a0), distance: Math.max(r.w, r.d) * 0.8 + 1.5 };
    });
  }

  /* ------------------------------------------------------------------ sync */
  setHouse(h: House) {
    if (this.pt && h !== this.house) this.stopRealistic(true);
    this.house = h;
    const stairs = h.items.filter((i) => catalogById.get(i.t)?.stair);
    const seenR = new Set<string>();
    for (const room of h.rooms) {
      seenR.add(room.id);
      const holes = this.holes(room, stairs);
      const key = JSON.stringify(room) + JSON.stringify(holes);
      const old = this.rooms.get(room.id);
      if (old && old.key === key) continue;
      if (old) this.removeRoomView(old);
      this.rooms.set(room.id, this.buildRoom(room, key, holes));
    }
    this.rooms.forEach((v, id) => !seenR.has(id) && (this.removeRoomView(v), this.rooms.delete(id)));

    const seenI = new Set<string>();
    let added = false;
    for (const it of h.items) {
      seenI.add(it.id);
      const old = this.items.get(it.id);
      const key = `${it.t}|${it.c}`;
      const y = levelY(lvl(it));
      if (old && old.key === key) {
        old.group.position.set(it.x, y, it.z);
        old.group.rotation.y = it.r;
        old.item = it;
        continue;
      }
      if (old) {
        this.itemsGroup.remove(old.group);
        disposeModel(old.group);
      }
      const g = buildModel(it.t, it.c);
      g.position.set(it.x, y, it.z);
      g.rotation.y = it.r;
      g.userData.itemId = it.id;
      this.itemsGroup.add(g);
      const iv: ItemView = { key, item: it, group: g };
      this.attachLight(iv);
      this.items.set(it.id, iv);
      added = true;
    }
    this.items.forEach((v, id) => {
      if (!seenI.has(id)) {
        this.itemsGroup.remove(v.group);
        disposeModel(v.group);
        this.items.delete(id);
      }
    });

    // rebuild the shell only when something it depends on changed
    const sk = JSON.stringify([
      h.rooms.map((r) => [r.id, r.type, r.x, r.z, r.w, r.d, r.h, r.level ?? 0, !!r.outdoor, r.wallPat, r.wallColor]),
      h.items.filter((i) => catalogById.get(i.t)?.opening || i.t === 'frontdoor').map((i) => [i.id, i.t, i.x, i.z, i.l ?? 0]),
      h.ext ?? null,
    ]);
    if (sk !== this.structKey) {
      this.structKey = sk;
      if (this.structure) {
        this.scene.remove(this.structure.group);
        disposeModel(this.structure.group);
      }
      this.structure = buildStructure(h);
      this.scene.add(this.structure.group);
      this.walker?.setWorld(h, this.structure.segs);
      if (this.roofLift > 0) this.structure.roof.visible = false;
    } else this.walker?.setWorld(h, this.structure!.segs);
    this.mapWallItems();
    this.applyDaylight();
    this.buildRoomLights();
    this.placeCeilingItems();
    this.items.forEach((v) => this.syncLight(v));
    if (added) this.applyNight();
    else this.applyLights();
    this.fitShadow();
    this.refreshSelection();
    this.invalidate();
  }

  /**
   * Daylight factor per room: sky light only gets in through glass, so a room's share of the
   * ambient (environment) light follows its window area against its floor area. Deep or
   * windowless rooms come out dimmer than the garden, as they do in reality.
   */
  private applyDaylight() {
    const st = this.structure;
    if (!st) return;
    const glass = new Map<string, number>();
    for (const w of st.walls) {
      for (const g of w.seg.gaps) {
        // windows and glazed doors; doorways between rooms are ignored
        if (g.door && !/slidingdoor/.test(this.items.get(g.id)?.item.t ?? '')) continue;
        const a = (g.b - g.a) * (g.y1 - g.y0);
        for (const id of [w.seg.plus, w.seg.minus]) if (id) glass.set(id, (glass.get(id) ?? 0) + a);
      }
    }
    const df = new Map<string, number>();
    for (const r of this.house.rooms) df.set(r.id, r.outdoor ? 1 : THREE.MathUtils.clamp(0.2 + (2 * (glass.get(r.id) ?? 0)) / (r.w * r.d), 0.2, 1));
    const scale = (m: THREE.Material | THREE.Material[], f: number) => {
      for (const x of Array.isArray(m) ? m : [m]) {
        const s = x as THREE.MeshStandardMaterial;
        if (s.envMapIntensity === undefined) continue;
        s.userData.envBase ??= s.envMapIntensity;
        s.envMapIntensity = s.userData.envBase * f;
      }
    };
    this.rooms.forEach((v) => scale(v.floorMat, df.get(v.room.id) ?? 1));
    st.roomMats.forEach((m, id) => scale(m, df.get(id) ?? 1));
    this.items.forEach((v) => {
      const room = this.house.rooms.find((o) => lvl(o) === lvl(v.item) && inRoom(o, v.item.x, v.item.z));
      const f = room ? df.get(room.id) ?? 1 : 1;
      v.group.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (m) scale(m, f);
      });
    });
  }

  /** Which wall each wall-mounted item hangs on (to hide it with a cut-down wall). */
  private mapWallItems() {
    this.wallOf.clear();
    if (!this.structure) return;
    for (const { item } of this.items.values()) {
      if (catalogById.get(item.t)?.mount !== 'wall') continue;
      const l = lvl(item);
      const w = this.structure.walls.find((v) => {
        if (v.level !== l) return false;
        const perp = v.seg.axis === 'x' ? item.z : item.x, along = v.seg.axis === 'x' ? item.x : item.z;
        return Math.abs(perp - v.seg.c) < 0.15 && along >= v.seg.s0 - 0.05 && along <= v.seg.s1 + 0.05;
      });
      if (w) this.wallOf.set(item.id, w);
    }
  }

  /** Stair wells: cut from the floor above a stair and from the ceiling over it. */
  private holes(room: Room, stairs: Item[]) {
    const out: { floor: number[][]; ceil: number[][] } = { floor: [], ceil: [] };
    if (room.outdoor) return out;
    for (const s of stairs) {
      const st = catalogById.get(s.t)!.stair!;
      const L = lvl(s), R = lvl(room);
      if (L !== R && L !== R - 1) continue;
      const c = Math.abs(Math.cos(s.r)), sn = Math.abs(Math.sin(s.r));
      const hw = (st.w * c + st.len * sn) / 2 + 0.05, hd = (st.w * sn + st.len * c) / 2 + 0.05;
      const x0 = Math.max(s.x - hw, room.x - room.w / 2 + 0.02) - room.x, x1 = Math.min(s.x + hw, room.x + room.w / 2 - 0.02) - room.x;
      const z0 = Math.max(s.z - hd, room.z - room.d / 2 + 0.02) - room.z, z1 = Math.min(s.z + hd, room.z + room.d / 2 - 0.02) - room.z;
      if (x1 - x0 < 0.2 || z1 - z0 < 0.2) continue;
      (L === R ? out.ceil : out.floor).push([x0, z0, x1, z1].map((v) => +v.toFixed(3)));
    }
    return out;
  }

  setSelection(itemId: string | null, roomId: string | null) {
    this.selItem = itemId;
    this.selRoom = roomId;
    this.refreshSelection();
  }

  private refreshSelection() {
    if (this.helper) {
      this.scene.remove(this.helper);
      this.helper.dispose();
      this.helper = null;
    }
    if (this.roomHelper) {
      this.scene.remove(this.roomHelper);
      this.roomHelper.geometry.dispose();
      this.roomHelper = null;
    }
    const accent = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8c6e52');
    const iv = this.selItem ? this.items.get(this.selItem) : null;
    // the selected lamp casts real-time shadows so you can see where its light falls
    this.assignPool(true);
    if (iv) {
      this.helper = new THREE.BoxHelper(iv.group, accent);
      this.scene.add(this.helper);
    } else if (this.selRoom) {
      const rv = this.rooms.get(this.selRoom);
      if (rv) {
        const { w, d } = rv.room;
        const pts = [-w / 2, -d / 2, w / 2, -d / 2, w / 2, -d / 2, w / 2, d / 2, w / 2, d / 2, -w / 2, d / 2, -w / 2, d / 2, -w / 2, -d / 2];
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap((v, i) => (i % 2 ? [0.02, v] : [v])), 3));
        this.roomHelper = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: accent }));
        this.roomHelper.position.set(rv.room.x, levelY(lvl(rv.room)), rv.room.z);
        this.scene.add(this.roomHelper);
      }
    }
    this.invalidate();
  }

  /* ------------------------------------------------------------ room views */
  private buildRoom(room: Room, key: string, holes: { floor: number[][]; ceil: number[][] }): RoomView {
    const { w, d, h } = room;
    const L = lvl(room);
    const g = new THREE.Group();
    g.position.set(room.x, levelY(L), room.z);
    g.userData.roomId = room.id;

    // floor (and the slab under it) as a shape so stair wells can be cut out
    const shape = (cut: number[][]) => {
      const s = new THREE.Shape([new THREE.Vector2(-w / 2, d / 2), new THREE.Vector2(w / 2, d / 2), new THREE.Vector2(w / 2, -d / 2), new THREE.Vector2(-w / 2, -d / 2)]);
      for (const [x0, z0, x1, z1] of cut) s.holes.push(new THREE.Path([new THREE.Vector2(x0, -z0), new THREE.Vector2(x0, -z1), new THREE.Vector2(x1, -z1), new THREE.Vector2(x1, -z0)]));
      return s;
    };
    const f = floorById(room.floor);
    const k = f.unit[0] * room.floorScale, kz = f.unit[1] * room.floorScale;
    const fs = surfaceSet(f, 1 / k, 1 / kz);
    const floorMat = new THREE.MeshPhysicalMaterial({
      ...fs, roughness: 1, clearcoat: f.coat ?? 0, clearcoatRoughness: 0.12,
      color: f.tint ? room.floorTint : '#ffffff', envMapIntensity: 0.8,
    });
    const fg = new THREE.ShapeGeometry(shape(holes.floor));
    fg.rotateX(-Math.PI / 2);
    // ShapeGeometry UVs are the shape's x/y in metres; flip v to match world z
    let proxy: THREE.Object3D | undefined;
    const floor = new THREE.Mesh(fg, floorMat);
    floor.position.y = room.outdoor && L === 0 ? 0.001 : 0.004;
    floor.receiveShadow = true;
    floor.userData.roomId = room.id;
    g.add(floor);
    if (!room.outdoor || L > 0) {
      const t = L > 0 ? 0.3 : 0.12;
      const pad = room.outdoor ? 0 : 0.1;
      const bs = holes.floor.length ? shape(holes.floor) : null;
      const bg = bs ? new THREE.ExtrudeGeometry(bs, { depth: t, bevelEnabled: false }) : new THREE.BoxGeometry(w + 2 * pad, t, d + 2 * pad);
      if (bs) bg.rotateX(-Math.PI / 2);
      else bg.translate(0, t / 2, 0);
      const base = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ color: L > 0 ? '#d6d1c8' : '#4f4842', roughness: 0.9 }));
      base.position.y = -t + 0.001;
      base.receiveShadow = true;
      g.add(base);
      if (L > 0) {
        base.castShadow = true;
        proxy = shadowProxy(base);
        proxy.position.add(g.position);
        this.roomShadows.add(proxy);
      }
    }

    let ceiling: THREE.Mesh | null = null;
    if (!room.outdoor) {
      const cg = new THREE.ShapeGeometry(shape(holes.ceil));
      cg.rotateX(Math.PI / 2);
      ceiling = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ color: '#f5f4f0', roughness: 0.95 }));
      ceiling.position.y = h;
      // flip back so the ceiling's holes line up (rotating +90° mirrors z)
      ceiling.scale.z = -1;
      g.add(ceiling);
    }

    const label = this.makeLabel(room.name, `${(w * d).toFixed(1)} ตร.ม.`);
    label.position.set(0, 0.3, 0);
    g.add(label);
    this.roomsGroup.add(g);
    return { key, room, group: g, floor, floorMat, ceiling, label, proxy };
  }

  private removeRoomView(v: RoomView) {
    if (v.proxy) this.roomShadows.remove(v.proxy);
    this.roomsGroup.remove(v.group);
    disposeModel(v.group);
  }

  private makeLabel(title: string, sub: string) {
    const c = mkCanvas(512, 160);
    const x = ctx2d(c);
    x.fillStyle = 'rgba(22,21,20,.72)';
    x.beginPath();
    x.roundRect(6, 6, 500, 148, 18);
    x.fill();
    x.fillStyle = '#fff';
    x.textAlign = 'center';
    x.font = '500 54px Prompt, sans-serif';
    x.fillText(title, 256, 78);
    x.font = '400 40px Jost, Prompt, sans-serif';
    x.fillStyle = 'rgba(255,255,255,.75)';
    x.fillText(sub, 256, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, fog: false }));
    s.scale.set(1.6, 0.5, 1);
    s.renderOrder = 10;
    s.userData.label = true;
    return s;
  }

  private fitShadow() {
    this.markShadows();
    const box = this.houseBox(null, true);
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    const r = Math.max(s.x, s.z) / 2 + 3;
    this.sun.target.position.copy(c);
    const d = r * 2 + 10;
    this.sun.position.copy(c).addScaledVector(this.sunDir.y > 0.05 ? this.sunDir : UP, d);
    Object.assign(this.sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 0.5, far: d * 2 + s.y });
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  houseBox(roomId?: string | null, all = false) {
    const box = new THREE.Box3();
    const list = roomId ? [this.rooms.get(roomId)].filter(Boolean) : [...this.rooms.values()];
    list.forEach((v) => {
      const r = v!.room;
      const L = lvl(r);
      if (!all && !roomId && this.mode === 'inside' && L > this.level) return;
      const y = levelY(L);
      box.expandByPoint(tmp.set(r.x - r.w / 2, y, r.z - r.d / 2));
      box.expandByPoint(tmp.set(r.x + r.w / 2, y + (r.outdoor ? 0 : r.h), r.z + r.d / 2));
    });
    if (box.isEmpty()) box.set(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 2.7, 2));
    if (!roomId && (all || this.mode !== 'inside')) box.max.y += 2.5;
    return box;
  }

  /* --------------------------------------------------------------- camera */
  private flyTo(pos: THREE.Vector3, target: THREE.Vector3, ms = 650) {
    this.tween = { p0: this.camera.position.clone(), t0: this.controls.target.clone(), p1: pos, t1: target, s: performance.now(), d: ms };
    this.invalidate();
  }

  /** Frame the whole house (or a room) from a named direction. */
  view(kind: 'iso' | 'top' | 'front' | 'back' | 'left' | 'right', roomId?: string | null) {
    if (this.photo) this.exitPhoto();
    if (this.walker) {
      if (roomId) this.walker.goTo(roomId);
      this.invalidate();
      return;
    }
    const box = this.houseBox(roomId);
    const c = box.getCenter(new THREE.Vector3());
    c.y = roomId ? box.min.y + 0.8 : this.mode === 'inside' ? levelY(this.level) + 0.8 : Math.min(c.y, 2.5);
    const s = box.getSize(new THREE.Vector3());
    const k = Math.max(s.x, s.z, 3);
    const dist = (k / 2 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.15;
    const dirs = {
      iso: this.mode === 'inside' ? new THREE.Vector3(0.7, 0.95, 1).normalize() : new THREE.Vector3(0.75, 0.42, 1).normalize(),
      top: new THREE.Vector3(0, 1, 0.0001),
      front: new THREE.Vector3(0, 0.3, 1).normalize(),
      back: new THREE.Vector3(0, 0.3, -1).normalize(),
      left: new THREE.Vector3(-1, 0.3, 0).normalize(),
      right: new THREE.Vector3(1, 0.3, 0).normalize(),
    };
    this.flyTo(c.clone().addScaledVector(dirs[kind], dist), c);
  }

  orbit(dAz: number, dPolar = 0) {
    if (this.photo) return;
    if (this.walker) {
      this.walker.yaw += dAz;
      this.walker.pitch = THREE.MathUtils.clamp(this.walker.pitch - dPolar, -1.2, 1.2);
      this.invalidate();
      return;
    }
    const off = this.camera.position.clone().sub(this.controls.target);
    const sp = new THREE.Spherical().setFromVector3(off);
    sp.theta += dAz;
    sp.phi = THREE.MathUtils.clamp(sp.phi + dPolar, 0.05, this.controls.maxPolarAngle);
    this.flyTo(this.controls.target.clone().add(new THREE.Vector3().setFromSpherical(sp)), this.controls.target.clone(), 380);
  }

  setAzimuth(theta: number) {
    if (this.photo) return;
    if (this.walker) {
      this.walker.yaw = theta + Math.PI;
      this.invalidate();
      return;
    }
    this.tween = null;
    const off = this.camera.position.clone().sub(this.controls.target);
    const sp = new THREE.Spherical().setFromVector3(off);
    sp.theta = theta;
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(sp));
    this.controls.update();
    this.invalidate();
  }

  zoom(f: number) {
    if (this.photo) return;
    if (this.walker) {
      this.walker.target = this.walker.pos.clone().add(new THREE.Vector3(-Math.sin(this.walker.yaw), 0, -Math.cos(this.walker.yaw)).multiplyScalar(f < 1 ? 1.2 : -0.01));
      return;
    }
    const off = this.camera.position.clone().sub(this.controls.target);
    const l = THREE.MathUtils.clamp(off.length() * f, this.controls.minDistance, this.controls.maxDistance);
    this.flyTo(this.controls.target.clone().add(off.setLength(l)), this.controls.target.clone(), 260);
  }

  setAutoRotate(on: boolean) {
    this.controls.autoRotate = on;
    this.controls.autoRotateSpeed = 0.9;
    this.invalidate();
  }

  /* ----------------------------------------------------------------- walk */
  private enterWalk() {
    if (!this.structure) return;
    this.tween = null;
    this.controls.enabled = false;
    this.controls.autoRotate = false;
    this.walker = new Walker(this.house, this.structure.segs);
    this.walker.start();
    this.camera.fov = 70;
    this.camera.updateProjectionMatrix();
    this.walker.apply(this.camera);
  }

  private exitWalk() {
    this.walker = null;
    this.swingDoors(0, true);
    this.look = null;
    this.camera.fov = 45;
    this.camera.updateProjectionMatrix();
    this.controls.enabled = true;
    this.camera.up.set(0, 1, 0);
    this.view('iso');
  }

  /** Doors swing open as you walk up to them (and close behind you). */
  private swingDoors(dt: number, closeAll = false) {
    let moved = false;
    const w = this.walker;
    this.items.forEach((v) => {
      const hinges: THREE.Object3D[] = (v.group.userData.hinges ??= (() => {
        const out: THREE.Object3D[] = [];
        v.group.traverse((o) => o.userData.hinge && out.push(o));
        return out;
      })());
      if (!hinges.length) return;
      const near = !closeAll && w && lvl(v.item) === w.eyeLevel && Math.hypot(w.pos.x - v.item.x, w.pos.z - v.item.z) < 1.9;
      const target = near ? 1 : 0;
      const cur: number = v.group.userData.open ?? 0;
      if (Math.abs(cur - target) < 1e-3) return;
      const next = closeAll ? 0 : THREE.MathUtils.damp(cur, target, 6, dt);
      v.group.userData.open = Math.abs(next - target) < 0.01 ? target : next;
      for (const h of hinges) h.rotation.y = -h.userData.hinge * v.group.userData.open * 1.45;
      moved = true;
    });
    return moved;
  }

  /** On-screen pad: hold to move (f: forward/back, s: strafe, t: turn). */
  walkPad(p: Partial<{ f: number; s: number; t: number }>) {
    if (this.walker) Object.assign(this.walker.pad, p);
  }

  walkTo(roomId: string) {
    this.walker?.goTo(roomId);
    this.invalidate();
  }

  get walkLevel() {
    return this.walker?.eyeLevel ?? 0;
  }

  private onKey = (e: KeyboardEvent) => {
    if (!this.walker) return;
    const t = e.target as HTMLElement;
    if (/INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
    const k = e.key.toLowerCase();
    if (!['w', 'a', 's', 'd', 'q', 'e', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) return;
    e.preventDefault();
    if (e.type === 'keydown') this.walker.keys.add(k);
    else this.walker.keys.delete(k);
  };

  private onBlur = () => {
    this.walker?.keys.clear();
    if (this.walker) Object.assign(this.walker.pad, { f: 0, s: 0, t: 0 });
  };

  private onDbl = (e: MouseEvent) => {
    if (!this.walker) return;
    this.setRay(e);
    const floors = [...this.rooms.values()].filter((v) => v.group.visible).map((v) => v.floor);
    const h = this.ray.intersectObjects(floors, false)[0];
    if (h) this.walker.target = h.point.clone().setY(0);
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.walker) return;
    e.preventDefault();
    this.zoom(e.deltaY < 0 ? 0.8 : 1.25);
  };

  /* ---------------------------------------------------------------- photo */
  enterPhoto(roomId: string, img: HTMLImageElement, pose: Pose, imgH: number, depthOffset: number) {
    const rv = this.rooms.get(roomId);
    if (!rv) return false;
    if (this.photo) this.photo.tex.dispose();
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    this.photo = { roomId, tex, aspect: img.naturalWidth / img.naturalHeight, original: false };
    this.tween = null;
    this.controls.enabled = false;
    this.controls.autoRotate = false;
    const { r1, ry, r2, C } = pose;
    const x = new THREE.Vector3(r1[0], ry[0], r2[0]);
    const y = new THREE.Vector3(-r1[1], -ry[1], -r2[1]);
    const z = new THREE.Vector3(-r1[2], -ry[2], -r2[2]);
    this.camera.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    this.camera.position.set(C[0] + rv.room.x, C[1] + levelY(lvl(rv.room)), C[2] + rv.room.z + depthOffset);
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(imgH / 2 / pose.f));
    this.scene.background = tex;
    this.sky.visible = false;
    this.resize();
    return true;
  }

  setPhotoOriginal(on: boolean) {
    if (!this.photo) return;
    this.photo.original = on;
    this.invalidate();
  }

  get inPhoto() {
    return !!this.photo;
  }

  exitPhoto() {
    if (!this.photo) return;
    this.photo.tex.dispose();
    this.photo = null;
    this.camera.fov = 45;
    this.controls.enabled = true;
    this.controls.target.copy(this.camera.position).add(new THREE.Vector3(0, 0, -2).applyQuaternion(this.camera.quaternion));
    this.resize();
    this.setTime(this.lastHour);
  }

  private lastHour = 15;
  setHour(h: number) {
    this.lastHour = h;
    this.stopRealistic(true);
    if (!this.photo) this.setTime(h);
  }

  /* -------------------------------------------------------------- picking */
  private setRay(e: { clientX: number; clientY: number }) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
  }

  private pickItem(): THREE.Object3D | null {
    const hits = this.ray.intersectObjects(this.itemsGroup.children, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && o.parent !== this.itemsGroup) o = o.parent;
      if (o && o.visible) return o;
    }
    return null;
  }

  private pickRoom(): string | null {
    const floors = [...this.rooms.values()].filter((v) => v.group.visible && (this.mode !== 'inside' || lvl(v.room) === this.level)).map((v) => v.floor);
    const h = this.ray.intersectObjects(floors, false)[0];
    return h ? (h.object.userData.roomId as string) : null;
  }

  private cubeRect() {
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.right - this.cubeSize - 14, y: r.top + 14, s: this.cubeSize };
  }

  private onDown = (e: PointerEvent) => {
    if (e.target !== this.renderer.domElement) return;
    if (this.walker) {
      this.look = { x: e.clientX, y: e.clientY, id: e.pointerId };
      this.walker.target = null;
      this.renderer.domElement.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button > 0) return;
    const cr = this.cubeRect();
    if (!this.photo && e.clientX >= cr.x && e.clientX <= cr.x + cr.s && e.clientY >= cr.y && e.clientY <= cr.y + cr.s) {
      this.onCubeClick(e, cr);
      e.stopPropagation();
      return;
    }
    this.down = { x: e.clientX, y: e.clientY };
    this.setRay(e);
    const obj = this.pickItem();
    if (obj) {
      const id = obj.userData.itemId as string;
      const L = lvl(this.items.get(id)!.item);
      this.plane.constant = -levelY(L);
      if (this.ray.ray.intersectPlane(this.plane, tmp)) {
        this.ev.selectItem(id);
        this.drag = { kind: 'item', id, obj, level: L, off: new THREE.Vector3(obj.position.x - tmp.x, 0, obj.position.z - tmp.z), startX: e.clientX, startY: e.clientY, moved: false, carry: [] };
        this.controls.enabled = false;
        this.renderer.domElement.setPointerCapture(e.pointerId);
        return;
      }
    }
    if (this.planMode) {
      const rid = this.pickRoom();
      const rv = rid ? this.rooms.get(rid) : null;
      const L = rv ? lvl(rv.room) : 0;
      this.plane.constant = -levelY(L);
      if (rv && this.ray.ray.intersectPlane(this.plane, tmp)) {
        this.ev.selectRoom(rv.room.id);
        const { x, z, w, d } = rv.room;
        const carry = [...this.items.values()]
          .filter((iv) => lvl(iv.item) === L && Math.abs(iv.group.position.x - x) <= w / 2 && Math.abs(iv.group.position.z - z) <= d / 2)
          .map((iv) => ({ g: iv.group, dx: iv.group.position.x - x, dz: iv.group.position.z - z }));
        this.drag = { kind: 'room', id: rv.room.id, obj: rv.group, level: L, off: new THREE.Vector3(x - tmp.x, 0, z - tmp.z), startX: e.clientX, startY: e.clientY, moved: false, carry };
        this.controls.enabled = false;
        this.renderer.domElement.setPointerCapture(e.pointerId);
      }
    }
  };

  private onMove = (e: PointerEvent) => {
    if (this.walker) {
      if (this.look && e.pointerId === this.look.id) {
        this.walker.look(e.clientX - this.look.x, e.clientY - this.look.y);
        this.look.x = e.clientX;
        this.look.y = e.clientY;
        this.invalidate();
      }
      return;
    }
    const d = this.drag;
    if (!d) {
      if (e.pointerType === 'mouse' && !e.buttons) {
        this.setRay(e);
        this.renderer.domElement.style.cursor = this.pickItem() ? 'grab' : this.planMode && this.pickRoom() ? 'move' : '';
      }
      return;
    }
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
    d.moved = true;
    this.renderer.domElement.style.cursor = 'grabbing';
    this.setRay(e);
    this.plane.constant = -levelY(d.level);
    if (!this.ray.ray.intersectPlane(this.plane, tmp)) return;
    let x = tmp.x + d.off.x;
    let z = tmp.z + d.off.z;
    const y = levelY(d.level);
    if (d.kind === 'room') {
      [x, z] = this.snapRoom(d.id, x, z);
      d.obj.position.set(x, y, z);
      for (const c of d.carry) c.g.position.set(x + c.dx, y, z + c.dz);
    } else {
      const iv = this.items.get(d.id)!;
      const def = catalogById.get(iv.item.t);
      if (def?.mount === 'wall') {
        const s = this.snapWall(x, z, d.level);
        if (s) {
          d.obj.position.set(s.x, y, s.z);
          d.obj.rotation.y = s.r;
        } else d.obj.position.set(x, y, z);
      } else d.obj.position.set(Math.round(x * 100) / 100, y, Math.round(z * 100) / 100);
      const dv = this.items.get(d.id);
      if (dv) {
        this.syncLight(dv);
        if (dv.spec) this.assignPool(true);
      }
      this.markShadows();
    }
    this.helper?.update();
    this.invalidate();
  };

  private onUp = (e: PointerEvent) => {
    if (this.walker) {
      if (this.look?.id === e.pointerId) this.look = null;
      return;
    }
    const d = this.drag;
    if (d) {
      this.drag = null;
      this.controls.enabled = !this.photo;
      this.renderer.domElement.style.cursor = '';
      if (d.moved) {
        if (d.kind === 'item') this.ev.itemMoved(d.id, d.obj.position.x, d.obj.position.z, d.obj.rotation.y);
        else this.ev.roomMoved(d.id, d.obj.position.x, d.obj.position.z);
      }
      this.down = null;
      return;
    }
    if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 5) {
      this.setRay(e);
      if (!this.pickItem()) {
        this.ev.selectItem(null);
        this.ev.selectRoom(this.pickRoom());
      }
    }
    this.down = null;
  };

  /** Room drag: 5 cm grid, edges snap to neighbouring rooms within 25 cm (any storey, to stack floors). */
  private snapRoom(id: string, x: number, z: number): [number, number] {
    const me = this.rooms.get(id)!.room;
    x = Math.round(x * 20) / 20;
    z = Math.round(z * 20) / 20;
    let bx = 0.25, bz = 0.25, sx = x, sz = z;
    for (const v of this.rooms.values()) {
      if (v.room.id === id) continue;
      const o = v.room;
      for (const [a, b] of [[x - me.w / 2, o.x + o.w / 2], [x + me.w / 2, o.x - o.w / 2], [x - me.w / 2, o.x - o.w / 2], [x + me.w / 2, o.x + o.w / 2]]) {
        if (Math.abs(a - b) < bx) { bx = Math.abs(a - b); sx = x + (b - a); }
      }
      for (const [a, b] of [[z - me.d / 2, o.z + o.d / 2], [z + me.d / 2, o.z - o.d / 2], [z - me.d / 2, o.z - o.d / 2], [z + me.d / 2, o.z + o.d / 2]]) {
        if (Math.abs(a - b) < bz) { bz = Math.abs(a - b); sz = z + (b - a); }
      }
    }
    return [sx, sz];
  }

  /** Nearest wall line among indoor rooms of a storey; returns position on the wall and inward-facing rotation. */
  snapWall(x: number, z: number, level = this.level) {
    let best: { x: number; z: number; r: number; d: number } | null = null;
    for (const v of this.rooms.values()) {
      const o = v.room;
      if (o.outdoor || lvl(o) !== level) continue;
      const x0 = o.x - o.w / 2, x1 = o.x + o.w / 2, z0 = o.z - o.d / 2, z1 = o.z + o.d / 2;
      const cx = THREE.MathUtils.clamp(x, x0 + 0.3, x1 - 0.3);
      const cz = THREE.MathUtils.clamp(z, z0 + 0.3, z1 - 0.3);
      const cands = [
        { x: cx, z: z0, r: 0, d: Math.hypot(x - cx, z - z0) },
        { x: cx, z: z1, r: Math.PI, d: Math.hypot(x - cx, z - z1) },
        { x: x0, z: cz, r: Math.PI / 2, d: Math.hypot(x - x0, z - cz) },
        { x: x1, z: cz, r: -Math.PI / 2, d: Math.hypot(x - x1, z - cz) },
      ];
      for (const c of cands) if (!best || c.d < best.d) best = c;
    }
    return best && best.d < 1.2 ? best : null;
  }

  /* ------------------------------------------------------------ view cube */
  private makeCube() {
    const faces = ['ขวา', 'ซ้าย', 'บน', 'ล่าง', 'หน้า', 'หลัง'];
    const mats = faces.map((t) => {
      const c = mkCanvas(128);
      const x = ctx2d(c);
      x.fillStyle = '#f4f2ee';
      x.fillRect(0, 0, 128, 128);
      x.strokeStyle = '#8c6e52';
      x.lineWidth = 6;
      x.strokeRect(3, 3, 122, 122);
      x.fillStyle = '#2a2623';
      x.font = '500 34px Prompt, sans-serif';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(t, 64, 66);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return new THREE.MeshBasicMaterial({ map: tex });
    });
    return new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), mats);
  }

  private onCubeClick(e: PointerEvent, cr: { x: number; y: number; s: number }) {
    const nx = ((e.clientX - cr.x) / cr.s) * 2 - 1;
    const ny = -((e.clientY - cr.y) / cr.s) * 2 + 1;
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(nx, ny), this.cubeCam);
    const h = rc.intersectObject(this.cube)[0];
    if (!h || !h.face) return;
    const n = h.face.normal.clone();
    const map: Record<string, 'right' | 'left' | 'top' | 'front' | 'back'> = { '1,0,0': 'right', '-1,0,0': 'left', '0,1,0': 'top', '0,0,1': 'front', '0,0,-1': 'back' };
    const k = map[[n.x, n.y, n.z].map(Math.round).join(',')];
    if (k) this.view(k);
  }

  /* -------------------------------------------------------------- render */
  /* ------------------------------------------------------- auto quality */
  private frameAvg = 16;
  private busyFrames = 0;
  private pixelCap = 1.5;
  /**
   * Watch how long frames take while the view is moving; if this machine can't keep ~30 fps,
   * step the resolution down (once per step, so the picture never flickers between sizes).
   */
  private adapt(gap: number) {
    if (!this.dirty || this.pt || gap > 200) {
      this.busyFrames = 0;
      return;
    }
    this.frameAvg += (gap - this.frameAvg) * 0.1;
    if (++this.busyFrames < 45 || this.frameAvg < 36) return;
    const pr = this.renderer.getPixelRatio();
    if (pr <= 0.76) return;
    this.pixelCap = Math.max(0.75, pr - 0.25);
    this.renderer.setPixelRatio(this.pixelCap);
    this.busyFrames = 0;
    this.frameAvg = 16;
    this.resize();
  }

  resize() {
    const r = this.host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const el = this.renderer.domElement;
    if (this.photo) {
      let W = r.width, H = r.height;
      if (W / H > this.photo.aspect) W = H * this.photo.aspect;
      else H = W / this.photo.aspect;
      this.renderer.setSize(W, H, false);
      Object.assign(el.style, { left: `${(r.width - W) / 2}px`, top: `${(r.height - H) / 2}px`, width: `${W}px`, height: `${H}px` });
      this.camera.aspect = W / H;
    } else {
      this.renderer.setSize(r.width, r.height, false);
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(r.width, r.height);
      Object.assign(el.style, { left: '0', top: '0', width: '100%', height: '100%' });
      this.camera.aspect = r.width / r.height;
    }
    this.cubeSize = r.width < 520 ? 72 : 96;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const gap = now - this.last;
    const dt = Math.min(0.05, gap / 1000);
    this.adapt(gap);
    this.last = now;
    if (this.tween) {
      let t = Math.min(1, (now - this.tween.s) / this.tween.d);
      t = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      this.camera.position.lerpVectors(this.tween.p0, this.tween.p1, t);
      this.controls.target.lerpVectors(this.tween.t0, this.tween.t1, t);
      if (t >= 1) this.tween = null;
      this.dirty = true;
    }
    if (this.roofAnim) {
      const t = Math.min(1, (now - this.roofAnim.s) / 550);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      this.roofLift = this.roofAnim.from + (this.roofAnim.to - this.roofAnim.from) * e;
      if (t >= 1) this.roofAnim = null;
      this.dirty = true;
    }
    if (this.walker) {
      if (this.walker.update(dt)) this.dirty = true;
      if (this.swingDoors(dt)) this.dirty = true;
      if (this.dirty) this.walker.apply(this.camera);
    } else if (!this.photo && this.controls.update()) this.dirty = true;
    if (this.pt) {
      // path tracing: keep adding samples; any camera move starts the picture over
      if (this.dirty) this.pt.updateCamera();
      this.dirty = false;
      this.pt.pausePathTracing = this.pt.samples >= this.ptTarget;
      this.pt.renderSample();
      if (++this.ptFrame % 8 === 0) this.onRender?.((this.pt as unknown as { isCompiling: boolean }).isCompiling ? -3 : Math.floor(this.pt.samples), this.ptTarget); // isCompiling is missing from the bundled types
      return;
    }
    if (this.dirty) {
      this.dirty = false;
      this.stillSince = now;
      this.refined = false;
      this.render(false);
    } else if (!this.refined && now - this.stillSince > 180) {
      this.refined = true;
      this.render(true);
    }
  };

  private render(full = true) {
    const cam = this.camera.position;
    const looking = new THREE.Spherical().setFromVector3(cam.clone().sub(this.controls.target));
    const inside = this.mode === 'inside' && !this.photo;
    const AL = this.level;
    const showLevel = (l: number) => !inside || l <= AL;
    const showLabels = !this.photo && !this.walker && (this.planMode || looking.phi < 0.6);
    const orig = this.photo?.original ?? false;
    const photoRoom = this.photo?.roomId ?? null;

    this.rooms.forEach((v) => {
      const L = lvl(v.room);
      v.group.visible = showLevel(L);
      v.label.visible = showLabels && (!inside || L === AL);
      v.floor.material = photoRoom === v.room.id && orig ? this.shadowMat : v.floorMat;
      if (v.ceiling) {
        const y = levelY(L);
        const inRoomNow = inRoom(v.room, cam.x, cam.z) && cam.y > y && cam.y < y + v.room.h;
        v.ceiling.visible = inRoomNow && !(photoRoom === v.room.id && orig);
      }
    });

    const st = this.structure;
    this.lowWalls.clear();
    if (st) {
      for (const wv of st.walls) {
        if (!showLevel(wv.level)) {
          wv.group.visible = false;
          continue;
        }
        wv.group.visible = true;
        let low = false;
        let hide = false;
        if (this.photo) {
          const s = wv.seg;
          if (s.plus === photoRoom || s.minus === photoRoom) {
            const inward = s.axis === 'x' ? new THREE.Vector3(0, 0, s.plus === photoRoom ? 1 : -1) : new THREE.Vector3(s.plus === photoRoom ? 1 : -1, 0, 0);
            hide = orig || tmp.copy(cam).sub(wv.centre).dot(inward) < 0;
          }
        } else if (inside && wv.level === AL) {
          if (this.wallMode === 'low') low = true;
          else if (this.wallMode === 'auto' && wv.out) low = tmp.copy(cam).sub(wv.centre).dot(wv.out) > 0;
        }
        wv.group.visible = !hide;
        if (low || hide) this.lowWalls.add(wv);
        for (const p of wv.pieces) {
          if (!low) {
            p.mesh.visible = true;
            p.mesh.scale.y = 1;
          } else if (p.y0 >= LOW) p.mesh.visible = false;
          else {
            p.mesh.visible = true;
            p.mesh.scale.y = Math.min(1, (LOW - p.y0) / p.h);
          }
        }
      }
      for (const [l, g] of st.extras) {
        g.visible = showLevel(l);
        // roof decks / carport sheets would cover the storey being edited
        g.children.forEach((c) => (c.visible = !(inside && l >= AL && (c.position.y > levelY(l) + 2.5))));
      }
      st.roof.visible = this.roofLift < 0.999;
      st.roof.position.y = st.roof.userData.y0 ?? (st.roof.userData.y0 = st.roof.position.y);
      st.roof.position.y += this.roofLift * 6;
    }

    this.items.forEach((v) => {
      const wv = this.wallOf.get(v.item.id);
      v.group.visible = showLevel(lvl(v.item)) && !(wv && this.lowWalls.has(wv) && !this.photo);
      // ceiling fixtures would float in mid-air when looking down into a roofless room
      if (v.group.visible && inside && catalogById.get(v.item.t)?.mount === 'ceiling') v.group.visible = cam.y < v.group.position.y + 2.7;
    });
    this.assignPool();

    this.helper?.update();
    const r = this.renderer;
    const size = r.getSize(new THREE.Vector2());
    r.setViewport(0, 0, size.x, size.y);
    r.setScissorTest(false);
    r.clear();
    if (this.shadowDirty && r.shadowMap.enabled) this.updateShadows();
    // while moving draw straight to screen; ambient occlusion + bloom go on the settled frame
    if (this.fx && !this.photo && full) {
      this.bloom.strength = 0.15 + 0.25 * this.nightness;
      this.composer.render();
    } else r.render(this.scene, this.camera);
    if (!this.photo && !this.walker) {
      const s = this.cubeSize;
      r.clearDepth();
      r.setScissorTest(true);
      r.setScissor(size.x - s - 14, size.y - s - 14, s, s);
      r.setViewport(size.x - s - 14, size.y - s - 14, s, s);
      this.cube.quaternion.copy(this.camera.quaternion).invert();
      this.cubeCam.position.set(0, 0, 4);
      this.cubeCam.lookAt(0, 0, 0);
      r.render(this.cubeScene, this.cubeCam);
      r.setScissorTest(false);
      r.setViewport(0, 0, size.x, size.y);
    }
    const theta = this.walker ? this.walker.yaw + Math.PI : looking.theta;
    const key = `${theta.toFixed(2)}|${looking.phi.toFixed(2)}`;
    if (key !== this.lastView) {
      this.lastView = key;
      this.ev.view(theta, looking.phi);
    }
  }
}
