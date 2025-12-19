import mongoose from "mongoose";

const reportSchema = new mongoose.Schema(
  {
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    post: { type: mongoose.Schema.Types.ObjectId, ref: "Post", required: true },
    reason: { type: String, default: "inappropriate" },
    status: { type: String, enum: ["open", "resolved"], default: "open" },
  },
  { timestamps: true }
);

export default mongoose.model("Report", reportSchema);
