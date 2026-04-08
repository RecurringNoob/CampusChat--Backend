/**
 * src/auth/services/auth.service.js
 *
 * Improvements:
 *  - Uses `authProvider` field instead of `passwordHash: "oauth"` sentinel
 *  - `register` sets `authProvider: "local"` explicitly
 *  - `login` checks `authProvider` to block OAuth-only accounts
 *  - `oauthLogin` / passport callback sets `authProvider: "google"`
 */

import User from "../models/user.model.js";
import { hashPassword, verifyPassword } from "../utils/hash.util.js";
import { isAllowedDomain } from "../utils/domain.guard.js";
import { sendOtp, verifyOtp } from "./otp.service.js";
import { signAccessToken, issueRefreshToken, revokeAllTokens } from "./token.service.js";

const err = (msg, code) => Object.assign(new Error(msg), { code });

/* ── Register (email + password) ── */
export const register = async ({ fullName, email, password }) => {
  console.info(`[auth] Register attempt for email: ${email}`);
  if (!isAllowedDomain(email)) {
    console.warn(`[auth] Registration blocked: domain not allowed for ${email}`);
    throw err("Domain not allowed", "DOMAIN_NOT_ALLOWED");
  }
  if (await User.findOne({ email })) {
    console.warn(`[auth] Registration failed: email already exists ${email}`);
    throw err("Email already registered", "EMAIL_EXISTS");
  }

  const passwordHash = await hashPassword(password);
  await User.create({ fullName, email, passwordHash, authProvider: "local", isVerified: false });
  console.info(`[auth] User registered successfully: ${email}`);
  await sendOtp(email);
  console.info(`[auth] OTP sent to newly registered user: ${email}`);
};

/* ── Verify OTP → issue tokens ── */
export const verifyEmail = async ({ email, code }) => {
  console.info(`[auth] Email verification attempt for ${email}`);
  await verifyOtp(email, code);

  const user = await User.findOneAndUpdate(
    { email },
    { isVerified: true },
    { new: true }
  );
  if (!user) {
    console.error(`[auth] Verification failed: user not found ${email}`);
    throw err("User not found", "USER_NOT_FOUND");
  }

  console.info(`[auth] Email verified for ${email}`);
  const tokens = await _issueTokenPair(user._id);
  console.info(`[auth] Tokens issued for ${email} (userId: ${user._id})`);
  return tokens;
};

/* ── Login (email + password) ── */
export const login = async ({ email, password }) => {
  console.info(`[auth] Login attempt for ${email}`);
  const user = await User.findOne({ email }).select("+passwordHash");
  if (!user) {
    console.warn(`[auth] Login failed: user not found ${email}`);
    throw err("Invalid credentials", "INVALID_CREDENTIALS");
  }

  // Block OAuth-only accounts from password login
  if (user.authProvider !== "local") {
    console.warn(`[auth] Login blocked: ${email} uses ${user.authProvider} provider`);
    throw err(`This account uses ${user.authProvider} login`, "USE_OAUTH");
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    console.warn(`[auth] Login failed: invalid password for ${email}`);
    throw err("Invalid credentials", "INVALID_CREDENTIALS");
  }

  if (!user.isVerified) {
    console.info(`[auth] Login blocked: unverified email ${email} - resending OTP`);
    await sendOtp(email);
    throw err("Email not verified — OTP resent", "EMAIL_NOT_VERIFIED");
  }

  console.info(`[auth] Login successful for ${email} (userId: ${user._id})`);
  const tokens = await _issueTokenPair(user._id);
  console.info(`[auth] Tokens issued for ${email} (userId: ${user._id})`);
  return tokens;
};

/* ── OAuth success handler ── */
export const oauthLogin = async (userId) => {
  console.info(`[auth] OAuth login for userId: ${userId}`);
  const tokens = await _issueTokenPair(userId);
  console.info(`[auth] Tokens issued via OAuth for userId: ${userId}`);
  return tokens;
};

/* ── Logout ── */
export const logout = (userId) => {
  console.info(`[auth] Logout for userId: ${userId}`);
  revokeAllTokens(userId);
  console.info(`[auth] All tokens revoked for userId: ${userId}`);
};

/* ── Resend OTP ── */
export const resendOtp = async (email) => {
  console.info(`[auth] Resend OTP requested for ${email}`);
  const user = await User.findOne({ email });
  if (!user) {
    console.warn(`[auth] Resend OTP failed: user not found ${email}`);
    throw err("User not found", "USER_NOT_FOUND");
  }
  if (user.isVerified) {
    console.warn(`[auth] Resend OTP blocked: email already verified ${email}`);
    throw err("Already verified", "ALREADY_VERIFIED");
  }
  await sendOtp(email);
  console.info(`[auth] OTP resent to ${email}`);
};

/* ── helpers ── */
const _issueTokenPair = async (userId) => ({
  accessToken: signAccessToken(userId),
  refreshToken: await issueRefreshToken(userId),
});