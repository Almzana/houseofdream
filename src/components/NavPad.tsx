import { useRef, useState } from 'react';
import { getEngine } from '../photo';

/**
 * Orbit ring: drag the bronze knob around the ring to walk around the house,
 * arrows rotate / tilt in 45° / 15° steps, the centre re-frames the house.
 */
const R = 54;
const C = 66;
const STEP = Math.PI / 4;

export function NavPad({ azimuth }: { azimuth: number }) {
  const svg = useRef<SVGSVGElement>(null);
  const [auto, setAuto] = useState(false);
  const dragging = useRef(false);

  // knob shows where the camera stands: azimuth 0 = in front of the house (bottom of the ring)
  const kx = C + R * Math.sin(azimuth);
  const ky = C + R * Math.cos(azimuth);

  const angleAt = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 132 - C;
    const y = ((e.clientY - r.top) / r.height) * 132 - C;
    return Math.atan2(x, y);
  };

  const e = () => getEngine();
  const arrow = (d: string, onClick: () => void, label: string) => (
    <g onClick={onClick} role="button" aria-label={label}>
      <path className="arrow" d={d} />
    </g>
  );

  return (
    <div className="float nav">
      <svg
        ref={svg}
        className="ring"
        viewBox="0 0 132 132"
        role="slider"
        aria-label="หมุนรอบบ้าน"
        aria-valuenow={Math.round(((azimuth * 180) / Math.PI + 360) % 360)}
        onPointerMove={(ev) => dragging.current && e()?.setAzimuth(angleAt(ev))}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        <circle className="track" cx={C} cy={C} r={R} />
        <circle className="trackin" cx={C} cy={C} r={R - 9} />
        <text className="tick" x={C} y={12} textAnchor="middle">หลัง</text>
        <text className="tick" x={C} y={128} textAnchor="middle">หน้า</text>
        <text className="tick" x={5} y={C + 3}>ซ</text>
        <text className="tick" x={121} y={C + 3}>ข</text>
        {arrow(`M${C - 30} ${C} l10 -8 v16 z`, () => e()?.orbit(-STEP), 'หมุนซ้าย')}
        {arrow(`M${C + 30} ${C} l-10 -8 v16 z`, () => e()?.orbit(STEP), 'หมุนขวา')}
        {arrow(`M${C} ${C - 30} l-8 10 h16 z`, () => e()?.orbit(0, -Math.PI / 12), 'มุมสูงขึ้น')}
        {arrow(`M${C} ${C + 30} l-8 -10 h16 z`, () => e()?.orbit(0, Math.PI / 12), 'มุมต่ำลง')}
        <circle className="centre" cx={C} cy={C} r={14} onClick={() => e()?.view('iso')} role="button" aria-label="จัดภาพทั้งบ้าน" />
        <text className="c" x={C} y={C + 3} textAnchor="middle">FIT</text>
        <circle
          className="knob"
          cx={kx}
          cy={ky}
          r={9}
          onPointerDown={(ev) => {
            dragging.current = true;
            (ev.target as Element).setPointerCapture(ev.pointerId);
          }}
        />
      </svg>
      <div className="zoom">
        <button onClick={() => e()?.zoom(0.8)} aria-label="ซูมเข้า">+</button>
        <button onClick={() => e()?.zoom(1.25)} aria-label="ซูมออก">−</button>
        <button
          aria-pressed={auto}
          aria-label="หมุนอัตโนมัติ"
          title="หมุนอัตโนมัติ"
          onClick={() => {
            setAuto(!auto);
            e()?.setAutoRotate(!auto);
          }}
        >
          ⟳
        </button>
      </div>
    </div>
  );
}
