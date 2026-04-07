/**
 * socket/middlewares/auth.middleware.js
 *
 * Improvements:
 *  - Extracted JWT verification into a shared util (src/auth/utils/jwt.util.js)
 *    so the socket and REST layers use identical logic instead of duplicating
 *    jwt.verify() calls with the same secret.
 */

import { verifyAccessToken } from "../../auth/utils/jwt.util.js";

export const socketAuth = (socket, next) => {
  try {
    if (process.env.NODE_ENV === "development") {
      socket.user = { id: socket.id, name: "Dev User" };
      return next();
    }

    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("AUTH_REQUIRED"));

    socket.user = verifyAccessToken(token); // throws on invalid/expired
    next();
  } catch {
    next(new Error("INVALID_TOKEN"));
  }
};