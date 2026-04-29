/**
 * socket/handlers/webrtc.handler.js
 */

export const webrtcHandler = (socket, io) => {

  /* ─── offer ─── */
  socket.on("offer", ({ offer, roomId, remoteId }) => {
    console.log(`[offer] from ${socket.id} to ${remoteId} in room ${roomId}`);
    if (!roomId || !socket.rooms.has(roomId)) return;

    const remote = io.sockets.sockets.get(remoteId);
    if (!remote?.rooms.has(roomId)) return;

    io.to(remoteId).emit("offer", { offer, roomId, remoteId: socket.id });
  });

  /* ─── answer ─── */
  socket.on("answer", ({ answer, remoteId, roomId }) => {
    console.log(`[answer] from ${socket.id} to ${remoteId} in room ${roomId}`);
    if (!roomId || !socket.rooms.has(roomId)) return;

    const remote = io.sockets.sockets.get(remoteId);
    if (!remote?.rooms.has(roomId)) return;

    io.to(remoteId).emit("answer", { answer, remoteId: socket.id });
  });

  /* ─── ice-candidate ─── */
  socket.on("ice-candidate", ({ candidate, remoteId, roomId }) => {
    console.log(`[ice] from ${socket.id} to ${remoteId} in room ${roomId}`);
    if (!roomId || !socket.rooms.has(roomId)) return;

    const remote = io.sockets.sockets.get(remoteId);
    if (!remote?.rooms.has(roomId)) return;

    io.to(remoteId).emit("ice-candidate", { candidate, remoteId: socket.id });
  });
};