import passport from "../config/passport.js";

// Protects routes — requires valid Bearer JWT
export const protect = (req, res, next) =>
  passport.authenticate("jwt", { session: false }, (err, user) => {
    if (err)    return next(err);
    if (!user)  return res.status(401).json({ error: "Unauthorized", code: "AUTH_REQUIRED" });
    req.user = user;
    next();
  })(req, res, next);

// Attaches user if token present, but doesn't block guests
export const optionalAuth = (req, _res, next) =>
  passport.authenticate("jwt", { session: false }, (_err, user) => {
    if (user) req.user = user;
    next();
  })(req, _res, next);