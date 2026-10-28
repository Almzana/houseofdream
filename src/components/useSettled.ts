import { useEffect, useState } from 'react';
import type { House } from '../types';
import { useStore } from '../store';

/**
 * The house as it was once edits paused for a moment. Panels that recompute costs or code
 * checks (100 ms and more on a large house) follow this instead of every single change, so
 * dragging and nudging things stays smooth.
 */
export function useSettledHouse(delay = 350): House {
  const house = useStore((s) => s.house);
  const [settled, setSettled] = useState(house);
  useEffect(() => {
    if (house === settled) return;
    const t = window.setTimeout(() => setSettled(house), delay);
    return () => clearTimeout(t);
  }, [house, settled, delay]);
  return settled;
}
