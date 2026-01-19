export function validateEnv() {
  const required = [
    "MONGO_URI",
    "JWT_SECRET",
    "APP_BASE_URL",
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.warn("[env] Missing required variables:", missing.join(", "));
  }

  // Recommended for browser/web auth (cookie-based refresh tokens)
  if (!process.env.JWT_REFRESH_SECRET) {
    console.warn("[env] JWT_REFRESH_SECRET is not set (recommended for web refresh tokens). Falling back to JWT_SECRET.");
  }
}
