import express from "express";
import {
	register,
	login,
	sendVerification,
	verifyEmail,
	forgotPassword,
	resetPassword,
	changePassword,
} from "../controllers/auth.controller.js";
import auth from "../middleware/auth.js";
import { authLimiter } from "../middleware/rateLimit.js";

const router = express.Router();

router.post("/register", authLimiter, register);
router.post("/login", authLimiter, login);
router.post("/send-verification", authLimiter, sendVerification);
router.get("/verify-email", verifyEmail);
router.post("/forgot-password", authLimiter, forgotPassword);
router.post("/reset-password", authLimiter, resetPassword);
router.post("/change-password", auth, changePassword);

export default router;
