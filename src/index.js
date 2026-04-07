/**
 * index.js
 *
 * Improvements:
 *  - Validate required env vars at startup (fail fast)
 *  - Connect to MongoDB before starting the server
 *  - Register all Express middleware/routes before server.listen()
 *  - Graceful shutdown on SIGTERM/SIGINT
 */

import express        from "express";
import http           from "http";
import mongoose       from "mongoose";
import passport       from "./auth/config/passport.js";
import authRouter     from "./auth/routes/auth.routes.js";
import { errorHandler } from "./auth/controllers/auth.controller.js";
import { authConfig as config } from "./auth/config/auth.config.js";
import { initSocket } from "./socket/index.js";
import { authLimiter } from "./auth/middleware/rate.limit.middleware.js";
import cors from "cors"
const app    = express();
const server = http.createServer(app);

app.use(
  cors({
    origin: config.frontendUrl,
    credentials: true, // if using cookies/session
  })
);
/* ── Middleware ── */
app.use(express.json());
app.use(passport.initialize());

/* ── Routes ── */
app.use("/api/auth", authLimiter, authRouter);
app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

/* ── Error handler (must be last) ── */
app.use(errorHandler);

/* ── Socket.IO ── */
initSocket(server);

/* ── Start ── */
const PORT     = config.port ?? 5000;
const MONGO_URI = config.mongoUri;

mongoose
  .connect(MONGO_URI)
  .then(() => {
    server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("MongoDB connection failed:", err);
    process.exit(1);
  });

/* ── Graceful shutdown ── */
const shutdown = async (signal) => {
  console.log(`\n${signal} received — shutting down gracefully`);
  server.close(async () => {
    await mongoose.connection.close();
    process.exit(0);
  });
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));