# WatchTogether

Watch the same movie in sync with a friend. Each person selects their **own local copy** of the video file — nothing is uploaded or streamed through the server. Socket.io only relays play, pause, and seek events.

## Stack

- **Frontend:** React (Vite) + Tailwind CSS
- **Backend:** Node.js, Express, Socket.io

## Quick start (local)

### 1. Install dependencies

```bash
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..
```

Or from the root (after `npm install` at root for `concurrently`):

```bash
npm install
npm install --prefix server
npm install --prefix client
```

### 2. Configure the client (optional)

Copy `client/.env.example` to `client/.env`:

```bash
cp client/.env.example client/.env
```

Default backend URL is `http://localhost:3000` if `VITE_BACKEND_URL` is not set.

### 3. Run both servers

```bash
npm run dev
```

- Backend: http://localhost:3000  
- Frontend: http://localhost:5173  

### 4. Use the app

1. User A opens the frontend, clicks **Create Room**, and shares the 5-character code.
2. User B opens the frontend (same or different machine), enters the code, and clicks **Join Room**.
3. Both users pick their local video file (same movie, local paths).
4. Play, pause, and scrub on one side — the other side follows (within a 0.5s drift threshold to avoid sync loops).

---

## Connect a friend over the internet

The backend must be reachable from both browsers. The frontend must point at that public URL via `VITE_BACKEND_URL`.

### Option A: Ngrok (quick test)

1. Start the backend locally:

   ```bash
   cd server && npm start
   ```

2. Expose port 3000 with [ngrok](https://ngrok.com/):

   ```bash
   ngrok http 3000
   ```

3. Copy the HTTPS forwarding URL (e.g. `https://abc123.ngrok-free.app`).

4. **User hosting the tunnel:** set in `client/.env`:

   ```env
   VITE_BACKEND_URL=https://abc123.ngrok-free.app
   ```

   Run the Vite dev server and share your frontend URL (see below).

5. **Remote friend:** either:
   - Uses your dev server if you expose 5173 too: `ngrok http 5173`, and they open that URL with the same `VITE_BACKEND_URL` in their build, or
   - Builds the client with the backend URL baked in:

     ```bash
     cd client
     VITE_BACKEND_URL=https://abc123.ngrok-free.app npm run build
     npm run preview
     ```

   Share the ngrok URL for port 5173 (or your deployed frontend).

6. Both users use the app: one creates a room, the other joins with the code.

**Tip:** Keep the ngrok session running for the whole watch party. Free ngrok URLs change when you restart.

### Option B: Deploy backend to Render (free tier)

1. Push this repo to GitHub.

2. On [Render](https://render.com), create a **Web Service**:
   - **Root directory:** `server`
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - Render sets `PORT` automatically.

3. Note your service URL, e.g. `https://watchtogether-api.onrender.com`.

4. Set `VITE_BACKEND_URL` to that URL when building or developing the client:

   ```env
   VITE_BACKEND_URL=https://watchtogether-api.onrender.com
   ```

5. Deploy the frontend (Vercel, Netlify, Render static site, etc.) with the same env var, or run locally with `.env` pointing at Render.

CORS is enabled for all origins on the API and Socket.io server so any deployed frontend domain can connect.

---

## Environment variables

| Variable | Where | Description |
|----------|--------|-------------|
| `PORT` | Server | HTTP port (default `3000`). Set by Render/Heroku/etc. |
| `VITE_BACKEND_URL` | Client | Socket.io server URL. Falls back to `http://localhost:3000`. |
| `METERED_DOMAIN` | Server | Your Metered app domain, e.g. `yourapp.metered.live` (no `https://`). |
| `METERED_SECRET_KEY` | Server | Metered **Secret Key** from Dashboard → Developers. Never put this in the client. |

---

## Webcam over the internet (Metered.ca TURN)

WebRTC video is peer-to-peer. On different networks you usually need a **TURN relay**. Socket.io sync still goes through Render; cameras do not.

### 1. Create a Metered account

1. Sign up at [metered.ca/stun-turn](https://www.metered.ca/stun-turn) (free tier available).
2. Open the **TURN Server** dashboard.

### 2. Get your server credentials

1. Go to **Developers** in the Metered dashboard.
2. Copy your **Metered Domain** (e.g. `watchtogether.metered.live`).
3. Copy your **Secret Key** — this stays on the server only.

### 3. Add env vars on Render

In your Render service → **Environment**:

| Key | Value |
|-----|--------|
| `METERED_DOMAIN` | `yourapp.metered.live` |
| `METERED_SECRET_KEY` | paste Secret Key |

Save and redeploy. The server creates short-lived TURN credentials and exposes them at `GET /api/turn-credentials`.

### 4. Verify

After deploy, open:

```
https://watchtogether-63ap.onrender.com/health
```

You should see `"turnConfigured": true`.

Then test webcams with one person on home Wi‑Fi and one on mobile data (or different locations). Both must click **Enable camera**.

### Local development

Copy `server/.env.example` to `server/.env` and fill in the same two variables. Restart the server (`npm run dev`).

If Metered is not configured, the app falls back to public STUN/OpenRelay servers (fine for same-network testing, unreliable across the internet).

---

## How sync works

- **Play / pause / seek** on the `<video>` element emit Socket.io events to the other client in the room.
- Incoming events set a short **remote** flag so the partner’s player does not echo events back.
- **Seek** is debounced (~200ms); time updates are ignored if the drift is under **0.5 seconds**.

---

## Project layout

```
watchtogether/
├── server/          # Express + Socket.io
├── client/          # React + Vite + Tailwind
├── package.json     # Root scripts (concurrent dev)
└── README.md
```

## Health check

`GET /health` on the backend returns `{ "ok": true }`.
