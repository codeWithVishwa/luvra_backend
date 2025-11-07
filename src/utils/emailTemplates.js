// Centralized, styled email templates for transactional emails
// Keep styles inline for broad email client support

export const generateVerifyEmailTemplate = (name, link) => `
  <div style="font-family:'Segoe UI',sans-serif;background:#f9f9f9;padding:20px">
    <div style="max-width:600px;margin:auto;background:#fff;border-radius:10px;overflow:hidden;
      box-shadow:0 2px 6px rgba(0,0,0,0.1)">
      <div style="background:#007bff;color:white;text-align:center;padding:16px 0;font-size:20px">
        Welcome to Luvra 💙
      </div>
      <div style="padding:25px;font-size:15px;color:#333">
        <p>Hi <strong>${name || "there"}</strong>,</p>
        <p>Thanks for signing up! Please verify your email by clicking the button below:</p>
        <div style="text-align:center;margin:25px 0;">
          <a href="${link}" style="background:#007bff;color:white;padding:10px 22px;
            text-decoration:none;border-radius:6px;font-weight:600;display:inline-block">Verify Email</a>
        </div>
        <p>If that doesn’t work, copy and paste this link in your browser:</p>
        <p style="background:#f3f3f3;padding:10px;border-radius:5px;word-break:break-all">${link}</p>
        <p style="font-size:13px;color:#666;">This link expires in 24 hours.</p>
      </div>
    </div>
  </div>
`;

export const generateResetPasswordTemplate = (name, link) => `
  <div style="font-family:'Segoe UI',sans-serif;background:#f9f9f9;padding:20px">
    <div style="max-width:600px;margin:auto;background:#fff;border-radius:10px;overflow:hidden;
      box-shadow:0 2px 6px rgba(0,0,0,0.1)">
      <div style="background:#ff9800;color:white;text-align:center;padding:16px 0;font-size:20px">
        Reset your password
      </div>
      <div style="padding:25px;font-size:15px;color:#333">
        <p>Hi <strong>${name || "there"}</strong>,</p>
        <p>We received a request to reset your password. Click the button below to set a new password:</p>
        <div style="text-align:center;margin:25px 0;">
          <a href="${link}" style="background:#ff9800;color:white;padding:10px 22px;
            text-decoration:none;border-radius:6px;font-weight:600;display:inline-block">Reset Password</a>
        </div>
        <p>If the button doesn’t work, copy and paste this link in your browser:</p>
        <p style="background:#f3f3f3;padding:10px;border-radius:5px;word-break:break-all">${link}</p>
        <p style="font-size:13px;color:#666;">This link expires in 1 hour. If you didn’t request this, you can safely ignore this email.</p>
      </div>
    </div>
  </div>
`;
