/**
 * src/env.validate.js
 *
 * Fail fast if any required environment variable is missing.
 * Import this as the very first line of index.js.
 */

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

if (missing.length > 0) {
  console.error(`❌ Missing required environment variables:\n  ${missing.join("\n  ")}`);
  process.exit(1);
}