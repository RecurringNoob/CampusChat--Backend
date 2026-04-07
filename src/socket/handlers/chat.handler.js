/**
 socket/handler/chat.handler.js
 */

import { validateMessage } from "../utils/validate.js";

export const chatHandler = (socket, io) => {
  socket.on("chat-message", ({ roomId, message }) => {
    if (!socket.rooms.has(roomId)) {
      return socket.emit("error", { code: "NOT_IN_ROOM", message: "You are not in this room" });
    }

    const { ok, error } = validateMessage(message);
    if (!ok) {
      return socket.emit("error", { code: "INVALID_MESSAGE", message: error });
    }

    io.to(roomId).emit("chat-message", {
      message,
      user: socket.user,
    });
  });
};