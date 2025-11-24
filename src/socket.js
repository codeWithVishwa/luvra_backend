import { Server } from "socket.io";
import User from "./models/user.model.js";

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
      // Fire & forget update of lastActiveAt
      User.findByIdAndUpdate(userId, { lastActiveAt: new Date() }).catch(()=>{});
      io.emit("presence:update", { userId: String(userId), online: true, lastActiveAt: new Date().toISOString() });
    }

    socket.on("disconnect", () => {
      if (userId) {
        // Check if still any sockets in room
        const room = io.sockets.adapter.rooms.get(`user:${userId}`);
        if (!room || room.size === 0) {
          onlineUsers.delete(String(userId));
          const ts = new Date();
          User.findByIdAndUpdate(userId, { lastActiveAt: ts }).catch(()=>{});
          io.emit("presence:update", { userId: String(userId), online: false, lastActiveAt: ts.toISOString() });
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
