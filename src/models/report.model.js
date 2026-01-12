import mongoose from "mongoose";

const reportSchema = new mongoose.Schema(
  {
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    targetType: { type: String, enum: ["post", "user"], default: "post" },
    post: { type: mongoose.Schema.Types.ObjectId, ref: "Post", default: null },
    reportedUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reason: { type: String, default: "inappropriate" },
    status: { type: String, enum: ["open", "resolved"], default: "open" },
  },
  { timestamps: true }
);

export default mongoose.model("Report", reportSchema);
