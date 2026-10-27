import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { catalogById } from '../data/catalog';
import { baht } from '../lib/boq';
import { getThumb, onThumbs, requestThumbs } from '../engine/thumbs';
import { LightControls } from './LightControls';

export function SelectionBar() {
  const selItem = useStore((s) => s.selItem);
  const item = useStore((s) => s.house.items.find((i) => i.id === s.selItem));
  const [armed, setArmed] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => onThumbs(() => tick((n) => n + 1)), []);
  useEffect(() => setArmed(false), [selItem]);
  if (!item) return null;
  const def = catalogById.get(item.t);
  if (!def) return null;
  const colour = item.c || def.colors[0];
  const thumb = getThumb(item.t, def.colors[0]);
  if (thumb === undefined) requestThumbs([{ t: item.t, c: def.colors[0] }]);
  const s = useStore.getState();

  return (
    <div className="float selbar" role="toolbar" aria-label="ของที่เลือก">
      {thumb && <img src={thumb} alt="" />}
      <div>
        <div className="name">{def.name}</div>
        <div className="meta">{def.size}{def.price ? ` · ≈ ${baht(def.price)}` : ''}{def.mount === 'wall' ? ' · ติดผนัง' : def.mount === 'ceiling' ? ' · ติดฝ้า' : ''}</div>
      </div>
      <div className="colors" aria-label="สี">
        {def.colors.map((c) => (
          <button key={c} className="dot" style={{ background: c }} aria-pressed={c === colour} title="เปลี่ยนสี" onClick={() => s.updateItem(item.id, { c })} />
        ))}
      </div>
      {def.light && <LightControls item={item} />}
      <span className="grow" />
      <button className="btn small" onClick={() => s.updateItem(item.id, { r: Math.round((item.r + Math.PI / 4) / (Math.PI / 4)) * (Math.PI / 4) })} title="หมุน (R)">หมุน 45°</button>
      <button className="btn small" onClick={() => s.duplicateItem(item.id)} title="ทำสำเนา (D)">สำเนา</button>
      <button
        className={`btn small danger${armed ? ' armed' : ''}`}
        onClick={() => (armed ? s.removeItem(item.id) : setArmed(true))}
        title="ลบ (Delete)"
      >
        {armed ? 'ยืนยันลบ' : 'ลบ'}
      </button>
    </div>
  );
}
