import { useState, useEffect, useRef, useCallback } from 'react';
import {
  normalizeSubtitleContent,
  discoverEmbeddedTracks,
  applySubtitleSelection,
} from '../lib/subtitles.js';

export function useSubtitles(videoRef, videoUrl) {
  const [embeddedTracks, setEmbeddedTracks] = useState([]);
  const [externalTrack, setExternalTrack] = useState(null);
  const [selectedTrackId, setSelectedTrackId] = useState('off');
  const [externalFileName, setExternalFileName] = useState('');
  const [subtitleError, setSubtitleError] = useState('');
  const externalUrlRef = useRef(null);
  const externalTrackIndexRef = useRef(null);

  const revokeExternalUrl = useCallback(() => {
    if (externalUrlRef.current) {
      URL.revokeObjectURL(externalUrlRef.current);
      externalUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => revokeExternalUrl();
  }, [revokeExternalUrl]);

  useEffect(() => {
    setEmbeddedTracks([]);
    setExternalTrack(null);
    setExternalFileName('');
    setSelectedTrackId('off');
    setSubtitleError('');
    externalTrackIndexRef.current = null;
    revokeExternalUrl();
  }, [videoUrl, revokeExternalUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return undefined;

    const handleLoadedMetadata = () => {
      setEmbeddedTracks(discoverEmbeddedTracks(video));
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    if (video.readyState >= 1) handleLoadedMetadata();

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [videoRef, videoUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    applySubtitleSelection(video, embeddedTracks, selectedTrackId, externalTrackIndexRef.current);
  }, [videoRef, embeddedTracks, selectedTrackId, externalTrack]);

  const handleExternalSubtitle = useCallback(
    async (file) => {
      setSubtitleError('');
      revokeExternalUrl();
      setExternalTrack(null);
      setExternalFileName('');
      externalTrackIndexRef.current = null;

      if (!file) return;

      try {
        const content = await file.text();
        const vtt = normalizeSubtitleContent(content, file.name);
        const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
        externalUrlRef.current = url;

        setExternalTrack({ src: url, label: file.name });
        setExternalFileName(file.name);
        setSelectedTrackId('external');
      } catch (err) {
        setSubtitleError(err.message || 'Could not load subtitle file');
      }
    },
    [revokeExternalUrl],
  );

  const handleExternalTrackAdded = useCallback((event) => {
    const track = event.target;
    externalTrackIndexRef.current = track.track?.index ?? null;
    applySubtitleSelection(
      videoRef.current,
      embeddedTracks,
      'external',
      externalTrackIndexRef.current,
    );
  }, [videoRef, embeddedTracks]);

  const trackOptions = [
    { id: 'off', label: 'Off' },
    ...embeddedTracks.map((track) => ({
      id: track.id,
      label: `${track.label}${track.language ? ` (${track.language})` : ''} — embedded`,
    })),
    ...(externalTrack
      ? [{ id: 'external', label: `${externalFileName || 'External file'} — loaded file` }]
      : []),
  ];

  return {
    trackOptions,
    selectedTrackId,
    setSelectedTrackId,
    externalTrack,
    externalFileName,
    subtitleError,
    handleExternalSubtitle,
    handleExternalTrackAdded,
    hasEmbeddedTracks: embeddedTracks.length > 0,
  };
}
