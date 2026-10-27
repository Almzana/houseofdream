export type RoomType =
  | 'living'
  | 'bedroom'
  | 'kitchen'
  | 'dining'
  | 'bathroom'
  | 'office'
  | 'laundry'
  | 'hall'
  | 'balcony'
  | 'garden'
  | 'garage';

export interface Room {
  id: string;
  name: string;
  type: RoomType;
  /** centre of the room on the plan (metres) */
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  floor: string;
  floorScale: number;
  floorTint: string;
  wallPat: string;
  wallColor: string;
  /** outdoor areas have no walls or ceiling */
  outdoor?: boolean;
  /** storey: 0 = ground floor, 1 = first floor … */
  level?: number;
}

export interface Item {
  id: string;
  t: string; // catalogue id
  x: number;
  z: number;
  r: number; // rotation around y (radians)
  c: string; // colour variant
  /** light fixtures: brightness (lumens), colour temperature (K), switched off */
  lm?: number;
  k?: number;
  off?: boolean;
  /** storey the item stands on (default 0) */
  l?: number;
}

export type RoofStyle = 'hip' | 'gable' | 'flat' | 'none';

/** The building shell seen from outside. */
export interface Exterior {
  roof: RoofStyle;
  roofColor: string;
  /** roof pitch in degrees */
  pitch: number;
  wallPat: string;
  wallColor: string;
  fence: boolean;
}

export interface House {
  rooms: Room[];
  items: Item[];
  ext?: Exterior;
}

export type WallMode = 'auto' | 'full' | 'low';
export type Quality = 'high' | 'fast';
/** outside = whole building with roof · inside = roof off, walls cut · walk = first person */
export type ViewMode = 'outside' | 'inside' | 'walk';

/** storey height, floor to floor (metres) */
export const LEVEL_H = 3.0;
export const levelOf = (o: { level?: number; l?: number }) => o.level ?? o.l ?? 0;

export const DEFAULT_EXT: Exterior = { roof: 'hip', roofColor: '#5a4a42', pitch: 30, wallPat: 'plain', wallColor: '#ece7df', fence: true };
