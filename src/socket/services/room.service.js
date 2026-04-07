/**
 * socket/services/room.service.js
 *
 * Improvements:
 *  - Snapshots socket.rooms before iterating to avoid mutating the Set
 *    mid-loop (socket.leave() modifies socket.rooms in place).
 *  - roomOwners is exported so callers can verify ownership without
 *    coupling to the internals of this module.
 *  - Added pruneRoom() to explicitly clean up roomOwners entries that
 *    were abandoned without a clean disconnect (e.g. server restart recovery).
 */

import { getState, setState } from "../socket.state.js";
import { cleanupParty }       from "./watchparty.service.js";

/** roomId → socketId of the current owner */
const roomOwners = new Map();

/* ─── join ─── */
export const joinRoom = (socket, io, roomId) => {
  if (socket.rooms.has(roomId)) return;

  const state = getState(socket.id);

  // Security: only allow joining the room the server assigned during matching.
  if (state?.currentRoom && state.currentRoom !== roomId) {
    return socket.emit("error", {
      code:    "ROOM_MISMATCH",
      message: "Room ID does not match your assigned room",
    });
  }

  const room = io.sockets.adapter.rooms.get(roomId);
  if (room && room.size >= 2) {
    return socket.emit("error", { code: "ROOM_FULL", message: "Room is full" });
  }

  socket.join(roomId);

  if (!roomOwners.has(roomId)) {
    roomOwners.set(roomId, socket.id);
  }
};

/* ─── leave (called on disconnect) ─── */
export const leaveRoom = (socket, io) => {
  // Snapshot rooms first — socket.leave() mutates socket.rooms in place,
  // which would cause the iterator to skip entries.
  const rooms = [...socket.rooms];

  for (const roomId of rooms) {
    if (roomId === socket.id) continue; // skip the socket's default room

    const isOwner = roomOwners.get(roomId) === socket.id;

    /* ── Party room cleanup ── */
    if (roomId.startsWith("party-")) {
      if (isOwner) {
        io.to(roomId).emit("party-ended");
        cleanupParty(roomId);
        roomOwners.delete(roomId);
      }
      socket.leave(roomId);
      continue;
    }

    /* ── P2P room cleanup ── */
    if (roomId.startsWith("room-")) {
      socket.to(roomId).emit("peer-left", { remoteId: socket.id });
      socket.leave(roomId);

      const remaining = io.sockets.adapter.rooms.get(roomId);
      if (!remaining || remaining.size === 0) {
        roomOwners.delete(roomId);
      } else if (isOwner) {
        const newOwner = remaining.values().next().value;
        roomOwners.set(roomId, newOwner);
        io.to(roomId).emit("room-owner-changed", { ownerId: newOwner });
      }
    }
  }

  setState(socket.id, { currentRoom: null, peerId: null });
};

export const isRoomOwner = (roomId, socketId) => roomOwners.get(roomId) === socketId;

/**
 * Explicitly remove a room from the ownership map.
 * Call this if a room needs to be torn down outside of the normal disconnect flow.
 */
export const pruneRoom = (roomId) => roomOwners.delete(roomId);