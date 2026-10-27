import { useEffect, useState } from 'react';
import { ROOM_TYPES, TEMPLATES } from '../data/templates';
import { floorById } from '../data/surfaces';
import { readImage, sampleColours, usePhoto, getEngine } from '../photo';
import { useStore } from '../store';
import type { RoomType } from '../types';
import { levelsOf } from '../lib/shell';
import { ExteriorEditor, HouseDesigner } from './HouseDesigner';

const SWATCH: Record<RoomType, string> = {
  living: '#c9a27a', bedroom: '#9aa7b0', kitchen: '#b9b8b3', dining: '#d8b4a0', bathroom: '#a6a7a2', office: '#a8b5ab',
  laundry: '#c9c2b8', hall: '#e3dfd9', balcony: '#8a6a4f', garden: '#4f7a35', garage: '#9b9790',
  pool: '#3fa7c9', terrace: '#a7835f', theater: '#3b3531', gym: '#8d969c', spa: '#c9b49a', wine: '#7a3b2e', closet: '#d8c7b0',
  library: '#8a6a4f', maid: '#c9c2b8', lift: '#6f7378', void: '#f4f2ee',
};

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const [txt, setTxt] = useState(value.toFixed(2));
  useEffect(() => setTxt(value.toFixed(2)), [value]);
  const commit = () => {
    const v = Number(txt);
    if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, +v.toFixed(2))));
    else setTxt(value.toFixed(2));
  };
  return (
    <label>
      {label}
      <input type="number" inputMode="decimal" step={0.05} min={min} max={max} value={txt}
        onChange={(e) => setTxt(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
    </label>
  );
}

export function HousePanel() {
  const s = useStore();
  const room = s.house.rooms.find((r) => r.id === s.selRoom);
  const photo = usePhoto();
  const [armedTpl, setArmedTpl] = useState<string | null>(null);
  const [armedDel, setArmedDel] = useState(false);
  const [over, setOver] = useState(false);
  const [armedFurnish, setArmedFurnish] = useState(false);
  useEffect(() => { setArmedDel(false); setArmedFurnish(false); }, [s.selRoom]);

  const onPhoto = async (file?: File) => {
    if (!file || !room) return;
    try {
      const { img, url } = await readImage(file);
      getEngine()?.exitPhoto();
      photo.set({ img, url, roomId: room.id, pts: null, f: null, markDepth: null, active: false, original: false, picked: sampleColours(img), calibOpen: true });
    } catch {
      /* not an image */
    }
  };

  const area = s.house.rooms.filter((r) => !r.outdoor).reduce((a, r) => a + r.w * r.d, 0);

  const levels = levelsOf(s.house.rooms);
  const multi = levels.length > 1;

  return (
    <section className="pane">
      <div className="sec">
        <h2>ออกแบบบ้านใหม่</h2>
        <HouseDesigner />
      </div>

      <div className="sec">
        <h2>แบบบ้านสำเร็จรูป</h2>
        <div className="templates">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              className={armedTpl === t.id ? 'armed' : ''}
              onClick={() => {
                if (armedTpl !== t.id) return setArmedTpl(t.id);
                s.loadTemplate(t.id);
                setArmedTpl(null);
                setTimeout(() => getEngine()?.view('iso'), 30);
              }}
            >
              <span>{t.name}</span>
              <small>{armedTpl === t.id ? 'กดอีกครั้งเพื่อแทนที่บ้านปัจจุบัน (ย้อนกลับได้)' : t.desc}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="sec">
        <div className="row"><h2>ห้องทั้งหมด</h2><span className="grow" /><span className="note">ในร่ม {area.toFixed(1)} ตร.ม.</span></div>
        {levels.map((l) => (
          <div key={l} className="sec" style={{ gap: 6 }}>
            {multi && <h3>ชั้น {l + 1}</h3>}
            <div className="rooms">
              {s.house.rooms.filter((r) => (r.level ?? 0) === l).map((r) => (
                <button key={r.id} aria-pressed={r.id === s.selRoom} onClick={() => {
                  s.selectRoom(r.id);
                  s.selectItem(null);
                  if (s.viewMode === 'walk') getEngine()?.walkTo(r.id);
                  else {
                    if (s.viewMode === 'outside' && !r.outdoor) s.set({ viewMode: 'inside' });
                    setTimeout(() => getEngine()?.view('iso', r.id), 0);
                  }
                }}>
                  <i style={{ background: SWATCH[r.type] }} />
                  <span>{r.name}</span>
                  <span className="a">{r.w.toFixed(1)}×{r.d.toFixed(1)} ม.</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="row">
          <select aria-label="เพิ่มชั้นที่จะวางห้อง" value={s.level} onChange={(e) => s.set({ level: +e.target.value, viewMode: 'inside' })} style={{ border: '1px solid var(--line)', padding: '7px 9px', background: 'var(--panel)' }}>
            {[...new Set([...levels, Math.max(...levels) + 1])].filter((l) => l < 3).map((l) => <option key={l} value={l}>{levels.includes(l) ? `ชั้น ${l + 1}` : `＋ ชั้น ${l + 1} (ใหม่)`}</option>)}
          </select>
          <select aria-label="เพิ่มห้องประเภท" value="" onChange={(e) => e.target.value && s.addRoom(e.target.value as RoomType)} style={{ border: '1px solid var(--line)', padding: '7px 9px', background: 'var(--panel)' }}>
            <option value="">＋ เพิ่มห้อง…</option>
            {(Object.keys(ROOM_TYPES) as RoomType[]).map((t) => <option key={t} value={t}>{ROOM_TYPES[t].name}</option>)}
          </select>
          <button className="btn" aria-pressed={s.planMode} onClick={() => s.set({ planMode: !s.planMode })} style={s.planMode ? { background: 'var(--ink)', color: 'var(--bg)' } : undefined}>
            {s.planMode ? 'เสร็จสิ้นจัดผัง' : 'จัดผังห้อง'}
          </button>
        </div>
        {s.planMode && <p className="note">ลากพื้นห้องในภาพเพื่อย้ายห้อง ของในห้องจะย้ายตาม ขอบห้องจะติดกับห้องข้างเคียงอัตโนมัติ</p>}
        <p className="note">ผนังสร้างให้เองจากขอบห้อง: ขอบที่ติดกันเป็นผนังกั้นห้อง ขอบที่ไม่มีห้องติดเป็นผนังภายนอก ประตูและหน้าต่างที่วางบนผนังจะเจาะช่องจริง</p>
      </div>

      <div className="sec">
        <h2>ภายนอกบ้าน</h2>
        <ExteriorEditor />
      </div>

      {room ? (
        <>
          <div className="sec">
            <h2>{room.name}</h2>
            <div className="field"><label htmlFor="rn">ชื่อห้อง</label><input id="rn" type="text" value={room.name} onChange={(e) => s.updateRoom(room.id, { name: e.target.value })} /></div>
            <div className="field">
              <label htmlFor="rt">ประเภท</label>
              <select id="rt" value={room.type} onChange={(e) => {
                const t = e.target.value as RoomType;
                const d = ROOM_TYPES[t];
                s.updateRoom(room.id, { type: t, outdoor: d.outdoor, floor: d.floor, wallPat: d.wallPat, wallColor: d.wallColor });
              }}>
                {(Object.keys(ROOM_TYPES) as RoomType[]).map((t) => <option key={t} value={t}>{ROOM_TYPES[t].name}</option>)}
              </select>
            </div>
            <div className="dims3">
              <NumberField label="กว้าง (ม.)" value={room.w} min={0.8} max={20} onChange={(w) => s.updateRoom(room.id, { w })} />
              <NumberField label="ยาว (ม.)" value={room.d} min={0.8} max={20} onChange={(d) => s.updateRoom(room.id, { d })} />
              {!room.outdoor && <NumberField label="สูงฝ้า (ม.)" value={room.h} min={2.2} max={5} onChange={(h) => s.updateRoom(room.id, { h })} />}
            </div>
            <p className="note">{(room.w * room.d).toFixed(2)} ตร.ม. · พื้น{floorById(room.floor).name}</p>
            <div className="row">
              <button className={`btn${armedFurnish ? ' primary' : ''}`} onClick={() => {
                if (!armedFurnish) return setArmedFurnish(true);
                s.furnishRoom(room.id);
                setArmedFurnish(false);
              }}>
                {armedFurnish ? 'ยืนยัน: แทนที่เฟอร์นิเจอร์ในห้องนี้' : '✦ จัดของอัตโนมัติ'}
              </button>
              <button className="btn" onClick={() => s.set({ tab: 'materials' })}>เปลี่ยนพื้น / ผนัง</button>
              <button className={`btn danger${armedDel ? ' armed' : ''}`} onClick={() => (armedDel ? s.removeRoom(room.id) : setArmedDel(true))}>
                {armedDel ? 'ยืนยันลบห้องและของในห้อง' : 'ลบห้อง'}
              </button>
            </div>
          </div>

          {!room.outdoor && (
            <div className="sec">
              <h2>สร้างห้องนี้จากรูปถ่าย</h2>
              <p className="note">ยืนที่ประตู ถือมือถือระดับอก ใช้เลนส์ 1x ถ่ายให้เห็นพื้นกับมุมผนัง ระบบจะประมาณขนาดห้อง แล้วโชว์ห้องเปล่าในมุมเดียวกับรูป</p>
              <label
                className={`drop${over ? ' over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); onPhoto(e.dataTransfer.files[0]); }}
              >
                <strong>ถ่ายรูป / เลือกรูปห้อง</strong>
                หรือลากไฟล์รูปมาวาง
                <input type="file" accept="image/*" hidden onChange={(e) => { onPhoto(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              {photo.picked && photo.roomId === room.id && (
                <div className="row">
                  <span className="note">สีจากรูป</span>
                  <span className="dot" style={{ background: photo.picked.wall }} title="ผนัง" />
                  <span className="dot" style={{ background: photo.picked.floor }} title="พื้น" />
                  <button className="btn small" onClick={() => s.updateRoom(room.id, { wallColor: photo.picked!.wall, wallPat: 'plain', floor: 'concrete', floorTint: photo.picked!.floor })}>ใช้สีเดิมจากรูป</button>
                  <button className="btn small" onClick={() => photo.set({ calibOpen: true })}>กำหนดมุมใหม่</button>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="empty">คลิกพื้นห้องในภาพ หรือเลือกจากรายการ เพื่อแก้ชื่อ ขนาด และวัสดุ</div>
      )}
    </section>
  );
}
