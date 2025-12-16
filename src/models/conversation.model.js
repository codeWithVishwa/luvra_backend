import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema(
  {
    participants: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }],
      validate: {
        validator: (value) => Array.isArray(value) && value.length === 2,
        message: "Direct conversations require exactly two participants",
      },
    },
    directPairKey: { type: String, unique: true },
    sessionKeyVersion: { type: Number, default: 1 },
    lastMessage: {
      type: {
        text: { type: String },
        type: { type: String }, // 'text', 'image', 'video', 'audio', 'post'
        ciphertextPreview: { type: String }, // Legacy field
        sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        at: { type: Date },
      },
      // No default; leave undefined unless explicitly set
    },
    deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

conversationSchema.pre("validate", function (next) {
  if (Array.isArray(this.participants) && this.participants.length === 2) {
    this.directPairKey = this.participants
      .map((id) => id.toString())
      .sort()
      .join(":");
  }
  next();
});

conversationSchema.index({ participants: 1 });
// Unique index already created by `unique: true` on directPairKey; no need to add another.
conversationSchema.index({ updatedAt: -1 });

export default mongoose.model("Conversation", conversationSchema);
