/**
 * src/auth/auth.controller.js
 *
 * Improvements:
 *  - googleCallback uses httpOnly cookies for the refresh token instead of
 *    exposing it in the redirect URL (tokens in query strings appear in logs,
 *    browser history, and Referer headers)
 *  - accessToken still goes in the URL fragment so the frontend SPA can pick
 *    it up without a round-trip, but the sensitive refresh token is in a cookie
 */

import * as authService           from "../services/auth.service.js";
import { rotateRefreshToken }     from "../services/token.service.js";

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

const ERROR_STATUS = {
  DOMAIN_NOT_ALLOWED:    403,
  EMAIL_EXISTS:          409,
  INVALID_CREDENTIALS:   401,
  EMAIL_NOT_VERIFIED:    403,
  USE_OAUTH:             400,
  OTP_INVALID:           400,
  OTP_EXPIRED:           400,
  OTP_NOT_FOUND:         400,
  USER_NOT_FOUND:        404,
  ALREADY_VERIFIED:      400,
  REFRESH_TOKEN_INVALID: 401,
};

export const errorHandler = (err, _req, res, _next) => {
  const status = ERROR_STATUS[err.code] ?? 500;
  res.status(status).json({ error: err.message, code: err.code ?? "INTERNAL_ERROR" });
};

export const register = wrap(async (req, res) => {
  await authService.register(req.body);
  res.status(201).json({ message: "Registered. Check your email for the OTP." });
});

export const verifyEmail = wrap(async (req, res) => {
  const tokens = await authService.verifyEmail(req.body);
  _sendTokens(res, tokens);
});

export const login = wrap(async (req, res) => {
  const tokens = await authService.login(req.body);
  _sendTokens(res, tokens);
});

export const refresh = wrap(async (req, res) => {
  // Support both cookie-based and body-based refresh tokens for flexibility
  const refreshToken = req.cookies?.refreshToken ?? req.body?.refreshToken;
  if (!refreshToken) return res.status(400).json({ error: "refreshToken required" });
  const tokens = await rotateRefreshToken(refreshToken);
  _sendTokens(res, tokens);
});

export const logout = wrap(async (req, res) => {
  await authService.logout(req.user._id);
  res.clearCookie("refreshToken");
  res.json({ message: "Logged out" });
});

export const resendOtp = wrap(async (req, res) => {
  await authService.resendOtp(req.body.email);
  res.json({ message: "OTP resent" });
});

export const getMe = wrap(async (req, res) => {
  res.json(req.user.toProfileJSON());
});

/* ── Google OAuth callbacks ── */
export const googleCallback = wrap(async (req, res) => {
  const { accessToken, refreshToken } = await authService.oauthLogin(req.user._id);

  // Refresh token → httpOnly cookie (never visible to JS)
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days in ms
  });

  // Access token → URL fragment (not query string — fragments aren't sent to servers)
  res.redirect(`${process.env.FRONTEND_URL}/auth/callback#accessToken=${accessToken}`);
});

export const googleFailure = (_req, res) => {
  res.redirect(`${process.env.FRONTEND_URL}/login?error=DOMAIN_NOT_ALLOWED`);
};

/* ── helpers ── */

/**
 * Send access token in the JSON body and refresh token as an httpOnly cookie.
 * This keeps the refresh token out of JS-accessible storage.
 */
const _sendTokens = (res, { accessToken, refreshToken }) => {
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   7 * 24 * 60 * 60 * 1000,
  });
  res.json({ accessToken });
};