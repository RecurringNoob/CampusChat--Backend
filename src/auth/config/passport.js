/**
 * src/auth/config/passport.js
 *
 * Improvements:
 *  - Google strategy sets `authProvider: "google"` instead of
 *    `passwordHash: "oauth"` sentinel on new user creation
 *  - Existing users who registered locally but are logging in via Google
 *    get their authProvider updated (accounts can be "upgraded" to Google)
 */

import passport         from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as JwtStrategy, ExtractJwt } from "passport-jwt";
import { authConfig }   from "./auth.config.js";
import User             from "../models/user.model.js";
import { isAllowedDomain } from "../utils/domain.guard.js";


/* ── JWT strategy (protects REST endpoints) ── */
passport.use(
  new JwtStrategy(
    {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey:    authConfig.jwt.accessSecret,
    },
    async (payload, done) => {
      try {
        const user = await User.findById(payload.sub).select("-passwordHash");
        return user ? done(null, user) : done(null, false);
      } catch (err) {
        done(err, false);
      }
    }
  )
);

/* ── Google OAuth strategy ── */
passport.use(
  new GoogleStrategy(
    {
      clientID:     authConfig.google.clientId,
      clientSecret: authConfig.google.clientSecret,
      callbackURL:  authConfig.google.callbackUrl,
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value?.toLowerCase();
        if (!email) return done(null, false, { message: "No email from Google" });

        if (!isAllowedDomain(email))
          return done(null, false, { message: "DOMAIN_NOT_ALLOWED" });

        let user = await User.findOne({ email });

        if (user) {
          const updates = {};
          if (!user.isVerified)           updates.isVerified    = true;
          if (user.authProvider !== "google") updates.authProvider = "google";
          if (Object.keys(updates).length) {
            Object.assign(user, updates);
            await user.save();
          }
          return done(null, user);
        }

        // New user via OAuth — no password
        user = await User.create({
          email,
          fullName:     profile.displayName,
          avatar:       profile.photos?.[0]?.value ?? "default-avatar.png",
          isVerified:   true,
          authProvider: "google", // explicit, no sentinel strings
        });

        done(null, user);
      } catch (err) {
        done(err, false);
      }
    }
  )
);

export default passport;