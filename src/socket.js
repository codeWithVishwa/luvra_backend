import { Server } from "socket.io";
import User from "./models/user.model.js";
import { sendPushNotification } from "./utils/expoPush.js";

let io;
const onlineUsers = new Set();

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
      socket.join(`user:${userId}`);
      onlineUsers.add(String(userId));
      
      // Update lastActiveAt
      User.findByIdAndUpdate(userId, { lastActiveAt: new Date() }).catch(()=>{});
      io.emit("presence:update", { userId: String(userId), online: true, lastActiveAt: new Date().toISOString() });

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
