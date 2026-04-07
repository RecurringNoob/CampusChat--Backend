/**
 services/watchparty.service.js
 */

const parties = new Map(); // partyId → { hostId, state }

/* ─── join ─── */
export const joinParty = (socket, partyId, io) => {
  socket.join(partyId);

  if (!parties.has(partyId)) {
    parties.set(partyId, {
      hostId: socket.id,
      state: { isPlaying: false, currentTime: 0 },
    });
  }

  const party = parties.get(partyId);

  socket.emit("sync-state", {
    hostId: party.hostId,
    isHost: party.hostId === socket.id,
    state: party.state,
  });
};

/* ─── update ─── */
// Returns true if update was applied (caller is host), false otherwise.
export const updateParty = (partyId, data, socket, io) => {
  const party = parties.get(partyId);
  if (!party || party.hostId !== socket.id) return false;

  party.state = { ...party.state, ...data };
  io.to(partyId).emit("state-updated", party.state);
  return true;
};

/* ─── cleanup ─── */
export const cleanupParty = (partyId) => {
  parties.delete(partyId);
};