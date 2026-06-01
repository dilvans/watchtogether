import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchIceServers } from '../lib/iceServers.js';

function serializeDescription(desc) {
  if (!desc) return null;
  return { type: desc.type, sdp: desc.sdp };
}

async function flushPendingCandidates(pc, queue) {
  const pending = [...queue];
  queue.length = 0;
  for (const candidate of pending) {
    try {
      await pc.addIceCandidate(candidate);
    } catch {
      /* ignore stale candidates */
    }
  }
}

export function useWebRTC(socket, { active, cameraOn, micOn, partnerId }) {
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
  const partnerIdRef = useRef(partnerId);
  const socketIdRef = useRef(socket?.id ?? null);
  const iceConfigRef = useRef(null);
  const [iceReady, setIceReady] = useState(false);

  partnerIdRef.current = partnerId;
  if (socket?.id) socketIdRef.current = socket.id;

  const isOfferer = () => {
    const partner = partnerIdRef.current;
    const selfId = socketIdRef.current;
    if (!partner || !selfId) return false;
    return selfId.localeCompare(partner) < 0;
  };

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

  const addRemoteTrack = (track) => {
    if (!remoteStreamRef.current) {
      remoteStreamRef.current = new MediaStream();
      setRemoteStream(remoteStreamRef.current);
    }
    const stream = remoteStreamRef.current;
    if (!stream.getTracks().some((t) => t.id === track.id)) {
      stream.addTrack(track);
    }
  };

  const attachLocalTracks = (pc, stream) => {
    stream.getTracks().forEach((track) => {
      const sender = pc.getSenders().find((s) => s.track?.kind === track.kind);
      if (sender) {
        sender.replaceTrack(track);
      } else {
        pc.addTrack(track, stream);
      }
    });
  };

  const buildPeerConnection = () => {
    const iceServers = iceConfigRef.current?.iceServers ?? [{ urls: 'stun:stun.l.google.com:19302' }];
    const pc = new RTCPeerConnection({ iceServers });

    pc.onicecandidate = (event) => {
      if (event.candidate && socket?.connected) {
        socket.emit('webrtc-ice-candidate', { candidate: event.candidate.toJSON() });
      }
    };

    pc.ontrack = (event) => {
      if (event.track) addRemoteTrack(event.track);
    };

    pc.onconnectionstatechange = () => {
      setConnectionState(pc.connectionState);
      if (pc.connectionState === 'failed') {
        cleanupPeerConnection();
      }
    };

    return pc;
  };

  const sendOffer = async () => {
    if (!socket?.connected || !localStreamRef.current || !isOfferer()) return;
    if (negotiatingRef.current) return;

    const existing = pcRef.current;
    if (
      existing &&
      existing.localDescription &&
      existing.connectionState !== 'failed' &&
      existing.connectionState !== 'closed'
    ) {
      return;
    }

    negotiatingRef.current = true;
    setConnectionState('connecting');

    try {
      if (existing) {
        existing.close();
        pcRef.current = null;
      }

      const pc = buildPeerConnection();
      pcRef.current = pc;
      attachLocalTracks(pc, localStreamRef.current);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('webrtc-offer', { sdp: serializeDescription(pc.localDescription) });
    } catch {
      cleanupPeerConnection();
    } finally {
      negotiatingRef.current = false;
    }
  };

  const answerOffer = async (sdp) => {
    if (isOfferer()) return;
    if (!localStreamRef.current) {
      pendingOfferRef.current = sdp;
      return;
    }
    if (negotiatingRef.current) return;

    const existing = pcRef.current;
    if (
      existing &&
      existing.remoteDescription &&
      existing.connectionState !== 'failed' &&
      existing.connectionState !== 'closed'
    ) {
      return;
    }

    negotiatingRef.current = true;
    setConnectionState('connecting');

    try {
      if (existing) {
        existing.close();
        pcRef.current = null;
      }

      const pc = buildPeerConnection();
      pcRef.current = pc;
      attachLocalTracks(pc, localStreamRef.current);

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
  };

  const maybeStartConnection = () => {
    if (!active || !cameraOn || !localStreamRef.current || !partnerIdRef.current) return;

    if (isOfferer()) {
      sendOffer();
    } else if (pendingOfferRef.current) {
      const sdp = pendingOfferRef.current;
      pendingOfferRef.current = null;
      answerOffer(sdp);
    }
  };

  useEffect(() => {
    if (!active) {
      iceConfigRef.current = null;
      setIceReady(false);
      return undefined;
    }

    let cancelled = false;

    fetchIceServers().then((config) => {
      if (cancelled) return;
      iceConfigRef.current = config;
      setIceReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [active]);

  useEffect(() => {
    if (!cameraOn) {
      stopLocalMedia();
      cleanupPeerConnection();
      setError(null);
      return undefined;
    }

    if (localStreamRef.current) return undefined;

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
    if (!active || !cameraOn || !localStream || !partnerId || !socket?.id || !iceReady) {
      return undefined;
    }
    maybeStartConnection();
    return undefined;
  }, [active, cameraOn, localStream, partnerId, socket?.id, iceReady]);

  useEffect(() => {
    if (!socket || !active) return undefined;

    const handleOffer = ({ sdp }) => {
      if (isOfferer()) return;
      if (pcRef.current?.remoteDescription) return;
      answerOffer(sdp);
    };

    const handleAnswer = async ({ sdp }) => {
      if (!isOfferer()) return;
      const pc = pcRef.current;
      if (!pc || pc.remoteDescription) return;

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

    socket.on('webrtc-offer', handleOffer);
    socket.on('webrtc-answer', handleAnswer);
    socket.on('webrtc-ice-candidate', handleIceCandidate);

    return () => {
      socket.off('webrtc-offer', handleOffer);
      socket.off('webrtc-answer', handleAnswer);
      socket.off('webrtc-ice-candidate', handleIceCandidate);
    };
  }, [socket, active, cleanupPeerConnection]);

  useEffect(
    () => () => {
      stopLocalMedia();
      cleanupPeerConnection();
    },
    [stopLocalMedia, cleanupPeerConnection],
  );

  return { localStream, remoteStream, error, connectionState };
}
