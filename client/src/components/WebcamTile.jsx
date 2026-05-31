import { useEffect, useRef } from 'react';

export default function WebcamTile({ stream, label, waiting = false }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream ?? null;
    if (stream) {
      video.play().catch(() => {});
    }
  }, [stream]);

  return (
    <div className="w-full overflow-hidden rounded-xl border border-zinc-700/80 bg-zinc-900 shadow-lg">
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={label === 'You'}
          className="aspect-video w-full object-cover"
        />
      ) : (
        <div className="flex aspect-video w-full items-center justify-center bg-zinc-800 text-xs text-zinc-500">
          {waiting ? 'Connecting…' : 'Waiting for partner camera'}
        </div>
      )}
      <span className="block bg-black/60 px-2 py-1 text-center text-xs font-medium text-zinc-200">
        {label}
      </span>
    </div>
  );
}
