import { useEffect, useRef } from 'react';

export default function WebcamTile({ stream, label, className = '' }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream ?? null;
  }, [stream]);

  return (
    <div
      className={`pointer-events-none absolute z-10 w-28 overflow-hidden rounded-lg border-2 border-zinc-700/80 bg-zinc-900 shadow-lg sm:w-36 ${className}`}
    >
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
          …
        </div>
      )}
      <span className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-0.5 text-center text-[10px] font-medium text-zinc-200">
        {label}
      </span>
    </div>
  );
}
