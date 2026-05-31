import { useEffect, useRef, useState, useCallback } from 'react';

const ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

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

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const pendingOfferRef = useRef(null);
  const makingOfferRef = useRef(false);

  const cleanupPeerConnection = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    pendingCandidatesRef.current = [];
    pendingOfferRef.current = null;
    makingOfferRef.current = false;
    setRemoteStream(null);
  }, []);

  const stopLocalMedia = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setLocalStream(null);
  }, []);

  const createPeerConnection = useCallback(() => {
    if (pcRef.current) return pcRef.current;

    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.onicecandidate = (event) => {
      if (event.candidate && socket?.connected) {
        socket.emit('webrtc-ice-candidate', { candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) setRemoteStream(stream);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        cleanupPeerConnection();
      }
    };

    pcRef.current = pc;
    return pc;
  }, [socket, cleanupPeerConnection]);

  const createOffer = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || !socket?.connected || !isHost || makingOfferRef.current) return;

    makingOfferRef.current = true;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('webrtc-offer', { sdp: pc.localDescription });
    } catch {
      /* negotiation can fail if partner disconnected mid-offer */
    } finally {
      makingOfferRef.current = false;
    }
  }, [socket, isHost]);

  const attachLocalTracks = useCallback((stream) => {
    const pc = createPeerConnection();
    const senders = pc.getSenders();

    stream.getTracks().forEach((track) => {
      const existing = senders.find((sender) => sender.track?.kind === track.kind);
      if (existing) {
        existing.replaceTrack(track);
      } else {
        pc.addTrack(track, stream);
      }
    });
  }, [createPeerConnection]);

  const handleRemoteOffer = useCallback(
    async (sdp) => {
      if (isHost || !localStreamRef.current) {
        pendingOfferRef.current = sdp;
        return;
      }

      const pc = createPeerConnection();
      attachLocalTracks(localStreamRef.current);

      try {
        await pc.setRemoteDescription(sdp);
        await flushPendingCandidates(pc, pendingCandidatesRef.current);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc-answer', { sdp: pc.localDescription });
      } catch {
        cleanupPeerConnection();
      }
    },
    [isHost, createPeerConnection, attachLocalTracks, socket, cleanupPeerConnection],
  );

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

    attachLocalTracks(localStream);

    if (isHost) {
      createOffer();
    }

    return undefined;
  }, [active, cameraOn, localStream, isHost, attachLocalTracks, createOffer]);

  useEffect(() => {
    if (!localStream || isHost || !pendingOfferRef.current) return undefined;

    handleRemoteOffer(pendingOfferRef.current);
    pendingOfferRef.current = null;

    return undefined;
  }, [localStream, isHost, handleRemoteOffer]);

  useEffect(() => {
    if (!socket || !active) return undefined;

    const handleOffer = ({ sdp }) => {
      if (isHost) return;
      handleRemoteOffer(sdp);
    };

    const handleAnswer = async ({ sdp }) => {
      if (!isHost) return;
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
      if (!pc || !pc.remoteDescription) {
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
  }, [
    socket,
    active,
    isHost,
    handleRemoteOffer,
    cleanupPeerConnection,
  ]);

  useEffect(() => {
    if (!active || !cameraOn) {
      cleanupPeerConnection();
    }
  }, [active, cameraOn, cleanupPeerConnection]);

  useEffect(
    () => () => {
      stopLocalMedia();
      cleanupPeerConnection();
    },
    [stopLocalMedia, cleanupPeerConnection],
  );

  return { localStream, remoteStream, error };
}
