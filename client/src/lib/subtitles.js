const SRT_TIMESTAMP = /(\d{2}:\d{2}:\d{2}),(\d{3})/g;

export function srtToVtt(content) {
  const body = content
    .replace(/\uFEFF/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(SRT_TIMESTAMP, '$1.$2')
    .replace(/^\d+\s*\n/gm, '');

  return `WEBVTT\n\n${body.trim()}\n`;
}

export function normalizeSubtitleContent(content, fileName) {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'vtt') return content;
  if (ext === 'srt') return srtToVtt(content);
  throw new Error('Unsupported subtitle format. Use .srt or .vtt files.');
}

export function discoverEmbeddedTracks(video) {
  if (!video?.textTracks) return [];

  return Array.from(video.textTracks)
    .map((track, index) => ({
      id: `embedded-${index}`,
      label: track.label || track.language || `Track ${index + 1}`,
      language: track.language || '',
      kind: track.kind,
      source: 'embedded',
      index,
    }))
    .filter((track) => track.kind === 'subtitles' || track.kind === 'captions');
}

export function applySubtitleSelection(video, tracks, selectedTrackId, externalTrackIndex) {
  if (!video?.textTracks) return;

  Array.from(video.textTracks).forEach((track, index) => {
    const isExternal = index === externalTrackIndex;
    const isEmbedded =
      selectedTrackId.startsWith('embedded-') &&
      index === Number.parseInt(selectedTrackId.replace('embedded-', ''), 10);

    track.mode = selectedTrackId === 'off' || (!isExternal && !isEmbedded) ? 'hidden' : 'showing';
  });
}
