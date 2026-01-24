import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import User from "../models/user.model.js";
import { sendEmail, buildApiUrl, buildAppUrl, getEmailHealth } from "../utils/email.js";
import { generateVerifyEmailTemplate, generateResetPasswordTemplate, generateVerifyEmailOtpTemplate, generateResetPasswordOtpTemplate, generateVaultPinResetOtpTemplate } from "../utils/emailTemplates.js";
import { suggestUsernames } from "../utils/nameSuggestions.js";

function getWebAuthConfig() {
  return {
    accessTtl: process.env.JWT_ACCESS_TTL || "24h",
    refreshDays: Number(process.env.JWT_REFRESH_DAYS || 30),
    refreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    refreshCookieName: process.env.JWT_REFRESH_COOKIE_NAME || "refresh_token",
    refreshCookiePath: process.env.JWT_REFRESH_COOKIE_PATH || "/api/v1/auth/web",
    refreshMaxSessions: Number(process.env.JWT_REFRESH_MAX_SESSIONS || 10),
  };
}

function isProd() {
  return process.env.NODE_ENV === "production";
}

function isHttpsRequest(req) {
  if (!req) return false;
  if (req.secure) return true;
  const xfProto = (req.headers?.['x-forwarded-proto'] || '').toString().toLowerCase();
  if (xfProto === 'https') return true;
  return false;
}

function getWebRefreshCookieOptions(req) {
  const { refreshDays, refreshCookiePath } = getWebAuthConfig();
  const prod = isProd();
  const isHttps = isHttpsRequest(req);

  // In local dev over plain HTTP, SameSite=None cookies will be rejected by the browser (requires Secure).
  // Force a dev-friendly cookie that will actually be stored/sent.
  const defaultSameSite = prod ? 'none' : 'lax';
  const configuredSameSite = (process.env.JWT_REFRESH_COOKIE_SAMESITE || defaultSameSite).toString().toLowerCase();
  const normalizedSameSite = configuredSameSite === 'strict' ? 'strict' : configuredSameSite === 'none' ? 'none' : 'lax';

  const normalizedSecure = prod ? true : isHttps;
  const effectiveSameSite = (!prod && !isHttps && normalizedSameSite === 'none') ? 'lax' : normalizedSameSite;

  const domain = process.env.JWT_REFRESH_COOKIE_DOMAIN || undefined;

  return {
    httpOnly: true,
    secure: normalizedSecure,
    sameSite: effectiveSameSite,
    path: refreshCookiePath,
    domain,
    maxAge: refreshDays * 24 * 60 * 60 * 1000,
  };
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function newJti() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

function signWebAccessToken(userId) {
  const { accessTtl } = getWebAuthConfig();
  return jwt.sign({ id: userId, typ: "access" }, process.env.JWT_SECRET, { expiresIn: accessTtl });
}

function signWebRefreshToken(userId) {
  const { refreshDays, refreshSecret } = getWebAuthConfig();
  return jwt.sign({ id: userId, typ: "refresh", jti: newJti() }, refreshSecret, { expiresIn: `${refreshDays}d` });
}

function safeUserShape(user) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    verified: user.verified,
    isVerified: !!user.isVerified,
    verificationType: user.verificationType || null,
    nickname: user.nickname,
    avatarUrl: user.avatarUrl || null,
    isPrivate: !!user.isPrivate,
  };
}

const htmlPage = ({ title, heading, body, success, ctaLink, ctaText }) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
  <style>
    :root { color-scheme: dark; }
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 0; padding: 24px; display: grid; place-items: center; min-height: 100vh; background: radial-gradient(1000px 600px at 10% -10%, #1f2937 20%, transparent), radial-gradient(800px 500px at 110% 10%, #0b1020 10%, transparent), linear-gradient(160deg, #0b0f19, #0b0f19); color: #e5e7eb; }
    .shell { width: 100%; max-width: 640px; }
    .brand { background: linear-gradient(135deg, #7c3aed, #2563eb); color:#fff; border-radius: 14px 14px 0 0; padding: 14px 18px; font-weight: 700; letter-spacing: .3px; box-shadow: 0 6px 18px rgba(37,99,235,0.35); }
    .card { background:#0f172a; border:1px solid #1f2937; border-top: none; border-radius: 0 0 14px 14px; box-shadow: 0 20px 50px rgba(0,0,0,0.45); padding: 26px; }
    .icon { display:flex; align-items:center; justify-content:center; width:64px; height:64px; border-radius:50%; margin-bottom: 12px; background: ${success ? "#052e1c" : "#2a0a0a"}; border: 1px solid ${success ? "#064e3b" : "#7f1d1d"}; }
    .icon svg { width: 32px; height: 32px; fill: ${success ? "#10b981" : "#ef4444"}; }
    h1 { margin: 6px 0 10px; font-size: 24px; color: #e5e7eb; }
    p { margin: 0 0 10px; line-height: 1.6; color: #cbd5e1; }
    .status { margin: 0 0 6px; font-weight: 700; color: ${success ? "#10b981" : "#ef4444"}; text-transform: uppercase; font-size: 13px; letter-spacing: .4px; }
    .actions { margin-top: 16px; }
    .btn { display:inline-block; padding: 10px 16px; border-radius: 8px; background: ${success ? "#10b981" : "#ef4444"}; color: #0b0f19 !important; text-decoration: none; font-weight:700; box-shadow: 0 8px 18px rgba(16,185,129,0.25); }
    .btn:hover { filter: brightness(1.05); }
    .muted { color: #94a3b8; font-size: 13px; margin-top: 14px; }
  </style>
  <meta name="color-scheme" content="dark" />
</head>
<body>
  <div class="shell">
    <div class="brand">Flowsnap</div>
    <main class="card" role="main">
      <div class="icon" aria-hidden="true">
        ${success
          ? '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>'
          : '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>'}
      </div>
      <div class="status">${success ? "Success" : "Error"}</div>
      <h1>${heading}</h1>
      <p>${body}</p>
      ${ctaLink ? `<div class="actions"><a class="btn" href="${ctaLink}">${ctaText || "Open App"}</a></div>` : ""}
      <p class="muted">You may safely close this tab and return to the app.</p>
    </main>
  </div>
  
</body>
</html>`;

export const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const cleanName = (name || '').trim();
    if (!cleanName || !email || !password)
      return res.status(400).json({ message: "All fields are required" });
    if (password.length < 8)
      return res.status(400).json({ message: "Password must be at least 8 characters long" });
    if (!/\S+@\S+\.\S+/.test(email))
      return res.status(400).json({ message: "Invalid email format" });
    // Check if email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      // If verified, instruct to login
      if (existingUser.verified) {
        return res.status(400).json({ message: "Email already registered. Please log in." });
      }
      // If not verified: resend OTP and return a flag indicating redirect to OTP page
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
      existingUser.emailVerificationOTP = otpHash;
      existingUser.emailVerificationOTPExpires = new Date(Date.now() + 10 * 60 * 1000);
      await existingUser.save();
      // Fire & forget email (do not block response)
      sendEmail({
        to: email,
        subject: "Your verification code",
        html: generateVerifyEmailOtpTemplate(existingUser.name || name, otp),
      }).catch(e => console.error("Email resend failed:", e.message));
      return res.status(200).json({ message: "Email already registered but not verified. Verification code resent.", emailAlreadyRegistered: true, user: { _id: existingUser._id, name: existingUser.name, email: existingUser.email, verified: existingUser.verified, nickname: existingUser.nickname } });
    }
    const existingName = await User.findOne({ nameLower: cleanName.toLowerCase() }).select('_id');
    if (existingName) {
      const suggestions = await suggestUsernames(cleanName);
      return res.status(409).json({ message: "Username already taken", suggestions });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name: cleanName, email, password: hashed });

    // Generate OTP for email verification (6-digit)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    user.emailVerificationOTP = otpHash;
    user.emailVerificationOTPExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await user.save();

    sendEmail({
      to: email,
      subject: "Your verification code",
      html: generateVerifyEmailOtpTemplate(cleanName, otp),
    }).catch(e => console.error("Email send failed:", e.message));

    // Important: never return password hashes to client
    const safeUser = { _id: user._id, name: user.name, email: user.email, verified: user.verified, nickname: user.nickname };
    res.status(201).json({ message: "Account created successfully. Enter the verification code sent to your email.", user: safeUser, created: true });
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.nameLower) {
      const suggestions = await suggestUsernames(req.body?.name);
      return res.status(409).json({ message: 'Username already taken', suggestions });
    }
    res.status(500).json({ error: error.message });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.status === "suspended") {
      return res.status(403).json({ message: "Your account has been suspended due to a violation of our policies." });
    }
    if (user.status === "banned") {
      return res.status(403).json({ message: "Your account has been permanently banned for violating our policies." });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ message: "Invalid credentials" });
    if (!user.verified) {
      // Generate (or refresh) OTP for email verification
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
      user.emailVerificationOTP = otpHash;
      user.emailVerificationOTPExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
      await user.save();
      // Fire & forget email send so login response is not blocked
      sendEmail({
        to: user.email,
        subject: "Your verification code",
        html: generateVerifyEmailOtpTemplate(user.name, otp),
      }).catch(e => console.error("[login] Verification email send failed:", e.message));
      const safeUser = { _id: user._id, name: user.name, email: user.email, verified: user.verified, nickname: user.nickname };
      return res.status(200).json({ requiresEmailVerification: true, message: "Email not verified. Verification code sent.", user: safeUser });
    }

    // Track last login ip + activity (best-effort, never block login)
    const ipHeader = (req.headers['x-forwarded-for'] || '').toString();
    const forwardedIp = ipHeader.split(',')[0]?.trim();
    const ip = forwardedIp || req.ip || null;
    user.lastIp = ip;
    user.lastLoginAt = new Date();
    user.lastActiveAt = new Date();
    user.save().catch(() => {});

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
    const safeUser = { _id: user._id, name: user.name, email: user.email, verified: user.verified, nickname: user.nickname };
    return res.status(200).json({ token, user: safeUser });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const sendVerification = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.verified) return res.status(400).json({ message: "Email already verified" });

    // Generate new OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    user.emailVerificationOTP = otpHash;
    user.emailVerificationOTPExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    // Invalidate any previous token-based verification
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;
    await user.save();

    sendEmail({
      to: email,
      subject: "Your verification code",
      html: generateVerifyEmailOtpTemplate(user.name, otp),
    }).catch(e => console.error("Email send failed:", e.message));

    res.status(200).json({ message: "Verification code sent" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const verifyEmail = async (req, res) => {
  try {
    const { token, email } = req.query;
    if (!token || !email) {
      res.status(400).set("Content-Type", "text/html").send(htmlPage({
        title: "Verification error",
        heading: "Missing token or email",
        body: "Please use the link provided in your email.",
        success: false,
  ctaLink: buildAppUrl("/"),
  ctaText: "Open Flowsnap"
      }));
      return;
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      email,
      emailVerificationToken: tokenHash,
      emailVerificationExpires: { $gt: new Date() },
    });

    if (!user) {
      res.status(400).set("Content-Type", "text/html").send(htmlPage({
        title: "Verification failed",
        heading: "Invalid or expired verification link",
        body: "Your verification link is invalid or has expired. Please request a new verification email.",
        success: false,
  ctaLink: buildAppUrl("/"),
  ctaText: "Open Flowsnap"
      }));
      return;
    }

    user.verified = true;
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;
    await user.save();

    res.status(200).set("Content-Type", "text/html").send(htmlPage({
      title: "Email verified",
      heading: "Email verified successfully",
      body: "Thanks! Your email has been verified. You can return to the app and log in.",
      success: true,
      ctaLink: buildAppUrl("/login"),
      ctaText: "Go to Login"
    }));
  } catch (error) {
    res.status(500).set("Content-Type", "text/html").send(htmlPage({
      title: "Server error",
      heading: "Something went wrong",
      body: "Please try again later.",
      success: false,
  ctaLink: buildAppUrl("/"),
  ctaText: "Open Flowsnap"
    }));
  }
};

// OTP-based email verification (JSON response, mobile friendly)
export const verifyEmailOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ message: "Email and OTP code are required" });
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.verified) return res.status(400).json({ message: "Email already verified" });
    if (!user.emailVerificationOTP || !user.emailVerificationOTPExpires) {
      return res.status(400).json({ message: "No active verification code. Request a new one." });
    }
    if (user.emailVerificationOTPExpires < new Date()) {
      return res.status(400).json({ message: "Verification code expired. Request a new one." });
    }
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    if (otpHash !== user.emailVerificationOTP) {
      return res.status(400).json({ message: "Invalid verification code" });
    }
    user.verified = true;
    user.emailVerificationOTP = null;
    user.emailVerificationOTPExpires = null;
    await user.save();
    const safeUser = { _id: user._id, name: user.name, email: user.email, verified: user.verified };
    res.status(200).json({ message: "Email verified successfully", user: safeUser });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });
    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    user.passwordResetOTP = otpHash;
    user.passwordResetOTPExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    // Invalidate old token-based reset if present
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    await user.save();

    sendEmail({
      to: email,
      subject: "Your password reset code",
      html: generateResetPasswordOtpTemplate(user.name, otp),
    }).catch(e => console.error("[forgotPassword] Email send failed:", e.message));

    res.status(200).json({ message: "Password reset code sent" });
  } catch (error) {
    console.error('[forgotPassword] Unexpected error:', error);
    res.status(500).json({ message: 'Failed to process password reset request' });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { token, email } = req.query;
    const { password } = req.body;
    if (!token || !email)
      return res.status(400).json({ message: "Token and email are required" });
    if (!password || password.length < 8)
      return res.status(400).json({ message: "Password must be at least 8 characters long" });

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      email,
      passwordResetToken: tokenHash,
      passwordResetExpires: { $gt: new Date() },
    });
    if (!user)
      return res.status(400).json({ message: "Invalid or expired reset token" });

    const hashed = await bcrypt.hash(password, 10);
    user.password = hashed;
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    await user.save();

    res.status(200).json({ message: "Password reset successful" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// OTP-based password reset
export const resetPasswordOtp = async (req, res) => {
  try {
    const { email, otp, password } = req.body;
    if (!email || !otp || !password) return res.status(400).json({ message: "Email, OTP and new password are required" });
    if (password.length < 8) return res.status(400).json({ message: "Password must be at least 8 characters long" });
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (!user.passwordResetOTP || !user.passwordResetOTPExpires) return res.status(400).json({ message: "No active reset code. Request a new one." });
    if (user.passwordResetOTPExpires < new Date()) return res.status(400).json({ message: "Reset code expired. Request a new one." });
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    if (otpHash !== user.passwordResetOTP) return res.status(400).json({ message: "Invalid reset code" });
    const hashed = await bcrypt.hash(password, 10);
    user.password = hashed;
    user.passwordResetOTP = null;
    user.passwordResetOTPExpires = null;
    await user.save();
    res.status(200).json({ message: "Password reset successful" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const changePassword = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({ message: "Current and new password are required" });
    if (newPassword.length < 8)
      return res.status(400).json({ message: "Password must be at least 8 characters long" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.status(400).json({ message: "Current password is incorrect" });

    const same = await bcrypt.compare(newPassword, user.password);
    if (same) return res.status(400).json({ message: "New password must be different from the current password" });

    const hashed = await bcrypt.hash(newPassword, 10);
    user.password = hashed;
    await user.save();

    res.status(200).json({ message: "Password changed successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Vault PIN reset via OTP (requires auth)
export const requestVaultPinResetOtp = async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (!user.email) return res.status(400).json({ message: "Email is required to reset vault PIN" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    user.vaultPinResetOTP = otpHash;
    user.vaultPinResetOTPExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    sendEmail({
      to: user.email,
      subject: "Your Message Vault PIN reset code",
      html: generateVaultPinResetOtpTemplate(user.name, otp),
    }).catch(e => console.error("[vaultPinReset] Email send failed:", e.message));

    res.status(200).json({ message: "Vault PIN reset code sent" });
  } catch (error) {
    res.status(500).json({ message: "Failed to send vault PIN reset code" });
  }
};

export const verifyVaultPinResetOtp = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { otp } = req.body;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    if (!otp) return res.status(400).json({ message: "OTP code is required" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (!user.vaultPinResetOTP || !user.vaultPinResetOTPExpires) {
      return res.status(400).json({ message: "No active reset code. Request a new one." });
    }
    if (user.vaultPinResetOTPExpires < new Date()) {
      return res.status(400).json({ message: "Reset code expired. Request a new one." });
    }

    const otpHash = crypto.createHash("sha256").update(String(otp)).digest("hex");
    if (otpHash !== user.vaultPinResetOTP) {
      return res.status(400).json({ message: "Invalid reset code" });
    }

    user.vaultPinResetOTP = null;
    user.vaultPinResetOTPExpires = null;
    await user.save();

    res.status(200).json({ message: "Vault PIN reset verified" });
  } catch (error) {
    res.status(500).json({ message: "Failed to verify vault PIN reset" });
  }
};

export const smtpHealth = async (req, res) => {
  try {
    const health = getEmailHealth();
    res.status(200).json({ ok: true, health });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};

// -------------------------
// Web-friendly auth (cookies)
// -------------------------

export const loginWeb = async (req, res) => {
  try {
    const { refreshDays, refreshCookieName, refreshMaxSessions } = getWebAuthConfig();
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.status === "suspended") {
      return res.status(403).json({ message: "Your account has been suspended due to a violation of our policies." });
    }
    if (user.status === "banned") {
      return res.status(403).json({ message: "Your account has been permanently banned for violating our policies." });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ message: "Invalid credentials" });

    if (!user.verified) {
      // Generate (or refresh) OTP for email verification
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
      user.emailVerificationOTP = otpHash;
      user.emailVerificationOTPExpires = new Date(Date.now() + 10 * 60 * 1000);
      await user.save();
      sendEmail({
        to: user.email,
        subject: "Your verification code",
        html: generateVerifyEmailOtpTemplate(user.name, otp),
      }).catch((e) => console.error("[loginWeb] Verification email send failed:", e.message));
      return res.status(200).json({ requiresEmailVerification: true, message: "Email not verified. Verification code sent.", user: safeUserShape(user) });
    }

    const accessToken = signWebAccessToken(user._id);
    const refreshToken = signWebRefreshToken(user._id);

    const tokenHash = hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);
    const userAgent = req.get("user-agent") || null;

    // Use atomic update to avoid Mongoose VersionError when other endpoints update the user concurrently
    await User.updateOne(
      { _id: user._id },
      {
        $push: {
          refreshTokens: {
            $each: [{ tokenHash, expiresAt, userAgent }],
            $slice: -refreshMaxSessions,
          },
        },
      }
    );

    res.cookie(refreshCookieName, refreshToken, getWebRefreshCookieOptions(req));
    return res.status(200).json({ accessToken, user: safeUserShape(user) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const refreshWeb = async (req, res) => {
  try {
    const { refreshCookieName, refreshDays, refreshMaxSessions, refreshSecret } = getWebAuthConfig();
    const refreshToken = req.cookies?.[refreshCookieName];
    if (!refreshToken) return res.status(401).json({ message: "Missing refresh token" });

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, refreshSecret);
    } catch {
      res.clearCookie(refreshCookieName, getWebRefreshCookieOptions(req));
      return res.status(401).json({ message: "Invalid refresh token" });
    }

    if (!decoded || decoded.typ !== "refresh" || !decoded.id) {
      res.clearCookie(refreshCookieName, getWebRefreshCookieOptions(req));
      return res.status(401).json({ message: "Invalid refresh token" });
    }

    const user = await User.findById(decoded.id).select("_id refreshTokens");
    if (!user) {
      res.clearCookie(refreshCookieName, getWebRefreshCookieOptions(req));
      return res.status(401).json({ message: "Invalid refresh token" });
    }

    const tokenHash = hashToken(refreshToken);
    const now = new Date();
    const refreshTokens = Array.isArray(user.refreshTokens) ? user.refreshTokens : [];
    const existingIndex = refreshTokens.findIndex((t) => t.tokenHash === tokenHash);
    if (existingIndex === -1) {
      res.clearCookie(refreshCookieName, getWebRefreshCookieOptions(req));
      return res.status(401).json({ message: "Refresh token not recognized" });
    }

    const existing = refreshTokens[existingIndex];
    if (existing?.expiresAt && existing.expiresAt < now) {
      await User.updateOne(
        { _id: user._id },
        { $pull: { refreshTokens: { tokenHash } } }
      ).catch(() => {});
      res.clearCookie(refreshCookieName, getWebRefreshCookieOptions(req));
      return res.status(401).json({ message: "Refresh token expired" });
    }

    // Rotate refresh token
    const newRefreshToken = signWebRefreshToken(user._id);
    const newTokenHash = hashToken(newRefreshToken);
    const newExpiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);
    const userAgent = req.get("user-agent") || null;

    // Atomic update avoids version conflicts with concurrent user updates (e.g., push token updates)
    // NOTE: MongoDB forbids updating the same path in multiple operators in one update
    // (e.g., $pull + $push on refreshTokens). Use a single pipeline update instead.
    const rotated = await User.updateOne(
      {
        _id: user._id,
        refreshTokens: {
          $elemMatch: {
            tokenHash,
            ...(existing?.expiresAt ? { expiresAt: { $gte: now } } : {}),
          },
        },
      },
      [
        {
          $set: {
            refreshTokens: {
              $let: {
                vars: {
                  filtered: {
                    $filter: {
                      input: { $ifNull: ["$refreshTokens", []] },
                      as: "t",
                      cond: { $ne: ["$$t.tokenHash", tokenHash] },
                    },
                  },
                },
                in: {
                  $slice: [
                    {
                      $concatArrays: [
                        "$$filtered",
                        [{ tokenHash: newTokenHash, expiresAt: newExpiresAt, userAgent }],
                      ],
                    },
                    -refreshMaxSessions,
                  ],
                },
              },
            },
          },
        },
      ]
    );

    if (!rotated?.modifiedCount) {
      // Another request likely already rotated/removed this refresh token
      res.clearCookie(refreshCookieName, getWebRefreshCookieOptions(req));
      return res.status(401).json({ message: "Refresh token not recognized" });
    }

    const accessToken = signWebAccessToken(user._id);
    res.cookie(refreshCookieName, newRefreshToken, getWebRefreshCookieOptions(req));
    return res.status(200).json({ accessToken });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const logoutWeb = async (req, res) => {
  try {
    const { refreshCookieName } = getWebAuthConfig();
    const refreshToken = req.cookies?.[refreshCookieName];
    if (refreshToken) {
      const tokenHash = hashToken(refreshToken);
      await User.updateOne(
        { refreshTokens: { $elemMatch: { tokenHash } } },
        { $pull: { refreshTokens: { tokenHash } } }
      ).catch(() => {});
    }
    res.clearCookie(refreshCookieName, getWebRefreshCookieOptions(req));
    return res.status(200).json({ ok: true });
  } catch (error) {
    const { refreshCookieName } = getWebAuthConfig();
    res.clearCookie(refreshCookieName, getWebRefreshCookieOptions(req));
    res.status(500).json({ error: error.message });
  }
};
