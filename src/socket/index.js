/**
 * socket/index.js
 */

import { Server } from "socket.io";
import { socketAuth }           from "./middlewares/auth.middleware.js";
import { registerSocketEvents } from "./events.js";
import { initSocketState }      from "./socket.state.js";

export const initSocket = (server) => {
  const io = new Server(server, {
    cors: {
      // Replace * with your actual frontend origin in production:
      // origin: process.env.ALLOWED_ORIGINS?.split(",") ?? ["https://yourapp.com"]
      origin: process.env.ALLOWED_ORIGINS ?? "*",
    },
  });

  io.use(socketAuth);

  io.on("connection", (socket) => {
    // Initialize per-socket state immediately after auth passes
    console.log('[Socket] connected:', socket.id, 'user:', socket.user?.id);
    initSocketState(socket);
    registerSocketEvents(io, socket);
  });
};