import express from "express";
import auth from "../middleware/auth.js";
import { reportPost } from "../controllers/reports.controller.js";

const router = express.Router();

// Create a report for a post (clip)
router.post("/posts/:postId", auth, reportPost);

export default router;
