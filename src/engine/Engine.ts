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
import { catalogById } from '../data/catalog';
import { floorById } from '../data/surfaces';
import type { House, Item, Quality, Room, ViewMode, WallMode } from '../types';
import { inRoom, levelY } from '../lib/shell';
import { kelvinRGB } from '../lib/kelvin';
import { buildModel, disposeModel } from './models';
import { setAnisotropy, surfaceSet } from './textures';
import { ctx2d, mkCanvas } from './canvas';
import { LOW, buildStructure, type Structure, type WallView } from './structure';
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
}
interface ItemView {
  key: string;
  item: Item;
  group: THREE.Group;
  light?: THREE.PointLight | THREE.SpotLight;
  glow?: THREE.MeshStandardMaterial[];
}

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
  private roomLights = new THREE.Group();
  private roomsGroup = new THREE.Group();
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
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.9;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
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

    this.scene.add(this.sun, this.sun.target, this.roomsGroup, this.itemsGroup, this.roomLights, this.lampGroup);

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
    this.bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.22, 0.45, 0.95);
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
    this.renderer.setPixelRatio(q === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : 1);
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
    if (was === 'walk') this.exitWalk();
    if (m === 'walk') this.enterWalk();
    const lift = m === 'inside' ? 1 : 0;
    if (lift !== this.roofLift || this.roofAnim) this.roofAnim = { from: this.roofLift, to: lift, s: performance.now() };
    this.invalidate();
  }

  setLevel(l: number) {
    this.level = l;
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
    this.sun.intensity = 2.6 * smooth(0, 0.18, sinE);
    this.sun.color.set('#ff9b5c').lerp(new THREE.Color('#fff1dc'), low);
    this.hemi.intensity = 0.06 + 0.5 * day;
    this.hemi.color.set('#40507a').lerp(new THREE.Color('#ffffff'), day);
    this.scene.environmentIntensity = 0.04 + 0.51 * day;
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

  /** A real light source for a lamp item, from its catalogue spec. */
  private attachLight(v: ItemView) {
    const spec = catalogById.get(v.item.t)?.light;
    if (!spec) return;
    const [x, y, z] = spec.at;
    let l: THREE.PointLight | THREE.SpotLight;
    if (spec.kind === 'spot') {
      const s = new THREE.SpotLight(0xffffff, 1, 9, spec.angle ?? 0.6, 0.55, 2);
      const [ax, ay, az] = spec.aim ?? [x, 0, z];
      s.userData.aim = new THREE.Vector3(ax, ay, az);
      this.lampGroup.add(s.target);
      s.shadow.mapSize.set(1024, 1024);
      s.shadow.bias = -0.0006;
      s.shadow.normalBias = 0.02;
      s.shadow.camera.near = 0.05;
      s.shadow.camera.far = 8;
      l = s;
    } else {
      l = new THREE.PointLight(0xffffff, 1, 10, 2);
      l.shadow.mapSize.set(512, 512);
      l.shadow.bias = -0.002;
      l.shadow.camera.near = 0.05;
    }
    // lights live outside the item so hiding a storey never changes the light count (no shader recompiles)
    l.userData.at = new THREE.Vector3(x, y, z);
    l.userData.level = lvl(v.item);
    this.lampGroup.add(l);
    v.light = l;
    v.glow = [];
    v.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && m.emissive && m.emissiveIntensity > 0 && m.emissive.getHex() !== 0) {
        m.userData.glow ??= m.emissiveIntensity;
        v.glow!.push(m);
      }
    });
  }

  /** Place a lamp's light where its fixture is (lights are kept in world space). */
  private syncLight(v: ItemView) {
    const l = v.light;
    if (!l) return;
    v.group.updateMatrixWorld();
    l.position.copy(l.userData.at).applyMatrix4(v.group.matrixWorld);
    l.userData.level = lvl(v.item);
    if ((l as THREE.SpotLight).isSpotLight) (l as THREE.SpotLight).target.position.copy(l.userData.aim).applyMatrix4(v.group.matrixWorld);
    l.updateMatrixWorld();
  }

  private dropLight(v: ItemView) {
    const l = v.light;
    if (!l) return;
    if ((l as THREE.SpotLight).isSpotLight) this.lampGroup.remove((l as THREE.SpotLight).target);
    this.lampGroup.remove(l);
    l.dispose();
    v.light = undefined;
  }

  private lampGroup = new THREE.Group();

  /** Lamp brightness/colour from each item's lumens and colour temperature. */
  private applyLights() {
    // by day lamps add almost nothing next to the sun, so skip their cost until dusk
    this.lampGroup.visible = this.nightness > 0.3 || !!this.pt;
    // eye adaptation: lamps matter at night, barely in daylight
    const k = 0.3 * (0.14 + 0.86 * this.nightness);
    const lit = new Set<string>();
    this.items.forEach((v) => {
      if (!v.light) return;
      const spec = catalogById.get(v.item.t)!.light!;
      const on = !v.item.off;
      const lm = v.item.lm ?? spec.lm;
      const [r, g, b] = kelvinRGB(v.item.k ?? 3000);
      v.light.color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
      // three.js gives a spot the intensity power/π (a point light gets power/4π): scale so equal lumens look equal
      const kind = (v.light as THREE.SpotLight).isSpotLight ? 0.3 : 1;
      v.light.userData.power = on ? lm * k * kind : 0;
      for (const m of v.glow ?? []) {
        m.emissive.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
        m.emissiveIntensity = on ? (m.userData.glow as number) * Math.min(2, lm / spec.lm) : 0;
      }
      if (on) {
        const room = this.house.rooms.find((o) => !o.outdoor && lvl(o) === lvl(v.item) && inRoom(o, v.item.x, v.item.z));
        if (room) lit.add(room.id);
      }
    });
    // rooms without any lamp of their own get a plain ceiling light
    this.roomLights.children.forEach((l) => {
      const p = l as THREE.PointLight;
      p.userData.power = lit.has(p.userData.room) || !this.night ? 0 : 1600 * k;
    });
    this.pt?.updateLights();
    this.invalidate();
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
  /** A plain ceiling light for rooms that have no lamp of their own (rebuilt only when that set changes). */
  private buildRoomLights() {
    const lamps = this.house.items.filter((i) => catalogById.get(i.t)?.light);
    const dark = this.house.rooms.filter((r) => !r.outdoor && !lamps.some((i) => lvl(i) === lvl(r) && inRoom(r, i.x, i.z)));
    const key = dark.map((r) => [r.id, r.x, r.z, r.w, r.d, r.h, lvl(r)].join()).join('|');
    if (key === this.roomLightKey) return;
    this.roomLightKey = key;
    this.roomLights.children.forEach((c) => (c as THREE.PointLight).dispose());
    this.roomLights.clear();
    for (const r of dark) {
      const l = new THREE.PointLight(0xffd6a0, 1, Math.max(r.w, r.d) * 1.6 + 2, 2);
      l.userData.room = r.id;
      l.position.set(r.x, levelY(lvl(r)) + r.h - 0.3, r.z);
      l.userData.level = lvl(r);
      this.roomLights.add(l);
    }
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
        this.dropLight(old);
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
        this.dropLight(v);
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
    this.buildRoomLights();
    this.placeCeilingItems();
    this.items.forEach((v) => this.syncLight(v));
    if (added) this.applyNight();
    else this.applyLights();
    this.fitShadow();
    this.refreshSelection();
    this.invalidate();
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
    this.items.forEach((v) => v.light && (v.light.castShadow = v === iv && this.renderer.shadowMap.enabled));
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
      base.castShadow = L > 0;
      g.add(base);
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
    return { key, room, group: g, floor, floorMat, ceiling, label };
  }

  private removeRoomView(v: RoomView) {
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
      if (dv) this.syncLight(dv);
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
    const dt = Math.min(0.05, (now - this.last) / 1000);
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
    if (!this.dirty) return;
    this.dirty = false;
    this.render();
  };

  private render() {
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
    // lamps on hidden storeys are dimmed to zero rather than hidden
    for (const l of [...this.roomLights.children, ...this.lampGroup.children] as THREE.PointLight[]) {
      if (l.isLight) l.power = showLevel(l.userData.level) ? (l.userData.power ?? 0) : 0;
    }

    this.helper?.update();
    const r = this.renderer;
    const size = r.getSize(new THREE.Vector2());
    r.setViewport(0, 0, size.x, size.y);
    r.setScissorTest(false);
    r.clear();
    if (this.fx && !this.photo) {
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
