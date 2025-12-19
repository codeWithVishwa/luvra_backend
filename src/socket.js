import { Server } from "socket.io";
import User from "./models/user.model.js";
import { sendPushNotification } from "./utils/expoPush.js";
import { deliverPendingNotificationsOnReconnect } from "./utils/messageNotifications.js";

let io;
// Presence set (kept for existing features like presence:update)
const onlineUsers = new Set();

// Requirement: maintain in-memory map userId -> socketId
// Note: users may connect from multiple devices; we store a Set of socketIds.
const userSocketIds = new Map();

export function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: (origin, cb) => cb(null, true),
      credentials: true,
    },
  });

  io.on("connection", async (socket) => {
    const userId = socket.handshake.auth?.userId || socket.handshake.query?.userId;
    if (userId) {
      // 1) Track socket mapping for real-time notifications
      const uid = String(userId);
      if (!userSocketIds.has(uid)) userSocketIds.set(uid, new Set());
      userSocketIds.get(uid).add(socket.id);

      socket.join(`user:${userId}`);
      onlineUsers.add(uid);
      
      // Update lastActiveAt
      User.findByIdAndUpdate(userId, { lastActiveAt: new Date() }).catch(()=>{});
      io.emit("presence:update", { userId: String(userId), online: true, lastActiveAt: new Date().toISOString() });

      // 2) Deliver any queued (offline) message notifications on reconnect
      try {
        await deliverPendingNotificationsOnReconnect({ io, userId: uid, socketId: socket.id });
      } catch (e) {
        console.error("Error delivering pending notifications", e);
      }

      // Check for offline notifications
      try {
        const user = await User.findById(userId).select("pushToken offlineNotifications");
        if (user && user.offlineNotifications && user.offlineNotifications.length > 0) {
          // Send summary push
          if (user.pushToken) {
            const count = user.offlineNotifications.reduce((acc, n) => acc + n.count, 0);
            const senders = user.offlineNotifications.length;
            const title = `You have ${count} new messages`;
            const body = `From ${senders} chats while you were away.`;
            
            // Optional: Send summary push
            // await sendPushNotification(user.pushToken, title, body, { type: 'summary' });
          }
          
          // Clear queue
          user.offlineNotifications = [];
          await user.save();
        }
      } catch (e) {
        console.error("Error processing offline notifications", e);
      }
    }

    socket.on("disconnect", () => {
      if (userId) {
        // 3) Remove socketId from map; user is offline only when all sockets are gone
        const uid = String(userId);
        const set = userSocketIds.get(uid);
        if (set) {
          set.delete(socket.id);
          if (set.size === 0) userSocketIds.delete(uid);
        }

        // Check if still any sockets in room
        const room = io.sockets.adapter.rooms.get(`user:${userId}`);
        if (!room || room.size === 0) {
          onlineUsers.delete(uid);
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

// Requirement helpers: userId -> socketId
export function getSocketIdsForUser(userId) {
  const set = userSocketIds.get(String(userId));
  if (!set) return [];
  return Array.from(set);
}

export function getSocketIdForUser(userId) {
  const ids = getSocketIdsForUser(userId);
  return ids.length ? ids[0] : null;
}
