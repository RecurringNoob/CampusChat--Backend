/**
 * socket/socket.state.js
 *
 * Single source of truth for per-socket state.
 * Replaces scattered module-level Maps across services.
 *
 * Shape:
 * {
 *   id: "abc123",
 *   user:      { id, name },
 *   meta:      { interests, age, country },
 *   matchState:{ searching: false, matched: true },
 *   currentRoom: "room-abc123-def456",
 *   peerId:    "def456",
 *   matchTimeout: TimeoutObject | null,
 * }
 */

const sockets = new Map(); // socketId → state

export const initSocketState = (socket) => {
  sockets.set(socket.id, {
    id: socket.id,
    user: socket.user ?? null,
    meta: null,
    matchState: { searching: false, matched: false },
    currentRoom: null,
    peerId: null,
    matchTimeout: null,
  });
};

export const getState = (socketId) => sockets.get(socketId) ?? null;

export const setState = (socketId, patch) => {
  const current = sockets.get(socketId);
  if (!current) return;

  sockets.set(socketId, {
    ...current,
    ...patch,
    matchState: patch.matchState
      ? { ...current.matchState, ...patch.matchState }
      : current.matchState,
  });
};

export const deleteState = (socketId) => {
  sockets.delete(socketId);
};

export const getAllSearching = () =>
  [...sockets.values()].filter((s) => s.matchState.searching);