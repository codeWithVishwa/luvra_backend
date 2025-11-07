import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
  gender: { type: String },
  avatarUrl: { type: String, default: null },
    interests: [String],
    honorScore: { type: Number, default: 50 },
    verified: { type: Boolean, default: false },
    // Email verification
    emailVerificationToken: { type: String, default: null }, // stored as sha256 hash
    emailVerificationExpires: { type: Date, default: null },
    // Password reset
    passwordResetToken: { type: String, default: null }, // stored as sha256 hash
    passwordResetExpires: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);
