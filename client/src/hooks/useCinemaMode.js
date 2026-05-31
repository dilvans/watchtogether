import { useState, useEffect, useRef, useCallback } from 'react';

const IDLE_MS = 3000;
const STORAGE_KEY = 'watchtogether-cinema-mode';

function readStoredPreference() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function useCinemaMode(enabled) {
  const [cinemaMode, setCinemaMode] = useState(readStoredPreference);
  const [uiVisible, setUiVisible] = useState(true);
  const idleTimerRef = useRef(null);

  const persistCinemaMode = useCallback((value) => {
    setCinemaMode(value);
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      /* ignore storage errors */
    }
  }, []);

  const revealUi = useCallback(() => {
    setUiVisible(true);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (!enabled || !cinemaMode) return;

    idleTimerRef.current = setTimeout(() => {
      setUiVisible(false);
    }, IDLE_MS);
  }, [enabled, cinemaMode]);

  useEffect(() => {
    if (!enabled || !cinemaMode) {
      setUiVisible(true);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      return undefined;
    }

    revealUi();

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'];
    events.forEach((event) => window.addEventListener(event, revealUi, { passive: true }));

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      events.forEach((event) => window.removeEventListener(event, revealUi));
    };
  }, [enabled, cinemaMode, revealUi]);

  const isDimmed = enabled && cinemaMode && !uiVisible;

  return { cinemaMode, setCinemaMode: persistCinemaMode, isDimmed, revealUi };
}
