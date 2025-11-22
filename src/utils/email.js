import nodemailer from "nodemailer";

let lastErrorLogTs = 0;
function logMailErrorOnce(msg) {
  const now = Date.now();
  if (now - lastErrorLogTs > 60000) { // at most once per minute
    console.error(msg);
    lastErrorLogTs = now;
  }
}

// Create a reusable transporter using SMTP details from env
let transporter;
let usingEthereal = false;
let verifyAttempted = false;
let fallbackActive = false;
async function createEtherealTransport() {
  const testAccount = await nodemailer.createTestAccount();
  transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: { user: testAccount.user, pass: testAccount.pass },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 8000,
  });
  usingEthereal = true;
  fallbackActive = true;
  console.warn('[mail] Using Ethereal fallback transporter.');
  return transporter;
}

async function verifyTransporter(tx) {
  try {
    // Race manual timeout vs verify
    await Promise.race([
      tx.verify(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('verify timeout')), 5000))
    ]);
    return true;
  } catch (e) {
    logMailErrorOnce(`[mail] transporter.verify failed: ${e.message}`);
    return false;
  }
}

async function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    return await createEtherealTransport();
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    pool: true,
    maxConnections: 3,
    maxMessages: 50,
  });
  // Attempt verify once; if it fails and fallback allowed, switch
  if (!verifyAttempted) {
    verifyAttempted = true;
    const ok = await verifyTransporter(transporter);
    if (!ok && String(process.env.MAIL_FALLBACK_TO_ETHEREAL).toLowerCase() === 'true') {
      await createEtherealTransport();
    }
  }
  return transporter;
}

export async function sendEmail({ to, subject, html, text }) {
  if (String(process.env.DEV_EMAIL_DISABLE).toLowerCase() === 'true') {
    console.log(`[mail] DEV_EMAIL_DISABLE=true, skipping email to ${to} (${subject})`);
    return;
  }
  const from = process.env.SMTP_FROM || `no-reply@${new URL(process.env.APP_BASE_URL || 'http://localhost').hostname}`;
  let tx = await getTransporter();
  try {
    const info = await attemptSend({ tx, from, to, subject, html, text });
    if (usingEthereal) {
      const preview = nodemailer.getTestMessageUrl(info);
      if (preview) console.log(`[mail] Preview URL: ${preview}`);
    }
  } catch (err) {
    logMailErrorOnce(`[mail] sendMail error: ${err.message}`);
    const isTimeout = /timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|ECONNECTION/i.test(err.code || err.message || '') || err.message.includes('Connection timeout');
    const allowAutoFallback = !usingEthereal && (String(process.env.MAIL_FALLBACK_TO_ETHEREAL).toLowerCase() === 'true' || isTimeout);
    if (allowAutoFallback) {
      console.warn('[mail] Switching to Ethereal fallback due to SMTP failure.');
      tx = await createEtherealTransport();
      try {
        const info2 = await attemptSend({ tx, from, to, subject, html, text });
        const preview2 = nodemailer.getTestMessageUrl(info2);
        if (preview2) console.log(`[mail] Fallback preview URL: ${preview2}`);
      } catch (e2) {
        logMailErrorOnce(`[mail] fallback send failed: ${e2.message}`);
      }
    }
  }
}

async function attemptSend({ tx, from, to, subject, html, text }) {
  const debug = String(process.env.MAIL_DEBUG).toLowerCase() === 'true';
  const payload = { from, to, subject, html, text };
  if (debug) console.log('[mail] attemptSend payload:', { to, subject, htmlLength: html?.length });
  try {
    return await tx.sendMail(payload);
  } catch (e) {
    // One retry after short delay for transient timeouts
    const transient = /ETIMEDOUT|ECONNRESET|ECONNECTION|EHOSTUNREACH|timeout/i.test(e.code || e.message || '');
    if (transient) {
      if (debug) console.log('[mail] transient error, retrying once:', e.message);
      await new Promise(r => setTimeout(r, 800));
      return await tx.sendMail(payload);
    }
    throw e;
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
