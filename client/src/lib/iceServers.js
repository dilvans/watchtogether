const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, '') || 'http://localhost:3000';

let cachedConfig = null;
let cacheExpiresAt = 0;

export async function fetchIceServers() {
  const now = Date.now();
  if (cachedConfig && cacheExpiresAt > now) {
    return cachedConfig;
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/turn-credentials`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const iceServers = Array.isArray(data.iceServers) ? data.iceServers : DEFAULT_ICE_SERVERS;
    cachedConfig = { iceServers };
    cacheExpiresAt = now + 3 * 60 * 60 * 1000;
    return cachedConfig;
  } catch {
    cachedConfig = { iceServers: DEFAULT_ICE_SERVERS };
    cacheExpiresAt = now + 60 * 1000;
    return cachedConfig;
  }
}
