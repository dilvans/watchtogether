import { useEffect, useRef, useCallback } from 'react';

const DRIFT_THRESHOLD = 0.5;
const SEEK_DEBOUNCE_MS = 200;
const SUPPRESS_EMIT_MS = 400;

function shouldSyncTime(current, target) {
  return Math.abs(current - target) > DRIFT_THRESHOLD;
}

export function useVideoSync(socket, videoRef, enabled) {
  const suppressEmitUntil = useRef(0);
  const seekDebounceRef = useRef(null);
  const lastEmittedSeek = useRef(0);

  const suppressOutgoing = () => {
    suppressEmitUntil.current = Date.now() + SUPPRESS_EMIT_MS;
  };

  const canEmit = () => Date.now() > suppressEmitUntil.current;

  const applyTimeIfNeeded = useCallback((video, time) => {
    if (time == null || Number.isNaN(time)) return;
    if (shouldSyncTime(video.currentTime, time)) {
      video.currentTime = time;
    }
  }, []);

  const emitPlay = useCallback(
    (time) => {
      if (!socket?.connected || !enabled || !canEmit()) return;
      socket.emit('sync-play', { time, at: Date.now() });
    },
    [socket, enabled],
  );

  const emitPause = useCallback(
    (time) => {
      if (!socket?.connected || !enabled || !canEmit()) return;
      socket.emit('sync-pause', { time, at: Date.now() });
    },
    [socket, enabled],
  );

  const emitSeek = useCallback(
    (time) => {
      if (!socket?.connected || !enabled || !canEmit()) return;
      const now = Date.now();
      if (now - lastEmittedSeek.current < SEEK_DEBOUNCE_MS) return;
      lastEmittedSeek.current = now;
      socket.emit('sync-seek', { time, at: now });
    },
    [socket, enabled],
  );

  useEffect(() => {
    if (!socket || !enabled) return;

    const onPlay = async ({ time }) => {
      const video = videoRef.current;
      if (!video) return;

      suppressOutgoing();
      try {
        applyTimeIfNeeded(video, time);
        await video.play();
      } catch {
        /* autoplay policies may block; user can press play */
      }
    };

    const onPause = ({ time }) => {
      const video = videoRef.current;
      if (!video) return;

      suppressOutgoing();
      applyTimeIfNeeded(video, time);
      video.pause();
    };

    const onSeek = ({ time }) => {
      const video = videoRef.current;
      if (!video) return;

      suppressOutgoing();
      applyTimeIfNeeded(video, time);
    };

    socket.on('sync-play', onPlay);
    socket.on('sync-pause', onPause);
    socket.on('sync-seek', onSeek);

    return () => {
      socket.off('sync-play', onPlay);
      socket.off('sync-pause', onPause);
      socket.off('sync-seek', onSeek);
    };
  }, [socket, enabled, videoRef, applyTimeIfNeeded]);

  const bindVideoEvents = useCallback(
    (video) => {
      if (!video) return () => {};

      const handlePlay = () => {
        if (!canEmit()) return;
        emitPlay(video.currentTime);
      };

      const handlePause = () => {
        if (!canEmit()) return;
        emitPause(video.currentTime);
      };

      const handleSeeked = () => {
        if (!canEmit()) return;
        if (seekDebounceRef.current) clearTimeout(seekDebounceRef.current);
        seekDebounceRef.current = setTimeout(() => {
          emitSeek(video.currentTime);
        }, SEEK_DEBOUNCE_MS);
      };

      video.addEventListener('play', handlePlay);
      video.addEventListener('pause', handlePause);
      video.addEventListener('seeked', handleSeeked);

      return () => {
        video.removeEventListener('play', handlePlay);
        video.removeEventListener('pause', handlePause);
        video.removeEventListener('seeked', handleSeeked);
        if (seekDebounceRef.current) clearTimeout(seekDebounceRef.current);
      };
    },
    [emitPlay, emitPause, emitSeek],
  );

  return { bindVideoEvents };
}
