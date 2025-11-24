import express from "express";
import auth from "../middleware/auth.js";
import { uploadMedia } from "../middleware/upload.js";
import {
  createPost,
  deletePost,
  likePost,
  listFeedPosts,
  listUserPosts,
  unlikePost,
  uploadPostMedia,
} from "../controllers/posts.controller.js";

const router = express.Router();

router.post("/media", auth, uploadMedia.single("media"), uploadPostMedia);
router.post("/", auth, createPost);
router.get("/feed", auth, listFeedPosts);
router.get("/user/:userId", auth, listUserPosts);
router.post("/:postId/like", auth, likePost);
router.delete("/:postId/like", auth, unlikePost);
router.delete("/:postId", auth, deletePost);

export default router;
