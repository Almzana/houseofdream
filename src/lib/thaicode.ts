/**
 * Checks a design against what building a house in Thailand requires: the Building Control
 * Act's Ministerial Regulation No. 55 (setbacks, open space, room sizes, stairs), the
 * electrical installation standard (earthing, RCD, meter size from the load), sanitation
 * (septic tank, grease trap), and the paperwork to file. Figures are the national minimums;
 * local regulations and the town plan can be stricter.
 */
import { DEFAULT_SITE, applyStorey, stairSteps, type House, type Room } from '../types';
import { WALL_T, inRoom, levelY, levelsOf, lotOf, openingsOf, roofPlan, MANSARD_H, roofReach } from './shell';
import { isExterior, wallSegments } from './walls';

export type Status = 'pass' | 'fail' | 'warn' | 'info';
export interface Check {
  group: string;
  title: string;
  status: Status;
  /** what was found */
  detail: string;
  /** the rule and where it comes from */
  rule: string;
  /** what to do about it */
  fix?: string;
  roomId?: string;
}

export interface CodeLookup {
  (t: string): { opening?: { w: number; y0: number; y1: number; door?: boolean }; light?: { lm: number } | unknown; stair?: { w: number; len: number } } | undefined;
}

const lv = (o: { level?: number; l?: number }) => o.level ?? o.l ?? 0;
const m2 = (v: number) => `${v.toFixed(1)} ตร.ม.`;
const m = (v: number) => `${v.toFixed(2)} ม.`;
const HABITABLE: Room['type'][] = ['living', 'bedroom', 'dining', 'office', 'kitchen'];
const R55 = 'กฎกระทรวง ฉบับที่ 55 (พ.ศ. 2543) ออกตาม พ.ร.บ.ควบคุมอาคาร';

/** Electrical load of the design (VA) and what it means for the meter and main breaker. */
export function electricalLoad(house: House, lookup: CodeLookup) {
  const lines: [string, number][] = [];
  let lights = 0;
  for (const it of house.items) {
    const l = lookup(it.t)?.light as { lm: number } | undefined;
    if (l) lights += (it.lm ?? l.lm) / 90;
  }
  lights += house.rooms.filter((r) => !r.outdoor && !house.items.some((i) => lookup(i.t)?.light && lv(i) === lv(r) && inRoom(r, i.x, i.z))).length * 18;
  lines.push(['แสงสว่าง', lights]);
  const perRoom: Partial<Record<Room['type'], number>> = { living: 6, bedroom: 4, office: 5, kitchen: 4, dining: 2, laundry: 1, hall: 1, garage: 1, balcony: 1 };
  const sockets = house.rooms.reduce((a, r) => a + (perRoom[r.type] ?? 0) * 180, 0);
  lines.push(['เต้ารับ (180 VA/จุด)', sockets]);
  const ac = house.rooms.filter((r) => !r.outdoor && (r.type === 'bedroom' || r.type === 'living' || r.type === 'office')).reduce((a, r) => a + (r.w * r.d > 20 ? 1700 : r.w * r.d > 14 ? 1100 : 800), 0);
  if (ac) lines.push(['เครื่องปรับอากาศ', ac]);
  const heaters = house.items.filter((i) => i.t === 'heater').length * 4500;
  if (heaters) lines.push(['เครื่องทำน้ำอุ่น 4,500 W', heaters]);
  const stove = house.items.filter((i) => i.t === 'kstove').length * 3000;
  if (stove) lines.push(['เตาไฟฟ้า/เตาอบ', stove]);
  const washer = house.items.filter((i) => i.t === 'washer').length * 1000;
  if (washer) lines.push(['เครื่องซักผ้า', washer]);
  if (house.items.some((i) => ['toilet', 'vanity', 'shower', 'ksink'].includes(i.t))) lines.push(['ปั๊มน้ำ', 300]);
  const connected = lines.reduce((a, [, v]) => a + v, 0);
  // demand with typical diversity for a dwelling: not everything runs at once
  const nHeat = house.items.filter((i) => i.t === 'heater').length;
  const demand = lights + sockets * 0.4 + ac * 0.8 + (nHeat ? 4500 + (nHeat - 1) * 4500 * 0.5 : 0) + stove * 0.8 + washer + 300;
  const amps = demand / 220;
  const meter = amps <= 45 ? '15(45)A' : amps <= 100 ? '30(100)A' : '3 เฟส 15(45)A';
  const main = amps <= 45 ? 50 : 100;
  const cable = amps <= 45 ? 'THW 16 ตร.มม.' : 'THW 35 ตร.มม.';
  return { lines, connected, demand, amps, meter, main, cable };
}

export function checkThaiCode(house: House, lookup: CodeLookup): Check[] {
  applyStorey(house);
  const out: Check[] = [];
  const rooms = house.rooms;
  const indoor = rooms.filter((r) => !r.outdoor);
  if (!indoor.length) return out;
  const site = { ...DEFAULT_SITE, ...house.site };
  const lot = lotOf(house);
  const levels = levelsOf(rooms);
  const top = Math.max(...indoor.map(lv));
  const ops = openingsOf(house, lookup);

  /* ---------- building height decides the setback ---------- */
  const plan = roofPlan(house);
  const ext = house.ext;
  const pitch = ext?.pitch ?? 30;
  let height = plan ? plan.base : levelY(top) + 2.7;
  if (plan && ext?.roof === 'mansard') height += MANSARD_H + 0.3;
  else if (plan && ext?.roof !== 'flat' && ext?.roof !== 'none') height += (Math.min(plan.x1 - plan.x0, plan.z1 - plan.z0) / 2) * Math.tan((pitch * Math.PI) / 180);
  if (ext?.roof === 'flat') height += 0.85;
  const need = height > 9 ? 3 : 2;
  out.push({
    group: 'ระยะร่นและที่ว่าง', title: 'ความสูงอาคาร', status: 'info',
    detail: `สูงประมาณ ${m(height)} จากพื้นดินถึงยอดหลังคา`, rule: `${R55}: อาคารสูงไม่เกิน 9 ม. ช่องเปิดต้องห่างแนวเขต 2 ม. · สูงเกิน 9 ม. ต้องห่าง 3 ม.`,
  });

  /* ---------- openings vs. side/back boundaries ---------- */
  const near: { room: string; side: string; dist: number; open: boolean }[] = [];
  for (const l of levels) {
    for (const s of wallSegments(rooms, ops, l)) {
      if (!isExterior(s)) continue;
      const o = !s.minus ? -1 : 1; // outdoor side
      const face = s.c + o * WALL_T;
      const dist = s.axis === 'x' ? (o < 0 ? face - lot.z0 : lot.z1 - face) : o < 0 ? face - lot.x0 : lot.x1 - face;
      const side = s.axis === 'x' ? (o < 0 ? 'ด้านหลัง' : 'ด้านหน้า') : o < 0 ? 'ด้านซ้าย' : 'ด้านขวา';
      if (side === 'ด้านหน้า') continue; // the street side is the road setback below
      // only walls actually facing that boundary (not courtyards)
      near.push({ room: (s.plus ?? s.minus)!, side, dist, open: s.gaps.length > 0 });
    }
  }
  for (const b of rooms.filter((r) => r.type === 'balcony' && lv(r) > 0)) {
    for (const [side, dist] of [['ด้านหลัง', b.z - b.d / 2 - lot.z0], ['ด้านซ้าย', b.x - b.w / 2 - lot.x0], ['ด้านขวา', lot.x1 - (b.x + b.w / 2)]] as const) near.push({ room: b.id, side, dist, open: true });
  }
  const bySide = new Map<string, typeof near>();
  for (const n of near) bySide.set(n.side, [...(bySide.get(n.side) ?? []), n]);
  for (const [side, list] of bySide) {
    const withOpen = list.filter((n) => n.open);
    const minOpen = withOpen.length ? Math.min(...withOpen.map((n) => n.dist)) : Infinity;
    const minAll = Math.min(...list.map((n) => n.dist));
    const worst = withOpen.find((n) => n.dist === minOpen);
    if (minOpen < need - 1e-3) {
      out.push({
        group: 'ระยะร่นและที่ว่าง', title: `ช่องเปิด${side} ใกล้แนวเขตที่ดิน`, status: 'fail', roomId: worst?.room,
        detail: `ผนังที่มีประตู/หน้าต่าง/ระเบียง ห่างแนวเขต ${m(minOpen)} (${rooms.find((r) => r.id === worst?.room)?.name ?? ''})`,
        rule: `${R55} ข้อ 50: ผนังหรือระเบียงที่มีช่องเปิด ต้องห่างแนวเขตที่ดินไม่น้อยกว่า ${need} ม.`,
        fix: `ขยายระยะ${side}เป็นอย่างน้อย ${need} ม. หรือย้ายหน้าต่าง/ประตูออกจากผนังด้านนี้ (ทำเป็นผนังทึบ)`,
      });
    } else if (minAll < 0.5 - 1e-3) {
      out.push({
        group: 'ระยะร่นและที่ว่าง', title: `ผนังทึบ${side} ชิดแนวเขต`, status: 'warn',
        detail: `ผนังทึบห่างแนวเขต ${m(minAll)}`, rule: `${R55} ข้อ 50: ผนังทึบต้องห่างแนวเขตไม่น้อยกว่า 0.50 ม. เว้นแต่ได้รับความยินยอมเป็นหนังสือจากเจ้าของที่ดินข้างเคียง`,
        fix: 'ขอหนังสือยินยอมจากเพื่อนบ้าน หรือร่นผนังเข้ามาอย่างน้อย 50 ซม.',
      });
    } else {
      out.push({ group: 'ระยะร่นและที่ว่าง', title: `ระยะร่น${side}`, status: 'pass', detail: withOpen.length ? `ช่องเปิดห่างแนวเขต ${m(minOpen)}` : `ผนังทึบห่างแนวเขต ${m(minAll)}`, rule: `${R55} ข้อ 50: ช่องเปิดห่างแนวเขต ≥ ${need} ม. · ผนังทึบ ≥ 0.50 ม.` });
    }
  }

  /* ---------- road setback ---------- */
  const W = site.road;
  const fromBoundary = W < 6 ? Math.max(0, 3 - W / 2) : W <= 10 ? W / 10 : W <= 20 ? 2 : Math.min(6, W / 10);
  const ruleRoad = 'ถนนกว้าง < 6 ม. ร่นจากกึ่งกลางถนน 3 ม. · 6–10 ม. ร่นจากเขตถนน 1/10 ของความกว้าง · 10–20 ม. ร่น 2 ม. · เกิน 20 ม. ร่น 1/10 (ไม่เกิน 6 ม.)';
  const frontFace = Math.max(...indoor.map((r) => r.z + r.d / 2)) + WALL_T + (plan ? 0 : 0);
  const frontGap = lot.z1 - frontFace;
  out.push({
    group: 'ระยะร่นและที่ว่าง', title: 'ระยะร่นจากถนนสาธารณะ', status: frontGap + 1e-3 >= fromBoundary ? 'pass' : 'fail',
    detail: `ถนนกว้าง ${W} ม. · ตัวบ้านห่างเขตที่ดินด้านหน้า ${m(frontGap)} (ต้องการ ≥ ${m(fromBoundary)})`,
    rule: `${R55} ข้อ 41: ${ruleRoad}`,
    fix: frontGap + 1e-3 >= fromBoundary ? undefined : `ร่นตัวบ้านเข้าไปให้ห่างเขตที่ดินด้านหน้าอย่างน้อย ${m(fromBoundary)}`,
  });
  // eaves count too: the roof overhang must stay inside the plot
  if (plan && ext?.roof !== 'none') {
    const o = roofReach(ext?.roof ?? 'hip');
    const over = Math.min(plan.x0 - o - lot.x0, lot.x1 - (plan.x1 + o), plan.z0 - o - lot.z0, lot.z1 - (plan.z1 + o));
    out.push({
      group: 'ระยะร่นและที่ว่าง', title: 'ชายคาอยู่ในเขตที่ดิน', status: over >= 0 ? 'pass' : 'fail',
      detail: over >= 0 ? `ชายคาห่างแนวเขตอย่างน้อย ${m(over)}` : `ชายคายื่นเกินแนวเขต ${m(-over)}`,
      rule: 'ส่วนใดของอาคาร (รวมชายคาและรางน้ำ) ห้ามล้ำแนวเขตที่ดิน และน้ำฝนต้องไม่ไหลลงที่ดินข้างเคียง (ป.พ.พ. มาตรา 1339)',
      fix: over >= 0 ? undefined : 'ลดระยะยื่นชายคา หรือร่นตัวบ้านจากแนวเขต',
    });
  }

  /* ---------- open space ---------- */
  const lotA = (lot.x1 - lot.x0) * (lot.z1 - lot.z0);
  const covered = rooms.filter((r) => lv(r) === 0 && (!r.outdoor || r.type === 'garage')).reduce((a, r) => a + r.w * r.d, 0);
  const floorMax = Math.max(...levels.map((l) => indoor.filter((r) => lv(r) === l).reduce((a, r) => a + r.w * r.d, 0)));
  const open = lotA - covered;
  out.push({
    group: 'ระยะร่นและที่ว่าง', title: 'ที่ว่างรอบอาคาร', status: open >= 0.3 * floorMax ? 'pass' : 'fail',
    detail: `ที่ดิน ${m2(lotA)} · อาคารคลุมพื้นดิน ${m2(covered)} · ที่ว่าง ${m2(open)} (${((open / floorMax) * 100).toFixed(0)}% ของพื้นที่ชั้นที่ใหญ่ที่สุด ${m2(floorMax)})`,
    rule: `${R55} ข้อ 33: อาคารอยู่อาศัยต้องมีที่ว่างไม่น้อยกว่า 30% ของพื้นที่ชั้นที่มากที่สุด`,
    fix: open >= 0.3 * floorMax ? undefined : 'เพิ่มขนาดที่ดิน หรือลดพื้นที่อาคารชั้นล่าง',
  });

  /* ---------- rooms ---------- */
  for (const r of indoor) {
    const habitable = HABITABLE.includes(r.type);
    const minH = habitable ? 2.6 : 2.0;
    if (r.h + 1e-3 < minH) {
      out.push({
        group: 'ขนาดห้อง', title: `ฝ้าเตี้ยเกินไป: ${r.name}`, status: 'fail', roomId: r.id,
        detail: `สูงจากพื้นถึงฝ้า ${m(r.h)}`, rule: `${R55}: ห้องในอาคารอยู่อาศัยสูงไม่น้อยกว่า 2.60 ม. · ห้องน้ำ ห้องส้วม ระเบียง ไม่น้อยกว่า 2.00 ม.`, fix: `ยกฝ้าเป็นอย่างน้อย ${minH.toFixed(2)} ม.`,
      });
    }
    if (r.type === 'bathroom' && (r.w * r.d < 1.5 || Math.min(r.w, r.d) < 0.9)) {
      out.push({ group: 'ขนาดห้อง', title: `ห้องน้ำเล็กเกินไป: ${r.name}`, status: 'fail', roomId: r.id, detail: `${m(r.w)} × ${m(r.d)} = ${m2(r.w * r.d)}`, rule: 'ห้องส้วมต้องมีพื้นที่ไม่น้อยกว่า 1.5 ตร.ม. และกว้างไม่น้อยกว่า 0.90 ม.', fix: 'ขยายห้องน้ำ' });
    }
    // ventilation: doors/windows to outside (or glazed doors) ≥ 10% of the floor area
    if (habitable || r.type === 'bathroom') {
      let openA = 0;
      for (const s of wallSegments(rooms, ops, lv(r))) {
        if (!isExterior(s) || (s.plus !== r.id && s.minus !== r.id)) continue;
        for (const g of s.gaps) openA += (g.b - g.a) * (g.y1 - g.y0);
      }
      const pct = (openA / (r.w * r.d)) * 100;
      if (pct + 1e-6 < 10) {
        out.push({
          group: 'แสงและการระบายอากาศ', title: `ช่องเปิดไม่พอ: ${r.name}`, status: r.type === 'bathroom' ? 'warn' : 'fail', roomId: r.id,
          detail: `ช่องเปิดสู่ภายนอก ${m2(openA)} = ${pct.toFixed(0)}% ของพื้นที่ห้อง`,
          rule: 'ห้องที่ใช้อยู่อาศัยต้องมีประตู หน้าต่าง หรือช่องระบายอากาศสู่ภายนอก รวมกันไม่น้อยกว่า 10% ของพื้นที่ห้อง (กฎกระทรวง ฉบับที่ 39) · ห้องน้ำที่ไม่มีหน้าต่างต้องมีพัดลมระบายอากาศ',
          fix: r.type === 'bathroom' ? 'เพิ่มหน้าต่างบนผนังภายนอก หรือติดพัดลมระบายอากาศ' : 'เพิ่มหน้าต่างบนผนังภายนอกของห้องนี้',
        });
      }
    }
    // every room needs a way in
    const hasDoor = house.items.some((i) => lookup(i.t)?.opening?.door && lv(i) === lv(r) && inRoom(r, i.x, i.z, 0.12));
    if (!hasDoor) out.push({ group: 'ขนาดห้อง', title: `ไม่มีประตูเข้า: ${r.name}`, status: 'fail', roomId: r.id, detail: 'ไม่พบประตูหรือช่องเปิดบนผนังของห้องนี้', rule: 'ห้องทุกห้องต้องมีทางเข้าออก', fix: 'วางประตูหรือช่องเปิดโล่งบนผนังที่ติดห้องข้างเคียง' });
  }
  if (!out.some((c) => c.group === 'ขนาดห้อง')) out.push({ group: 'ขนาดห้อง', title: 'ความสูงฝ้า ขนาดห้องน้ำ และทางเข้าทุกห้อง', status: 'pass', detail: `ตรวจ ${indoor.length} ห้อง`, rule: `${R55}: ห้องอยู่อาศัยสูง ≥ 2.60 ม. · ห้องน้ำ ≥ 2.00 ม. และ ≥ 1.5 ตร.ม.` });
  if (!out.some((c) => c.group === 'แสงและการระบายอากาศ')) out.push({ group: 'แสงและการระบายอากาศ', title: 'ช่องเปิดระบายอากาศ', status: 'pass', detail: 'ทุกห้องมีช่องเปิดสู่ภายนอก ≥ 10% ของพื้นที่ห้อง', rule: 'กฎกระทรวง ฉบับที่ 39' });

  /* ---------- stairs ---------- */
  if (top > 0) {
    const stairs = house.items.filter((i) => lookup(i.t)?.stair);
    for (let l = 1; l <= top; l++) {
      const st = stairs.find((s) => lv(s) === l - 1);
      if (!st) {
        out.push({ group: 'บันได', title: `ไม่มีบันไดขึ้นชั้น ${l + 1}`, status: 'fail', detail: 'มีห้องชั้นบนแต่ไม่มีบันได', rule: 'ทุกชั้นต้องมีบันไดเข้าถึง', fix: 'วาง "บันไดขึ้นชั้นบน" จากหมวดประตู/หน้าต่าง' });
        continue;
      }
      const sp = lookup(st.t)!.stair!;
      const { rise, go, flight, landing } = stairSteps();
      const ok = sp.w >= 0.8 && rise <= 0.2 && go >= 0.22 && flight <= 3;
      out.push({
        group: 'บันได', title: `บันไดขึ้นชั้น ${l + 1}`, status: ok ? 'pass' : 'fail',
        detail: `กว้าง ${m(sp.w)} · ลูกตั้ง ${(rise * 100).toFixed(1)} ซม. · ลูกนอน ${(go * 100).toFixed(0)} ซม. · ${landing ? `มีชานพักกลาง แต่ละช่วงสูง ${m(flight)}` : `สูงช่วงเดียว ${m(flight)}`}`,
        rule: `${R55}: บันไดอาคารอยู่อาศัยกว้าง ≥ 80 ซม. · ลูกตั้ง ≤ 20 ซม. · ลูกนอน ≥ 22 ซม. · ช่วงหนึ่งสูง ≤ 3 ม. (เกินต้องมีชานพัก) · ระยะดิ่งเหนือขั้น ≥ 1.90 ม.`,
      });
    }
  }

  /* ---------- sanitation ---------- */
  const toilets = house.items.filter((i) => i.t === 'toilet').length;
  out.push({
    group: 'ประปาและสุขาภิบาล', title: 'ระบบบำบัดน้ำเสีย', status: toilets ? 'pass' : 'info',
    detail: toilets ? `ส้วม ${toilets} ที่ → ถังบำบัดสำเร็จรูป 1,600 ลิตร (คำนวณในโหมดโครงสร้าง)` : 'ยังไม่มีส้วมในแบบ',
    rule: 'กฎกระทรวงกำหนดระบบบำบัดน้ำเสียฯ: น้ำเสียต้องผ่านการบำบัดก่อนระบายสู่ท่อสาธารณะ · ส้วมต้องต่อถังบำบัด/บ่อเกรอะ-บ่อซึม',
  });
  const sinks = house.items.filter((i) => i.t === 'ksink').length;
  if (sinks) out.push({ group: 'ประปาและสุขาภิบาล', title: 'บ่อดักไขมันครัว', status: 'pass', detail: `ซิงค์ครัว ${sinks} จุด → บ่อดักไขมัน 1 ชุด ก่อนลงบ่อพัก`, rule: 'น้ำทิ้งจากครัวต้องผ่านบ่อดักไขมันก่อนระบาย (เทศบัญญัติ/กฎกระทรวงการระบายน้ำทิ้ง)' });
  out.push({ group: 'ประปาและสุขาภิบาล', title: 'ระยะบ่อซึม/ถังบำบัดจากแหล่งน้ำ', status: 'info', detail: 'ถังบำบัดวางด้านข้างบ้าน', rule: 'บ่อซึมต้องห่างบ่อน้ำใช้/แหล่งน้ำไม่น้อยกว่า 10 ม. (มาตรฐานกรมอนามัย)' });

  /* ---------- electrical ---------- */
  const load = electricalLoad(house, lookup);
  out.push({
    group: 'ไฟฟ้า', title: `ขนาดมิเตอร์ที่ควรขอ: ${load.meter}`, status: 'info',
    detail: `โหลดติดตั้งรวม ${(load.connected / 1000).toFixed(1)} kVA · คิดตามการใช้พร้อมกันจริง ≈ ${(load.demand / 1000).toFixed(1)} kVA ≈ ${load.amps.toFixed(0)} A · เมนเบรกเกอร์ ${load.main} A · สายเมน ${load.cable}`,
    rule: 'การไฟฟ้า (กฟภ./กฟน.) จ่ายไฟตามขนาดมิเตอร์ · ขนาดสายและเบรกเกอร์ตามมาตรฐานการติดตั้งทางไฟฟ้าสำหรับประเทศไทย (วสท. 2001)',
  });
  out.push({ group: 'ไฟฟ้า', title: 'สายดินและหลักดิน', status: 'pass', detail: 'หลักดินทองแดง ø5/8" ยาว 2.40 ม. + สายดินเข้าตู้ไฟ (มีในโหมดโครงสร้าง)', rule: 'การไฟฟ้ากำหนดให้บ้านใหม่ต้องมีระบบสายดิน ก่อนติดตั้งมิเตอร์ (มาตรฐาน วสท.)' });
  out.push({ group: 'ไฟฟ้า', title: 'เครื่องตัดไฟรั่ว (RCD/RCBO 30 mA)', status: 'pass', detail: 'ตู้ไฟมีกันดูดที่เมน และ RCBO แยกวงจรเครื่องทำน้ำอุ่น', rule: 'วงจรในที่เปียก (ห้องน้ำ เครื่องทำน้ำอุ่น ภายนอกอาคาร) ต้องมีเครื่องตัดไฟรั่วขนาดไม่เกิน 30 mA' });

  /* ---------- large homes: lift, pool, big-building thresholds ---------- */
  const total = indoor.filter((r) => r.type !== 'void').reduce((a, r) => a + r.w * r.d, 0);
  const G = 'บ้านขนาดใหญ่ · ระบบพิเศษ';
  const lifts = indoor.filter((r) => r.type === 'lift');
  if (lifts.length) {
    const small = lifts.filter((r) => Math.min(r.w, r.d) < 1.6);
    out.push({
      group: G, title: 'ลิฟต์บ้าน', status: small.length ? 'warn' : 'pass', roomId: small[0]?.id,
      detail: small.length ? `ปล่องลิฟต์แคบ ${m(Math.min(small[0].w, small[0].d))} — ลิฟต์บ้านทั่วไปต้องการปล่องอย่างน้อย 1.60 × 1.60 ม.` : `ลิฟต์ ${new Set(lifts.map(lv)).size} ชั้น · ปล่องคอนกรีตเสริมเหล็ก + บ่อลิฟต์ลึก 1.40 ม. (ดูในโหมดโครงสร้าง)`,
      rule: 'มาตรฐานลิฟต์ EN 81-41 / มอก. · ต้องมีระบบ ARD พาลงชั้นใกล้สุดเมื่อไฟดับ โทรศัพท์ฉุกเฉินในตัวลิฟต์ และตรวจสอบโดยวิศวกรเครื่องกลทุกปี',
    });
  }
  const pools = rooms.filter((r) => r.type === 'pool');
  if (pools.length) {
    const poolA = pools.reduce((a, r) => a + r.w * r.d, 0);
    out.push({
      group: G, title: 'สระว่ายน้ำ', status: 'info', roomId: pools[0].id,
      detail: `สระ ${m2(poolA)} ลึก 1.50 ม. · ถังคอนกรีตบนเสาเข็มของตัวเอง แยกจากโครงสร้างบ้าน`,
      rule: 'โครงสร้างสระต้องมีวิศวกรโยธาออกแบบ · ถ้ามีเด็กเล็กควรมีรั้วกั้นสูง ≥ 1.20 ม. ประตูปิดเองได้ · วงจรไฟฟ้าสระต้องมี RCD 30 mA และต่อประสานศักย์ (Equipotential bonding)',
    });
  }
  const threePhase = lifts.length > 0 || house.tier === 'luxury' || house.tier === 'ultra';
  if (threePhase) out.push({ group: G, title: 'ขอไฟฟ้า 3 เฟส', status: 'info', detail: 'ลิฟต์ แอร์ VRV ปั๊มสระ และเครื่องชาร์จ EV ใช้ไฟรวมสูง — ควรขอมิเตอร์ 3 เฟส 4 สาย (เช่น 30(100)A 3 เฟส)', rule: 'การไฟฟ้า (กฟน./กฟภ.) · ระบบโซลาร์แบบ On-grid ต้องขออนุญาตขนานไฟ และแจ้ง กกพ.' });
  const big = total >= 2000 || height >= 15;
  out.push({
    group: G, title: big ? 'เข้าข่ายอาคารขนาดใหญ่' : 'ยังไม่เข้าข่ายอาคารขนาดใหญ่', status: big ? 'warn' : 'pass',
    detail: `พื้นที่ใช้สอย ${m2(total)} · สูง ${m(height)}`,
    rule: 'กฎกระทรวงฉบับที่ 33: อาคารขนาดใหญ่ = พื้นที่รวม ≥ 2,000 ตร.ม. หรือ สูง ≥ 15 ม. และพื้นที่ > 1,000 ตร.ม. → ต้องมีบันไดหนีไฟ ระบบดับเพลิง และที่จอดรถตามเกณฑ์ · สูง ≥ 23 ม. เป็นอาคารสูง',
  });
  if (total > 300 || top >= 2) out.push({
    group: G, title: 'ออกแบบต้านแผ่นดินไหว', status: 'info',
    detail: top >= 2 ? 'บ้าน 3 ชั้นขึ้นไป — ตรวจโซนแผ่นดินไหวของที่ตั้ง (เช่น กทม. ปริมณฑล ภาคเหนือ ภาคตะวันตก)' : 'ตรวจโซนแผ่นดินไหวของที่ตั้ง',
    rule: 'กฎกระทรวงการรับน้ำหนัก ความต้านทาน ความคงทนของอาคาร และพื้นดินที่รองรับอาคารในการต้านทานแรงสั่นสะเทือนของแผ่นดินไหว พ.ศ. 2564 · มยผ. 1301/1302',
  });
  if (house.tier === 'luxury' || house.tier === 'ultra') out.push({
    group: G, title: 'เสาเข็มเจาะและพื้น Post-tension', status: 'info',
    detail: 'เสาเข็มเจาะทุกต้นต้องทดสอบ Seismic test · สุ่มทดสอบ Static/Dynamic load test · พื้น PT ต้องมีแบบดึงลวดและบันทึกแรงดึง',
    rule: 'มยผ. 1106 (เสาเข็มเจาะ) · มาตรฐาน วสท. สำหรับคอนกรีตอัดแรง · วิศวกรโยธาระดับสามัญขึ้นไปลงนาม',
  });

  /* ---------- paperwork ---------- */
  const docs: [string, string][] = [
    ['ตรวจผังเมืองรวม (สีที่ดิน) และข้อบัญญัติท้องถิ่น', 'สำนักงานเขต/เทศบาล/อบต. — บางพื้นที่มีระยะร่น ความสูง และ FAR/OSR เข้มกว่านี้'],
    ['ยื่นขออนุญาตก่อสร้างอาคาร (แบบ ข.1)', 'พร้อมโฉนด/น.ส.3 สำเนา, แบบแปลน 5 ชุด, รายการคำนวณโครงสร้าง; ได้ใบอนุญาต (อ.1) ก่อนลงมือ'],
    [total > 150 ? `ผู้ออกแบบต้องเป็นสถาปนิกและวิศวกรผู้ได้รับใบอนุญาต (บ้าน ${m2(total)} > 150 ตร.ม.)` : 'แนะนำให้วิศวกรโยธาลงนามรายการคำนวณโครงสร้าง', 'ตาม พ.ร.บ.สถาปนิก และ พ.ร.บ.วิศวกร (ตรวจสอบเกณฑ์กับหน่วยงานท้องถิ่น)'],
    ['หนังสือยินยอมเพื่อนบ้าน (ถ้าผนังชิดเขตน้อยกว่าเกณฑ์)', 'ใช้กับผนังทึบที่ห่างแนวเขตไม่ถึง 50 ซม.'],
    ['แจ้งเริ่มก่อสร้างและแต่งตั้งผู้ควบคุมงาน', 'แจ้งท้องถิ่นตามแบบที่กำหนด'],
    ['ขอเลขที่บ้าน', 'สำนักทะเบียนท้องถิ่น — ต้องมีใบอนุญาตก่อสร้าง'],
    ['ขอติดตั้งมิเตอร์ไฟฟ้าและประปา', `การไฟฟ้า (มิเตอร์ ${load.meter}) และการประปา — ใช้เลขที่บ้านหรือใบอนุญาต`],
  ];
  for (const [title, detail] of docs) out.push({ group: 'เอกสารและใบอนุญาต', title, status: 'info', detail, rule: 'พ.ร.บ.ควบคุมอาคาร พ.ศ. 2522 และกฎหมายที่เกี่ยวข้อง' });

  return out;
}

/** Minimum distances to draw on the plot (setback lines). */
export function setbackLines(house: House, need = 2) {
  const lot = lotOf(house);
  const W = { ...DEFAULT_SITE, ...house.site }.road;
  const front = W < 6 ? Math.max(0, 3 - W / 2) : W <= 10 ? W / 10 : W <= 20 ? 2 : Math.min(6, W / 10);
  return { x0: lot.x0 + need, x1: lot.x1 - need, z0: lot.z0 + need, z1: lot.z1 - front, lot };
}
