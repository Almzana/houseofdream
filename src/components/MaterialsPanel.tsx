import { FLOORS, PAINTS, PAINT, WALLS, floorById } from '../data/surfaces';
import { setCustomCanvas, surfaceThumb } from '../engine/textures';
import { ctx2d, mkCanvas } from '../engine/canvas';
import { baht } from '../lib/boq';
import { readImage } from '../photo';
import { useStore } from '../store';
import { useState } from 'react';

export function MaterialsPanel() {
  const room = useStore((s) => s.house.rooms.find((r) => r.id === s.selRoom));
  const updateRoom = useStore((s) => s.updateRoom);
  const [, bump] = useState(0);
  if (!room) return <section className="pane"><div className="empty">คลิกพื้นห้องในภาพ หรือเลือกห้องในแท็บ “บ้าน” เพื่อเปลี่ยนพื้นและผนัง</div></section>;

  const floors = [...FLOORS].sort((a, b) => Number(!!b.outdoor === !!room.outdoor) - Number(!!a.outdoor === !!room.outdoor));
  const f = floorById(room.floor);
  const set = (p: Parameters<typeof updateRoom>[1]) => updateRoom(room.id, p);

  return (
    <section className="pane">
      <div className="sec">
        <h2>พื้น · {room.name}</h2>
        <div className="grid">
          {floors.map((fl) => (
            <button key={fl.id} className="card swatch" aria-pressed={fl.id === room.floor} onClick={() => set({ floor: fl.id })}>
              <span className="img"><img src={surfaceThumb(fl)} alt="" /></span>
              <span className="t">{fl.name}</span>
              <span className="s">{fl.price.m2 ? `${baht(fl.price.m2)}/ตร.ม.` : `${baht(fl.price.labor)}/ตร.ม. รวมแรง`}</span>
            </button>
          ))}
          <label className="card swatch" style={{ cursor: 'pointer' }}>
            <span className="img" style={{ fontSize: 28 }}>＋</span>
            <span className="t">ลายของฉัน</span>
            <span className="s">อัปโหลดรูปกระเบื้อง</span>
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                const { img } = await readImage(file);
                const c = mkCanvas(1024);
                const s = Math.min(img.width, img.height);
                ctx2d(c).drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 1024, 1024);
                let custom = FLOORS.find((x) => x.id === 'custom');
                if (!custom) {
                  custom = { id: 'custom', name: 'ลายของฉัน 60×60', unit: [0.6, 0.6], dims: [60, 60], adhesive: true, price: { m2: 500, box: 1.44, labor: 350 }, rough: [0.3, 0.8], ns: 0.6, coat: 0.3, relief: 'luma', draw: () => {} };
                  FLOORS.push(custom);
                }
                setCustomCanvas('custom', c);
                bump((n) => n + 1);
                set({ floor: 'custom', floorScale: room.floorScale + 1e-6 });
              }}
            />
          </label>
        </div>
        {f.dims && (
          <div className="field">
            <label htmlFor="fs">ขนาดแผ่น</label>
            <input id="fs" type="range" min={0.5} max={2} step={0.05} value={room.floorScale} onChange={(e) => set({ floorScale: +e.target.value })} />
          </div>
        )}
        {f.tint && (
          <div className="field">
            <label htmlFor="ft">สีพื้น</label>
            <input id="ft" type="color" value={room.floorTint} onChange={(e) => set({ floorTint: e.target.value })} />
          </div>
        )}
      </div>

      {!room.outdoor && (
        <>
          <div className="sec">
            <h2>สีผนัง</h2>
            <div className="paints">
              {PAINTS.map((c) => (
                <button key={c} className="dot" style={{ background: c }} title={c} aria-pressed={c === room.wallColor} onClick={() => set({ wallColor: c })} />
              ))}
              <input type="color" value={room.wallColor} title="เลือกสีเอง" onChange={(e) => set({ wallColor: e.target.value })} aria-label="เลือกสีผนังเอง" />
            </div>
          </div>
          <div className="sec">
            <h2>ผิวผนัง</h2>
            <div className="grid">
              {WALLS.map((w) => (
                <button key={w.id} className="card swatch" aria-pressed={w.id === room.wallPat} onClick={() => set({ wallPat: w.id })}>
                  <span className="img"><img src={surfaceThumb(w)} alt="" /></span>
                  <span className="t">{w.name}</span>
                  <span className="s">
                    {w.price.kind === 'paint' ? `${baht(PAINT.gallon)}/แกลลอน` : w.price.kind === 'roll' ? `${baht(w.price.roll)}/ม้วน` : `${baht(w.price.m2)}/ตร.ม.`}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
