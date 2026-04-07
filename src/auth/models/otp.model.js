import mongoose from "mongoose";

const otpSchema = new mongoose.Schema({
  email:     { type: String, required: true, lowercase: true },
  code:      { type: String, required: true },
  expiresAt: { type: Date,   required: true },
  createdAt: { type: Date,   default: Date.now },
});

// MongoDB auto-deletes documents once expiresAt is reached
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Otp = mongoose.model("Otp", otpSchema);