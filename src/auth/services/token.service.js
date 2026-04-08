/**
 * src/auth/services/token.service.js
 *
 * Improvements:
 *  - Refresh token lookup uses a stored prefix (first 16 hex chars) as a fast
 *    index so we only bcrypt-compare against a tiny subset of records instead
 *    of every unexpired token in the DB. O(n) bcrypt scan → O(1) index lookup.
 *  - Token model must now include a `prefix` field (see token.model.js).
 */

import jwt       from "jsonwebtoken";
import crypto    from "crypto";
import { Token } from "../models/token.model.js";
import { hashToken, verifyToken } from "../utils/hash.util.js";
import { authConfig } from "../config/auth.config.js";

/* ── Access token (short-lived JWT) ── */
export const signAccessToken = (userId) =>
 jwt.sign({ sub: userId }, authConfig.jwt.accessSecret, {
  expiresIn: authConfig.jwt.accessExpiresIn,
});

/* ── Refresh token (opaque random string, hashed at rest) ── */
export const issueRefreshToken = async (userId) => {
  const raw    = crypto.randomBytes(64).toString("hex");
  const hash   = await hashToken(raw);
  const prefix = raw.slice(0, 16); // non-secret lookup hint

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  await Token.create({ userId, token: hash, prefix, expiresAt });
  return raw;
};

/* ── Rotate: validate old RT, issue new pair ── */
export const rotateRefreshToken = async (raw) => {
  if (typeof raw !== "string" || raw.length < 16) {
    throw Object.assign(new Error("Invalid refresh token"), { code: "REFRESH_TOKEN_INVALID" });
  }

  const prefix = raw.slice(0, 16);

  // Only compare tokens that share the prefix — typically just one record
  const candidates = await Token.find({ prefix, expiresAt: { $gt: new Date() } });

  let matched = null;
  for (const record of candidates) {
    if (await verifyToken(raw, record.token)) {
      matched = record;
      break;
    }
  }

  if (!matched) {
    throw Object.assign(new Error("Invalid or expired refresh token"), { code: "REFRESH_TOKEN_INVALID" });
  }

  await matched.deleteOne(); // revoke used token (rotation)

  const accessToken  = signAccessToken(matched.userId);
  const refreshToken = await issueRefreshToken(matched.userId);
  return { accessToken, refreshToken };
};

/* ── Revoke all refresh tokens for a user (logout) ── */
export const revokeAllTokens = (userId) => Token.deleteMany({ userId });