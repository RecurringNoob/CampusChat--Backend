/**
 * src/auth/auth.routes.js
 *
 * Improvements:
 *  - OTP endpoints get their own tighter rate limiter
 */

import { Router }      from "express";
import passport        from "../config/passport.js";
import * as ctrl       from "../controllers/auth.controller.js";
import { protect }     from "../middleware/auth.middleware.js";
import { otpLimiter }  from "../middleware/rate.limit.middleware.js";

const router = Router();

/* ── Email + password ── */
router.post("/register",   ctrl.register);
router.post("/verify-otp", otpLimiter, ctrl.verifyEmail);
router.post("/login",      ctrl.login);
router.post("/refresh",    ctrl.refresh);
router.post("/resend-otp", otpLimiter, ctrl.resendOtp);
router.post("/logout",     protect, ctrl.logout);
router.get("/me",          protect, ctrl.getMe);

/* ── Google OAuth ── */
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"], session: false })
);
router.get(
  "/google/callback",
  passport.authenticate("google", { session: false, failureRedirect: "/api/auth/google/failed" }),
  ctrl.googleCallback
);
router.get("/google/failed", ctrl.googleFailure);

// /ice-config
router.get('/ice-config', protect, (req, res) => {
  res.json({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      {
        urls: [
          process.env.TURN_URL,
          process.env.TURN_URL_TCP,
          process.env.TURN_URL_TLS,
        ],
        username: process.env.TURN_USERNAME,
        credential: process.env.TURN_CREDENTIAL,
      },
    ],
  });
});

export default router;