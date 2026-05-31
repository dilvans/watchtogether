import { io } from 'socket.io-client';

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, '') || 'http://localhost:3000';

export function createSocket() {
  return io(BACKEND_URL, {
    transports: ['websocket', 'polling'],
    autoConnect: true,
  });
}

export { BACKEND_URL };
