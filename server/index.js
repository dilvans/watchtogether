import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors({ origin: '*' }));
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

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
    callback({ ok: true, code });
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
    callback({ ok: true, code: normalized });

    io.to(normalized).emit('partner-joined');
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
});
