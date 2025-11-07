import express from "express";
import auth from "../middleware/auth.js";
import { getOrCreateConversation, listConversations, listMessages, sendMessage, markRead, sendMediaMessage } from "../controllers/chat.controller.js";
import { uploadMedia } from "../middleware/upload.js";

const router = express.Router();

router.get("/conversations", auth, listConversations);
router.post("/conversations/:userId", auth, getOrCreateConversation);
router.get("/conversations/:conversationId/messages", auth, listMessages);
router.post("/conversations/:conversationId/messages", auth, sendMessage);
router.post("/conversations/:conversationId/media", auth, uploadMedia.single('media'), sendMediaMessage);
router.post("/conversations/:conversationId/read", auth, markRead);

export default router;
