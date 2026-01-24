import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema(
  {
    participants: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }],
      validate: {
        validator: function (value) {
          if (!Array.isArray(value)) return false;
          if (this.isGroup) return value.length >= 2;
          return value.length === 2;
        },
        message: "Direct conversations require exactly two participants",
      },
    },
    isGroup: { type: Boolean, default: false },
    name: { type: String, default: null },
    photoUrl: { type: String, default: null },
    admins: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    inviteCode: { type: String, default: null },
    inviteEnabled: { type: Boolean, default: true },
    directPairKey: { type: String, unique: true, sparse: true },
    sessionKeyVersion: { type: Number, default: 1 },
    lastMessage: {
      type: {
        text: { type: String },
        msgType: { type: String }, // 'text', 'image', 'video', 'audio', 'post'
        ciphertextPreview: { type: String }, // Legacy field
        sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        at: { type: Date },
      },
    },
    deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    clearedFor: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        clearedAt: { type: Date, required: true },
      }
    ],
  },
  { timestamps: true }
);

conversationSchema.pre("validate", function (next) {
  if (!this.isGroup && Array.isArray(this.participants) && this.participants.length === 2) {
    this.directPairKey = this.participants
      .map((id) => id.toString())
      .sort()
      .join(":");
  } else {
    this.directPairKey = null;
  }
  next();
});

conversationSchema.index({ participants: 1 });
conversationSchema.index({ inviteCode: 1 }, { unique: true, sparse: true });
// Unique index already created by `unique: true` on directPairKey; no need to add another.
conversationSchema.index({ updatedAt: -1 });

export default mongoose.model("Conversation", conversationSchema);
