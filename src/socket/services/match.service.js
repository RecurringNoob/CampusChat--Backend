/**
 * socket/services/match.service.js
 *
 * Improvements:
 *  - Re-checks both sockets' state *after* clearing timeouts to eliminate the
 *    TOCTOU window where two concurrent _tryMatch calls could claim the same
 *    candidate (state check → clear timeout → state check again).
 *  - Removed the unreachable io.to(socketId).emit("match-timeout") in
 *    cleanupMatch: by the time "disconnect" fires, the socket is already gone
 *    from io.sockets.sockets, so the condition was always false.
 */

import { getState, setState, getAllSearching } from "../socket.state.js";

const MATCH_TIMEOUT_MS = 30_000;

/* ─── enqueue ─── */
export const enqueueMatch = (socket, io) => {
  const state = getState(socket.id);
  if (!state) return;
  if (state.matchState.searching || state.matchState.matched) return;

  setState(socket.id, { matchState: { searching: true, matched: false } });

  const timeout = setTimeout(() => {
    const current = getState(socket.id);
    if (current?.matchState.searching) {
      setState(socket.id, { matchState: { searching: false, matched: false }, matchTimeout: null });
      io.to(socket.id).emit("match-timeout");
    }
  }, MATCH_TIMEOUT_MS);

  setState(socket.id, { matchTimeout: timeout });
  _tryMatch(socket, io);
};

/* ─── core matching ─── */
const _tryMatch = (socket, io) => {
  const myState = getState(socket.id);
  if (!myState?.matchState.searching) return;

  const searching = getAllSearching().filter((s) => s.id !== socket.id);
  if (searching.length === 0) return;

  // Score all candidates, pick best
  const scored = searching
    .map((candidate) => ({
      candidate,
      score: _interestScore(myState.meta, candidate.meta),
    }))
    .sort((a, b) => b.score - a.score);

  const { candidate } = scored[0];

  // ── Step 1: check candidate is still searching ──
  const candidateState = getState(candidate.id);
  if (!candidateState?.matchState.searching) return;

  // ── Step 2: clear both timeouts (the "claim" window) ──
  _clearMatchTimeout(socket.id);
  _clearMatchTimeout(candidate.id);

  // ── Step 3: re-verify both states after clearing timeouts ──
  // A concurrent _tryMatch on the candidate's socket could have claimed
  // one of them between steps 1 and 2.
  const myFresh        = getState(socket.id);
  const candidateFresh = getState(candidate.id);
  if (!myFresh?.matchState.searching || !candidateFresh?.matchState.searching) return;

  // ── Step 4: atomically mark both as matched ──
  setState(socket.id,    { matchState: { searching: false, matched: true } });
  setState(candidate.id, { matchState: { searching: false, matched: true } });

  const [a, b]  = [socket.id, candidate.id].sort();
  const roomId  = `room-${a}-${b}`;

  setState(socket.id,    { currentRoom: roomId, peerId: candidate.id });
  setState(candidate.id, { currentRoom: roomId, peerId: socket.id });

  io.to(socket.id).emit("match-found",    { roomId, remoteId: candidate.id, initiator: true  });
  io.to(candidate.id).emit("match-found", { roomId, remoteId: socket.id,    initiator: false });
};

/* ─── cleanup on disconnect ─── */
export const cleanupMatch = (socketId, io) => {
  const state = getState(socketId);
  if (!state) return;

  _clearMatchTimeout(socketId);
  setState(socketId, { matchState: { searching: false, matched: false }, matchTimeout: null });

  // NOTE: We intentionally do NOT emit "match-timeout" here.
  // By the time "disconnect" fires, the socket is already removed from
  // io.sockets.sockets — the emit would be silently dropped anyway.
};

/* ─── register meta ─── */
export const registerMeta = (socketId, meta) => {
  setState(socketId, { meta });
};

/* ─── helpers ─── */
const _clearMatchTimeout = (socketId) => {
  const state = getState(socketId);
  if (state?.matchTimeout) {
    clearTimeout(state.matchTimeout);
    setState(socketId, { matchTimeout: null });
  }
};

const _interestScore = (a, b) => {
  if (!a?.interests || !b?.interests) return 0;
  const setB = new Set(b.interests);
  return a.interests.filter((i) => setB.has(i)).length;
};