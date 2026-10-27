import { DEFAULT_EXT, type House, type Item, type Room, type RoomType } from '../types';
import { generateHouse } from './generate';

export const ROOM_TYPES: Record<RoomType, { name: string; floor: string; wallPat: string; wallColor: string; h: number; outdoor?: boolean }> = {
  living: { name: 'ห้องนั่งเล่น', floor: 'oak', wallPat: 'plain', wallColor: '#f4f2ee', h: 2.7 },
  bedroom: { name: 'ห้องนอน', floor: 'oak', wallPat: 'plain', wallColor: '#e6e0d2', h: 2.7 },
  kitchen: { name: 'ห้องครัว', floor: 'granito', wallPat: 'subway', wallColor: '#f4f2ee', h: 2.7 },
  dining: { name: 'ห้องกินข้าว', floor: 'oak', wallPat: 'plain', wallColor: '#e8d9c4', h: 2.7 },
  bathroom: { name: 'ห้องน้ำ', floor: 'antislip', wallPat: 'tile3060', wallColor: '#f4f2ee', h: 2.6 },
  office: { name: 'ห้องทำงาน', floor: 'oak', wallPat: 'plain', wallColor: '#d6e0d9', h: 2.7 },
  laundry: { name: 'ห้องซักล้าง', floor: 'antislip', wallPat: 'plain', wallColor: '#f4f2ee', h: 2.6 },
  hall: { name: 'โถง / ทางเดิน', floor: 'granito', wallPat: 'plain', wallColor: '#f4f2ee', h: 2.7 },
  balcony: { name: 'ระเบียง', floor: 'deck', wallPat: 'plain', wallColor: '#f4f2ee', h: 2.7, outdoor: true },
  garden: { name: 'สวน', floor: 'grass', wallPat: 'plain', wallColor: '#f4f2ee', h: 2.7, outdoor: true },
  garage: { name: 'โรงจอดรถ', floor: 'paver', wallPat: 'plain', wallColor: '#f4f2ee', h: 2.7, outdoor: true },
  pool: { name: 'สระว่ายน้ำ', floor: 'paver', wallPat: 'plain', wallColor: '#f4f2ee', h: 2.7, outdoor: true },
  terrace: { name: 'ลานพักผ่อน / Pool deck', floor: 'deck', wallPat: 'plain', wallColor: '#f4f2ee', h: 2.7, outdoor: true },
  theater: { name: 'ห้องโฮมเธียเตอร์', floor: 'walnut', wallPat: 'slats', wallColor: '#3b3531', h: 2.7 },
  gym: { name: 'ห้องออกกำลังกาย', floor: 'concrete', wallPat: 'plain', wallColor: '#d8d2c8', h: 2.7 },
  spa: { name: 'สปา / ซาวน่า', floor: 'marble', wallPat: 'stone', wallColor: '#e8dcc8', h: 2.7 },
  wine: { name: 'ห้องเก็บไวน์', floor: 'terrazzo', wallPat: 'brick', wallColor: '#b9a089', h: 2.7 },
  closet: { name: 'ห้องแต่งตัว (Walk-in)', floor: 'oak', wallPat: 'plain', wallColor: '#ece6dc', h: 2.7 },
  library: { name: 'ห้องสมุด', floor: 'walnut', wallPat: 'slats', wallColor: '#c9b49a', h: 2.7 },
  maid: { name: 'ห้องแม่บ้าน', floor: 'granito', wallPat: 'plain', wallColor: '#f4f2ee', h: 2.6 },
  lift: { name: 'ลิฟต์', floor: 'marble', wallPat: 'plain', wallColor: '#d8d2c8', h: 2.7 },
  void: { name: 'ช่องเปิดโล่ง (Double height)', floor: 'oak', wallPat: 'plain', wallColor: '#f4f2ee', h: 2.7, outdoor: true },
};

let seq = 0;
export const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Build a room from its plan rectangle [x0,x1] × [z0,z1]. */
export function makeRoom(type: RoomType, x0: number, z0: number, x1: number, z1: number, name?: string): Room {
  const t = ROOM_TYPES[type];
  return {
    id: uid('r'), name: name ?? t.name, type,
    x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, h: t.h,
    floor: t.floor, floorScale: 1, floorTint: '#c4c1ba', wallPat: t.wallPat, wallColor: t.wallColor,
    outdoor: t.outdoor,
  };
}

const P = Math.PI;
type ItemSpec = [string, number, number, number?, string?];
const items = (list: ItemSpec[]): Item[] =>
  list.map(([t, x, z, r = 0, c]) => ({ id: uid('i'), t, x, z, r, c: c ?? '' }));

export interface Template {
  id: string;
  name: string;
  desc: string;
  make: () => House;
}

export const TEMPLATES: Template[] = [
  {
    id: 'luxury', name: 'Luxury Villa 2 ชั้น', desc: '5 ห้องนอน en-suite · โถงสูง 2 ชั้น · ลิฟต์ · สระว่ายน้ำ',
    make: () => generateHouse({ floors: 2, bedrooms: 5, bathrooms: 5, garage: true, garden: true, roof: 'hip', tier: 'luxury' }),
  },
  {
    id: 'ultra', name: 'Ultra Luxury Mansion 3 ชั้น', desc: 'Master suite ทั้งชั้น · เธียเตอร์ สปา ฟิตเนส · ห้องไวน์',
    make: () => generateHouse({ floors: 2, bedrooms: 6, bathrooms: 6, garage: true, garden: true, roof: 'flat', tier: 'ultra' }),
  },
  {
    id: 'house2', name: 'บ้าน 2 ชั้น 4 ห้องนอน', desc: '3 ห้องน้ำ · หลังคาปั้นหยา · โรงจอดรถ',
    make: () => generateHouse({ floors: 2, bedrooms: 4, bathrooms: 3, garage: true, garden: true, roof: 'hip' }),
  },
  {
    id: 'modern', name: 'บ้านโมเดิร์น 2 ชั้น', desc: '3 ห้องนอน · หลังคาแบน',
    make: () => ({ ...generateHouse({ floors: 2, bedrooms: 3, bathrooms: 3, garage: true, garden: true, roof: 'flat' }), ext: { ...DEFAULT_EXT, roof: 'flat', wallColor: '#f6f4ef', wallPat: 'plain', roofColor: '#2b2b2b' } }),
  },
  {
    id: 'house', name: 'บ้านชั้นเดียว 3 ห้องนอน', desc: 'จัดวางเอง · โรงจอดรถ · สวน',
    make: () => ({
      rooms: [
        makeRoom('bedroom', 0, -8, 3.5, -4, 'ห้องนอน 2'),
        makeRoom('bedroom', 3.5, -8, 7, -4, 'ห้องนอน 3'),
        makeRoom('bathroom', 7, -8, 9, -4, 'ห้องน้ำรวม'),
        makeRoom('bedroom', 9, -8, 13.5, -4, 'ห้องนอนใหญ่'),
        makeRoom('hall', 0, -4, 11.5, -2),
        makeRoom('laundry', 11.5, -4, 13.5, -2),
        makeRoom('living', 0, -2, 6, 3),
        makeRoom('dining', 6, -2, 9.5, 3),
        makeRoom('kitchen', 9.5, -2, 13.5, 3),
        makeRoom('garage', 0, 3, 6, 8.5),
        makeRoom('garden', 6, 3, 13.5, 8.5),
      ],
      items: items([
        // living
        ['tv', 2.6, -1.78], ['sectional', 2.6, 1.75, P], ['coffee', 2.6, 0.45], ['rug', 2.6, 0.55], ['floorlamp', 5.5, 2.5], ['fiddle', 0.45, 2.5], ['art', 0, 0.9, P / 2],
        ['door', 1.2, -2], ['door', 4.5, 3], ['window', 0, -0.9, P / 2],
        // dining
        ['dining', 7.75, 0.5, P / 2], ['chair', 7.25, -0.1, P / 2], ['chair', 7.25, 0.5, P / 2], ['chair', 7.25, 1.1, P / 2],
        ['chair', 8.25, -0.1, -P / 2], ['chair', 8.25, 0.5, -P / 2], ['chair', 8.25, 1.1, -P / 2], ['pendant', 7.75, 0.5], ['slidingdoor', 7.75, 3, P],
        // kitchen
        ['fridge', 9.86, -1.64], ['ksink', 10.8, -1.7], ['kstove', 11.85, -1.7], ['kbase', 12.9, -1.7],
        ['hood', 11.85, -2], ['kupper', 10.8, -2], ['kupper', 12.9, -2], ['island', 11.5, 0.8], ['barstool', 11.05, 1.55], ['barstool', 11.95, 1.55],
        ['window', 13.5, 0.6, -P / 2], ['door', 12.5, -2],
        // hall
        ['plant', 10.8, -3.6], ['art', 5.5, -2, P],
        ['door', 2.8, -4], ['door', 4.2, -4], ['door', 8, -4], ['door', 10.4, -4], ['door', 11.5, -3, P / 2],
        // bedroom 2
        ['singlebed', 1.0, -6.95], ['wardrobe', 2.8, -7.68], ['desk', 1.0, -4.32, P], ['officechair', 1.0, -4.9, P], ['window', 0, -6, P / 2],
        // bedroom 3
        ['bed', 5.25, -6.95], ['nightstand', 4.1, -7.75], ['nightstand', 6.4, -7.75], ['window', 7, -6.2, -P / 2],
        // shared bath
        ['toilet', 7.45, -7.62], ['shower', 8.53, -7.53], ['vanity', 8.76, -5.6, -P / 2], ['mirror', 9, -5.6, -P / 2], ['towel', 7, -5.4, P / 2],
        // master
        ['bed6', 11.25, -6.95], ['nightstand', 9.95, -7.75], ['nightstand', 12.55, -7.75], ['wardrobe2', 13.2, -5.2, -P / 2], ['window', 13.5, -7.2, -P / 2], ['rug', 11.25, -5.6],
        // laundry
        ['washer', 12.0, -3.68], ['basket', 12.9, -3.6],
        // garage + garden
        ['car', 3, 5.75], ['tree', 11.8, 6.4], ['outdoorset', 8.6, 5.8], ['shrub', 9.8, 8.2], ['lounger', 12.6, 4.4, P / 2],
      ]),
    }),
  },
  {
    id: 'condo', name: 'คอนโด 1 ห้องนอน', desc: '≈ 35 ตร.ม. · ระเบียง',
    make: () => ({
      rooms: [
        makeRoom('living', 0, 0, 5, 4.5, 'นั่งเล่น + ทานข้าว'),
        makeRoom('kitchen', 0, -2.4, 2.4, 0, 'ครัว'),
        makeRoom('hall', 2.4, -2.4, 5, 0, 'ทางเข้า'),
        makeRoom('bathroom', 5, -2.4, 7.2, 0),
        makeRoom('bedroom', 5, 0, 8.5, 4.5),
        makeRoom('balcony', 0, 4.5, 8.5, 6),
      ],
      items: items([
        ['tv', 2.5, 0.22], ['sofa', 2.5, 2.7, P], ['coffee', 2.5, 1.55], ['rug', 2.5, 1.7], ['fiddle', 0.4, 4.05], ['art', 0, 2, P / 2],
        ['roundtable', 4.25, 3.75], ['chair', 4.25, 3.05], ['slidingdoor', 2.5, 4.5, P],
        ['fridge', 0.4, -2.04], ['ksink', 1.35, -2.1], ['kupper', 1.35, -2.4], ['door', 1.8, 0],
        ['door', 3.7, -2.4], ['door', 3.7, 0], ['sideboard', 4.2, -2.17, 0, '#e9e2d6'],
        ['toilet', 5.5, -2.05], ['shower', 6.74, -1.94], ['vanity', 6.96, -0.6, -P / 2], ['mirror', 7.2, -0.6, -P / 2], ['door', 5, -0.9, P / 2],
        ['bed', 6.75, 1.05], ['nightstand', 5.5, 0.25], ['nightstand', 8.0, 0.25], ['wardrobe', 8.2, 3.3, -P / 2], ['door', 5, 3.8, P / 2], ['slidingdoor', 6.75, 4.5, P],
        ['plant', 0.4, 5.25], ['lounger', 7.4, 5.25, P / 2],
      ]),
    }),
  },
  {
    id: 'bath', name: 'ห้องน้ำ', desc: '2.2 × 2.8 ม.',
    make: () => ({
      rooms: [makeRoom('bathroom', -1.1, -1.4, 1.1, 1.4)],
      items: items([
        ['shower', 0.65, -0.95], ['toilet', -0.55, -1.05], ['vanity', -0.86, 0.35, P / 2], ['mirror', -1.1, 0.35, P / 2],
        ['towel', 1.1, 0.45, -P / 2], ['bathmat', 0.6, -0.15], ['plant', 0.85, 1.15], ['heater', 1.1, -0.95, -P / 2], ['door', 0, 1.4, P],
      ]),
    }),
  },
  {
    id: 'kitchen', name: 'ห้องครัว', desc: '3.5 × 4 ม. · เกาะกลาง',
    make: () => ({
      rooms: [makeRoom('kitchen', -1.75, -2, 1.75, 2)],
      items: items([
        ['fridge', -1.39, -1.64], ['ksink', -0.45, -1.7], ['kstove', 0.6, -1.7], ['kbase', 1.15, -1.7 + 0.0], ['hood', 0.6, -2], ['kupper', -0.45, -2],
        ['island', 0, 0.4], ['barstool', -0.45, 1.15], ['barstool', 0.45, 1.15], ['pendant', -0.4, 0.4], ['pendant', 0.4, 0.4], ['window', 1.75, 0.2, -P / 2], ['door', -1.0, 2, P],
      ]).filter((i) => i.t !== 'kbase'),
    }),
  },
  {
    id: 'empty', name: 'เริ่มจากห้องเปล่า', desc: '1 ห้อง 4 × 5 ม.',
    make: () => ({ rooms: [makeRoom('living', -2, -2.5, 2, 2.5)], items: [] }),
  },
];
