import { useEffect } from 'react';
import { useStore, type Tab } from './store';
import { Viewport } from './components/Viewport';
import { HousePanel } from './components/HousePanel';
import { MaterialsPanel } from './components/MaterialsPanel';
import { CatalogPanel } from './components/CatalogPanel';
import { BudgetPanel, useBoq } from './components/BudgetPanel';
import { baht } from './lib/boq';

const TABS: { id: Tab; name: string; icon: JSX.Element }[] = [
  { id: 'house', name: 'บ้าน', icon: <path d="M3 11 12 4l9 7v9H3z M9 20v-6h6v6" /> },
  { id: 'materials', name: 'พื้น/ผนัง', icon: <path d="M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z" /> },
  { id: 'catalog', name: 'ของแต่ง', icon: <path d="M4 13h16v4H4z M6 13V9a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v4 M6 17v2 M18 17v2" /> },
  { id: 'budget', name: 'สรุปงบ', icon: <path d="M5 3h14v18H5z M8 7h8 M8 11h8 M8 15h5" /> },
];

export function App() {
  const s = useStore();
  const boq = useBoq();
  const floors = new Set(s.house.rooms.map((r) => r.level ?? 0)).size;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
      const st = useStore.getState();
      if (st.viewMode === 'walk') return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) st.redo(); else st.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); st.redo(); return; }
      const it = st.house.items.find((i) => i.id === st.selItem);
      if (e.key === 'Escape') { st.selectItem(null); st.set({ planMode: false }); return; }
      if (!it) return;
      if (e.key === 'r' || e.key === 'R') st.updateItem(it.id, { r: Math.round((it.r + Math.PI / 4) / (Math.PI / 4)) * (Math.PI / 4) });
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); st.removeItem(it.id); }
      else if (e.key === 'd' || e.key === 'D') st.duplicateItem(it.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <header className="bar">
        <div className="brand">
          <h1>บ้านในฝัน 3D</h1>
          <span className="stats">{boq.totals.area.toFixed(1)} ตร.ม. · {s.house.rooms.filter((r) => !r.outdoor).length} ห้อง{floors > 1 ? ` · ${floors} ชั้น` : ''} · งบ ≈ {baht(boq.totals.all)}</span>
        </div>
        <span className="spacer" />
        <div className="hgroup">
          <button className="hbtn" onClick={s.undo} disabled={!s.past.length} title="ย้อนกลับ (Ctrl+Z)">↶ ย้อน</button>
          <button className="hbtn" onClick={s.redo} disabled={!s.future.length} title="ทำซ้ำ (Ctrl+Y)">↷ ทำซ้ำ</button>
        </div>
        <button className="hbtn" aria-pressed={s.quality === 'fast'} onClick={() => s.set({ quality: s.quality === 'high' ? 'fast' : 'high' })} title="ปิดเงาเพื่อให้ลื่นขึ้นบนเครื่องช้า">
          {s.quality === 'high' ? 'คุณภาพสูง' : 'โหมดเร็ว'}
        </button>
      </header>

      <main className="work">
        <Viewport />
        <aside className="panel">
          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={s.tab === t.id} onClick={() => s.set({ tab: t.id })}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden>{t.icon}</svg>
                {t.name}
              </button>
            ))}
          </nav>
          {s.tab === 'house' && <HousePanel />}
          {s.tab === 'materials' && <MaterialsPanel />}
          {s.tab === 'catalog' && <CatalogPanel />}
          {s.tab === 'budget' && <BudgetPanel />}
        </aside>
      </main>
    </div>
  );
}
