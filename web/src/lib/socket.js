import { io } from 'socket.io-client';
import { getToken } from './api.js';

let socket = null;

export function connectSocket() {
  const token = getToken();
  if (!token) return null;
  if (socket && socket.connected) return socket;
  if (socket) socket.disconnect();

  socket = io({
    path: '/socket.io',
    auth: { token },
    transports: ['polling', 'websocket'],
    reconnectionDelay: 800,
    reconnectionDelayMax: 5000,
  });
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function getSocket() {
  return socket;
}
