import express from "express";
import auth from "../middleware/auth.js";
import { uploadMedia } from "../middleware/upload.js";
import {
  createPost,
  addComment,
  deleteComment,
  deletePost,
  likePost,
  listPostComments,
  listFeedPosts,
  listUserPosts,
  unlikePost,
  uploadPostMedia,
  updatePostSettings,
} from "../controllers/posts.controller.js";

const router = express.Router();

router.post("/media", auth, uploadMedia.single("media"), uploadPostMedia);
router.post("/", auth, createPost);
router.get("/feed", auth, listFeedPosts);
router.get("/user/:userId", auth, listUserPosts);
router.post("/:postId/like", auth, likePost);
router.delete("/:postId/like", auth, unlikePost);
router.get("/:postId/comments", auth, listPostComments);
router.post("/:postId/comments", auth, addComment);
router.delete("/:postId/comments/:commentId", auth, deleteComment);
router.patch("/:postId/settings", auth, updatePostSettings);
router.delete("/:postId", auth, deletePost);

export default router;
