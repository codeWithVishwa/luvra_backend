import express from "express";
import auth from "../middleware/auth.js";
import {
	getOrCreateConversation,
	listConversations,
	listMessages,
	sendMessage,
	markRead,
	deleteMessage,
	deleteConversationForUser,
	startChat,
	listMessageRequests,
	acceptMessageRequest,
	rejectMessageRequest,
	uploadChatMedia,
  replyFromNotification,
} from "../controllers/chat.controller.js";
import { uploadMedia } from "../middleware/upload.js";

const router = express.Router();

router.get("/conversations", auth, listConversations);
router.post("/conversations/:userId", auth, getOrCreateConversation);
router.get("/conversations/:conversationId/messages", auth, listMessages);
router.post("/conversations/:conversationId/messages", auth, sendMessage);
router.post("/conversations/:conversationId/media", auth, uploadMedia.single("media"), uploadChatMedia);
router.post("/conversations/:conversationId/read", auth, markRead);
router.delete("/conversations/:conversationId", auth, deleteConversationForUser);
router.delete("/messages/:messageId", auth, deleteMessage);

router.post("/start/:targetUserId", auth, startChat);
router.get("/requests", auth, listMessageRequests);
router.post("/requests/:requesterId/accept", auth, acceptMessageRequest);
router.post("/requests/:requesterId/reject", auth, rejectMessageRequest);

router.post("/reply-from-notification", auth, replyFromNotification);

export default router;
