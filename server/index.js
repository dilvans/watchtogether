import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(__dirname, '../client/dist');
const hasClientBuild = existsSync(path.join(clientDist, 'index.html'));

const app = express();
app.use(cors({ origin: '*' }));
app.get('/health', (_req, res) => {
  res.json({ ok: true, clientBuild: hasClientBuild });
});

if (hasClientBuild) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/socket.io')) {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, 'index.html'), (err) => {
      if (err) next(err);
    });
  });
} else {
  app.get('/', (_req, res) => {
    res.status(503).send('Frontend build missing. Run npm run build in the server directory.');
  });
}

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const rooms = new Map();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

function generateRoomCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

function createUniqueCode() {
  let code;
  do {
    code = generateRoomCode();
  } while (rooms.has(code));
  return code;
}

function getRoom(code) {
  return rooms.get(code?.toUpperCase());
}

io.on('connection', (socket) => {
  socket.on('create-room', (callback) => {
    const code = createUniqueCode();
    rooms.set(code, { host: socket.id, users: [socket.id] });
    socket.join(code);
    socket.data.roomCode = code;
    callback({ ok: true, code, partnerId: null });
  });

  socket.on('join-room', (code, callback) => {
    const normalized = code?.trim().toUpperCase();
    const room = getRoom(normalized);

    if (!room) {
      callback({ ok: false, error: 'Room not found' });
      return;
    }

    if (room.users.length >= 2) {
      callback({ ok: false, error: 'Room is full' });
      return;
    }

    room.users.push(socket.id);
    socket.join(normalized);
    socket.data.roomCode = normalized;
    callback({ ok: true, code: normalized, partnerId: room.host });

    socket.to(normalized).emit('partner-joined', { partnerId: socket.id });
  });

  socket.on('sync-play', (payload) => {
    const code = socket.data.roomCode;
    if (!code) return;
    socket.to(code).emit('sync-play', payload);
  });

  socket.on('sync-pause', (payload) => {
    const code = socket.data.roomCode;
    if (!code) return;
    socket.to(code).emit('sync-pause', payload);
  });

  socket.on('sync-seek', (payload) => {
    const code = socket.data.roomCode;
    if (!code) return;
    socket.to(code).emit('sync-seek', payload);
  });

  socket.on('webrtc-offer', (payload) => {
    const code = socket.data.roomCode;
    if (!code) return;
    socket.to(code).emit('webrtc-offer', payload);
  });

  socket.on('webrtc-answer', (payload) => {
    const code = socket.data.roomCode;
    if (!code) return;
    socket.to(code).emit('webrtc-answer', payload);
  });

  socket.on('webrtc-ice-candidate', (payload) => {
    const code = socket.data.roomCode;
    if (!code) return;
    socket.to(code).emit('webrtc-ice-candidate', payload);
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code) return;

    const room = rooms.get(code);
    if (!room) return;

    room.users = room.users.filter((id) => id !== socket.id);

    if (room.users.length === 0) {
      rooms.delete(code);
    } else {
      io.to(code).emit('partner-left');
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`WatchTogether server listening on port ${PORT}`);
  if (!hasClientBuild) {
    console.warn('Client build not found at', clientDist);
  }
});
