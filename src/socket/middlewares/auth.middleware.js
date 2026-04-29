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
      console.log('[socketAuth] dev bypass for socket:', socket.id);
      socket.user = { id: socket.id, name: "Dev User" };
      return next();
    }

    const token = socket.handshake.auth?.token;
    console.log('[socketAuth] token present:', !!token);

    if (!token) return next(new Error("AUTH_REQUIRED"));

    socket.user = verifyAccessToken(token); // throws on invalid/expired
     console.log('[socketAuth] token verified for user:', socket.user.sub);
    next();
  } catch {
    console.error('[socketAuth] verification failed:', err.name, err.message); // ← add this
    next(new Error("INVALID_TOKEN"));
  }
};