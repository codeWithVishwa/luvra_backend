import nodemailer from "nodemailer";

// Create a reusable transporter using SMTP details from env
let transporter;
let usingEthereal = false;
async function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    // Dev-friendly fallback: create a disposable Ethereal account
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    usingEthereal = true;
    console.warn("[mail] SMTP env not set. Using Ethereal test account for development.");
    return transporter;
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465, // true for 465, false for other ports
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    pool: true,
    maxConnections: 3,
    maxMessages: 50,
  });
  return transporter;
}

export async function sendEmail({ to, subject, html, text }) {
  if (String(process.env.DEV_EMAIL_DISABLE).toLowerCase() === 'true') {
    console.log(`[mail] DEV_EMAIL_DISABLE=true, skipping email to ${to} (${subject})`);
    return;
  }
  const from = process.env.SMTP_FROM || `no-reply@${new URL(process.env.APP_BASE_URL || 'http://localhost').hostname}`;
  const tx = await getTransporter();
  const info = await tx.sendMail({ from, to, subject, html, text }).catch(err => {
    console.error('[mail] sendMail error:', err.message);
    throw err;
  });
  if (usingEthereal) {
    const preview = nodemailer.getTestMessageUrl(info);
    if (preview) {
      console.log(`[mail] Preview URL: ${preview}`);
    }
  }
}

export function buildAppUrl(path) {
  const base = process.env.FRONTEND_URL || process.env.APP_BASE_URL || "http://localhost:5173";
  return base.replace(/\/$/, "") + path;
}

export function buildApiUrl(path) {
  const base = process.env.APP_BASE_URL || "http://localhost:5000";
  return base.replace(/\/$/, "") + path;
}
