import { useEffect, useRef, useState, useCallback } from 'react';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
};

function serializeDescription(desc) {
  if (!desc) return null;
  return { type: desc.type, sdp: desc.sdp };
}

async function flushPendingCandidates(pc, queue) {
  while (queue.length > 0) {
    const candidate = queue.shift();
    try {
      await pc.addIceCandidate(candidate);
    } catch {
      /* ignore stale candidates */
    }
  }
}

export function useWebRTC(socket, { active, cameraOn, micOn, isHost }) {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [error, setError] = useState(null);
  const [connectionState, setConnectionState] = useState('idle');

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const pendingOfferRef = useRef(null);
  const negotiatingRef = useRef(false);
  const isHostRef = useRef(isHost);

  isHostRef.current = isHost;

  const cleanupPeerConnection = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    remoteStreamRef.current = null;
    pendingCandidatesRef.current = [];
    pendingOfferRef.current = null;
    negotiatingRef.current = false;
    setRemoteStream(null);
    setConnectionState('idle');
  }, []);

  const stopLocalMedia = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setLocalStream(null);
  }, []);

  const ensureRemoteStream = useCallback(() => {
    if (!remoteStreamRef.current) {
      remoteStreamRef.current = new MediaStream();
      setRemoteStream(remoteStreamRef.current);
    }
    return remoteStreamRef.current;
  }, []);

  const createPeerConnection = useCallback(() => {
    if (pcRef.current) return pcRef.current;

    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.onicecandidate = (event) => {
      if (event.candidate && socket?.connected) {
        socket.emit('webrtc-ice-candidate', { candidate: event.candidate.toJSON() });
      }
    };

    pc.ontrack = (event) => {
      const stream = ensureRemoteStream();
      if (event.track && !stream.getTracks().some((t) => t.id === event.track.id)) {
        stream.addTrack(event.track);
        setRemoteStream(new MediaStream(stream.getTracks()));
      }
    };

    pc.onconnectionstatechange = () => {
      setConnectionState(pc.connectionState);
      if (pc.connectionState === 'failed') {
        cleanupPeerConnection();
      }
    };

    pcRef.current = pc;
    return pc;
  }, [socket, cleanupPeerConnection, ensureRemoteStream]);

  const attachLocalTracks = useCallback(
    (stream) => {
      const pc = createPeerConnection();
      stream.getTracks().forEach((track) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === track.kind);
        if (sender) {
          sender.replaceTrack(track);
        } else {
          pc.addTrack(track, stream);
        }
      });
    },
    [createPeerConnection],
  );

  const sendOffer = useCallback(async () => {
    if (!socket?.connected || !isHostRef.current || !localStreamRef.current) return;
    if (negotiatingRef.current) return;

    negotiatingRef.current = true;
    setConnectionState('connecting');

    try {
      cleanupPeerConnection();
      attachLocalTracks(localStreamRef.current);

      const pc = pcRef.current;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('webrtc-offer', { sdp: serializeDescription(pc.localDescription) });
    } catch {
      cleanupPeerConnection();
    } finally {
      negotiatingRef.current = false;
    }
  }, [socket, cleanupPeerConnection, attachLocalTracks]);

  const answerOffer = useCallback(
    async (sdp) => {
      if (isHostRef.current || !localStreamRef.current) {
        pendingOfferRef.current = sdp;
        return;
      }
      if (negotiatingRef.current) return;

      negotiatingRef.current = true;
      setConnectionState('connecting');

      try {
        cleanupPeerConnection();
        attachLocalTracks(localStreamRef.current);

        const pc = pcRef.current;
        await pc.setRemoteDescription(sdp);
        await flushPendingCandidates(pc, pendingCandidatesRef.current);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc-answer', { sdp: serializeDescription(pc.localDescription) });
      } catch {
        cleanupPeerConnection();
      } finally {
        negotiatingRef.current = false;
      }
    },
    [socket, cleanupPeerConnection, attachLocalTracks],
  );

  const signalReady = useCallback(() => {
    if (socket?.connected && localStreamRef.current) {
      socket.emit('webrtc-ready');
    }
  }, [socket]);

  useEffect(() => {
    if (!cameraOn) {
      stopLocalMedia();
      cleanupPeerConnection();
      setError(null);
      return undefined;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera is not supported in this browser.');
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.getAudioTracks().forEach((track) => {
          track.enabled = micOn;
        });
        localStreamRef.current = stream;
        setLocalStream(stream);
        setError(null);
      } catch (err) {
        setError(
          err?.name === 'NotAllowedError'
            ? 'Camera access denied. Check browser permissions.'
            : 'Could not access camera.',
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cameraOn, stopLocalMedia, cleanupPeerConnection]);

  useEffect(() => {
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = micOn;
    });
  }, [micOn]);

  useEffect(() => {
    if (!active || !cameraOn || !localStream) return undefined;

    signalReady();
    if (isHost) {
      sendOffer();
    }

    return undefined;
  }, [active, cameraOn, localStream, isHost, signalReady, sendOffer]);

  useEffect(() => {
    if (!localStream || isHost || !pendingOfferRef.current) return undefined;

    const sdp = pendingOfferRef.current;
    pendingOfferRef.current = null;
    answerOffer(sdp);

    return undefined;
  }, [localStream, isHost, answerOffer]);

  useEffect(() => {
    if (!socket || !active) return undefined;

    const handleReady = () => {
      if (isHostRef.current && localStreamRef.current) {
        sendOffer();
      }
    };

    const handleOffer = ({ sdp }) => {
      if (isHostRef.current) return;
      answerOffer(sdp);
    };

    const handleAnswer = async ({ sdp }) => {
      if (!isHostRef.current) return;
      const pc = pcRef.current;
      if (!pc) return;

      try {
        await pc.setRemoteDescription(sdp);
        await flushPendingCandidates(pc, pendingCandidatesRef.current);
      } catch {
        cleanupPeerConnection();
      }
    };

    const handleIceCandidate = async ({ candidate }) => {
      if (!candidate) return;
      const pc = pcRef.current;
      if (!pc?.remoteDescription) {
        pendingCandidatesRef.current.push(candidate);
        return;
      }
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        /* ignore */
      }
    };

    socket.on('webrtc-ready', handleReady);
    socket.on('webrtc-offer', handleOffer);
    socket.on('webrtc-answer', handleAnswer);
    socket.on('webrtc-ice-candidate', handleIceCandidate);

    return () => {
      socket.off('webrtc-ready', handleReady);
      socket.off('webrtc-offer', handleOffer);
      socket.off('webrtc-answer', handleAnswer);
      socket.off('webrtc-ice-candidate', handleIceCandidate);
    };
  }, [socket, active, sendOffer, answerOffer, cleanupPeerConnection]);

  useEffect(
    () => () => {
      stopLocalMedia();
      cleanupPeerConnection();
    },
    [stopLocalMedia, cleanupPeerConnection],
  );

  return { localStream, remoteStream, error, connectionState };
}
