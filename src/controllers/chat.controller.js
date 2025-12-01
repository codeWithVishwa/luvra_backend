import Conversation from "../models/conversation.model.js";
import Message from "../models/message.model.js";
import User from "../models/user.model.js";
import { getIO } from "../socket.js";

function ensureParticipants(userId, otherId) {
  const a = String(userId);
  const b = String(otherId);
  return a < b ? [a, b] : [b, a];
}

async function getInteractionBlock(userId, otherId) {
  if (!otherId) return { blocked: false };
  const [me, other] = await Promise.all([
    User.findById(userId).select("_id blockedUsers"),
    User.findById(otherId).select("_id blockedUsers"),
  ]);
  if (!other) return { notFound: true };
  const blockedByMe = Array.isArray(me?.blockedUsers) && me.blockedUsers.some((id) => String(id) === String(otherId));
  const blockedByOther = Array.isArray(other.blockedUsers) && other.blockedUsers.some((id) => String(id) === String(userId));
  if (blockedByMe) return { blocked: true, message: "Unblock this user to chat" };
  if (blockedByOther) return { blocked: true, message: "This user has blocked you" };
  return { blocked: false };
}

function ciphertextPreview(ciphertext) {
  if (!ciphertext) return null;
  return `${ciphertext.slice(0, 48)}${ciphertext.length > 48 ? "…" : ""}`;
}

async function upsertDirectConversation(userId, otherId) {
  const [lower, higher] = ensureParticipants(userId, otherId);
  const pairKey = `${lower}:${higher}`;
  let convo = await Conversation.findOne({ directPairKey: pairKey });
  if (!convo) {
    convo = await Conversation.create({ participants: [lower, higher] });
  } else if (Array.isArray(convo.deletedFor) && convo.deletedFor.some((id) => String(id) === String(userId))) {
    convo.deletedFor = convo.deletedFor.filter((id) => String(id) !== String(userId));
    await convo.save();
  }
  return convo;
}

function isFollower(userDoc, followerId) {
  if (!userDoc) return false;
  return userDoc.followers?.some((id) => String(id) === String(followerId)) || false;
}

function hasMessageRequest(userDoc, fromId) {
  if (!userDoc) return false;
  return userDoc.messageRequests?.some((req) => String(req.from) === String(fromId)) || false;
}

async function evaluateChatAccess(meId, targetUser) {
  const follower = isFollower(targetUser, meId);
  if (targetUser.isPrivate && !follower) {
    return { status: "not_allowed_private" };
  }
  if (!targetUser.isPrivate && !follower) {
    return { status: "needs_request" };
  }
  return { status: "chat_allowed" };
}

export const startChat = async (req, res) => {
  try {
    const { targetUserId } = req.params;
    if (String(targetUserId) === String(req.user._id)) {
      return res.status(400).json({ message: "Cannot chat with yourself" });
    }

    const [currentUser, targetUser] = await Promise.all([
      User.findById(req.user._id).select("_id blockedUsers following"),
      User.findById(targetUserId).select("_id name blockedUsers isPrivate followers messageRequests"),
    ]);
    if (!targetUser) return res.status(404).json({ message: "User not found" });

    const blockStatus = await getInteractionBlock(req.user._id, targetUserId);
    if (blockStatus.blocked) return res.status(403).json({ status: "blocked", message: blockStatus.message });

    const access = await evaluateChatAccess(req.user._id, targetUser);
    if (access.status === "not_allowed_private") {
      return res.status(403).json({ status: "not_allowed_private" });
    }

    if (access.status === "needs_request") {
      if (!hasMessageRequest(targetUser, req.user._id)) {
        targetUser.messageRequests.push({ from: req.user._id });
        await targetUser.save();
      }
      return res.json({ status: "request_sent" });
    }

    const convo = await upsertDirectConversation(req.user._id, targetUserId);
    return res.json({ status: "chat_allowed", chatId: convo._id, conversation: convo });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const listMessageRequests = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select("messageRequests")
      .populate("messageRequests.from", "name avatarUrl isPrivate");
    res.json({ requests: user?.messageRequests || [] });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

async function handleMessageRequestDecision(req, res, accepted) {
  const { requesterId } = req.params;
  const user = await User.findById(req.user._id);
  if (!user) return res.status(404).json({ message: "User not found" });

  const before = user.messageRequests.length;
  user.messageRequests = user.messageRequests.filter((entry) => String(entry.from) !== String(requesterId));
  if (before === user.messageRequests.length) {
    await user.save();
    return res.status(404).json({ message: "Request not found" });
  }
  await user.save();

  if (!accepted) {
    return res.json({ status: "rejected" });
  }

  const convo = await upsertDirectConversation(req.user._id, requesterId);
  return res.json({ status: "accepted", chatId: convo._id });
}

export const acceptMessageRequest = async (req, res) => {
  try {
    await handleMessageRequestDecision(req, res, true);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const rejectMessageRequest = async (req, res) => {
  try {
    await handleMessageRequestDecision(req, res, false);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const getOrCreateConversation = async (req, res) => {
  try {
    const otherId = req.params.userId;
    if (String(otherId) === String(req.user._id)) return res.status(400).json({ message: "Cannot chat with yourself" });
    const blockStatus = await getInteractionBlock(req.user._id, otherId);
    if (blockStatus.notFound) return res.status(404).json({ message: "User not found" });
    if (blockStatus.blocked) return res.status(403).json({ message: blockStatus.message });

    const target = await User.findById(otherId).select("isPrivate followers messageRequests");
    if (!target) return res.status(404).json({ message: "User not found" });
    const access = await evaluateChatAccess(req.user._id, target);
    if (access.status === "not_allowed_private") {
      return res.status(403).json({ message: "Follow request must be accepted before chatting" });
    }
    if (access.status === "needs_request") {
      if (!hasMessageRequest(target, req.user._id)) {
        target.messageRequests.push({ from: req.user._id });
        await target.save();
      }
      return res.status(202).json({ message: "Message request sent" });
    }

    const convo = await upsertDirectConversation(req.user._id, otherId);
    res.json({ conversation: convo });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const listConversations = async (req, res) => {
  try {
    const convos = await Conversation.find({ participants: req.user._id, deletedFor: { $ne: req.user._id } })
      .sort({ updatedAt: -1 })
      .limit(50)
      .populate("participants", "_id name email avatarUrl verified");
    const userId = String(req.user._id);
    const withUnread = await Promise.all(
      convos.map(async (c) => {
        const unread = await Message.countDocuments({ conversation: c._id, readBy: { $ne: userId } });
        const obj = c.toObject();
        obj.unreadCount = unread;
        return obj;
      })
    );
    res.json({ conversations: withUnread });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const listMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { before, limit = 30 } = req.query;
    const convo = await Conversation.findById(conversationId);
    if (!convo || !convo.participants.some((p) => String(p) === String(req.user._id))) {
      return res.status(404).json({ message: "Conversation not found" });
    }
    const others = convo.participants.filter((p) => String(p) !== String(req.user._id));
    for (const participant of others) {
      const blockStatus = await getInteractionBlock(req.user._id, participant);
      if (blockStatus.notFound) return res.status(404).json({ message: "User not found" });
      if (blockStatus.blocked) return res.status(403).json({ message: blockStatus.message });
    }
    const q = { conversation: conversationId };
    if (before) q.createdAt = { $lt: new Date(before) };
    const msgs = await Message.find(q)
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .select("ciphertext nonce payloadType sender receiver createdAt deleted deletedAt readBy");
    res.json({ messages: msgs.reverse() });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const sendMessage = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { ciphertext, nonce, payloadType = "text" } = req.body;
    if (!ciphertext || !nonce) return res.status(400).json({ message: "Ciphertext and nonce required" });

    const convo = await Conversation.findById(conversationId);
    if (!convo || !convo.participants.some((p) => String(p) === String(req.user._id))) {
      return res.status(404).json({ message: "Conversation not found" });
    }
    const receiverId = convo.participants.find((p) => String(p) !== String(req.user._id));
    const blockStatus = await getInteractionBlock(req.user._id, receiverId);
    if (blockStatus.blocked) return res.status(403).json({ message: blockStatus.message });

    const message = await Message.create({
      conversation: conversationId,
      sender: req.user._id,
      receiver: receiverId,
      ciphertext,
      nonce,
      payloadType,
      readBy: [req.user._id],
    });

    convo.lastMessage = {
      ciphertextPreview: ciphertextPreview(ciphertext),
      sender: req.user._id,
      at: message.createdAt,
    };
    await convo.save();

    const io = getIO();
    if (io) {
      const recipients = convo.participants.filter((p) => String(p) !== String(req.user._id));
      recipients.forEach((rid) => {
        io.to(`user:${rid}`).emit("message:new", { conversationId, message });
      });
    }

    res.status(201).json({ message });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const markRead = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const convo = await Conversation.findById(conversationId);
    if (!convo || !convo.participants.some((p) => String(p) === String(req.user._id))) {
      return res.status(404).json({ message: "Conversation not found" });
    }
    await Message.updateMany(
      { conversation: conversationId, readBy: { $ne: req.user._id } },
      { $addToSet: { readBy: req.user._id } }
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const msg = await Message.findById(messageId);
    if (!msg) return res.status(404).json({ message: "Message not found" });
    if (String(msg.sender) !== String(req.user._id)) return res.status(403).json({ message: "Not allowed" });
    const convo = await Conversation.findById(msg.conversation);
    if (!convo || !convo.participants.some((p) => String(p) === String(req.user._id))) {
      return res.status(404).json({ message: "Conversation not found" });
    }
    if (msg.deleted) return res.json({ message: msg });

    msg.deleted = true;
    msg.deletedAt = new Date();
    msg.deletedBy = req.user._id;
    msg.ciphertext = "";
    msg.nonce = "";
    await msg.save();

    if (convo.lastMessage && String(convo.lastMessage.sender) === String(req.user._id)) {
      convo.lastMessage.ciphertextPreview = "[deleted]";
      convo.lastMessage.at = new Date();
      await convo.save();
    }

    const io = getIO();
    if (io) {
      const recipients = convo.participants.filter((p) => String(p) !== String(req.user._id));
      recipients.forEach((rid) => {
        io.to(`user:${rid}`).emit("message:deleted", {
          conversationId: String(convo._id),
          messageId: String(msg._id),
        });
      });
    }

    res.json({ message: msg });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const deleteConversationForUser = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const convo = await Conversation.findOneAndUpdate(
      { _id: conversationId, participants: req.user._id },
      { $addToSet: { deletedFor: req.user._id } },
      { new: true }
    );
    if (!convo) return res.status(404).json({ message: "Conversation not found" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};
