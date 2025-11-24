import Conversation from "../models/conversation.model.js";
import Message from "../models/message.model.js";
import User from "../models/user.model.js";
import { getIO } from "../socket.js";
import cloudinary from "cloudinary";
import sharp from "sharp";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

function ensureCloudinaryConfigured() {
  const cfg = cloudinary.v2.config();
  if (!cfg.api_key || !cfg.cloud_name) {
    cloudinary.v2.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }
}

function isCloudinaryConfigured() {
  const cfg = cloudinary.v2.config();
  return Boolean(cfg.cloud_name && cfg.api_key && cfg.api_secret);
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
}

function extFromMime(mime) {
  // Very small mapping sufficient for common types
  if (mime.startsWith("image/")) {
    if (mime === "image/jpeg") return ".jpg";
    if (mime === "image/png") return ".png";
    if (mime === "image/webp") return ".webp";
    return ".img";
  }
  if (mime.startsWith("video/")) {
    if (mime === "video/mp4") return ".mp4";
    if (mime === "video/quicktime") return ".mov";
    return ".vid";
  }
  if (mime.startsWith("audio/")) {
    if (mime === "audio/mpeg") return ".mp3";
    if (mime === "audio/mp4") return ".m4a";
    if (mime === "audio/aac") return ".aac";
    return ".aud";
  }
  return "";
}

function ensureParticipants(userId, otherId) {
  const a = String(userId), b = String(otherId);
  return a < b ? [a, b] : [b, a];
}

async function getInteractionBlock(userId, otherId) {
  if (!otherId) return { blocked: false };
  const [me, other] = await Promise.all([
    User.findById(userId).select('_id blockedUsers'),
    User.findById(otherId).select('_id blockedUsers'),
  ]);
  if (!other) return { notFound: true };
  const blockedByMe = Array.isArray(me?.blockedUsers) && me.blockedUsers.some((id) => String(id) === String(otherId));
  const blockedByOther = Array.isArray(other.blockedUsers) && other.blockedUsers.some((id) => String(id) === String(userId));
  if (blockedByMe) return { blocked: true, message: 'Unblock this user to chat' };
  if (blockedByOther) return { blocked: true, message: 'This user has blocked you' };
  return { blocked: false };
}

function clearDeletionForParticipants(convo) {
  if (!Array.isArray(convo.deletedFor) || !convo.deletedFor.length) return false;
  const remaining = convo.deletedFor.filter((id) => !convo.participants.some((p) => String(p) === String(id)));
  const changed = remaining.length !== convo.deletedFor.length;
  if (changed) {
    convo.deletedFor = remaining;
  }
  return changed;
}

export const getOrCreateConversation = async (req, res) => {
  try {
    const otherId = req.params.userId;
    if (String(otherId) === String(req.user._id)) return res.status(400).json({ message: "Cannot chat with yourself" });
    const blockStatus = await getInteractionBlock(req.user._id, otherId);
    if (blockStatus.notFound) return res.status(404).json({ message: 'User not found' });
    if (blockStatus.blocked) return res.status(403).json({ message: blockStatus.message });
    const [u1, u2] = ensureParticipants(req.user._id, otherId);
    let convo = await Conversation.findOne({ participants: { $all: [u1, u2], $size: 2 } });
    if (!convo) {
      convo = await Conversation.create({ participants: [u1, u2] });
    } else if (Array.isArray(convo.deletedFor) && convo.deletedFor.some((id) => String(id) === String(req.user._id))) {
      convo.deletedFor = convo.deletedFor.filter((id) => String(id) !== String(req.user._id));
      await convo.save();
    }
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
    // Compute unread counts for each conversation based on messages not yet read by current user
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
      if (blockStatus.notFound) return res.status(404).json({ message: 'User not found' });
      if (blockStatus.blocked) return res.status(403).json({ message: blockStatus.message });
    }
    const q = { conversation: conversationId };
    if (before) q.createdAt = { $lt: new Date(before) };
    const msgs = await Message.find(q).sort({ createdAt: -1 }).limit(Number(limit));
    res.json({ messages: msgs.reverse() });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const sendMessage = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { text } = req.body;
    if (!text) return res.status(400).json({ message: "Message text required" });

    const convo = await Conversation.findById(conversationId);
    if (!convo || !convo.participants.some((p) => String(p) === String(req.user._id))) {
      return res.status(404).json({ message: "Conversation not found" });
    }
    const others = convo.participants.filter((p) => String(p) !== String(req.user._id));
    for (const participant of others) {
      const blockStatus = await getInteractionBlock(req.user._id, participant);
      if (blockStatus.notFound) return res.status(404).json({ message: 'User not found' });
      if (blockStatus.blocked) return res.status(403).json({ message: blockStatus.message });
    }

    const msg = await Message.create({ conversation: conversationId, sender: req.user._id, text, readBy: [req.user._id] });
    convo.lastMessage = { text, sender: req.user._id, at: new Date() };
    clearDeletionForParticipants(convo);
    await convo.save();

    // Emit via socket to the other participant(s)
    const io = getIO();
    const recipients = convo.participants.filter((p) => String(p) !== String(req.user._id));
    recipients.forEach((rid) => {
      io.to(`user:${rid}`).emit("message:new", { conversationId, message: msg });
    });

    res.status(201).json({ message: msg });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const sendMediaMessage = async (req, res) => {
  try {
    ensureCloudinaryConfigured();
    const { conversationId } = req.params;
    const file = req.file;
    if (!file) return res.status(400).json({ message: "No media file uploaded" });

    const convo = await Conversation.findById(conversationId);
    if (!convo || !convo.participants.some((p) => String(p) === String(req.user._id))) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const mime = file.mimetype;
    let type = 'text';
    if (mime.startsWith('image/')) type = 'image';
    else if (mime.startsWith('video/')) type = 'video';
    else if (mime.startsWith('audio/')) type = 'audio';
    else return res.status(400).json({ message: 'Unsupported media type' });

    let mediaUrl = null;
    let thumbUrl = null;

    if (isCloudinaryConfigured()) {
      // Optional: create a smaller image preview for image
      if (type === 'image') {
        const thumb = await sharp(file.buffer).resize(320, 320, { fit: 'cover' }).webp({ quality: 70 }).toBuffer();
        const dataUriThumb = `data:image/webp;base64,${thumb.toString('base64')}`;
        const upThumb = await cloudinary.v2.uploader.upload(dataUriThumb, { folder: 'luvra/media/thumbs', resource_type: 'image' });
        thumbUrl = upThumb.secure_url;
      }

      // Upload main media via base64 data URI (works for image/audio). For large video, consider direct upload.
      let resource_type = type === 'audio' ? 'video' : type; // Cloudinary uses 'video' for audio as well
      const dataUri = `data:${mime};base64,${file.buffer.toString('base64')}`;
      const uploaded = await cloudinary.v2.uploader.upload(dataUri, { folder: 'luvra/media', resource_type });
      mediaUrl = uploaded.secure_url;
    } else {
      // Fallback: save locally under /uploads/media and optional /uploads/thumbs
      const uploadsRoot = path.join(process.cwd(), 'uploads');
      const mediaDir = path.join(uploadsRoot, 'media');
      const thumbsDir = path.join(uploadsRoot, 'thumbs');
      await ensureDir(mediaDir);
      await ensureDir(thumbsDir);

      const base = crypto.randomBytes(16).toString('hex');
      const ext = extFromMime(mime) || (type === 'image' ? '.jpg' : type === 'video' ? '.mp4' : '.bin');
      const filename = `${base}${ext}`;
      const filePath = path.join(mediaDir, filename);
      await fs.writeFile(filePath, file.buffer);
      mediaUrl = `/uploads/media/${filename}`;

      if (type === 'image') {
        const thumbBuf = await sharp(file.buffer).resize(320, 320, { fit: 'cover' }).webp({ quality: 70 }).toBuffer();
        const thumbName = `${base}.webp`;
        const thumbPath = path.join(thumbsDir, thumbName);
        await fs.writeFile(thumbPath, thumbBuf);
        thumbUrl = `/uploads/thumbs/${thumbName}`;
      }
    }

    const msg = await Message.create({
      conversation: conversationId,
      sender: req.user._id,
      type,
      mediaUrl,
      thumbUrl,
      text: null,
      readBy: [req.user._id],
    });

    convo.lastMessage = { text: type.toUpperCase() + ' attachment', sender: req.user._id, at: new Date() };
    clearDeletionForParticipants(convo);
    await convo.save();

    const io = getIO();
    const recipients = convo.participants.filter((p) => String(p) !== String(req.user._id));
    recipients.forEach((rid) => {
      io.to(`user:${rid}`).emit("message:new", { conversationId, message: msg });
    });

    res.status(201).json({ message: msg });
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
    await Message.updateMany({ conversation: conversationId, readBy: { $ne: req.user._id } }, { $addToSet: { readBy: req.user._id } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const msg = await Message.findById(messageId);
    if (!msg) return res.status(404).json({ message: 'Message not found' });
    // Only sender can delete
    if (String(msg.sender) !== String(req.user._id)) return res.status(403).json({ message: 'Not allowed' });
    const convo = await Conversation.findById(msg.conversation);
    if (!convo || !convo.participants.some(p => String(p) === String(req.user._id))) {
      return res.status(404).json({ message: 'Conversation not found' });
    }
    if (msg.deleted) return res.json({ message: msg });

    msg.deleted = true;
    msg.deletedAt = new Date();
    msg.deletedBy = req.user._id;
    // Clear sensitive payload
    msg.text = null;
    msg.mediaUrl = null;
    msg.thumbUrl = null;
    // Keep type as-is or set to text; UI will look at deleted flag
    await msg.save();

    // If this was the lastMessage, update a placeholder
    if (convo.lastMessage && String(convo.lastMessage.sender) === String(req.user._id)) {
      // We cannot compare ids directly to msg._id since lastMessage doesn't store id; set placeholder text
      convo.lastMessage.text = 'Message deleted';
      convo.lastMessage.at = new Date();
      await convo.save();
    }

    const io = getIO();
    const recipients = convo.participants.filter((p) => String(p) !== String(req.user._id));
    recipients.forEach((rid) => {
      io.to(`user:${rid}`).emit('message:deleted', { conversationId: String(convo._id), messageId: String(msg._id) });
    });

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
    if (!convo) return res.status(404).json({ message: 'Conversation not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};
