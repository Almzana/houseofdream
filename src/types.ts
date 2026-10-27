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
  | 'garage'
  // luxury
  | 'pool'
  | 'terrace'
  | 'theater'
  | 'gym'
  | 'spa'
  | 'wine'
  | 'closet'
  | 'library'
  | 'maid'
  | 'lift'
  /** open to the room below (double-height space): no floor, a glass balustrade at its edges */
  | 'void';

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

/** How the house is built: wall blocks, pipes, wiring, piles. */
export interface BuildSpec {
  block: 'red' | 'aac';
  pipe: 'ppr' | 'pvc';
  wire: 'thw' | 'vaf';
  pile: 'i18' | 'spun';
}

export interface House {
  rooms: Room[];
  items: Item[];
  ext?: Exterior;
  build?: BuildSpec;
  site?: Site;
  /** standard / luxury / ultra-luxury: sets structure, services and cost levels */
  tier?: Tier;
  /** floor-to-floor height (m), 3.0 if not set */
  storey?: number;
}

/** The land: clear distance from the drawn plan to each boundary (m), and the street in front. */
export interface Site {
  left: number;
  right: number;
  back: number;
  front: number;
  /** width of the public road along the front boundary */
  road: number;
}
// 2.5 m keeps the wall face (20 cm outside the room edge) beyond the 2 m opening setback
export const DEFAULT_SITE: Site = { left: 2.5, right: 2.5, back: 2.5, front: 2, road: 6 };

export type WallMode = 'auto' | 'full' | 'low';
export type Quality = 'high' | 'fast';
/** outside = whole building · inside = roof off, walls cut · walk = first person · build = construction X-ray */
export type ViewMode = 'outside' | 'inside' | 'walk' | 'build';

/** storey height, floor to floor (m) — set per house with applyStorey (ES modules keep this binding live) */
export let LEVEL_H = 3.0;

export type Tier = 'standard' | 'luxury' | 'ultra';
export const TIER_STOREY: Record<Tier, number> = { standard: 3.0, luxury: 3.6, ultra: 3.9 };

/** Use a house's storey height for everything that follows (geometry, stairs, checks, quantities). */
export function applyStorey(h: { storey?: number }) {
  LEVEL_H = h.storey ?? 3.0;
}

/**
 * Straight stair for the current storey height: risers ≤ 19 cm, treads 25 cm, and a 1 m
 * landing halfway when one flight would climb more than 3 m (Thai rule for dwellings).
 */
export function stairSteps(H = LEVEL_H) {
  const n = Math.ceil(H / 0.19 - 1e-9);
  const landing = H > 3 + 1e-9 ? 1.0 : 0;
  return { n, rise: H / n, go: 0.25, landing, flight: landing ? H / 2 : H, len: n * 0.25 + landing };
}
export const levelOf = (o: { level?: number; l?: number }) => o.level ?? o.l ?? 0;

export const DEFAULT_EXT: Exterior = { roof: 'hip', roofColor: '#5a4a42', pitch: 30, wallPat: 'plain', wallColor: '#ece7df', fence: true };
