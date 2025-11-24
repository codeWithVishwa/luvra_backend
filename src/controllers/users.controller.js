import User from "../models/user.model.js";
import FriendRequest from "../models/friendRequest.model.js";
import cloudinary from "cloudinary";
import sharp from "sharp";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

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

function isCloudinaryConfigured() {
  const cfg = cloudinary.v2.config();
  return Boolean(cfg.cloud_name && cfg.api_key && cfg.api_secret);
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
      .select("_id name email verified avatarUrl")
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
      .populate("from", "_id name email avatarUrl")
      .sort({ createdAt: -1 });
    const outgoing = await FriendRequest.find({ from: req.user._id, status: "pending" })
      .populate("to", "_id name email avatarUrl")
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
  const users = await User.find({ _id: { $in: ids } }).select("_id name email avatarUrl");
    res.json({ contacts: users });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("_id name email avatarUrl interests gender bio verified honorScore");
    res.json({ user });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

export const updateProfile = async (req, res) => {
  try {
    const { name, interests, gender, bio } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (name) {
      const existing = await User.findOne({ nameLower: name.toLowerCase(), _id: { $ne: user._id } }).select('_id');
      if (existing) return res.status(409).json({ message: 'Username already taken' });
      user.name = name;
    }
    if (Array.isArray(interests)) user.interests = interests.slice(0, 20);
    if (gender) user.gender = gender;
    if (typeof bio === 'string') user.bio = bio.slice(0, 300);
    await user.save();
    res.json({ user: { _id: user._id, name: user.name, email: user.email, avatarUrl: user.avatarUrl, interests: user.interests, gender: user.gender, bio: user.bio } });
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
    let avatarUrl;
    if (isCloudinaryConfigured()) {
      // Simpler: upload base64 data URI (avoids stream piping complexity)
      const dataUri = `data:image/webp;base64,${processed.toString('base64')}`;
      const result = await cloudinary.v2.uploader.upload(dataUri, {
        folder: "luvra/avatars",
        overwrite: true,
        resource_type: "image",
      });
      avatarUrl = result.secure_url;
    } else {
      // Fallback: save locally under /uploads/avatars
      const uploadsRoot = path.join(process.cwd(), 'uploads');
      const avatarsDir = path.join(uploadsRoot, 'avatars');
      await fs.mkdir(avatarsDir, { recursive: true }).catch(() => {});
      const name = `${crypto.randomBytes(12).toString('hex')}.webp`;
      const outPath = path.join(avatarsDir, name);
      await fs.writeFile(outPath, processed);
      avatarUrl = `/uploads/avatars/${name}`;
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });
    user.avatarUrl = avatarUrl;
    await user.save();
    res.json({ avatarUrl: user.avatarUrl });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

// Online users will be tracked in socket.js; we expose an endpoint to query
import { getOnlineUsers } from "../socket.js";
export const listOnlineUsers = async (req, res) => {
  try {
    const onlineIds = Array.from(getOnlineUsers());
    const users = await User.find({ _id: { $in: onlineIds } }).select("_id name email avatarUrl lastActiveAt");
    res.json({ users });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

export const getUserBasic = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).select('_id name avatarUrl lastActiveAt');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ user });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

export const getUserPublicProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).select('_id name avatarUrl interests gender bio');
    if (!user) return res.status(404).json({ message: 'User not found' });
    // Friend count (accepted requests where this user is either side)
    const friendCount = await FriendRequest.countDocuments({ status: 'accepted', $or: [ { from: userId }, { to: userId } ] });
    // Optionally could add relationship status relative to requesting user later
    res.json({ user: { _id: user._id, name: user.name, avatarUrl: user.avatarUrl, interests: user.interests, gender: user.gender, bio: user.bio, friendCount } });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

export const removeFriend = async (req, res) => {
  try {
    const otherId = req.params.userId;
    // Find accepted friend request in either direction
    const fr = await FriendRequest.findOne({
      status: 'accepted',
      $or: [
        { from: req.user._id, to: otherId },
        { from: otherId, to: req.user._id },
      ],
    });
    if (!fr) return res.status(404).json({ message: 'Friendship not found' });
    await fr.deleteOne();
    return res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// Recommend friends based on overlapping interests and not already connected or pending
export const recommendFriends = async (req, res) => {
  try {
    const me = await User.findById(req.user._id).select('_id interests');
    if (!me) return res.status(404).json({ message: 'User not found' });
    const myInterests = Array.isArray(me.interests) ? me.interests.filter(Boolean) : [];
    if (myInterests.length === 0) return res.json({ users: [] });

    // Build exclusion list: self, accepted friends, pending requests
    const accepted = await FriendRequest.find({
      status: 'accepted',
      $or: [ { from: req.user._id }, { to: req.user._id } ]
    }).select('from to');
    const pending = await FriendRequest.find({
      status: 'pending',
      $or: [ { from: req.user._id }, { to: req.user._id } ]
    }).select('from to');
    const exclude = new Set([ String(req.user._id) ]);
    const addEx = (fr) => {
      exclude.add(String(fr.from) === String(req.user._id) ? String(fr.to) : String(fr.from));
    };
    accepted.forEach(addEx); pending.forEach(addEx);

    // Initial candidate fetch: any overlap
    const candidates = await User.find({
      _id: { $nin: Array.from(exclude) },
      interests: { $in: myInterests }
    }).select('_id name email avatarUrl interests').limit(75);

    const mySet = new Set(myInterests);
    const scored = candidates.map(u => {
      const overlap = (u.interests || []).reduce((acc, val) => acc + (mySet.has(val) ? 1 : 0), 0);
      return { user: u, overlap };
    })
    .filter(s => s.overlap > 0)
    .sort((a,b) => b.overlap - a.overlap || a.user.name.localeCompare(b.user.name))
    .slice(0, 15)
    .map(s => ({ _id: s.user._id, name: s.user.name, email: s.user.email, avatarUrl: s.user.avatarUrl, overlap: s.overlap, interests: s.user.interests }));

    res.json({ users: scored });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};
