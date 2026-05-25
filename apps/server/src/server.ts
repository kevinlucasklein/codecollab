// CodeCollab Server — Entry Point
// Express REST API + Socket.io WebSocket server


import "dotenv/config";
import http from "node:http";
import express from "express";
import cors from "cors";
import { Server as SocketIOServer } from "socket.io";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
} from "@codecollab/shared";

// Config
const PORT = parseInt(process.env.SERVER_PORT || "3001", 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:3000";

// Express App
const app: ReturnType<typeof express> = express();
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json());

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// TODO: Step 4 — Mount auth routes
// TODO: Step 5 — Mount document routes

// HTTP Server
const httpServer = http.createServer(app);

// Socket.io
const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(
  httpServer,
  {
    cors: {
      origin: CORS_ORIGIN,
      credentials: true,
    },
  }
);

// TODO: Step 6 — Wire up Yjs document sync + JWT auth middleware

io.on("connection", (socket) => {
  console.log(`[socket] connected: ${socket.id}`);

  socket.on("disconnect", (reason) => {
    console.log(`[socket] disconnected: ${socket.id} (${reason})`);
  });
});

// Start
httpServer.listen(PORT, () => {
  console.log(`\n🚀 CodeCollab server running on http://localhost:${PORT}`);
  console.log(`   CORS origin: ${CORS_ORIGIN}\n`);
});

export { app, io, httpServer };
