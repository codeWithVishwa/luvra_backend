import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import User from "../models/user.model.js";
import { sendEmail, buildApiUrl, buildAppUrl } from "../utils/email.js";
import { generateVerifyEmailTemplate, generateResetPasswordTemplate, generateVerifyEmailOtpTemplate, generateResetPasswordOtpTemplate } from "../utils/emailTemplates.js";

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
    <div class="brand">Luvra</div>
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
    if (!name || !email || !password)
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
      return res.status(200).json({ message: "Email already registered but not verified. Verification code resent.", emailAlreadyRegistered: true, user: { _id: existingUser._id, name: existingUser.name, email: existingUser.email, verified: existingUser.verified } });
    }
    const existingName = await User.findOne({ nameLower: name.toLowerCase() }).select('_id');
    if (existingName) return res.status(409).json({ message: "Username already taken" });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashed });

    // Generate OTP for email verification (6-digit)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    user.emailVerificationOTP = otpHash;
    user.emailVerificationOTPExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await user.save();

    sendEmail({
      to: email,
      subject: "Your verification code",
      html: generateVerifyEmailOtpTemplate(name, otp),
    }).catch(e => console.error("Email send failed:", e.message));

    // Important: never return password hashes to client
    const safeUser = { _id: user._id, name: user.name, email: user.email, verified: user.verified };
    res.status(201).json({ message: "Account created successfully. Enter the verification code sent to your email.", user: safeUser, created: true });
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.nameLower) {
      return res.status(409).json({ message: 'Username already taken' });
    }
    res.status(500).json({ error: error.message });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ message: "Invalid credentials" });
    if (!user.verified) {
      return res.status(403).json({ message: "User not verified. Please verify your email." });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
    const safeUser = { _id: user._id, name: user.name, email: user.email, verified: user.verified };
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
  ctaText: "Open Luvra"
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
  ctaText: "Open Luvra"
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
  ctaText: "Open Luvra"
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
