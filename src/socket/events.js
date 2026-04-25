/**
 * socket/events.js
 *
 * Registers all socket events in lifecycle order:
 *
 *   CONNECTED → MATCHMAKING → MATCHED → WEBRTC_CONNECTING → CONNECTED_CALL
 *
 *   connect
 *     ↓ register-meta          (optional, before find-match)
 *     ↓ find-match
 *     ↓ match-found            (server → client)
 *     ↓ join-room              (client → server, after match-found)
 *     ↓ offer / answer / ice-candidate
 *     ↓ chat-message / screenshare
 *     ↓ disconnect
 */

import { enqueueMatch, cleanupMatch, registerMeta } from "./services/match.service.js";
import { joinRoom, leaveRoom }                       from "./services/room.service.js";
import { deleteState }                               from "./socket.state.js";
import { webrtcHandler }                             from "./handlers/webrtc.handler.js";
import { chatHandler }                               from "./handlers/chat.handler.js";
import { watchPartyHandler }                         from "./handlers/watchparty.handler.js";
import { validateMeta, validateRoomId }              from "./utils/validate.js";

export const registerSocketEvents = (io, socket) => {

  /* ── Phase 1: CONNECTED ── */
  // socket state already initialized in index.js after connection


  /* ── Phase 2: MATCHMAKING ── */

  socket.on("register-meta", (meta) => {
    const { ok, error } = validateMeta(meta);
    if (!ok) return socket.emit("error", { code: "INVALID_META", message: error });
    registerMeta(socket.id, meta);
  });

  socket.on("find-match", () => {
      console.log('[find-match] received from:', socket.id);
    enqueueMatch(socket, io);
  });


  /* ── Phase 3: MATCHED → join room ── */
  // Client must emit join-room immediately after receiving match-found.
  // This puts the socket into the Socket.IO room so all subsequent
  // security checks (socket.rooms.has) pass correctly.

  socket.on("join-room", ({ roomId }) => {
    const { ok, error } = validateRoomId(roomId);
    if (!ok) return socket.emit("error", { code: "INVALID_ROOM", message: error });
    joinRoom(socket, io, roomId);
  });


  /* ── Phase 4 & 5: WEBRTC_CONNECTING + CONNECTED_CALL ── */

  webrtcHandler(socket, io);
  chatHandler(socket, io);
  watchPartyHandler(socket, io);


  /* ── Disconnect: full cleanup in reverse order ── */

  socket.on("disconnect", () => {
    cleanupMatch(socket.id, io);   // cancel queue / timeout
    leaveRoom(socket, io);         // notify peer, clean room ownership
    deleteState(socket.id);        // remove socket state entry
  });
};