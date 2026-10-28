/** Bill of quantities: material amounts and rough Thai-market costs per room. */
import { PAINT, floorById, wallById } from '../data/surfaces';
import { applyStorey, type House, type Room } from '../types';
import { shellStats } from './shell';
import { construct, type Lookup as BuildLookup, type QtyLine } from './construction';

export type Line = [string, string];
export interface RoomBoq {
  room: Room;
  floorA: number;
  wallA: number;
  perim: number;
  floor: { lines: Line[]; cost: number };
  wall: { lines: Line[]; cost: number };
  cost: number;
}
export interface ItemLine {
  t: string;
  name: string;
  n: number;
  unit: number;
  total: number;
}
export interface Boq {
  rooms: RoomBoq[];
  items: ItemLine[];
  shell: { lines: Line[]; cost: number; roofA: number; wallA: number; fence: number };
  /** structure and services: piles to wiring */
  works: { lines: QtyLine[]; cost: number };
  totals: { floor: number; wall: number; items: number; shell: number; works: number; all: number; area: number };
}

export const baht = (n: number) => '฿' + Math.round(n).toLocaleString('th-TH');
const n1 = (v: number) => v.toLocaleString('th-TH', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const DOOR_AREA = 1.6;
const ADHESIVE = { bag: 250, m2PerBag: 4 };
const GROUT = { kg: 60, kgPerM2Floor: 0.4, kgPerM2Wall: 0.3 };
const SKIRT = { len: 2.4, price: 180 };

export function roomBoq(room: Room): RoomBoq {
  const { w, d, h } = room;
  const floorA = w * d;
  const perim = 2 * (w + d);
  const wallA = room.outdoor ? 0 : Math.max(0, perim * h - DOOR_AREA);

  /* floor */
  const f = floorById(room.floor);
  const s = room.floorScale;
  const need = floorA * 1.1;
  const fl: Line[] = [[f.name, `${n1(floorA)} ตร.ม.`]];
  let fc = 0;
  if (f.dims) {
    const ta = (f.area ?? (f.dims[0] * f.dims[1]) / 1e4) * s * s;
    const pcs = Math.ceil(need / ta);
    const boxes = f.price.box ? Math.ceil(need / (f.price.box * s * s)) : 0;
    fl.push(
      ['ขนาดแผ่น', f.id === 'hex' ? `หกเหลี่ยม ${Math.round(f.dims[0] * s)} ซม.` : `${Math.round(f.dims[0] * s)}×${Math.round(f.dims[1] * s)} ซม.`],
      ['สั่งเผื่อ 10%', `${n1(need)} ตร.ม.`],
      ['จำนวน', `${pcs.toLocaleString('th-TH')} แผ่น${boxes ? ` ≈ ${boxes} กล่อง` : ''}`],
      ['ค่าวัสดุ', baht(need * f.price.m2)],
      ['ค่าแรงปู', baht(floorA * f.price.labor)],
    );
    fc = need * f.price.m2 + floorA * f.price.labor;
    if (f.adhesive) {
      const bags = Math.ceil(floorA / ADHESIVE.m2PerBag);
      const gk = Math.ceil(floorA * GROUT.kgPerM2Floor);
      fl.push(['ปูนกาว 20 กก. + ยาแนว', `${bags} + ${gk} ถุง · ${baht(bags * ADHESIVE.bag + gk * GROUT.kg)}`]);
      fc += bags * ADHESIVE.bag + gk * GROUT.kg;
    } else if (!f.outdoor) {
      const foam = Math.ceil(floorA * 1.05);
      fl.push(['แผ่นโฟมรองพื้น', `${foam} ตร.ม. · ${baht(foam * 35)}`]);
      fc += foam * 35;
    }
  } else {
    fc = need * f.price.m2 + floorA * f.price.labor;
    fl.push(['วัสดุ + ค่าแรง', baht(fc)]);
  }
  if (!room.outdoor) {
    const sticks = Math.ceil((perim - 0.8) / SKIRT.len);
    fl.push(['บัวพื้น', `${sticks} เส้น · ${baht(sticks * SKIRT.price)}`]);
    fc += sticks * SKIRT.price;
  }

  /* walls */
  const wl: Line[] = [];
  let wc = 0;
  if (!room.outdoor) {
    const p = wallById(room.wallPat);
    const q = p.price;
    wl.push([p.name, `${n1(wallA)} ตร.ม.`]);
    if (q.kind === 'paint') {
      const gal = Math.ceil((wallA * PAINT.coats) / PAINT.cover);
      const pri = Math.ceil(wallA / 40);
      wc = gal * PAINT.gallon + pri * PAINT.primer + wallA * PAINT.labor;
      wl.push(['สีทาภายใน 2 รอบ', `${gal} แกลลอน · ${baht(gal * PAINT.gallon)}`], ['สีรองพื้น', `${pri} แกลลอน · ${baht(pri * PAINT.primer)}`], ['ค่าแรงทาสี', baht(wallA * PAINT.labor)]);
    } else if (q.kind === 'roll') {
      const rolls = Math.ceil((wallA * 1.1) / q.rollM2);
      wc = rolls * q.roll + wallA * 80;
      wl.push(['วอลเปเปอร์ 0.53×10 ม.', `${rolls} ม้วน · ${baht(rolls * q.roll)}`], ['ค่าแรงติด', baht(wallA * 80)]);
    } else if (q.kind === 'area') {
      wc = wallA * q.m2;
      wl.push([q.label, baht(wc)]);
    } else {
      const needW = wallA * 1.1;
      const pcs = Math.ceil(needW / q.tile);
      const boxes = Math.ceil(needW / q.box);
      const bags = Math.ceil(wallA / ADHESIVE.m2PerBag);
      const gk = Math.ceil(wallA * GROUT.kgPerM2Wall);
      wc = needW * q.m2 + wallA * q.labor + bags * ADHESIVE.bag + gk * GROUT.kg;
      wl.push(
        ['จำนวน', `${pcs.toLocaleString('th-TH')} ${q.tileLabel ?? 'แผ่น'} ≈ ${boxes} กล่อง`],
        ['ค่าวัสดุ', baht(needW * q.m2)],
        ['ค่าแรงปู', baht(wallA * q.labor)],
        ['ปูนกาว + ยาแนว', `${bags} + ${gk} ถุง · ${baht(bags * ADHESIVE.bag + gk * GROUT.kg)}`],
      );
    }
  }
  return { room, floorA, wallA, perim, floor: { lines: fl, cost: fc }, wall: { lines: wl, cost: wc }, cost: fc + wc };
}

type Lookup = (t: string) => ({ name: string; price: number; opening?: { w: number; y0: number; y1: number; door?: boolean }; light?: unknown; mount?: string }) | undefined;

const ROOF = { tile: 380, frame: 550, labor: 220, perM2: 10, flat: 950 };
const EXT_PAINT = { gallon: 1650, cover: 30, labor: 110 };
const FENCE = 3500;

/** Roof, exterior walls and fence. */
export function shellBoq(house: House, lookup: Lookup) {
  const s = shellStats(house, lookup);
  const lines: Line[] = [];
  let cost = 0;
  if (s.roofA > 0) {
    if (s.ext.roof === 'flat') {
      cost += s.roofA * ROOF.flat;
      lines.push(['หลังคาแบน (กันซึม + ปูนเทปรับระดับ)', `${n1(s.roofA)} ตร.ม. · ${baht(s.roofA * ROOF.flat)}`]);
    } else {
      const pcs = Math.ceil(s.roofA * ROOF.perM2 * 1.05);
      cost += s.roofA * (ROOF.tile + ROOF.frame + ROOF.labor);
      lines.push(
        [s.ext.roof === 'mansard' ? 'หลังคาทรงแมนซาร์ด (Mansard) ลาดชัน 72°' : `หลังคา${s.ext.roof === 'hip' ? 'ปั้นหยา' : 'จั่ว'} ${s.ext.pitch}°`, `${n1(s.roofA)} ตร.ม.`],
        ['กระเบื้องคอนกรีต', `${pcs.toLocaleString('th-TH')} แผ่น · ${baht(s.roofA * ROOF.tile)}`],
        ['โครงหลังคาเหล็ก', baht(s.roofA * ROOF.frame)],
        ['ค่าแรงมุงหลังคา', baht(s.roofA * ROOF.labor)],
      );
    }
  }
  if (s.wallA > 0) {
    const p = wallById(s.ext.wallPat).price;
    if (p.kind === 'paint') {
      const gal = Math.ceil((s.wallA * 2) / EXT_PAINT.cover);
      const c = gal * EXT_PAINT.gallon + Math.ceil(s.wallA / 40) * PAINT.primer + s.wallA * EXT_PAINT.labor;
      cost += c;
      lines.push(['ผนังภายนอก (หักประตู/หน้าต่าง)', `${n1(s.wallA)} ตร.ม.`], ['สีทาภายนอก 2 รอบ + รองพื้น', `${gal} แกลลอน · ${baht(c)}`]);
    } else {
      const m2 = p.kind === 'tile' ? p.m2 * 1.1 + p.labor : p.kind === 'area' ? p.m2 : 600;
      cost += s.wallA * m2;
      lines.push([`ผนังภายนอก · ${wallById(s.ext.wallPat).name}`, `${n1(s.wallA)} ตร.ม. · ${baht(s.wallA * m2)}`]);
    }
  }
  if (s.fence > 0) {
    cost += s.fence * FENCE;
    lines.push(['รั้วก่ออิฐ + ระแนงอลูมิเนียม', `${n1(s.fence)} ม. · ${baht(s.fence * FENCE)}`]);
  }
  return { lines, cost, roofA: s.roofA, wallA: s.wallA, fence: s.fence };
}

export function houseBoq(house: House, lookup: Lookup): Boq {
  applyStorey(house);
  const rooms = house.rooms.map(roomBoq);
  const counts = new Map<string, number>();
  for (const it of house.items) counts.set(it.t, (counts.get(it.t) ?? 0) + 1);
  const items: ItemLine[] = [];
  counts.forEach((n, t) => {
    const d = lookup(t);
    if (d) items.push({ t, name: d.name, n, unit: d.price, total: d.price * n });
  });
  items.sort((a, b) => b.total - a.total);
  const floor = rooms.reduce((s, r) => s + r.floor.cost, 0);
  const wall = rooms.reduce((s, r) => s + r.wall.cost, 0);
  const it = items.reduce((s, i) => s + i.total, 0);
  const area = house.rooms.filter((r) => !r.outdoor).reduce((s, r) => s + r.w * r.d, 0);
  const shell = shellBoq(house, lookup);
  const wl = house.rooms.length ? construct(house, lookup as BuildLookup).quantities : [];
  const works = { lines: wl, cost: wl.reduce((a, l) => a + l.qty * l.rate, 0) };
  return { rooms, items, shell, works, totals: { floor, wall, items: it, shell: shell.cost, works: works.cost, all: floor + wall + it + shell.cost + works.cost, area } };
}
