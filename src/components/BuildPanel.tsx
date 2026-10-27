import { useEffect, useState } from 'react';
import { DEFAULT_SPEC, SPEC_NAMES, type Layer } from '../lib/construction';
import { LAYERS, type BuildPick } from '../engine/buildview';
import { getEngine } from '../photo';
import { useStore } from '../store';
import type { BuildSpec } from '../types';

const SPEC_LABEL: Record<keyof BuildSpec, string> = { block: 'ผนัง', pipe: 'ท่อประปา', wire: 'สายไฟ', pile: 'เสาเข็ม' };

/** Construction X-ray: layers, exploded view, part inspector and build spec. */
export function BuildPanel({ pick, onClose }: { pick: BuildPick | null; onClose: () => void }) {
  const [hidden, setHidden] = useState<Layer[]>([]);
  const [explode, setExplode] = useState(0);
  const [furniture, setFurniture] = useState(false);
  const spec = { ...DEFAULT_SPEC, ...useStore((s) => s.house.build) };
  const setBuild = useStore((s) => s.setBuild);
  useEffect(() => getEngine()?.setBuildOptions({ hidden, explode, furniture }), [hidden, explode, furniture]);

  const toggle = (id: Layer) => setHidden((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]));
  const only = (id: Layer) => setHidden(LAYERS.map((l) => l.id).filter((x) => x !== id));

  return (
    <>
      <div className="float buildpanel" aria-label="ชั้นงานก่อสร้าง">
        <h3>ถอดประกอบบ้าน</h3>
        <label className="explode">
          <span>แยกชิ้นส่วน</span>
          <input type="range" min={0} max={1} step={0.01} value={explode} onChange={(e) => setExplode(+e.target.value)} />
        </label>
        <ul className="layers">
          {LAYERS.map((l) => (
            <li key={l.id}>
              <label>
                <input type="checkbox" checked={!hidden.includes(l.id)} onChange={() => toggle(l.id)} />
                <i style={{ background: l.color }} />
                {l.name}
              </label>
              <button className="only" onClick={() => only(l.id)} title="ดูเฉพาะชั้นนี้">เฉพาะ</button>
            </li>
          ))}
        </ul>
        <div className="row">
          <button className="btn small" onClick={() => setHidden([])}>แสดงทั้งหมด</button>
          <label className="check"><input type="checkbox" checked={furniture} onChange={(e) => setFurniture(e.target.checked)} /> เฟอร์นิเจอร์</label>
        </div>
        <h3>สเปกงานก่อสร้าง</h3>
        {(Object.keys(SPEC_NAMES) as (keyof BuildSpec)[]).map((k) => (
          <label key={k} className="specrow">
            <span>{SPEC_LABEL[k]}</span>
            <select value={spec[k]} onChange={(e) => setBuild({ [k]: e.target.value } as Partial<BuildSpec>)}>
              {Object.entries(SPEC_NAMES[k]).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
            </select>
          </label>
        ))}
        <div className="legend">
          <span><i style={{ background: '#2f80ed' }} />น้ำดี</span>
          <span><i style={{ background: '#e5484d' }} />น้ำร้อน</span>
          <span><i style={{ background: '#d9822b' }} />โสโครก</span>
          <span><i style={{ background: '#8a9099' }} />น้ำทิ้ง</span>
          <span><i style={{ background: '#f2c94c' }} />แสงสว่าง</span>
          <span><i style={{ background: '#e74c3c' }} />เต้ารับ</span>
          <span><i style={{ background: '#2d9cdb' }} />แอร์</span>
          <span><i style={{ background: '#f2994a' }} />วงจรเฉพาะ</span>
        </div>
      </div>
      {pick && (
        <div className="float inspect" role="status">
          <button className="close" onClick={onClose} aria-label="ปิด">×</button>
          <small>{LAYERS.find((l) => l.id === pick.layer)?.name} · ชั้น {pick.level + 1}</small>
          <b>{pick.name}</b>
          <span>{pick.spec}</span>
        </div>
      )}
    </>
  );
}
