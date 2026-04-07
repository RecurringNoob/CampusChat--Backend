/**
 socket/utils/validate.js
 *
 * Lightweight runtime validation for socket payloads.
 * Returns { ok, error } — no throwing.
 */

export const validateMeta = (meta) => {
  if (!meta || typeof meta !== "object") return fail("meta must be an object");
  if (meta.age !== undefined && (typeof meta.age !== "number" || meta.age < 0 || meta.age > 120))
    return fail("age must be a number between 0 and 120");
  if (meta.interests !== undefined) {
    if (!Array.isArray(meta.interests)) return fail("interests must be an array");
    if (meta.interests.length > 20) return fail("too many interests (max 20)");
    if (meta.interests.some((i) => typeof i !== "string" || i.length > 50))
      return fail("each interest must be a string under 50 chars");
  }
  if (meta.country !== undefined && typeof meta.country !== "string")
    return fail("country must be a string");
  return ok();
};

export const validateTime = (time) => {
  if (typeof time !== "number" || !isFinite(time) || time < 0)
    return fail("time must be a non-negative finite number");
  return ok();
};

export const validateMessage = (message) => {
  if (!message || typeof message !== "object") return fail("message must be an object");
  if (typeof message.text !== "string") return fail("message.text must be a string");
  if (message.text.length === 0) return fail("message cannot be empty");
  if (message.text.length > 500) return fail("message exceeds 500 char limit");
  return ok();
};

export const validateRoomId = (roomId) => {
  if (typeof roomId !== "string" || !roomId.startsWith("room-"))
    return fail("invalid roomId");
  return ok();
};

export const validatePartyId = (partyId) => {
  if (typeof partyId !== "string" || partyId.trim().length === 0)
    return fail("invalid partyId");
  return ok();
};

/* ─── helpers ─── */
const ok    = ()      => ({ ok: true,  error: null });
const fail  = (msg)   => ({ ok: false, error: msg });