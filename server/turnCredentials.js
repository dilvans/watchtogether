const FALLBACK_ICE_SERVERS = [
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
];

function normalizeIceServers(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.iceServers)) return payload.iceServers;
  return FALLBACK_ICE_SERVERS;
}

export async function getTurnIceServers() {
  const domain = process.env.METERED_DOMAIN?.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const secretKey = process.env.METERED_SECRET_KEY;

  if (!domain || !secretKey) {
    return { iceServers: FALLBACK_ICE_SERVERS, source: 'fallback' };
  }

  const createUrl = `https://${domain}/api/v1/turn/credential?secretKey=${encodeURIComponent(secretKey)}`;
  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      label: 'watchtogether',
      expiryInSeconds: 14_400,
    }),
  });

  if (!createRes.ok) {
    throw new Error(`Metered create credential failed (${createRes.status})`);
  }

  const created = await createRes.json();
  const apiKey = created?.apiKey;
  if (!apiKey) {
    throw new Error('Metered create credential response missing apiKey');
  }

  const iceUrl = `https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`;
  const iceRes = await fetch(iceUrl);
  if (!iceRes.ok) {
    throw new Error(`Metered fetch ICE servers failed (${iceRes.status})`);
  }

  const icePayload = await iceRes.json();
  return { iceServers: normalizeIceServers(icePayload), source: 'metered' };
}
