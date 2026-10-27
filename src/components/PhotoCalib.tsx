import { useCallback, useEffect, useRef, useState } from 'react';
import { estimateRoom, focalFromCorners, poseFrom, type Pt } from '../lib/pose';
import { getEngine, usePhoto } from '../photo';
import { useStore } from '../store';

const DEFAULT_PTS: Pt[] = [[0.3, 0.5], [0.7, 0.5], [0.9, 0.95], [0.1, 0.95], [0.3, 0.12]];

/** Show the matched photo view for the room the photo belongs to. Returns an error message or null. */
export function showPhotoView(): string | null {
  const p = usePhoto.getState();
  const room = useStore.getState().house.rooms.find((r) => r.id === p.roomId);
  const e = getEngine();
  if (!p.img || !p.pts || !room || !e) return 'ไม่พบรูปหรือห้อง';
  const W = p.img.naturalWidth, H = p.img.naturalHeight, { w, d } = room;
  const dm = Math.min(p.markDepth ?? d, d);
  const pose = poseFrom(p.pts, W, H, [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, -d / 2 + dm], [-w / 2, -d / 2 + dm]], p.f ?? focalFromCorners(p.pts, W, H));
  if (!pose || pose.C[1] < 0.2 || pose.C[1] > 8) return 'คำนวณมุมกล้องไม่ได้ ลองเรียงจุด 1 ซ้ายใน → 2 ขวาใน → 3 ขวาหน้า → 4 ซ้ายหน้า';
  useStore.getState().selectItem(null);
  e.enterPhoto(room.id, p.img, pose, H, 0);
  e.setPhotoOriginal(p.original);
  p.set({ active: true });
  return null;
}

export function PhotoCalib() {
  const photo = usePhoto();
  const updateRoom = useStore((s) => s.updateRoom);
  const room = useStore((s) => s.house.rooms.find((r) => r.id === photo.roomId));
  const [pts, setPts] = useState<Pt[]>(photo.pts ?? DEFAULT_PTS);
  const [estimate, setEstimate] = useState(true);
  const [atDoor, setAtDoor] = useState(true);
  const [camH, setCamH] = useState(1.45);
  const [msg, setMsg] = useState('');
  const [rect, setRect] = useState({ x: 0, y: 0, w: 1, h: 1 });
  const box = useRef<HTMLDivElement>(null);
  const dragK = useRef(-1);

  const fit = useCallback(() => {
    const el = box.current;
    if (!el || !photo.img) return;
    const r = el.getBoundingClientRect();
    const a = photo.img.naturalWidth / photo.img.naturalHeight;
    let W = r.width * 0.72, H = r.height * 0.72;
    if (W / H > a) W = H * a;
    else H = W / a;
    setRect({ x: (r.width - W) / 2, y: (r.height - H) / 2 - 20, w: W, h: H });
  }, [photo.img]);

  useEffect(() => {
    fit();
    const ro = new ResizeObserver(fit);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [fit]);

  if (!photo.img || !room) return null;
  const P = pts.map((p) => [rect.x + p[0] * rect.w, rect.y + p[1] * rect.h]);

  const move = (e: React.PointerEvent) => {
    if (dragK.current < 0) return;
    const r = box.current!.getBoundingClientRect();
    const nx = (e.clientX - r.left - rect.x) / rect.w;
    const ny = (e.clientY - r.top - rect.y) / rect.h;
    const next = pts.slice();
    next[dragK.current] = [Math.max(-0.25, Math.min(1.25, nx)), Math.max(-0.25, Math.min(1.25, ny))];
    setPts(next);
  };

  const go = () => {
    const img = photo.img!;
    const W = img.naturalWidth, H = img.naturalHeight;
    let f: number | null = null;
    let markDepth: number | null = null;
    if (estimate) {
      const est = estimateRoom(pts, W, H, Math.max(0.5, Math.min(2.5, camH)));
      if (!est || est.w < 1 || est.w > 15 || est.d < 0.8 || est.d > 15) {
        setMsg('ประมาณขนาดไม่ได้ ลองวางจุด 1→4 ใหม่ หรือเอาเครื่องหมาย “ประมาณขนาด” ออกแล้วกรอกขนาดเอง');
        return;
      }
      const D = atDoor ? Math.max(est.d, est.camZ + est.d / 2 + 0.1) : est.d;
      markDepth = atDoor ? est.d : null;
      f = est.f;
      const cl = (v: number, a: number, b: number) => +Math.max(a, Math.min(b, v)).toFixed(2);
      // keep the back wall where it is so neighbouring rooms stay aligned
      const back = room.z - room.d / 2;
      const d = cl(D, 1, 15);
      updateRoom(room.id, { w: cl(est.w, 1, 15), d, h: cl(est.h, 2.2, 4), z: +(back + d / 2).toFixed(3) });
    }
    photo.set({ pts, f, markDepth, calibOpen: false });
    const err = showPhotoView();
    if (err) {
      photo.set({ calibOpen: true });
      setMsg(err);
    }
  };

  return (
    <div className="calib" ref={box}>
      <img src={photo.url} alt="รูปห้องสำหรับกำหนดมุม" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />
      <svg
        aria-label="จุดมุมห้อง"
        onPointerMove={move}
        onPointerUp={() => (dragK.current = -1)}
        onPointerCancel={() => (dragK.current = -1)}
      >
        {[0, 1, 2, 3].map((i) => {
          const a = P[i], b = P[(i + 1) % 4], dx = b[0] - a[0], dy = b[1] - a[1];
          return <line key={i} className="guide" x1={a[0] - dx * 3} y1={a[1] - dy * 3} x2={b[0] + dx * 3} y2={b[1] + dy * 3} />;
        })}
        <line className="guide" x1={P[0][0]} y1={P[0][1]} x2={P[4][0]} y2={P[4][1]} style={{ stroke: '#fff' }} />
        <polygon className="edge" points={P.slice(0, 4).map((p) => p.join(',')).join(' ')} />
        {P.map((p, i) => (
          <g
            key={i}
            onPointerDown={(e) => {
              dragK.current = i;
              (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId);
              e.preventDefault();
            }}
          >
            <circle className="hit" cx={p[0]} cy={p[1]} r={24} />
            <circle className={`knob${i === 4 ? ' ceil' : ''}`} cx={p[0]} cy={p[1]} r={11} />
            <text x={p[0] - 4} y={p[1] + 5}>{i + 1}</text>
          </g>
        ))}
      </svg>
      <div className="float calibbar">
        <p>
          <b>1, 2</b> = มุมพื้นชนผนังด้านใน · <b>3, 4</b> = จุดบนเส้นพื้นชนผนังขวา/ซ้าย ใกล้ขอบล่างรูป · จุดขาว <b>5</b> = มุมเพดานเหนือจุด 1
          {msg && <span className="msg"> {msg}</span>}
        </p>
        <label><input type="checkbox" checked={estimate} onChange={(e) => setEstimate(e.target.checked)} /> ประมาณขนาดห้องจากรูป</label>
        <label title="ไม่ติ๊ก = จุด 3, 4 คือมุมห้องด้านหน้าจริง"><input type="checkbox" checked={atDoor} onChange={(e) => setAtDoor(e.target.checked)} /> ยืนถ่ายที่ประตู</label>
        <label>กล้องสูง <input type="number" min={0.5} max={2.5} step={0.05} value={camH} onChange={(e) => setCamH(+e.target.value)} /> ม.</label>
        <button className="btn" onClick={() => photo.set({ calibOpen: false })}>ยกเลิก</button>
        <button className="btn primary" onClick={go}>สร้างห้องเปล่า</button>
      </div>
    </div>
  );
}
