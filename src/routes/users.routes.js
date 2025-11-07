import express from "express";
import auth from "../middleware/auth.js";
import { searchUsers, sendFriendRequest, listFriendRequests, respondFriendRequest, listContacts, getProfile, updateProfile, uploadAvatar, listOnlineUsers } from "../controllers/users.controller.js";
import { upload } from "../middleware/upload.js";

const router = express.Router();

router.get("/search", auth, searchUsers);
router.post("/request/:userId", auth, sendFriendRequest);
router.get("/requests", auth, listFriendRequests);
router.post("/requests/:requestId/respond", auth, respondFriendRequest);
router.get("/contacts", auth, listContacts);
router.get("/me", auth, getProfile);
router.patch("/me", auth, updateProfile);
router.post("/me/avatar", auth, upload.single('avatar'), uploadAvatar);
router.get("/online", auth, listOnlineUsers);

export default router;
