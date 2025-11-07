import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import morgan from "morgan";
import helmet from "helmet";
import sanitizeHtml from "sanitize-html";
import connectDB from "./config/db.js";
import http from "http";
import { initSocket } from "./socket.js";
import authRoutes from "./routes/auth.routes.js";
import userRoutes from "./routes/users.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import { validateEnv } from "./utils/validateEnv.js";
import errorHandler from "./middleware/errorHandler.js";
// If you kept express-mongo-sanitize and are on an Express-5-safe version, you can import and use it here.
// import mongoSanitize from "express-mongo-sanitize";

dotenv.config();
const app = express();
validateEnv();

// CORS
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.APP_BASE_URL,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // allow non-browser clients
      if (allowedOrigins.some((o) => origin.startsWith(o))) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// Parse first
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security headers
app.use(helmet());

// Optional: If you use Mongoose, enable filter sanitization at the ORM layer
// import mongoose from "mongoose";
// mongoose.set("sanitizeFilter", true);

// Optional: If you still use express-mongo-sanitize and it's Express-5 safe, enable it here
// app.use(mongoSanitize());

// In-place XSS sanitizer for inputs (mutates; does not reassign req.query/body/params)
function deepSanitizeInPlace(value) {
  if (typeof value === "string") {
    // Strip all HTML; adjust allowlist if you need certain tags/attrs
    return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} });
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const v = value[i];
      const sanitized = deepSanitizeInPlace(v);
      if (sanitized !== v) value[i] = sanitized;
    }
    return value;
  }
  if (value && typeof value === "object") {
    for (const k of Object.keys(value)) {
      const v = value[k];
      const sanitized = deepSanitizeInPlace(v);
      if (sanitized !== v) value[k] = sanitized;
    }
    return value;
  }
  return value;
}

app.use((req, res, next) => {
  // IMPORTANT: only mutate; do not reassign req.query
  deepSanitizeInPlace(req.body);
  deepSanitizeInPlace(req.params);
  deepSanitizeInPlace(req.query);
  next();
});

// Logs and rate limiting
app.use(morgan("dev"));
app.use("/api", apiLimiter);

// Routes
app.use("/api/v1/health", (req, res) => {
  res.status(200).send("API is running");
});
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/chat", chatRoutes);

// Error handler (last)
app.use(errorHandler);

// Start Server after DB connects
const PORT = process.env.PORT || 5000;
async function start() {
  await connectDB();
  const server = http.createServer(app);
  initSocket(server);
  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});