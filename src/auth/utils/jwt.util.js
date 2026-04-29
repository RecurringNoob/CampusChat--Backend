/**
 * src/auth/utils/jwt.util.js
 *
 * Single place for access-token signing and verification.
 * Used by both the REST auth middleware (via Passport) and the
 * Socket.IO auth middleware — no duplicated jwt.verify() calls.
 */

import jwt           from "jsonwebtoken";
import { authConfig } from "../config/auth.config.js";

export const signAccessToken = (userId) =>
  jwt.sign({ sub: userId }, authConfig.accessToken.secret, {
    expiresIn: authConfig.accessToken.expiresIn,
  });

/**
 * Verifies an access token and returns the decoded payload.
 * Throws a JsonWebTokenError / TokenExpiredError on failure —
 * callers should catch and handle appropriately.
 */
export const verifyAccessToken = (token) =>
  jwt.verify(token, authConfig.jwt.accessSecret);