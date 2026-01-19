import rateLimit from "express-rate-limit";

const rateLimitDisabled =
  process.env.DISABLE_RATE_LIMIT === "true" ||
  process.env.DISABLE_RATE_LIMIT === "1" ||
  process.env.NODE_ENV !== "production";

const noopLimiter = (_req, _res, next) => next();

// General API limiter
export const apiLimiter = rateLimitDisabled
  ? noopLimiter
  : rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      standardHeaders: true,
      legacyHeaders: false,
      // Explicitly read IP respecting trust proxy setting
      keyGenerator: (req) => req.ip,
    });

// Stricter limiter for auth endpoints
export const authLimiter = rateLimitDisabled
  ? noopLimiter
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 20,
      message: { message: "Too many auth attempts, please try again later" },
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => req.ip,
    });
