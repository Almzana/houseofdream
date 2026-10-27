import { useMemo } from 'react';
import { catalogById } from '../data/catalog';
import { baht, houseBoq, type Line } from '../lib/boq';
import { useStore } from '../store';

const Lines = ({ lines }: { lines: Line[] }) => (
  <div className="boq">
    {lines.map(([a, b], i) => (
      <span key={i} style={{ display: 'contents' }}>
        <span>{a}</span>
        <span>{b}</span>
      </span>
    ))}
  </div>
);

export function useBoq() {
  const house = useStore((s) => s.house);
  return useMemo(() => houseBoq(house, (t) => catalogById.get(t)), [house]);
}

export function BudgetPanel() {
  const boq = useBoq();
  const selRoom = useStore((s) => s.selRoom);
  const { totals } = boq;

  return (
    <section className="pane">
      <div className="total">
        <small>งบประมาณรวมโดยประมาณ</small>
        <b>{baht(totals.all)}</b>
        <span>พื้นที่ในร่ม {totals.area.toFixed(1)} ตร.ม. · {boq.rooms.length} ห้อง/พื้นที่</span>
      </div>
      <div className="split">
        <div><small>งานพื้น</small><b>{baht(totals.floor)}</b></div>
        <div><small>งานผนัง</small><b>{baht(totals.wall)}</b></div>
        <div><small>ภายนอก</small><b>{baht(totals.shell)}</b></div>
        <div><small>โครงสร้าง · ระบบ</small><b>{baht(totals.works)}</b></div>
        <div><small>ของแต่ง</small><b>{baht(totals.items)}</b></div>
      </div>

      <div className="sec">
        <h2>โครงสร้าง · ประปา · ไฟฟ้า</h2>
        <p className="note">คำนวณจากผังบ้าน: เสาเข็ม ฐานราก เสา คาน พื้น ผนังก่อ ฝ้า ท่อ สายไฟ จุดปลั๊ก/สวิตช์ ดูเป็น 3D ได้ในโหมด “โครงสร้าง”</p>
        {[...new Set(boq.works.lines.map((l) => l.group))].map((g) => (
          <details key={g} className="room">
            <summary>
              <span>{g}</span>
              <b>{baht(boq.works.lines.filter((l) => l.group === g).reduce((a, l) => a + l.qty * l.rate, 0))}</b>
            </summary>
            <div className="body">
              <Lines lines={boq.works.lines.filter((l) => l.group === g).map((l) => [l.name, l.rate ? `${l.qty.toLocaleString('th-TH')} ${l.unit} · ${baht(l.qty * l.rate)}` : `${l.qty.toLocaleString('th-TH')} ${l.unit}`] as Line)} />
            </div>
          </details>
        ))}
      </div>

      <div className="sec">
        <h2>ภายนอก · หลังคา · รั้ว</h2>
        {boq.shell.lines.length ? <Lines lines={boq.shell.lines} /> : <div className="empty">ยังไม่มีผนังภายนอก</div>}
      </div>

      <div className="sec">
        <h2>แยกตามห้อง</h2>
        {boq.rooms.map((r) => (
          <details key={r.room.id} className="room" open={r.room.id === selRoom}>
            <summary>
              <span>
                {r.room.name}
                <small>
                  {r.room.w.toFixed(2)} × {r.room.d.toFixed(2)}{r.room.outdoor ? '' : ` × ${r.room.h.toFixed(2)}`} ม. · พื้น {r.floorA.toFixed(1)} ตร.ม.
                  {r.room.outdoor ? '' : ` · ผนัง ${r.wallA.toFixed(1)} ตร.ม.`}{(r.room.level ?? 0) > 0 ? ` · ชั้น ${(r.room.level ?? 0) + 1}` : ''}
                </small>
              </span>
              <b>{baht(r.cost)}</b>
            </summary>
            <div className="body">
              <h3 style={{ margin: 0, fontFamily: 'var(--f-display)', fontSize: 12, letterSpacing: '.16em', color: 'var(--muted)' }}>พื้น · {baht(r.floor.cost)}</h3>
              <Lines lines={r.floor.lines} />
              {!r.room.outdoor && (
                <>
                  <h3 style={{ margin: 0, fontFamily: 'var(--f-display)', fontSize: 12, letterSpacing: '.16em', color: 'var(--muted)' }}>ผนัง · {baht(r.wall.cost)}</h3>
                  <Lines lines={r.wall.lines} />
                </>
              )}
            </div>
          </details>
        ))}
      </div>

      <div className="sec">
        <h2>ของแต่ง / เฟอร์นิเจอร์</h2>
        {boq.items.length ? (
          <div className="boq">
            {boq.items.map((i) => (
              <span key={i.t} style={{ display: 'contents' }}>
                <span>{i.name} × {i.n}</span>
                <span>{i.total ? baht(i.total) : '–'}</span>
              </span>
            ))}
            <span className="hr" />
            <span><b>รวม</b></span>
            <span><b>{baht(totals.items)}</b></span>
          </div>
        ) : (
          <div className="empty">ยังไม่มีของในบ้าน</div>
        )}
      </div>
      <p className="note">
        ราคาเป็นค่าประมาณจากราคาตลาดทั่วไปในไทย (วัสดุ + ค่าแรงช่าง) ใช้วางแผนเบื้องต้นเท่านั้น ราคาจริงขึ้นกับแบรนด์ ร้าน และหน้างาน
        พื้นที่ผนังหักประตู 1 บานต่อห้อง และเผื่อเศษวัสดุ 10% · งานภายนอกรวมหลังคา สีภายนอก และรั้ว ราคาโครงสร้างและงานระบบเป็นค่าประมาณจากปริมาณที่คำนวณได้ ควรให้วิศวกรออกแบบและคำนวณโครงสร้างจริงก่อนก่อสร้าง
      </p>
    </section>
  );
}
