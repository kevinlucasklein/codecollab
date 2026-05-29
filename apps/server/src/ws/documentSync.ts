import { Server, Socket } from "socket.io";
import * as Y from "yjs";
import jwt from "jsonwebtoken";
import { pool, query } from "../db/index.js";
import type { ClientToServerEvents, ServerToClientEvents, User } from "@codecollab/shared";

const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production-use-a-long-random-string";

// In-memory cache of active Yjs documents
// Key: document ID
const docs = new Map<string, {
  doc: Y.Doc;
  connections: number;
  saveTimeout: NodeJS.Timeout | null;
}>();

const SAVE_DEBOUNCE_MS = 2000;

type AccessRole = "owner" | "editor" | "viewer" | "none";

// Resolve a user's access role for a document: owner, an explicit file/folder
// share permission, or "none" for link-only access.
async function getAccessRole(docId: string, userId: string): Promise<AccessRole> {
  const docRes = await query(
    "SELECT owner_id, github_repo, github_branch FROM documents WHERE id = $1",
    [docId]
  );
  if (docRes.rows.length === 0) return "none";

  const row = docRes.rows[0];
  if (row.owner_id === userId) return "owner";

  const shareRes = await query(
    `SELECT permission FROM document_shares WHERE document_id = $1 AND shared_with = $2
     UNION
     SELECT permission FROM folder_shares
       WHERE owner_id = $3 AND github_repo = $4 AND github_branch = COALESCE($5, '') AND shared_with = $2`,
    [docId, userId, row.owner_id, row.github_repo, row.github_branch]
  );

  if (shareRes.rows.some((r) => r.permission === "editor")) return "editor";
  if (shareRes.rows.some((r) => r.permission === "viewer")) return "viewer";
  return "none";
}

export function setupWebSocket(io: Server<ClientToServerEvents, ServerToClientEvents>) {
  // Middleware: Authenticate socket connection
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error("Authentication error: No token provided"));
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as User;
      socket.data.user = decoded;
      next();
    } catch (err) {
      next(new Error("Authentication error: Invalid token"));
    }
  });

  io.on("connection", (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    const user = socket.data.user as User;
    console.log(`User connected: ${user.displayName} (${socket.id})`);

    // Handle joining a document
    socket.on("doc:join", async (docId, callback) => {
      try {
        // 1. Verify user has access to this doc (in our simple app, anyone with the link and an account can edit)
        const dbDoc = await query("SELECT id, yjs_state, base_content FROM documents WHERE id = $1", [docId]);
        if (dbDoc.rows.length === 0) {
          callback({ success: false, error: "Document not found" });
          return;
        }

        // 2. Load or create Y.Doc in memory
        let roomDoc = docs.get(docId);
        if (!roomDoc) {
          roomDoc = {
            doc: new Y.Doc(),
            connections: 0,
            saveTimeout: null,
          };
          
          // Apply initial state from database if it exists
          if (dbDoc.rows[0].yjs_state) {
            Y.applyUpdate(roomDoc.doc, dbDoc.rows[0].yjs_state);
          } else if (dbDoc.rows[0].base_content) {
            // Seed with base content from GitHub import
            const ytext = roomDoc.doc.getText("monaco");
            ytext.insert(0, dbDoc.rows[0].base_content);
          }
          
          docs.set(docId, roomDoc);
        }

        roomDoc.connections++;

        // 2b. Resolve and remember this user's access role for the room, so we
        // can enforce read-only (viewer) access on incoming edits.
        const role = await getAccessRole(docId, user.id);
        const data = socket.data as any;
        data.roles = data.roles || {};
        data.roles[docId] = role;

        // 3. Join the socket.io room
        socket.join(docId);

        // 4. Send current document state to the client
        const stateVector = Y.encodeStateAsUpdate(roomDoc.doc);
        socket.emit("doc:loaded", stateVector);

        // 5. Notify others that a user joined
        // We generate a random color for the user session
        const color = "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
        socket.to(docId).emit("user:joined", { id: user.id, displayName: user.displayName, color });

        callback({ success: true });
        console.log(`User ${user.displayName} joined doc ${docId}. Active connections: ${roomDoc.connections}`);
      } catch (error) {
        console.error("Error joining doc:", error);
        callback({ success: false, error: "Internal server error" });
      }
    });

    // Handle document updates from clients
    socket.on("sync:update", (docId, updateBuffer) => {
      const roomDoc = docs.get(docId);
      if (!roomDoc) return;

      // Hard enforcement: viewers cannot modify the document. We drop their
      // edits server-side regardless of what their client does. Owners,
      // editors, and link-only collaborators may edit.
      const role = (socket.data as any).roles?.[docId] as AccessRole | undefined;
      if (role === "viewer") {
        return;
      }

      // Ensure updateBuffer is Uint8Array (socket.io might send it as a Buffer in Node)
      const update = new Uint8Array(updateBuffer);

      // Apply the update to our in-memory Y.Doc
      Y.applyUpdate(roomDoc.doc, update);

      // Broadcast the update to all other clients in the room
      socket.to(docId).emit("sync:update", update);

      // Debounce saving to the database
      if (roomDoc.saveTimeout) {
        clearTimeout(roomDoc.saveTimeout);
      }
      roomDoc.saveTimeout = setTimeout(() => saveDocToDatabase(docId, roomDoc.doc), SAVE_DEBOUNCE_MS);
    });

    // Handle awareness updates (cursor position, selection)
    socket.on("sync:awareness", (docId, updateBuffer) => {
      socket.to(docId).emit("sync:awareness", new Uint8Array(updateBuffer));
    });

    // Handle leaving a document
    socket.on("doc:leave", (docId) => {
      handleLeave(socket, docId, user);
    });

    // Handle disconnect
    // Broadcast new comment thread
    socket.on("comment:thread_created", (docId, thread) => {
      console.log(`[WS] comment:thread_created received for doc ${docId}, broadcasting...`);
      socket.to(docId).emit("comment:thread_created", thread);
    });

    // Broadcast new comment reply
    socket.on("comment:added", (docId, comment) => {
      console.log(`[WS] comment:added received for doc ${docId}, broadcasting...`);
      socket.to(docId).emit("comment:added", comment);
    });

    // Broadcast thread resolved
    socket.on("comment:resolved", (docId, threadId) => {
      console.log(`[WS] comment:resolved received for doc ${docId}, broadcasting...`);
      socket.to(docId).emit("comment:resolved", threadId);
    });

    // Broadcast document renamed
    socket.on("document:renamed", (docId, newTitle) => {
      console.log(`[WS] document:renamed received for doc ${docId}, new title: ${newTitle}, broadcasting...`);
      socket.to(docId).emit("document:renamed", newTitle);
    });

    socket.on("disconnect", () => {
      console.log(`User disconnected: ${user.displayName} (${socket.id})`);
      // User could be in multiple rooms, find all
      for (const room of socket.rooms) {
        if (room !== socket.id) {
          handleLeave(socket, room, user);
        }
      }
    });
  });
}

// Helper to handle a user leaving a document room
function handleLeave(socket: Socket, docId: string, user: User) {
  socket.leave(docId);
  socket.to(docId).emit("user:left", user.id);

  const roomDoc = docs.get(docId);
  if (roomDoc) {
    roomDoc.connections--;
    console.log(`User ${user.displayName} left doc ${docId}. Active connections: ${roomDoc.connections}`);

    if (roomDoc.connections <= 0) {
      // Everyone left, save one last time and clean up memory
      if (roomDoc.saveTimeout) {
        clearTimeout(roomDoc.saveTimeout);
      }
      saveDocToDatabase(docId, roomDoc.doc);
      docs.delete(docId);
      console.log(`Document ${docId} removed from memory`);
    }
  }
}

// Helper to persist Y.Doc to PostgreSQL
async function saveDocToDatabase(docId: string, doc: Y.Doc) {
  try {
    const state = Y.encodeStateAsUpdate(doc);
    // state is Uint8Array. pg driver handles Buffer to BYTEA automatically.
    const buffer = Buffer.from(state);
    await query("UPDATE documents SET yjs_state = $1, updated_at = NOW() WHERE id = $2", [buffer, docId]);
    console.log(`Saved document ${docId} to database`);
  } catch (error) {
    console.error(`Failed to save document ${docId} to database:`, error);
  }
}
