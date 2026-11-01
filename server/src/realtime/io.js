let io = null;

export function setIo(instance) {
  io = instance;
}

export function getIo() {
  return io;
}

export function emitToUser(userId, event, payload) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, payload);
}

export function emitToMatch(matchId, event, payload) {
  if (!io) return;
  io.to(`match:${matchId}`).emit(event, payload);
}

export function emitToAdmins(event, payload) {
  if (!io) return;
  io.to('admins').emit(event, payload);
}

export function isOnline(userId) {
  if (!io) return false;
  const sockets = io.sockets.adapter.rooms.get(`user:${userId}`);
  return Boolean(sockets && sockets.size > 0);
}
