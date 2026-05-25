import { useEffect, useState, useRef } from "react";
import * as Y from "yjs";
import { io, Socket } from "socket.io-client";
import type { 
  ServerToClientEvents, 
  ClientToServerEvents, 
  PresenceUser 
} from "@codecollab/shared";
import { useAuth } from "../lib/auth";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001";

export function useYjsSync(docId: string) {
  const { token, user } = useAuth();
  const [doc] = useState(() => new Y.Doc());
  const [ytext] = useState(() => doc.getText("monaco")); // The shared text type
  
  const [isConnected, setIsConnected] = useState(false);
  const [isSynced, setIsSynced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Custom presence state (since we aren't using y-protocols)
  const [activeUsers, setActiveUsers] = useState<Map<string, PresenceUser>>(new Map());
  
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);

  useEffect(() => {
    if (!token || !user) return;

    // 1. Initialize Socket.io connection
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, {
      auth: { token },
      transports: ["websocket"], // force websocket to avoid polling issues
    });
    
    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      setError(null);
      
      // 2. Join the document room
      socket.emit("doc:join", docId, (response) => {
        if (!response.success) {
          setError(response.error || "Failed to join document");
        }
      });
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
      setIsSynced(false);
    });

    socket.on("connect_error", (err) => {
      setError(`Connection error: ${err.message}`);
      setIsConnected(false);
    });

    // 3. Handle incoming document state (initial load)
    socket.on("doc:loaded", (stateBuffer) => {
      // Create a Uint8Array from the raw buffer/array
      const state = new Uint8Array(stateBuffer);
      Y.applyUpdate(doc, state);
      setIsSynced(true);
    });

    // 4. Handle incoming incremental Yjs updates from other users
    socket.on("sync:update", (updateBuffer) => {
      const update = new Uint8Array(updateBuffer);
      Y.applyUpdate(doc, update);
    });

    // 5. Presence: Someone joined
    socket.on("user:joined", (newUser) => {
      setActiveUsers((prev) => {
        const next = new Map(prev);
        next.set(newUser.id, {
          id: newUser.id,
          displayName: newUser.displayName,
          color: newUser.color
        });
        return next;
      });
    });

    // 6. Presence: Someone left
    socket.on("user:left", (userId) => {
      setActiveUsers((prev) => {
        const next = new Map(prev);
        next.delete(userId);
        return next;
      });
    });

    // 7. Yjs Local Edits -> emit to server
    const handleYjsUpdate = (update: Uint8Array, origin: any) => {
      if (origin !== "server") {
        socket.emit("sync:update", docId, update);
      }
    };
    
    // We bind the observer to the doc, marking server updates with origin='server'
    // so we don't reflect them back to the server. Wait, applyUpdate doesn't let you set origin 
    // easily unless you use a transaction.
    // Actually, Yjs Doc.on('update') receives the origin as the second parameter!
    // So when we call Y.applyUpdate(doc, update, "server"), the origin is "server".
    doc.on("update", handleYjsUpdate);

    return () => {
      doc.off("update", handleYjsUpdate);
      socket.emit("doc:leave", docId);
      socket.disconnect();
    };
  }, [docId, token, user, doc]);

  // Expose a function to safely apply updates from the server, passing "server" as the origin
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    
    // Re-bind the sync:update listener to pass "server" origin to applyUpdate
    socket.off("sync:update");
    socket.on("sync:update", (updateBuffer) => {
      const update = new Uint8Array(updateBuffer);
      Y.applyUpdate(doc, update, "server");
    });
    
    // Re-bind doc:loaded as well
    socket.off("doc:loaded");
    socket.on("doc:loaded", (stateBuffer) => {
      const state = new Uint8Array(stateBuffer);
      Y.applyUpdate(doc, state, "server");
      setIsSynced(true);
    });
  }, [doc]);

  return { doc, ytext, isConnected, isSynced, error, activeUsers };
}
