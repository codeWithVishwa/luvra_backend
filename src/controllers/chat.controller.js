import Conversation from "../models/conversation.model.js";
import Message from "../models/message.model.js";
import User from "../models/user.model.js";
import { getIO } from "../socket.js";
import cloudinary from "cloudinary";
import sharp from "sharp";

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

function ensureParticipants(userId, otherId) {
  const a = String(userId), b = String(otherId);
  return a < b ? [a, b] : [b, a];
}

export const getOrCreateConversation = async (req, res) => {
  try {
    const otherId = req.params.userId;
    if (String(otherId) === String(req.user._id)) return res.status(400).json({ message: "Cannot chat with yourself" });
    const [u1, u2] = ensureParticipants(req.user._id, otherId);
    let convo = await Conversation.findOne({ participants: { $all: [u1, u2], $size: 2 } });
    if (!convo) {
      convo = await Conversation.create({ participants: [u1, u2] });
    }
    res.json({ conversation: convo });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const listConversations = async (req, res) => {
  try {
    const convos = await Conversation.find({ participants: req.user._id })
      .sort({ updatedAt: -1 })
      .limit(50)
      .populate("participants", "_id name email");
    res.json({ conversations: convos });
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

    const msg = await Message.create({ conversation: conversationId, sender: req.user._id, text });
    convo.lastMessage = { text, sender: req.user._id, at: new Date() };
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

    // Optional: create a smaller image preview for image/video
    let thumbUrl = null;
    if (type === 'image') {
      const thumb = await sharp(file.buffer).resize(320, 320, { fit: 'cover' }).webp({ quality: 70 }).toBuffer();
      const dataUri = `data:image/webp;base64,${thumb.toString('base64')}`;
      const upThumb = await cloudinary.v2.uploader.upload(dataUri, { folder: 'luvra/media/thumbs', resource_type: 'image' });
      thumbUrl = upThumb.secure_url;
    }

    // Upload main media via base64 data URI (works for image/audio). For large video, consider direct upload.
    let resource_type = type === 'audio' ? 'video' : type; // Cloudinary uses 'video' for audio as well
    const dataUri = `data:${mime};base64,${file.buffer.toString('base64')}`;
    const uploaded = await cloudinary.v2.uploader.upload(dataUri, { folder: 'luvra/media', resource_type });

    const msg = await Message.create({
      conversation: conversationId,
      sender: req.user._id,
      type,
      mediaUrl: uploaded.secure_url,
      thumbUrl,
      text: null,
    });

    convo.lastMessage = { text: type.toUpperCase() + ' attachment', sender: req.user._id, at: new Date() };
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
