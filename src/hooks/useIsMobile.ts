import { useEffect, useState } from 'react';

// Matches a phone/tablet-sized OR touch-primary device. Either condition is
// enough: a narrow desktop window (≤768px) gets the immersive layout too, and a
// touch laptop with a wide screen does as well. Kept deliberately broad so the
// Zoom-style mobile UI is the one users on real phones always see.
const MOBILE_QUERY = '(max-width: 768px), (pointer: coarse)';

const getInitial = (): boolean => {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(MOBILE_QUERY).matches;
};

/**
 * Returns true when the app should render the immersive mobile meeting layout.
 * Re-evaluates on viewport resize / orientation change so toggling the device
 * toolbar (or rotating a phone) flips the layout live.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(getInitial);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(MOBILE_QUERY);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    // Sync once in case the value changed between initial render and effect.
    setIsMobile(mql.matches);
    // addEventListener is the modern API; older Safari needs addListener.
    if (mql.addEventListener) {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
    mql.addListener(handler);
    return () => mql.removeListener(handler);
  }, []);

  return isMobile;
}

// Width only — below Tailwind's `md` (768px). Used to pick the phone layout of
// a screen, where a touch laptop with a wide window should keep the desktop one.
const NARROW_QUERY = '(max-width: 767px)';

export function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState<boolean>(() =>
    typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(NARROW_QUERY).matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(NARROW_QUERY);
    const handler = (e: MediaQueryListEvent) => setNarrow(e.matches);
    setNarrow(mql.matches);
    if (mql.addEventListener) {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
    mql.addListener(handler);
    return () => mql.removeListener(handler);
  }, []);

  return narrow;
}
