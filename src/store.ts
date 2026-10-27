import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_EXT, DEFAULT_SITE, type Site, type BuildSpec, type Exterior, type House, type Item, type Quality, type Room, type RoomType, type ViewMode, type WallMode } from './types';
import { ROOM_TYPES, TEMPLATES, makeRoom, uid } from './data/templates';
import { catalogById } from './data/catalog';
import { DEFAULT_SPEC } from './lib/construction';
import { entranceSide, furnish, generateHouse, type GenOptions } from './data/generate';

export type Tab = 'house' | 'materials' | 'catalog' | 'budget' | 'code';
const HISTORY = 60;

interface State {
  house: House;
  past: House[];
  future: House[];
  selItem: string | null;
  selRoom: string | null;
  tab: Tab;
  wallMode: WallMode;
  quality: Quality;
  planMode: boolean;
  seenTips: boolean;
  viewMode: ViewMode;
  /** storey being viewed / edited */
  level: number;
  /** hour of the day for the sun (6–20) */
  hour: number;

  commit: (fn: (h: House) => House) => void;
  undo: () => void;
  redo: () => void;
  loadTemplate: (id: string) => void;
  generate: (o: GenOptions) => void;
  setExt: (p: Partial<Exterior>) => void;
  setBuild: (p: Partial<BuildSpec>) => void;
  setSite: (p: Partial<Site>) => void;
  addRoom: (type: RoomType) => void;
  updateRoom: (id: string, patch: Partial<Room>) => void;
  removeRoom: (id: string) => void;
  moveRoom: (id: string, x: number, z: number) => void;
  furnishRoom: (id: string) => void;
  addItem: (t: string, near?: { x: number; z: number }, color?: string) => string;
  updateItem: (id: string, patch: Partial<Item>) => void;
  removeItem: (id: string) => void;
  duplicateItem: (id: string) => void;
  selectItem: (id: string | null) => void;
  selectRoom: (id: string | null) => void;
  set: (p: Partial<Pick<State, 'tab' | 'wallMode' | 'quality' | 'planMode' | 'seenTips' | 'viewMode' | 'level' | 'hour'>>) => void;
}

const lv = (o: { level?: number; l?: number }) => o.level ?? o.l ?? 0;
const inside = (r: Room, i: Item) => lv(i) === lv(r) && Math.abs(i.x - r.x) <= r.w / 2 && Math.abs(i.z - r.z) <= r.d / 2;

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      house: TEMPLATES[0].make(),
      past: [],
      future: [],
      selItem: null,
      selRoom: null,
      tab: 'house',
      wallMode: 'auto',
      quality: 'high',
      planMode: false,
      seenTips: false,
      viewMode: 'outside',
      level: 0,
      hour: 15,

      commit: (fn) =>
        set((s) => ({ house: fn(s.house), past: [...s.past.slice(-HISTORY + 1), s.house], future: [] })),
      undo: () =>
        set((s) => {
          const prev = s.past[s.past.length - 1];
          if (!prev) return s;
          return { house: prev, past: s.past.slice(0, -1), future: [s.house, ...s.future], selItem: null };
        }),
      redo: () =>
        set((s) => {
          const next = s.future[0];
          if (!next) return s;
          return { house: next, past: [...s.past, s.house], future: s.future.slice(1), selItem: null };
        }),

      loadTemplate: (id) => {
        const t = TEMPLATES.find((x) => x.id === id);
        if (!t) return;
        get().commit(() => t.make());
        set({ selItem: null, selRoom: null, level: 0 });
      },
      generate: (o) => {
        get().commit(() => generateHouse(o));
        set({ selItem: null, selRoom: null, level: 0, viewMode: 'outside', planMode: false });
      },
      setExt: (p) => get().commit((h) => ({ ...h, ext: { ...DEFAULT_EXT, ...h.ext, ...p } })),
      setBuild: (p) => get().commit((h) => ({ ...h, build: { ...DEFAULT_SPEC, ...h.build, ...p } })),
      setSite: (p) => get().commit((h) => ({ ...h, site: { ...DEFAULT_SITE, ...h.site, ...p } })),

      addRoom: (type) => {
        const { house: h, level } = get();
        // place to the right of this storey's plan (or over the ground floor when starting a new storey)
        const same = h.rooms.filter((r) => lv(r) === level);
        const ref = same.length ? same : h.rooms;
        const maxX = ref.length ? Math.max(...ref.map((r) => r.x + r.w / 2)) : -2;
        const minX = ref.length ? Math.min(...ref.map((r) => r.x - r.w / 2)) : -2;
        const minZ = ref.length ? Math.min(...ref.map((r) => r.z - r.d / 2)) : -2;
        const size: Record<RoomType, [number, number]> = {
          living: [4.5, 4], bedroom: [3.5, 3.5], kitchen: [3, 3.5], dining: [3.5, 3.5], bathroom: [2, 2.5], office: [3, 3],
          laundry: [2, 2], hall: [2, 4], balcony: [4, 1.5], garden: [5, 5], garage: [3.5, 5.5],
        };
        const [w, d] = size[type];
        const x0 = same.length ? maxX : minX;
        const r = makeRoom(type, x0, minZ, x0 + w, minZ + d);
        if (level) r.level = level;
        get().commit((hh) => ({ ...hh, rooms: [...hh.rooms, r] }));
        set({ selRoom: r.id, selItem: null });
      },
      updateRoom: (id, patch) =>
        get().commit((h) => ({ ...h, rooms: h.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
      removeRoom: (id) => {
        const room = get().house.rooms.find((r) => r.id === id);
        if (!room) return;
        get().commit((h) => ({ ...h, rooms: h.rooms.filter((r) => r.id !== id), items: h.items.filter((i) => !inside(room, i)) }));
        set({ selRoom: null, selItem: null });
      },
      moveRoom: (id, x, z) => {
        const room = get().house.rooms.find((r) => r.id === id);
        if (!room) return;
        const dx = x - room.x, dz = z - room.z;
        get().commit((h) => ({
          ...h,
          rooms: h.rooms.map((r) => (r.id === id ? { ...r, x, z } : r)),
          items: h.items.map((i) => (inside(room, i) ? { ...i, x: i.x + dx, z: i.z + dz } : i)),
        }));
      },
      furnishRoom: (id) => {
        const h = get().house;
        const room = h.rooms.find((r) => r.id === id);
        if (!room) return;
        // keep doors, windows and stairs; replace the furniture
        const keep = (i: Item) => !inside(room, i) || !!catalogById.get(i.t)?.opening || !!catalogById.get(i.t)?.stair;
        const fresh = furnish(room, entranceSide(room, h.items)).filter((i) => !catalogById.get(i.t)?.opening);
        get().commit((hh) => ({ ...hh, items: [...hh.items.filter(keep), ...fresh] }));
        set({ selItem: null });
      },

      addItem: (t, near, color) => {
        const def = catalogById.get(t);
        const s = get();
        const room = s.house.rooms.find((r) => r.id === s.selRoom) ?? s.house.rooms.find((r) => lv(r) === s.level) ?? s.house.rooms[0];
        const base = near ?? (room ? { x: room.x, z: room.z } : { x: 0, z: 0 });
        const it: Item = { id: uid('i'), t, x: base.x + (Math.random() - 0.5) * 0.3, z: base.z + (Math.random() - 0.5) * 0.3, r: 0, c: color ?? def?.colors[0] ?? '' };
        const L = room ? lv(room) : s.level;
        if (L) it.l = L;
        if (def?.mount === 'wall' && room) {
          it.x = room.x;
          it.z = room.z - room.d / 2;
        }
        s.commit((h) => ({ ...h, items: [...h.items, it] }));
        set({ selItem: it.id });
        return it.id;
      },
      updateItem: (id, patch) =>
        get().commit((h) => ({ ...h, items: h.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),
      removeItem: (id) => {
        get().commit((h) => ({ ...h, items: h.items.filter((i) => i.id !== id) }));
        if (get().selItem === id) set({ selItem: null });
      },
      duplicateItem: (id) => {
        const src = get().house.items.find((i) => i.id === id);
        if (!src) return;
        const it = { ...src, id: uid('i'), x: src.x + 0.3, z: src.z + 0.3 };
        get().commit((h) => ({ ...h, items: [...h.items, it] }));
        set({ selItem: it.id });
      },
      selectItem: (id) => set({ selItem: id }),
      selectRoom: (id) => {
        const r = id ? get().house.rooms.find((o) => o.id === id) : null;
        set(r ? { selRoom: id, level: lv(r) } : { selRoom: id });
      },
      set: (p) => set(p),
    }),
    {
      name: 'baan3d.v1',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ house: s.house, wallMode: s.wallMode, quality: s.quality, seenTips: s.seenTips, tab: s.tab, hour: s.hour, viewMode: s.viewMode === 'walk' ? 'inside' : s.viewMode }),
      merge: (persisted, current) => {
        const p = persisted as Partial<State> | undefined;
        const ok = p?.house && Array.isArray(p.house.rooms) && Array.isArray(p.house.items);
        return { ...current, ...(p ?? {}), house: ok ? p!.house! : current.house };
      },
    },
  ),
);

export { ROOM_TYPES };
