import { useEffect, useMemo, useState } from 'react';
import { catalogById } from '../data/catalog';
import { lotOf } from '../lib/shell';
import { checkThaiCode, electricalLoad, type Status } from '../lib/thaicode';
import { getEngine } from '../photo';
import { useStore } from '../store';
import { useSettledHouse } from './useSettled';
import { DEFAULT_SITE, type Site } from '../types';

const ICON: Record<Status, string> = { pass: '✓', fail: '✕', warn: '!', info: 'i' };
const lookup = (t: string) => catalogById.get(t);

function Num({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const [txt, setTxt] = useState(String(value));
  useEffect(() => setTxt(String(value)), [value]);
  const commit = () => {
    const v = Number(txt);
    if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, +v.toFixed(2))));
    else setTxt(String(value));
  };
  return (
    <label>
      {label}
      <input type="number" step={0.1} min={min} max={max} value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
    </label>
  );
}

/** Thai land area: ไร่-งาน-ตารางวา (1 ตร.วา = 4 ตร.ม., 1 งาน = 100 ตร.วา, 1 ไร่ = 4 งาน). */
function thaiArea(m2: number) {
  const wa = m2 / 4;
  const rai = Math.floor(wa / 400), ngan = Math.floor((wa % 400) / 100), w = wa % 100;
  return `${rai ? `${rai} ไร่ ` : ''}${ngan ? `${ngan} งาน ` : ''}${w.toFixed(1)} ตร.วา`;
}

/** What building this house in Thailand requires, checked against the design. */
export function CodePanel() {
  const house = useStore((s) => s.house);
  const setSite = useStore((s) => s.setSite);
  const selectRoom = useStore((s) => s.selectRoom);
  const set = useStore((s) => s.set);
  const site: Site = { ...DEFAULT_SITE, ...house.site };
  const settled = useSettledHouse();
  const checks = useMemo(() => checkThaiCode(settled, lookup), [settled]);
  const load = useMemo(() => electricalLoad(settled, lookup), [settled]);
  const lot = lotOf(house);
  const lotW = lot.x1 - lot.x0, lotD = lot.z1 - lot.z0;
  const n = (s: Status) => checks.filter((c) => c.status === s).length;
  const groups = [...new Set(checks.map((c) => c.group))];

  return (
    <section className="pane">
      <div className={`codesum${n('fail') ? ' bad' : ''}`}>
        <small>ตรวจแบบตามข้อกำหนดการสร้างบ้านในประเทศไทย</small>
        <b>{n('fail') ? `ต้องแก้ ${n('fail')} ข้อ` : 'ผ่านเกณฑ์หลักทั้งหมด'}</b>
        <span>ผ่าน {n('pass')} · ควรระวัง {n('warn')} · ข้อมูล/เอกสาร {n('info')}</span>
      </div>

      <div className="sec">
        <h2>ที่ดิน</h2>
        <p className="note">ระยะจากตัวบ้านถึงเขตที่ดินแต่ละด้าน (ด้านหน้าติดถนน) — ใช้ตรวจระยะร่น ที่ว่าง และวาดรั้ว</p>
        <div className="dims3 five">
          <Num label="ซ้าย (ม.)" value={site.left} min={0} max={50} onChange={(left) => setSite({ left })} />
          <Num label="ขวา (ม.)" value={site.right} min={0} max={50} onChange={(right) => setSite({ right })} />
          <Num label="หลัง (ม.)" value={site.back} min={0} max={50} onChange={(back) => setSite({ back })} />
          <Num label="หน้า (ม.)" value={site.front} min={0} max={50} onChange={(front) => setSite({ front })} />
          <Num label="ถนนกว้าง (ม.)" value={site.road} min={2} max={40} onChange={(road) => setSite({ road })} />
        </div>
        <p className="note">ที่ดิน {lotW.toFixed(2)} × {lotD.toFixed(2)} ม. = {(lotW * lotD).toFixed(1)} ตร.ม. ({thaiArea(lotW * lotD)}) · เส้นประในภาพคือแนวระยะร่นขั้นต่ำ</p>
      </div>

      {groups.map((g) => (
        <div key={g} className="sec">
          <h2>{g}</h2>
          <ul className="checks">
            {checks.filter((c) => c.group === g).map((c, i) => (
              <li key={i} className={c.status}>
                <i aria-label={c.status}>{ICON[c.status]}</i>
                <div>
                  <button
                    className="t"
                    disabled={!c.roomId}
                    onClick={() => {
                      if (!c.roomId) return;
                      selectRoom(c.roomId);
                      set({ viewMode: 'inside' });
                      setTimeout(() => getEngine()?.view('iso', c.roomId), 0);
                    }}
                  >
                    {c.title}
                  </button>
                  <span className="d">{c.detail}</span>
                  {c.fix && <span className="f">แก้: {c.fix}</span>}
                  <small>{c.rule}</small>
                </div>
              </li>
            ))}
          </ul>
          {g === 'ไฟฟ้า' && (
            <div className="boq">
              {load.lines.map(([k, v]) => (
                <span key={k} style={{ display: 'contents' }}>
                  <span>{k}</span>
                  <span>{Math.round(v).toLocaleString('th-TH')} VA</span>
                </span>
              ))}
              <span className="hr" />
              <span><b>รวมโหลดติดตั้ง</b></span>
              <span><b>{(load.connected / 1000).toFixed(1)} kVA</b></span>
            </div>
          )}
        </div>
      ))}
      <p className="note">
        เกณฑ์ในหน้านี้เป็นข้อกำหนดขั้นต่ำระดับประเทศ (พ.ร.บ.ควบคุมอาคาร กฎกระทรวงฉบับที่ 55 มาตรฐานการติดตั้งไฟฟ้า) ใช้ตรวจเบื้องต้นเท่านั้น
        ผังเมืองและข้อบัญญัติท้องถิ่นอาจเข้มกว่า ก่อนยื่นขออนุญาตควรให้สถาปนิก/วิศวกรตรวจแบบและลงนาม
      </p>
    </section>
  );
}
