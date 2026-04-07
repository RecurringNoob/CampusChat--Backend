/**
 * src/auth/middlewares/rate-limit.middleware.js
 *
 * Improvements:
 *  - General auth limiter applied at the router level
 *  - Tighter limiter for OTP endpoints (brute-force protection)
 *
 * A 6-digit OTP has only 1,000,000 possibilities — without rate limiting an
 * attacker could exhaust them in minutes.
 */

import rateLimit from "express-rate-limit";

/** Applied to all /api/auth routes */
export const authLimiter = rateLimit({
  windowMs:         15 * 60 * 1000, // 15 minutes
  max:              60,
  standardHeaders:  true,
  legacyHeaders:    false,
  message: { error: "Too many requests, please try again later.", code: "RATE_LIMITED" },
});

/** Applied only to OTP-related routes */
export const otpLimiter = rateLimit({
  windowMs:         10 * 60 * 1000, // 10 minutes
  max:              5,              // 5 OTP attempts per window
  standardHeaders:  true,
  legacyHeaders:    false,
  message: { error: "Too many OTP attempts, please try again later.", code: "RATE_LIMITED" },
});