import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, trim: true },
    type: { type: String, enum: ["text", "image", "video", "audio"], default: "text" },
    mediaUrl: { type: String, default: null },
    thumbUrl: { type: String, default: null }, // For image/video thumbnail
    mediaDuration: { type: Number, default: null }, // seconds for audio/video
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    deleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

messageSchema.index({ conversation: 1, createdAt: -1 });

export default mongoose.model("Message", messageSchema);
