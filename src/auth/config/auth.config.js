// src/config/env.js
import dotenv from "dotenv";

// Load .env in development only (production uses system env)
if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

const REQUIRED = [
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "MONGO_URI",
  "RESEND_API_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_CALLBACK_URL",
  "FRONTEND_URL",
];

const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`❌ Missing required env variables:\n  ${missing.join("\n  ")}`);
  process.exit(1);
}

// Optional with defaults
const ALLOWED_EMAIL_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS ?? "lnmiit.ac.in")
  .split(",")
  .map((d) => d.trim().toLowerCase());

export const authConfig = {
  // Server
  port: process.env.PORT ?? 5000,
  frontendUrl: process.env.FRONTEND_URL,

  // MongoDB
  mongoUri: process.env.MONGO_URI,

  // JWT
  jwt: {
    accessSecret: process.env.JWT_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiresIn: "3d",
    refreshExpiresIn: "7d",
  },

  // OTP
  otp: {
    expiresInMinutes: 10,
  },

  // Domain restriction
  allowedEmailDomains: ALLOWED_EMAIL_DOMAINS,

  // Google OAuth
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl: process.env.GOOGLE_CALLBACK_URL,
  },

  // Resend (email)
  resendApiKey: process.env.RESEND_API_KEY,
};