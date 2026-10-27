import { useEffect, useMemo, useState } from 'react';
import { generateHouse, type GenOptions } from '../data/generate';
import { EXT_COLORS, EXT_WALLS, ROOF_COLORS, wallById } from '../data/surfaces';
import { surfaceThumb } from '../engine/textures';
import { getEngine } from '../photo';
import { useStore } from '../store';
import { DEFAULT_EXT, type RoofStyle } from '../types';

export const ROOFS: { id: RoofStyle; name: string; path: string }[] = [
  { id: 'hip', name: 'ปั้นหยา', path: 'M4 30 L20 14 H44 L60 30 Z' },
  { id: 'gable', name: 'จั่ว', path: 'M8 30 L32 10 L56 30 Z' },
  { id: 'flat', name: 'แบน', path: 'M6 22 H58 V30 H6 Z M6 16 H10 V22 H6 Z M54 16 H58 V22 H54 Z' },
  { id: 'none', name: 'ไม่มี', path: 'M10 30 H54' },
];

function RoofIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 64 44" aria-hidden>
      <path d={path} fill="currentColor" opacity=".85" />
      <rect x="14" y="30" width="36" height="12" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="stepper">
      <span>{label}</span>
      <button onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`ลด${label}`}>−</button>
      <b>{value}</b>
      <button onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`เพิ่ม${label}`}>+</button>
    </div>
  );
}

/** Choose a few things, get a whole furnished house. */
export function HouseDesigner() {
  const generate = useStore((s) => s.generate);
  const [o, setO] = useState<GenOptions>({ floors: 2, bedrooms: 3, bathrooms: 2, garage: true, garden: true, roof: 'hip' });
  const [armed, setArmed] = useState(false);
  useEffect(() => setArmed(false), [o]);
  const up = (p: Partial<GenOptions>) => setO((x) => ({ ...x, ...p }));
  const sum = useMemo(() => {
    const h = generateHouse(o);
    const indoor = h.rooms.filter((r) => !r.outdoor);
    return { area: indoor.reduce((a, r) => a + r.w * r.d, 0), rooms: indoor.length, items: h.items.length };
  }, [o]);

  return (
    <div className="designer">
      <div className="seg wide" role="group" aria-label="จำนวนชั้น">
        <button aria-pressed={o.floors === 1} onClick={() => up({ floors: 1 })}>บ้านชั้นเดียว</button>
        <button aria-pressed={o.floors === 2} onClick={() => up({ floors: 2 })}>บ้าน 2 ชั้น</button>
      </div>
      <div className="steppers">
        <Stepper label="ห้องนอน" value={o.bedrooms} min={1} max={6} onChange={(bedrooms) => up({ bedrooms })} />
        <Stepper label="ห้องน้ำ" value={o.bathrooms} min={1} max={5} onChange={(bathrooms) => up({ bathrooms })} />
      </div>
      <div className="roofs" role="group" aria-label="แบบหลังคา">
        {ROOFS.slice(0, 3).map((r) => (
          <button key={r.id} aria-pressed={o.roof === r.id} onClick={() => up({ roof: r.id })}>
            <RoofIcon path={r.path} />
            {r.name}
          </button>
        ))}
      </div>
      <div className="row">
        <label className="check"><input type="checkbox" checked={o.garage} onChange={(e) => up({ garage: e.target.checked })} /> โรงจอดรถ</label>
        <label className="check"><input type="checkbox" checked={o.garden} onChange={(e) => up({ garden: e.target.checked })} /> สวนหน้าบ้าน</label>
      </div>
      <p className="note">ได้บ้านพื้นที่ใช้สอยประมาณ <b>{sum.area.toFixed(0)} ตร.ม.</b> · {sum.rooms} ห้อง · จัดของให้ {sum.items} ชิ้น พร้อมประตู หน้าต่าง{o.floors === 2 ? ' บันได' : ''}</p>
      <button
        className={`btn primary${armed ? ' armed' : ''}`}
        onClick={() => {
          if (!armed) return setArmed(true);
          generate(o);
          setArmed(false);
          setTimeout(() => getEngine()?.view('iso'), 30);
        }}
      >
        {armed ? 'กดอีกครั้งเพื่อแทนที่บ้านปัจจุบัน (ย้อนกลับได้)' : 'สร้างบ้านหลังนี้'}
      </button>
    </div>
  );
}

/** Roof, facade, fence. */
export function ExteriorEditor() {
  const raw = useStore((s) => s.house.ext);
  const ext = { ...DEFAULT_EXT, ...raw };
  const setExt = useStore((s) => s.setExt);
  const [pitch, setPitch] = useState(ext.pitch);
  useEffect(() => setPitch(ext.pitch), [ext.pitch]);
  const sloped = ext.roof === 'hip' || ext.roof === 'gable';

  return (
    <>
      <h3>หลังคา</h3>
      <div className="roofs four" role="group" aria-label="แบบหลังคา">
        {ROOFS.map((r) => (
          <button key={r.id} aria-pressed={ext.roof === r.id} onClick={() => setExt({ roof: r.id })}>
            <RoofIcon path={r.path} />
            {r.name}
          </button>
        ))}
      </div>
      {ext.roof !== 'none' && ext.roof !== 'flat' && (
        <div className="paints">
          {ROOF_COLORS.map((c) => <button key={c} className="dot" style={{ background: c }} aria-pressed={c === ext.roofColor} aria-label={`สีหลังคา ${c}`} onClick={() => setExt({ roofColor: c })} />)}
        </div>
      )}
      {sloped && (
        <div className="field">
          <label htmlFor="pitch">ความชัน {pitch}°</label>
          <input id="pitch" type="range" min={15} max={40} step={1} value={pitch}
            onChange={(e) => setPitch(+e.target.value)}
            onPointerUp={() => pitch !== ext.pitch && setExt({ pitch })}
            onKeyUp={() => pitch !== ext.pitch && setExt({ pitch })} />
        </div>
      )}
      <h3>ผนังภายนอก</h3>
      <div className="grid small">
        {EXT_WALLS.map((id) => {
          const w = wallById(id);
          return (
            <button key={id} className="card swatch" aria-pressed={ext.wallPat === id} onClick={() => setExt({ wallPat: id })}>
              <span className="img"><img src={surfaceThumb(w)} alt="" /></span>
              <span className="t">{w.name}</span>
            </button>
          );
        })}
      </div>
      <div className="paints">
        {EXT_COLORS.map((c) => <button key={c} className="dot" style={{ background: c }} aria-pressed={c === ext.wallColor} aria-label={`สีผนัง ${c}`} onClick={() => setExt({ wallColor: c })} />)}
        <input type="color" value={ext.wallColor} onChange={(e) => setExt({ wallColor: e.target.value })} aria-label="เลือกสีผนังเอง" />
      </div>
      <label className="check"><input type="checkbox" checked={ext.fence} onChange={(e) => setExt({ fence: e.target.checked })} /> รั้วรอบบ้าน + ประตูรั้ว</label>
    </>
  );
}
