import { useState, useEffect, useRef, useCallback } from 'react';

const IDLE_MS = 3000;
const CINEMA_KEY = 'watchtogether-cinema-mode';
const EXPANDED_KEY = 'watchtogether-expanded-video';

function readStored(key) {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* ignore storage errors */
  }
}

export function useCinemaMode(enabled) {
  const [cinemaMode, setCinemaMode] = useState(() => readStored(CINEMA_KEY));
  const [expandedVideo, setExpandedVideo] = useState(() => readStored(EXPANDED_KEY));
  const [uiVisible, setUiVisible] = useState(true);
  const idleTimerRef = useRef(null);

  const persistCinemaMode = useCallback((value) => {
    setCinemaMode(value);
    writeStored(CINEMA_KEY, value);
  }, []);

  const persistExpandedVideo = useCallback((value) => {
    setExpandedVideo(value);
    writeStored(EXPANDED_KEY, value);
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
  const isExpanded = enabled && expandedVideo;

  return {
    cinemaMode,
    setCinemaMode: persistCinemaMode,
    expandedVideo,
    setExpandedVideo: persistExpandedVideo,
    isDimmed,
    isExpanded,
    revealUi,
  };
}
