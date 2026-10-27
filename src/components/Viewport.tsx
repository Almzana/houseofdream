import { useEffect, useMemo, useRef, useState } from 'react';
import { Engine } from '../engine/Engine';
import { useStore } from '../store';
import { getEngine, setEngine, usePhoto } from '../photo';
import { levelsOf } from '../lib/shell';
import type { ViewMode, WallMode } from '../types';
import { NavPad } from './NavPad';
import { SelectionBar } from './SelectionBar';
import { PhotoCalib, showPhotoView } from './PhotoCalib';
import { BuildPanel } from './BuildPanel';
import type { BuildPick } from '../engine/buildview';

const MODES: { id: ViewMode; name: string; icon: JSX.Element }[] = [
  { id: 'outside', name: 'ภายนอก', icon: <path d="M3 11 12 4l9 7 M5 10v10h14V10 M10 20v-5h4v5" /> },
  { id: 'inside', name: 'ภายใน', icon: <path d="M3 9h18 M5 9v11h14V9 M9 13h6 M7 4l5-1 5 1" /> },
  { id: 'build', name: 'โครงสร้าง', icon: <path d="M4 20h16 M6 20V9l6-5 6 5v11 M6 13h12 M10 20v-7 M14 20v-7 M6 9h12" /> },
  { id: 'walk', name: 'เดินชม', icon: <path d="M13 4a1.5 1.5 0 1 1 0 .1 M10 21l2-6 3 3v3 M12 15l-1-5 4 1 2 3 M11 10l-3 2-1 3" /> },
];
const WALLS: { id: WallMode; name: string }[] = [
  { id: 'auto', name: 'ตัดผนังอัตโนมัติ' },
  { id: 'low', name: 'ผนังเตี้ย' },
  { id: 'full', name: 'ผนังเต็ม' },
];
const hourLabel = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}`;

/** Hold-to-move button for the walk pad. */
function Hold({ label, onHold, children }: { label: string; onHold: (on: boolean) => void; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); onHold(true); }}
      onPointerUp={() => onHold(false)}
      onPointerCancel={() => onHold(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

export function Viewport() {
  const host = useRef<HTMLDivElement>(null);
  const [az, setAz] = useState(0);
  /** realistic render progress: null = off, s = −2 while the scene is being prepared */
  const [rt, setRt] = useState<{ s: number; t: number } | null>(null);
  const [pick, setPick] = useState<BuildPick | null>(null);
  const selRoom = useStore((s) => s.selRoom);
  const rooms = useStore((s) => s.house.rooms);
  const planMode = useStore((s) => s.planMode);
  const seenTips = useStore((s) => s.seenTips);
  const viewMode = useStore((s) => s.viewMode);
  const level = useStore((s) => s.level);
  const hour = useStore((s) => s.hour);
  const wallMode = useStore((s) => s.wallMode);
  const set = useStore((s) => s.set);
  const photo = usePhoto();
  const room = rooms.find((r) => r.id === selRoom);
  const levels = useMemo(() => levelsOf(rooms), [rooms]);

  useEffect(() => {
    const st = useStore.getState();
    const e = new Engine(host.current!, {
      selectItem: (id) => useStore.getState().selectItem(id),
      selectRoom: (id) => useStore.getState().selectRoom(id),
      itemMoved: (id, x, z, r) => useStore.getState().updateItem(id, { x: +x.toFixed(3), z: +z.toFixed(3), r: +r.toFixed(4) }),
      roomMoved: (id, x, z) => useStore.getState().moveRoom(id, +x.toFixed(3), +z.toFixed(3)),
      view: (theta) => setAz(theta),
      inspect: (p) => setPick(p),
    });
    setEngine(e);
    e.onRender = (s, t) => setRt(s === -1 ? null : { s, t });
    if (import.meta.env.DEV) (window as unknown as { __engine: Engine }).__engine = e;
    e.setQuality(st.quality);
    e.setWallMode(st.wallMode);
    e.setLevel(st.level);
    e.setHour(st.hour);
    e.setHouse(st.house);
    e.setViewMode(st.viewMode);
    e.setSelection(st.selItem, st.selRoom);
    e.showSetbacks(st.tab === 'code');
    e.view('iso');
    const unsub = useStore.subscribe((s, p) => {
      if (s.house !== p.house) e.setHouse(s.house);
      if (s.selItem !== p.selItem || s.selRoom !== p.selRoom) e.setSelection(s.selItem, s.selRoom);
      if (s.wallMode !== p.wallMode) e.setWallMode(s.wallMode);
      if (s.quality !== p.quality) e.setQuality(s.quality);
      if (s.planMode !== p.planMode) e.setPlanMode(s.planMode);
      if (s.hour !== p.hour) e.setHour(s.hour);
      if (s.tab !== p.tab) e.showSetbacks(s.tab === 'code');
      if (s.level !== p.level) e.setLevel(s.level);
      if (s.viewMode !== p.viewMode) {
        e.setViewMode(s.viewMode);
        if (s.viewMode !== 'walk' && p.viewMode !== 'walk') e.view('iso');
      }
    });
    return () => {
      unsub();
      e.dispose();
      setEngine(null);
    };
  }, []);

  const walking = viewMode === 'walk';
  const pickMode = (m: ViewMode) => {
    getEngine()?.exitPhoto();
    photo.set({ active: false });
    set({ viewMode: m, planMode: false });
  };
  const pickLevel = (l: number) => {
    set({ level: l, viewMode: walking ? 'walk' : 'inside' });
    if (walking) {
      const r = rooms.find((o) => (o.level ?? 0) === l && !o.outdoor);
      if (r) getEngine()?.walkTo(r.id);
    } else setTimeout(() => getEngine()?.view('iso'), 0);
  };

  const hint = photo.active
    ? 'ลากของเพื่อย้าย · กด “มุม 3D” ที่ปุ่มด้านขวาเพื่อหมุนดูรอบห้อง'
    : walking
      ? 'W A S D หรือลูกศร = เดิน · ลากเมาส์ = มองรอบ · ดับเบิลคลิกพื้น = เดินไปตรงนั้น · Shift = เดินเร็ว'
      : viewMode === 'build'
        ? 'คลิกชิ้นส่วนเพื่อดูสเปก · เลื่อน “แยกชิ้นส่วน” เพื่อถอดประกอบ · ติ๊กเลือกชั้นงานที่ต้องการดู'
      : planMode
        ? 'โหมดจัดผัง: ลากพื้นห้องเพื่อย้ายห้อง ขอบห้องจะติดกันเอง'
        : viewMode === 'outside'
          ? 'ลากเพื่อหมุนรอบบ้าน · กด “ภายใน” เพื่อยกหลังคาดูข้างใน'
          : 'ลากพื้นที่ว่างเพื่อหมุน · คลิกของเพื่อเลือก แล้วลากเพื่อย้าย';
  const pad = (p: Partial<{ f: number; s: number; t: number }>) => getEngine()?.walkPad(p);
  const startRender = () => {
    useStore.getState().selectItem(null);
    setRt({ s: -2, t: 400 });
    // let the "preparing" message paint before the scene is compiled
    setTimeout(() => requestAnimationFrame(() => getEngine()?.startRealistic()), 30);
  };
  const savePng = () => {
    const url = getEngine()?.snapshot();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `baan3d-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.png`;
    a.click();
  };

  return (
    <div className="stage" ref={host}>
      <div className="float chipbar">
        <span className="where">
          {room ? <>ห้อง <b>{room.name}</b> · {(room.w * room.d).toFixed(1)} ตร.ม.{levels.length > 1 ? ` · ชั้น ${(room.level ?? 0) + 1}` : ''}</> : walking ? 'โหมดเดินชมบ้าน' : 'คลิกพื้นห้องเพื่อเลือกห้อง'}
        </span>
        <span className="note">{hint}</span>
      </div>

      {!photo.active && (
        <div className="float modebar">
          <div className="modes" role="group" aria-label="มุมมอง">
            {MODES.map((m) => (
              <button key={m.id} aria-pressed={viewMode === m.id} onClick={() => pickMode(m.id)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{m.icon}</svg>
                {m.name}
              </button>
            ))}
          </div>
          {levels.length > 1 && (
            <div className="seg" role="group" aria-label="ชั้น">
              {levels.map((l) => (
                <button key={l} aria-pressed={viewMode !== 'outside' && level === l} onClick={() => pickLevel(l)}>ชั้น {l + 1}</button>
              ))}
            </div>
          )}
          {viewMode === 'inside' && (
            <div className="seg" role="group" aria-label="การแสดงผนัง">
              {WALLS.map((w) => <button key={w.id} aria-pressed={wallMode === w.id} onClick={() => set({ wallMode: w.id })}>{w.name}</button>)}
            </div>
          )}
          <label className="sun" title="เวลาของวัน: แสงแดด เงา และไฟกลางคืน">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              {hour >= 18.5 || hour < 6 ? <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" /> : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>}
            </svg>
            <input type="range" min={6} max={21} step={0.5} value={hour} onChange={(e) => set({ hour: +e.target.value })} aria-label="เวลา" />
            <b>{hourLabel(hour)}</b>
          </label>
        </div>
      )}

      {rt && (
        <div className="float renderbar" role="status">
          <div className="prog">
            {rt.s === -3
              ? <span>กำลังเตรียมตัวคำนวณแสงของการ์ดจอ · ครั้งแรกอาจใช้ราว 1 นาที</span>
              : rt.s < 0
              ? <span>กำลังเตรียมฉากสำหรับคำนวณแสง…</span>
              : rt.s >= rt.t
                ? <span><b>เสร็จแล้ว</b> · แสงเด้งสะท้อน {rt.t} รอบต่อพิกเซล</span>
                : <span>คำนวณแสงสะท้อน <b>{rt.s}/{rt.t}</b> · ยิ่งนานยิ่งเนียน · ลากเพื่อหมุนได้</span>}
            <div className="bar"><i style={{ width: `${rt.s < 0 ? 0 : (100 * rt.s) / rt.t}%` }} /></div>
          </div>
          <button className="btn" onClick={savePng} disabled={rt.s < 0}>บันทึกภาพ PNG</button>
          <button className="btn primary" onClick={() => getEngine()?.stopRealistic(true)}>ปิด</button>
        </div>
      )}

      {!photo.active && !walking && !rt && viewMode !== 'build' && (
        <div className="float viewbtns" aria-label="มุมกล้อง">
          <button onClick={() => getEngine()?.view('iso')}>มุม 3D</button>
          <button onClick={() => getEngine()?.view('top')}>มองจากบน</button>
          <button onClick={() => getEngine()?.view('front')}>ด้านหน้าบ้าน</button>
          <button onClick={() => getEngine()?.view('iso', selRoom)} disabled={!selRoom}>ซูมห้องนี้</button>
          <button className="real" onClick={startRender} title="คำนวณแสงที่เด้งสะท้อนจริงจากทุกพื้นผิว">✦ ภาพสมจริง</button>
          {photo.img && photo.pts && <button onClick={() => showPhotoView()}>มุมรูปถ่าย</button>}
        </div>
      )}

      {photo.active && (
        <div className="float photobar">
          <div className="seg" role="group" aria-label="แสดงผล">
            <button aria-pressed={!photo.original} onClick={() => { photo.set({ original: false }); getEngine()?.setPhotoOriginal(false); }}>ห้องเปล่า</button>
            <button aria-pressed={photo.original} onClick={() => { photo.set({ original: true }); getEngine()?.setPhotoOriginal(true); }}>รูปเดิม</button>
          </div>
          <button className="btn" onClick={() => photo.set({ calibOpen: true })}>แก้มุมห้อง</button>
          <button className="btn" onClick={() => { getEngine()?.view('iso', photo.roomId); photo.set({ active: false }); }}>มุม 3D</button>
        </div>
      )}

      {walking ? (
        <div className="float walkpad" aria-label="ปุ่มเดิน">
          <div className="dpad">
            <Hold label="หันซ้าย" onHold={(on) => pad({ t: on ? 1 : 0 })}>⟲</Hold>
            <Hold label="เดินหน้า" onHold={(on) => pad({ f: on ? 1 : 0 })}>▲</Hold>
            <Hold label="หันขวา" onHold={(on) => pad({ t: on ? -1 : 0 })}>⟳</Hold>
            <Hold label="เดินซ้าย" onHold={(on) => pad({ s: on ? -1 : 0 })}>◀</Hold>
            <Hold label="ถอยหลัง" onHold={(on) => pad({ f: on ? -1 : 0 })}>▼</Hold>
            <Hold label="เดินขวา" onHold={(on) => pad({ s: on ? 1 : 0 })}>▶</Hold>
          </div>
          <select aria-label="ไปที่ห้อง" value="" onChange={(e) => e.target.value && getEngine()?.walkTo(e.target.value)}>
            <option value="">ไปที่ห้อง…</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{levels.length > 1 ? `ชั้น ${(r.level ?? 0) + 1} · ` : ''}{r.name}</option>)}
          </select>
          <button className="btn" onClick={() => pickMode('outside')}>ออกจากโหมดเดิน</button>
        </div>
      ) : (
        !photo.active && <NavPad azimuth={az} />
      )}
      {!walking && !rt && viewMode !== 'build' && <SelectionBar />}
      {viewMode === 'build' && !photo.active && <BuildPanel pick={pick} onClose={() => setPick(null)} />}
      {photo.calibOpen && <PhotoCalib />}

      {!seenTips && (
        <div className="float tips" role="dialog" aria-label="วิธีใช้">
          <h2>เริ่มต้นใช้งาน</h2>
          <ul>
            <li>ปุ่มด้านบน: <b>ภายนอก</b> ดูบ้านทั้งหลัง · <b>ภายใน</b> ยกหลังคาออกเพื่อจัดห้อง · <b>เดินชม</b> เดินในบ้านแบบเกม</li>
            <li>ใช้วงแหวนมุมซ้ายล่างหมุนรอบบ้าน หรือกดปุ่มกลางเมาส์ค้างแล้วลาก (ลูกกลิ้ง = ซูม, คลิกขวาลาก = เลื่อน)</li>
            <li>เลื่อนแถบเวลา ☀ เพื่อดูแสงเช้า บ่าย เย็น และไฟในบ้านตอนกลางคืน</li>
            <li>แท็บ “บ้าน” ออกแบบบ้านใหม่ได้ เลือกจำนวนห้องนอน ห้องน้ำ และแบบหลังคา แล้วระบบจัดห้องกับของให้</li>
            <li>แท็บ “ของแต่ง” มีรูปของทุกชิ้น · แท็บ “สรุปงบ” บอกวัสดุและงบทั้งหลัง</li>
          </ul>
          <button className="btn primary" onClick={() => useStore.getState().set({ seenTips: true })}>เริ่มเลย</button>
        </div>
      )}
    </div>
  );
}
