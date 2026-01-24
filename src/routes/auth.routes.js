import express from "express";
import {
	register,
	login,
	sendVerification,
	verifyEmail,
	verifyEmailOtp,
	forgotPassword,
	resetPassword,
	resetPasswordOtp,
	changePassword,
	requestVaultPinResetOtp,
	verifyVaultPinResetOtp,
	loginWeb,
	refreshWeb,
	logoutWeb,
	smtpHealth,
} from "../controllers/auth.controller.js";
import auth from "../middleware/auth.js";
import { authLimiter } from "../middleware/rateLimit.js";

const router = express.Router();

router.post("/register", authLimiter, register);
router.post("/login", authLimiter, login);
router.post("/send-verification", authLimiter, sendVerification);
router.get("/verify-email", verifyEmail);
router.post("/verify-email-otp", authLimiter, verifyEmailOtp);
router.post("/forgot-password", authLimiter, forgotPassword);
router.post("/reset-password", authLimiter, resetPassword);
router.post("/reset-password-otp", authLimiter, resetPasswordOtp);
router.post("/change-password", auth, changePassword);
router.post("/vault-pin-reset-request", auth, requestVaultPinResetOtp);
router.post("/vault-pin-reset-verify", auth, verifyVaultPinResetOtp);

// Web auth (cookie-based refresh + short-lived access token)
router.post("/web/login", authLimiter, loginWeb);
router.post("/web/refresh", authLimiter, refreshWeb);
router.post("/web/logout", logoutWeb);

router.get("/smtp-health", smtpHealth);

export default router;
