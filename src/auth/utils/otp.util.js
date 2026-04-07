import crypto from "crypto";

/**
 * Returns a cryptographically random 6-digit string, zero-padded.
 * e.g. "047382"
 */
export const generateOtp = () =>
  String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");