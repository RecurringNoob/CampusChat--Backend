/**
 * src/auth/services/auth.service.js
 *
 * Improvements:
 *  - Uses `authProvider` field instead of `passwordHash: "oauth"` sentinel
 *  - `register` sets `authProvider: "local"` explicitly
 *  - `login` checks `authProvider` to block OAuth-only accounts
 *  - `oauthLogin` / passport callback sets `authProvider: "google"`
 */

import User                          from "../models/user.model.js";
import { hashPassword, verifyPassword } from "../utils/hash.util.js";
import { isAllowedDomain }           from "../utils/domain.guard.js";
import { sendOtp, verifyOtp }        from "./otp.service.js";
import { signAccessToken, issueRefreshToken, revokeAllTokens } from "./token.service.js";

const err = (msg, code) => Object.assign(new Error(msg), { code });

/* ── Register (email + password) ── */
export const register = async ({ fullName, email, password }) => {
  if (!isAllowedDomain(email))       throw err("Domain not allowed",       "DOMAIN_NOT_ALLOWED");
  if (await User.findOne({ email })) throw err("Email already registered", "EMAIL_EXISTS");

  const passwordHash = await hashPassword(password);
  await User.create({ fullName, email, passwordHash, authProvider: "local", isVerified: false });
  await sendOtp(email);
};

/* ── Verify OTP → issue tokens ── */
export const verifyEmail = async ({ email, code }) => {
  await verifyOtp(email, code);

  const user = await User.findOneAndUpdate(
    { email },
    { isVerified: true },
    { new: true }
  );
  if (!user) throw err("User not found", "USER_NOT_FOUND");

  return _issueTokenPair(user._id);
};

/* ── Login (email + password) ── */
export const login = async ({ email, password }) => {
  const user = await User.findOne({ email }).select("+passwordHash");
  if (!user) throw err("Invalid credentials", "INVALID_CREDENTIALS");

  // Block OAuth-only accounts from password login
  if (user.authProvider !== "local")
    throw err(`This account uses ${user.authProvider} login`, "USE_OAUTH");

  if (!(await verifyPassword(password, user.passwordHash)))
    throw err("Invalid credentials", "INVALID_CREDENTIALS");

  if (!user.isVerified) {
    await sendOtp(email);
    throw err("Email not verified — OTP resent", "EMAIL_NOT_VERIFIED");
  }

  return _issueTokenPair(user._id);
};

/* ── OAuth success handler ── */
export const oauthLogin = async (userId) => _issueTokenPair(userId);

/* ── Logout ── */
export const logout = (userId) => revokeAllTokens(userId);

/* ── Resend OTP ── */
export const resendOtp = async (email) => {
  const user = await User.findOne({ email });
  if (!user)           throw err("User not found",   "USER_NOT_FOUND");
  if (user.isVerified) throw err("Already verified", "ALREADY_VERIFIED");
  await sendOtp(email);
};

/* ── helpers ── */
const _issueTokenPair = async (userId) => ({
  accessToken:  signAccessToken(userId),
  refreshToken: await issueRefreshToken(userId),
});