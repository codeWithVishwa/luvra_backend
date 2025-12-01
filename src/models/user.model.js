import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
  gender: { type: String },
  avatarUrl: { type: String, default: null },
  isPrivate: { type: Boolean, default: false },
  followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  followRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  messageRequests: [
    {
      from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      createdAt: { type: Date, default: Date.now },
    },
  ],
  encryptionPublicKey: { type: String, default: null },
  bio: { type: String, trim: true, maxlength: 300 },
    interests: [String],
    honorScore: { type: Number, default: 50 },
    verified: { type: Boolean, default: false },
    // Email verification
    emailVerificationToken: { type: String, default: null }, // stored as sha256 hash
    emailVerificationExpires: { type: Date, default: null },
    // Email verification via OTP (numeric code hashed)
    emailVerificationOTP: { type: String, default: null }, // sha256 hash of 6-digit code
    emailVerificationOTPExpires: { type: Date, default: null },
    // Password reset
    passwordResetToken: { type: String, default: null }, // stored as sha256 hash
    passwordResetExpires: { type: Date, default: null },
    // Password reset via OTP
    passwordResetOTP: { type: String, default: null }, // sha256 hash of 6-digit code
    passwordResetOTPExpires: { type: Date, default: null },
    // Lowercase name for uniqueness enforcement (case-insensitive)
    nameLower: { type: String, index: true, unique: true, sparse: true },
    // Presence tracking
    lastActiveAt: { type: Date, default: Date.now, index: true },
    // Users who have liked this profile
    profileLikes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    status:{
      type: String, enum: ["active", "banned", "suspended"], default: 'active'
    }
  },
  { timestamps: true }
);

userSchema.index({ followers: 1 });
userSchema.index({ following: 1 });
userSchema.index({ followRequests: 1 });
userSchema.index({ 'messageRequests.from': 1 });

userSchema.pre('save', function(next) {
  if (this.isModified('name') && typeof this.name === 'string') {
    this.nameLower = this.name.toLowerCase();
  }
  next();
});

export default mongoose.model("User", userSchema);
