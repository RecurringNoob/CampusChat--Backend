/**
 * src/models/User.js
 *
 * Improvements:
 *  - Replaced the `passwordHash: "oauth"` magic string sentinel with a proper
 *    `authProvider` enum field. This is explicit, type-safe, and extensible
 *    (easy to add "github", "apple", etc. later).
 *  - `passwordHash` is now truly optional for OAuth-only accounts.
 */

import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    // === AUTHENTICATION ===
    email: {
      type:     String,
      required: [true, "Email is required"],
      unique:   true,
      lowercase: true,
      trim:     true,
      match:    [/^\S+@\S+\.\S+$/, "Please use a valid email address"],
    },
    username: {
      type:      String,
      unique:    true,
      sparse:    true,
      trim:      true,
      minlength: 3,
      maxlength: 20,
    },
    passwordHash: {
      type:   String,
      select: false,
      // Not required — OAuth accounts have no password
    },

    /**
     * How the user authenticates.
     * "local"  → email + password + OTP verification
     * "google" → Google OAuth (no password)
     *
     * Replaces the old magic string `passwordHash: "oauth"`.
     */
    authProvider: {
      type:     String,
      enum:     ["local", "google"],
      required: true,
      default:  "local",
    },

    // === PROFILE ===
    fullName:       { type: String, required: true, trim: true, maxlength: 50 },
    avatar:         { type: String, default: "default-avatar.png" },
    university:     { type: String, trim: true },
    major:          { type: String, trim: true },
    graduationYear: { type: Number, min: 1900, max: new Date().getFullYear() + 10 },
    bio:            { type: String, maxlength: 300 },
    interests:      [String],

    // === VERIFICATION ===
    isVerified: { type: Boolean, default: false },

    // === SOCIAL ===
    friends:      [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    friendRequests: {
      incoming: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      outgoing: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    },
    blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    // === GAMIFICATION ===
    hostingPoints: { type: Number, default: 0 },
    role:          { type: String, enum: ["user", "admin"], default: "user" },

    // === ACTIVITY ===
    lastActive: { type: Date, default: Date.now },

    // === PREFERENCES ===
    settings: {
      micEnabled:        { type: Boolean, default: true },
      cameraEnabled:     { type: Boolean, default: true },
      preferredCameraId: String,
      preferredMicId:    String,
      theme:             { type: String, enum: ["dark", "light"], default: "dark" },
    },
  },
  { timestamps: true }
);

// --- Indexes ---

userSchema.index({ university: 1 });

// --- Public profile ---
userSchema.methods.toProfileJSON = function () {
  return {
    id:             this._id,
    fullName:       this.fullName,
    username:       this.username,
    avatar:         this.avatar,
    university:     this.university,
    major:          this.major,
    graduationYear: this.graduationYear,
    bio:            this.bio,
    interests:      this.interests,
    isVerified:     this.isVerified,
    authProvider:   this.authProvider,
    hostingPoints:  this.hostingPoints,
    role:           this.role,
    lastActive:     this.lastActive,
  };
};

const User = mongoose.model("User", userSchema);
export default User;