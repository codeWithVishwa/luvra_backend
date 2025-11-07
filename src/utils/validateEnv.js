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
}
