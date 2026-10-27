import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CATEGORIES, catalogById, type CatalogItem } from '../data/catalog';
import { buildModel, disposeModel } from '../engine/models';
import { stageLights } from '../engine/thumbs';
import { baht } from '../lib/boq';

interface Props {
  item: CatalogItem;
  roomName?: string;
  onAdd: (color: string) => void;
  onClose: () => void;
  onStep: (dir: 1 | -1) => void;
}

/** Large studio preview of one catalogue item: live 3D, drag to turn, colour choice. */
export function ItemPreview({ item, roomName, onAdd, onClose, onStep }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<{ set: (t: string, c: string) => void; spin: (on: boolean) => void } | null>(null);
  const [color, setColor] = useState(item.colors[0]);
  const [spin, setSpin] = useState(true);

  useEffect(() => setColor(item.colors[0]), [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // one renderer for the life of the dialog
  useEffect(() => {
    const el = host.current!;
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.95;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(r.domElement);

    const scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(r);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    const sun = new THREE.DirectionalLight(0xfff4e6, 1.8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.24 }));
    ground.receiveShadow = true;
    scene.add(sun, sun.target, ground, new THREE.HemisphereLight(0xffffff, 0x887766, 0.5));

    const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    const ctl = new OrbitControls(cam, r.domElement);
    ctl.enableDamping = true;
    ctl.enablePan = false;
    ctl.autoRotate = true;
    ctl.autoRotateSpeed = 1.6;
    ctl.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.ROTATE };
    const noAutoscroll = (e: MouseEvent) => { if (e.button === 1) e.preventDefault(); };
    r.domElement.addEventListener('mousedown', noAutoscroll);

    let model: THREE.Group | null = null;
    let wall = false, spinOn = true;
    const set = (t: string, c: string) => {
      if (model) { scene.remove(model); disposeModel(model); }
      model = buildModel(t, c);
      model.traverse((o) => { if ((o as THREE.PointLight).isPointLight) (o as THREE.PointLight).intensity = 0; });
      scene.add(model);
      const box = new THREE.Box3().setFromObject(model);
      const centre = box.getCenter(new THREE.Vector3());
      const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.15);
      wall = catalogById.get(t)?.mount === 'wall';
      ctl.autoRotate = spinOn && !wall;
      stageLights(sun, ground, centre, box.min.y, radius, wall);
      const dist = radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * 1.05;
      cam.position.copy(centre).addScaledVector(new THREE.Vector3(0.75, 0.5, 1).normalize(), dist);
      cam.near = dist / 50;
      cam.far = dist * 6;
      cam.updateProjectionMatrix();
      ctl.target.copy(centre);
      ctl.minDistance = dist * 0.45;
      ctl.maxDistance = dist * 2;
      // wall items are seen from the front only; floor items can be turned all round
      ctl.minAzimuthAngle = wall ? -1.1 : -Infinity;
      ctl.maxAzimuthAngle = wall ? 1.1 : Infinity;
      ctl.maxPolarAngle = wall ? Math.PI * 0.75 : Math.PI / 2.05;
      ctl.update();
    };

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      r.setSize(w, h);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      ctl.update();
      r.render(scene, cam);
    };
    loop();
    stage.current = { set, spin: (on) => { spinOn = on; ctl.autoRotate = on && !wall; } };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      ctl.dispose();
      r.domElement.removeEventListener('mousedown', noAutoscroll);
      if (model) disposeModel(model);
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      scene.environment?.dispose();
      r.dispose();
      r.domElement.remove();
      stage.current = null;
    };
  }, []);

  useEffect(() => stage.current?.set(item.id, color), [item.id, color]);
  useEffect(() => stage.current?.spin(spin), [spin, item.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      else if (e.key === 'ArrowRight') onStep(1);
      else if (e.key === 'ArrowLeft') onStep(-1);
      else if (e.key === 'Enter') onAdd(color);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [color, onAdd, onClose, onStep]);

  const cats = item.cats.map((c) => CATEGORIES.find((x) => x.id === c)?.name).filter(Boolean).join(' · ');

  return (
    <div className="preview-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="preview" role="dialog" aria-modal="true" aria-label={item.name}>
        <div className="stage" ref={host}>
          <button className="step prev" onClick={() => onStep(-1)} aria-label="ชิ้นก่อนหน้า">‹</button>
          <button className="step next" onClick={() => onStep(1)} aria-label="ชิ้นถัดไป">›</button>
          <span className="hint">ลากเพื่อหมุนดูรอบด้าน · ลูกกลิ้งเพื่อซูม</span>
        </div>
        <div className="info">
          <button className="close" onClick={onClose} aria-label="ปิด">×</button>
          <small>{cats}</small>
          <h2>{item.name}</h2>
          <dl>
            <dt>ขนาด</dt><dd>{item.size}</dd>
            <dt>ราคาประมาณ</dt><dd>{item.price ? baht(item.price) : '–'}</dd>
            <dt>การติดตั้ง</dt><dd>{item.mount === 'wall' ? 'ติดผนัง' : 'วางพื้น'}</dd>
          </dl>
          {item.colors.length > 1 && (
            <div className="colours">
              <small>สี / วัสดุ</small>
              <div className="paints">
                {item.colors.map((c) => (
                  <button key={c} className="dot" style={{ background: c }} aria-pressed={c === color} aria-label={`สี ${c}`} onClick={() => setColor(c)} />
                ))}
              </div>
            </div>
          )}
          <label className="spin">
            <input type="checkbox" checked={spin} onChange={(e) => setSpin(e.target.checked)} disabled={item.mount === 'wall'} /> หมุนอัตโนมัติ
          </label>
          <span className="grow" />
          <button className="btn primary" onClick={() => onAdd(color)}>{roomName ? `วางใน${roomName}` : 'วางในบ้าน'}</button>
        </div>
      </div>
    </div>
  );
}
