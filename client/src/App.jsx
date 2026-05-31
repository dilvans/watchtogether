import { useState, useEffect, useRef, useCallback } from 'react';
import { createSocket, BACKEND_URL } from './lib/socket.js';
import { useVideoSync } from './hooks/useVideoSync.js';
import { useWebRTC } from './hooks/useWebRTC.js';
import WebcamTile from './components/WebcamTile.jsx';

const STATUS = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  LOBBY: 'lobby',
  WAITING: 'waiting',
  CONNECTED: 'connected',
};

function StatusBadge({ status, roomCode, partnerHere }) {
  const labels = {
    [STATUS.DISCONNECTED]: { text: 'Disconnected from server', color: 'bg-red-500/20 text-red-300' },
    [STATUS.CONNECTING]: { text: 'Connecting to server…', color: 'bg-amber-500/20 text-amber-300' },
    [STATUS.LOBBY]: { text: 'Create or join a room', color: 'bg-zinc-500/20 text-zinc-300' },
    [STATUS.WAITING]: { text: 'Waiting for partner…', color: 'bg-amber-500/20 text-amber-300' },
    [STATUS.CONNECTED]: { text: 'Connected!', color: 'bg-emerald-500/20 text-emerald-300' },
  };

  const { text, color } = labels[status] || labels[STATUS.LOBBY];

  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <span className={`rounded-full px-4 py-1.5 text-sm font-medium ${color}`}>
        {text}
      </span>
      {roomCode && (
        <span className="rounded-full bg-zinc-800 px-4 py-1.5 text-sm text-zinc-300">
          Room: <strong className="text-white tracking-widest">{roomCode}</strong>
        </span>
      )}
      {partnerHere && status === STATUS.CONNECTED && (
        <span className="text-sm text-zinc-500">Partner in room</span>
      )}
    </div>
  );
}

export default function App() {
  const [socket, setSocket] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState(STATUS.CONNECTING);
  const [roomCode, setRoomCode] = useState('');
  const [joinInput, setJoinInput] = useState('');
  const [error, setError] = useState('');
  const [inRoom, setInRoom] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [partnerId, setPartnerId] = useState(null);
  const [partnerHere, setPartnerHere] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [videoUrl, setVideoUrl] = useState(null);
  const [fileName, setFileName] = useState('');

  const videoRef = useRef(null);
  const objectUrlRef = useRef(null);

  const syncEnabled = inRoom && partnerHere && !!videoUrl;
  const { bindVideoEvents } = useVideoSync(socket, videoRef, syncEnabled);
  const webcamActive = inRoom && partnerHere;
  const { localStream, remoteStream, error: webcamError, connectionState } = useWebRTC(socket, {
    active: webcamActive,
    cameraOn,
    micOn,
    partnerId,
  });

  useEffect(() => {
    const s = createSocket();
    setSocket(s);

    const onConnect = () => setConnectionStatus(STATUS.LOBBY);
    const onDisconnect = () => setConnectionStatus(STATUS.DISCONNECTED);

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);

    if (s.connected) onConnect();

    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!socket || !inRoom) return;

    const onPartnerJoined = ({ partnerId: id }) => {
      setPartnerId(id);
      setPartnerHere(true);
      setConnectionStatus(STATUS.CONNECTED);
    };

    const onPartnerLeft = () => {
      setPartnerId(null);
      setPartnerHere(false);
      setConnectionStatus(STATUS.WAITING);
      setCameraOn(false);
      setMicOn(false);
    };

    socket.on('partner-joined', onPartnerJoined);
    socket.on('partner-left', onPartnerLeft);

    return () => {
      socket.off('partner-joined', onPartnerJoined);
      socket.off('partner-left', onPartnerLeft);
    };
  }, [socket, inRoom]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    return bindVideoEvents(video);
  }, [videoUrl, bindVideoEvents]);

  const handleCreateRoom = () => {
    setError('');
    socket?.emit('create-room', (res) => {
      if (!res?.ok) {
        setError('Could not create room');
        return;
      }
      setRoomCode(res.code);
      setInRoom(true);
      setIsHost(true);
      setPartnerId(null);
      setPartnerHere(false);
      setConnectionStatus(STATUS.WAITING);
    });
  };

  const handleJoinRoom = () => {
    setError('');
    const code = joinInput.trim();
    if (!code) {
      setError('Enter a room code');
      return;
    }
    socket?.emit('join-room', code, (res) => {
      if (!res?.ok) {
        setError(res.error || 'Could not join room');
        return;
      }
      setRoomCode(res.code);
      setInRoom(true);
      setIsHost(false);
      setPartnerId(res.partnerId ?? null);
      setPartnerHere(true);
      setConnectionStatus(STATUS.CONNECTED);
    });
  };

  const handleFileChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }

    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setVideoUrl(url);
    setFileName(file.name);
  }, []);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800/80 bg-zinc-900/50 backdrop-blur">
        <div className="mx-auto max-w-4xl px-4 py-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            WatchTogether
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Sync playback with a friend — each of you plays your own local copy
          </p>
          <div className="mt-4">
            <StatusBadge
              status={connectionStatus}
              roomCode={inRoom ? roomCode : null}
              partnerHere={partnerHere}
            />
          </div>
          <p className="mt-2 text-xs text-zinc-600">
            Server: {BACKEND_URL}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        {!inRoom ? (
          <section className="mx-auto max-w-md space-y-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 shadow-xl">
            <div>
              <button
                type="button"
                onClick={handleCreateRoom}
                disabled={connectionStatus === STATUS.DISCONNECTED}
                className="w-full rounded-xl bg-violet-600 px-4 py-3 font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Create Room
              </button>
              <p className="mt-2 text-center text-xs text-zinc-500">
                You&apos;ll get a code to share
              </p>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-zinc-700" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-zinc-900 px-2 text-zinc-500">or</span>
              </div>
            </div>

            <div className="space-y-3">
              <input
                type="text"
                value={joinInput}
                onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
                placeholder="Room code"
                maxLength={6}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-center font-mono text-lg tracking-widest uppercase outline-none ring-violet-500/50 focus:ring-2"
              />
              <button
                type="button"
                onClick={handleJoinRoom}
                disabled={connectionStatus === STATUS.DISCONNECTED}
                className="w-full rounded-xl border border-zinc-600 bg-zinc-800 px-4 py-3 font-medium transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Join Room
              </button>
            </div>

            {error && (
              <p className="text-center text-sm text-red-400" role="alert">
                {error}
              </p>
            )}
          </section>
        ) : (
          <section className="space-y-6">
            {inRoom && !partnerHere && (
              <p className="text-center text-sm text-zinc-400">
                Share room code <strong className="text-white">{roomCode}</strong> with
                your partner. Sync starts when they join.
              </p>
            )}

            <div className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
              <label className="flex w-full max-w-md cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-600 px-6 py-8 transition hover:border-violet-500/50 hover:bg-zinc-800/30">
                <span className="text-sm font-medium text-zinc-300">
                  Choose local video file
                </span>
                <span className="text-xs text-zinc-500">MP4, MKV, WebM, etc.</span>
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleFileChange}
                  className="sr-only"
                />
              </label>
              {fileName && (
                <p className="max-w-full truncate text-sm text-zinc-400">
                  {fileName}
                </p>
              )}
            </div>

            <div className="flex flex-col items-center justify-center gap-4 lg:flex-row lg:items-start">
              <div className="w-full min-w-0 flex-1 lg:max-w-3xl">
                {videoUrl ? (
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    controls
                    className="w-full rounded-xl border border-zinc-800 bg-black shadow-2xl"
                  />
                ) : (
                  <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/80 text-zinc-500">
                    Select a video to begin
                  </div>
                )}
              </div>

              {webcamActive && cameraOn && (
                <div className="flex w-full shrink-0 flex-row gap-3 lg:w-44 lg:flex-col">
                  <WebcamTile stream={localStream} label="You" />
                  <WebcamTile
                    stream={remoteStream}
                    label="Partner"
                    waiting={connectionState === 'connecting' || connectionState === 'new'}
                  />
                </div>
              )}
            </div>

            {partnerHere && (
              <div className="flex flex-col items-center gap-2">
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setCameraOn((on) => !on)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                      cameraOn
                        ? 'bg-violet-600 text-white hover:bg-violet-500'
                        : 'border border-zinc-600 bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
                    }`}
                  >
                    {cameraOn ? 'Camera on' : 'Enable camera'}
                  </button>
                  {cameraOn && (
                    <button
                      type="button"
                      onClick={() => setMicOn((on) => !on)}
                      className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                        micOn
                          ? 'border border-emerald-600/50 bg-emerald-600/20 text-emerald-300'
                          : 'border border-zinc-600 bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                      }`}
                    >
                      {micOn ? 'Mic on' : 'Mic off'}
                    </button>
                  )}
                </div>
                <p className="text-center text-xs text-zinc-500">
                  Both people must click Enable camera to see each other.
                </p>
              </div>
            )}

            {webcamError && (
              <p className="text-center text-sm text-red-400" role="alert">
                {webcamError}
              </p>
            )}

            {videoUrl && !partnerHere && (
              <p className="text-center text-xs text-zinc-500">
                Playback controls will sync once your partner joins
              </p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
