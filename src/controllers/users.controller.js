import User from "../models/user.model.js";
import FriendRequest from "../models/friendRequest.model.js";
import cloudinary from "cloudinary";
import sharp from "sharp";

// Lazy Cloudinary configuration so it works even if dotenv loads later
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

export const searchUsers = async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.json({ users: [] });
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const users = await User.find({
      _id: { $ne: req.user._id },
      $or: [{ name: regex }, { email: regex }],
    })
      .select("_id name email verified")
      .limit(20);
    res.json({ users });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const sendFriendRequest = async (req, res) => {
  try {
    const to = req.params.userId;
    if (to === String(req.user._id)) return res.status(400).json({ message: "Cannot send request to yourself" });
    const fr = await FriendRequest.findOneAndUpdate(
      { from: req.user._id, to },
      { $setOnInsert: { from: req.user._id, to, status: "pending" } },
      { upsert: true, new: true }
    );
    res.status(201).json({ request: fr });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const listFriendRequests = async (req, res) => {
  try {
    const incoming = await FriendRequest.find({ to: req.user._id, status: "pending" })
      .populate("from", "_id name email")
      .sort({ createdAt: -1 });
    const outgoing = await FriendRequest.find({ from: req.user._id, status: "pending" })
      .populate("to", "_id name email")
      .sort({ createdAt: -1 });
    res.json({ incoming, outgoing });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const respondFriendRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { action } = req.body; // "accept" | "decline"
    const fr = await FriendRequest.findById(requestId);
    if (!fr) return res.status(404).json({ message: "Request not found" });
    if (String(fr.to) !== String(req.user._id)) return res.status(403).json({ message: "Not allowed" });

    fr.status = action === "accept" ? "accepted" : "declined";
    await fr.save();

    res.json({ request: fr });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const listContacts = async (req, res) => {
  try {
    // Contacts are users with accepted friend requests in either direction
    const accepted = await FriendRequest.find({
      $or: [{ from: req.user._id }, { to: req.user._id }],
      status: "accepted",
    });
    const ids = accepted.map((fr) => (String(fr.from) === String(req.user._id) ? fr.to : fr.from));
    const users = await User.find({ _id: { $in: ids } }).select("_id name email");
    res.json({ contacts: users });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("_id name email avatarUrl interests gender verified honorScore");
    res.json({ user });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

export const updateProfile = async (req, res) => {
  try {
    const { name, interests, gender } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (name) user.name = name;
    if (Array.isArray(interests)) user.interests = interests.slice(0, 20);
    if (gender) user.gender = gender;
    await user.save();
    res.json({ user: { _id: user._id, name: user.name, email: user.email, avatarUrl: user.avatarUrl, interests: user.interests, gender: user.gender } });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

export const uploadAvatar = async (req, res) => {
  try {
    ensureCloudinaryConfigured();
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    // Basic validation
    if (!/^image\//.test(req.file.mimetype)) return res.status(400).json({ message: "File must be an image" });
    // Resize & convert to webp buffer with sharp
    const processed = await sharp(req.file.buffer)
      .resize(256, 256, { fit: "cover" })
      .webp({ quality: 80 })
      .toBuffer();

    // Simpler: upload base64 data URI (avoids stream piping complexity)
    const dataUri = `data:image/webp;base64,${processed.toString('base64')}`;
    const result = await cloudinary.v2.uploader.upload(dataUri, {
      folder: "luvra/avatars",
      overwrite: true,
      resource_type: "image",
    });

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });
    user.avatarUrl = result.secure_url;
    await user.save();
    res.json({ avatarUrl: user.avatarUrl });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

// Online users will be tracked in socket.js; we expose an endpoint to query
import { getOnlineUsers } from "../socket.js";
export const listOnlineUsers = async (req, res) => {
  try {
    const onlineIds = Array.from(getOnlineUsers());
    const users = await User.find({ _id: { $in: onlineIds } }).select("_id name email avatarUrl");
    res.json({ users });
  } catch (e) { res.status(500).json({ message: e.message }); }
};
