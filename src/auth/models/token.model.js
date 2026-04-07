/**
 * src/auth/models/token.model.js
 *
 * Improvements:
 *  - Added `prefix` field (first 16 chars of the raw token) as an indexed
 *    lookup hint so token.service.js can avoid a full-collection bcrypt scan.
 */

import mongoose from "mongoose";

const tokenSchema = new mongoose.Schema({
  userId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      "User",
    required: true,
  },
  token: {
    type:     String,
    required: true,   // bcrypt hash of the raw token
  },
  prefix: {
    type:     String,
    required: true,   // first 16 hex chars — non-secret, used for fast lookup
    length:   16,
  },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
});

tokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // auto-purge expired
tokenSchema.index({ userId:    1 });
tokenSchema.index({ prefix:    1 }); // fast lookup by prefix

export const Token = mongoose.model("Token", tokenSchema);