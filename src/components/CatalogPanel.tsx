import { useEffect, useMemo, useState } from 'react';
import { CATALOG, CATEGORIES, catalogById, type CatId } from '../data/catalog';
import { ItemPreview } from './ItemPreview';
import { getThumb, onThumbs, requestThumbs } from '../engine/thumbs';
import { baht } from '../lib/boq';
import { useStore } from '../store';
import type { RoomType } from '../types';

/** Pre-select the category that matches the selected room. */
const ROOM_TO_CAT: Partial<Record<RoomType, CatId>> = {
  living: 'living', bedroom: 'bedroom', kitchen: 'kitchen', dining: 'dining', bathroom: 'bath',
  office: 'office', laundry: 'bath', garden: 'outdoor', garage: 'outdoor', balcony: 'outdoor',
};

export function CatalogPanel() {
  const addItem = useStore((s) => s.addItem);
  const selRoom = useStore((s) => s.house.rooms.find((r) => r.id === s.selRoom));
  const [cat, setCat] = useState<CatId | 'all'>(selRoom ? ROOM_TO_CAT[selRoom.type] ?? 'all' : 'all');
  const [q, setQ] = useState('');
  const [, tick] = useState(0);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (selRoom) setCat(ROOM_TO_CAT[selRoom.type] ?? 'all');
  }, [selRoom?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return CATALOG.filter((c) => (cat === 'all' || c.cats.includes(cat)) && (!s || c.name.toLowerCase().includes(s)));
  }, [cat, q]);

  const [preview, setPreview] = useState<string | null>(null);
  const current = preview ? list.find((c) => c.id === preview) : undefined;
  const add = (t: string, color?: string) => {
    addItem(t, undefined, color);
    setToast(`เพิ่ม${catalogById.get(t)?.name ?? ''}แล้ว`);
  };

  useEffect(() => onThumbs(() => tick((n) => n + 1)), []);
  useEffect(() => {
    requestThumbs(list.map((c) => ({ t: c.id, c: c.colors[0] })));
  }, [list]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 1600);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <section className="pane">
      <div className="sec">
        <h2>เลือกของเข้าบ้าน</h2>
        <label className="search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input type="search" placeholder="ค้นหา เช่น โซฟา, ตู้เย็น, ประตู" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหาของ" />
        </label>
        <div className="cats" role="group" aria-label="หมวดหมู่">
          <button aria-pressed={cat === 'all'} onClick={() => setCat('all')}>ทั้งหมด</button>
          {CATEGORIES.map((c) => (
            <button key={c.id} aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{c.name}</button>
          ))}
        </div>
        <p className="note">
          {selRoom ? <>กดรูปเพื่อดูตัวอย่าง 3D แล้ววางใน <b>{selRoom.name}</b> (หรือกด + เพื่อวางทันที)</> : 'กดรูปเพื่อดูตัวอย่าง 3D · คลิกพื้นห้องในภาพก่อนเพื่อเลือกห้องที่จะวาง'}
          {toast && <b style={{ color: 'var(--ok)' }}> · {toast}</b>}
        </p>
      </div>
      {list.length ? (
        <div className="grid">
          {list.map((c) => {
            const src = getThumb(c.id, c.colors[0]);
            return (
              <div key={c.id} className="card">
                <button className="open" onClick={() => setPreview(c.id)} title={`ดูตัวอย่าง ${c.name}`}>
                  <span className="img">{src ? <img src={src} alt="" loading="lazy" /> : <span className="ph" />}</span>
                  <span className="t">{c.name}</span>
                  <span className="s">{c.size}{c.price ? ` · ${baht(c.price)}` : ''}</span>
                </button>
                <button className="add" onClick={() => add(c.id)} aria-label={`วาง ${c.name} ทันที`} title="วางทันที">+</button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty">ไม่พบ “{q}” ลองคำอื่น หรือเลือกหมวด “ทั้งหมด”</div>
      )}
      {current && (
        <ItemPreview
          item={current}
          roomName={selRoom?.name}
          onClose={() => setPreview(null)}
          onAdd={(color) => { add(current.id, color); setPreview(null); }}
          onStep={(d) => {
            const i = list.findIndex((c) => c.id === current.id);
            setPreview(list[(i + d + list.length) % list.length].id);
          }}
        />
      )}
    </section>
  );
}
