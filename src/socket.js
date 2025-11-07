import { Server } from "socket.io";

let io;
const onlineUsers = new Set();

export function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: (origin, cb) => cb(null, true),
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    const userId = socket.handshake.auth?.userId || socket.handshake.query?.userId;
    if (userId) {
      socket.join(`user:${userId}`);
      onlineUsers.add(String(userId));
      io.emit("presence:update", { userId: String(userId), online: true });
    }

    socket.on("disconnect", () => {
      if (userId) {
        // Check if still any sockets in room
        const room = io.sockets.adapter.rooms.get(`user:${userId}`);
        if (!room || room.size === 0) {
          onlineUsers.delete(String(userId));
          io.emit("presence:update", { userId: String(userId), online: false });
        }
      }
    });
  });

  return io;
}

export function getIO() {
  if (!io) throw new Error("Socket.io not initialized");
  return io;
}

export function getOnlineUsers() {
  return onlineUsers;
}
