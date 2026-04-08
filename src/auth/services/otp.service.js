/**
 * src/auth/services/otp.service.js
 *
 * Improvements:
 *  - OTP is hashed at rest (bcrypt) so a compromised DB doesn't expose
 *    pending codes that could be used to verify/hijack accounts.
 *  - verifyOtp uses a constant-time comparison via bcrypt.compare.
 */

import { Otp }            from "../models/otp.model.js";
import { generateOtp }    from "../utils/otp.util.js";
import { sendOtpEmail }   from "../config/mailer.js";
import { authConfig }     from "../config/auth.config.js";
import bcrypt             from "bcrypt";

const OTP_HASH_ROUNDS = 10;

export const sendOtp = async (email) => {
  const code      = generateOtp();
  const codeHash  = await bcrypt.hash(code, OTP_HASH_ROUNDS);
  const expiresAt = new Date(Date.now() + authConfig.otp.expiresInMinutes * 60_000);

  await Otp.deleteMany({ email });                        // invalidate previous OTPs
  await Otp.create({ email, code: codeHash, expiresAt }); // store hash, not plain code

  // Send the plain code to the user's email — we never store it in plaintext
  await sendOtpEmail({ to: email, code, expiresInMinutes: authConfig.otp.expiresInMinutes });
};

export const verifyOtp = async (email, code) => {
  const record = await Otp.findOne({ email });

  if (!record)
    throw Object.assign(new Error("OTP not found"),  { code: "OTP_NOT_FOUND" });

  if (record.expiresAt < new Date())
    throw Object.assign(new Error("OTP expired"),    { code: "OTP_EXPIRED" });

  // bcrypt.compare is constant-time — safe against timing attacks
  const valid = await bcrypt.compare(String(code), record.code);
  if (!valid)
    throw Object.assign(new Error("OTP is invalid"), { code: "OTP_INVALID" });

  await record.deleteOne(); // one-time use
};