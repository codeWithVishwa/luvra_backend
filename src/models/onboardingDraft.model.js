import mongoose from "mongoose";

const onboardingDraftSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    emailOtpHash: { type: String, default: null },
    emailOtpExpires: { type: Date, default: null },
    emailVerified: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

onboardingDraftSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("OnboardingDraft", onboardingDraftSchema);

