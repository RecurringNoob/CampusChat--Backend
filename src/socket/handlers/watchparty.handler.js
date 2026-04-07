/**
 socket/handler/watchparty.handler.js
 */

import { joinParty, updateParty } from "../services/watchparty.service.js";
import { validateTime, validatePartyId } from "../utils/validate.js";

const guard = (socket, partyId) => {
  const { ok: idOk, error: idErr } = validatePartyId(partyId);
  if (!idOk) { socket.emit("error", { code: "INVALID_PARTY", message: idErr }); return false; }
  if (!socket.rooms.has(partyId)) { socket.emit("error", { code: "NOT_IN_PARTY", message: "You are not in this party" }); return false; }
  return true;
};

export const watchPartyHandler = (socket, io) => {

  socket.on("join-watch-party", ({ partyId }) => {
    const { ok, error } = validatePartyId(partyId);
    if (!ok) return socket.emit("error", { code: "INVALID_PARTY", message: error });
    joinParty(socket, partyId, io);
  });

  socket.on("play", ({ partyId, time }) => {
    if (!guard(socket, partyId)) return;
    const { ok, error } = validateTime(time);
    if (!ok) return socket.emit("error", { code: "INVALID_TIME", message: error });

    const updated = updateParty(partyId, { isPlaying: true, currentTime: time }, socket, io);
    if (updated) socket.to(partyId).emit("play", { time });
  });

  socket.on("pause", ({ partyId, time }) => {
    if (!guard(socket, partyId)) return;
    const { ok, error } = validateTime(time);
    if (!ok) return socket.emit("error", { code: "INVALID_TIME", message: error });

    const updated = updateParty(partyId, { isPlaying: false, currentTime: time }, socket, io);
    if (updated) socket.to(partyId).emit("pause", { time });
  });

  socket.on("seek", ({ partyId, time }) => {
    if (!guard(socket, partyId)) return;
    const { ok, error } = validateTime(time);
    if (!ok) return socket.emit("error", { code: "INVALID_TIME", message: error });

    const updated = updateParty(partyId, { currentTime: time }, socket, io);
    if (updated) socket.to(partyId).emit("seek", { time });
  });
};