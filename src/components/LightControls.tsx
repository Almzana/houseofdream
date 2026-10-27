import { useEffect, useState } from 'react';
import { catalogById } from '../data/catalog';
import { kelvinCss, kelvinName } from '../lib/kelvin';
import { getEngine } from '../photo';
import { useStore } from '../store';
import type { Item } from '../types';

/** Brightness, colour temperature and switch for a selected lamp. */
export function LightControls({ item }: { item: Item }) {
  const spec = catalogById.get(item.t)?.light;
  const update = useStore((s) => s.updateItem);
  const [lm, setLm] = useState(item.lm ?? spec?.lm ?? 800);
  const [k, setK] = useState(item.k ?? 3000);
  useEffect(() => {
    setLm(item.lm ?? spec?.lm ?? 800);
    setK(item.k ?? 3000);
  }, [item.id, item.lm, item.k, spec?.lm]);
  if (!spec) return null;
  const watts = Math.round(lm / 90);
  const commit = () => (lm !== (item.lm ?? spec.lm) || k !== (item.k ?? 3000)) && update(item.id, { lm, k });

  return (
    <div className="lightctl" aria-label="ตั้งค่าแสง">
      <button className={`switch${item.off ? '' : ' on'}`} onClick={() => update(item.id, { off: !item.off })} aria-pressed={!item.off} title="เปิด/ปิดไฟ">
        <i style={{ background: item.off ? 'var(--line)' : kelvinCss(k) }} />
        {item.off ? 'ปิดไฟ' : 'เปิดไฟ'}
      </button>
      <label>
        <span>ความสว่าง <b>{lm.toLocaleString('th-TH')} lm</b> ≈ LED {watts}W</span>
        <input type="range" min={100} max={4000} step={50} value={lm} disabled={item.off}
          onChange={(e) => { setLm(+e.target.value); getEngine()?.previewLight(item.id, { lm: +e.target.value }); }}
          onPointerUp={commit} onKeyUp={commit} />
      </label>
      <label>
        <span>สีแสง <b>{k}K</b> {kelvinName(k)}</span>
        <input type="range" className="kelvin" min={2700} max={6500} step={100} value={k} disabled={item.off}
          onChange={(e) => { setK(+e.target.value); getEngine()?.previewLight(item.id, { k: +e.target.value }); }}
          onPointerUp={commit} onKeyUp={commit} />
      </label>
    </div>
  );
}
