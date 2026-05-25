import { useEffect, useState, useRef } from "react";
import * as Y from "yjs";
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from "y-protocols/awareness";
import { io, Socket } from "socket.io-client";
import type { 
  ServerToClientEvents, 
  ClientToServerEvents, 
  PresenceUser 
} from "@codecollab/shared";
import { useAuth } from "../lib/auth";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001";

// Simple color generator based on user ID
function getUserColor(userId: string) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 70%, 50%)`;
}

export function useYjsSync(docId: string) {
  const { token, user } = useAuth();
  
  // Yjs State
  const [doc] = useState(() => new Y.Doc());
  const [ytext] = useState(() => doc.getText("monaco"));
  
  // Awareness State (y-protocols)
  const [awareness] = useState(() => new Awareness(doc));
  
  // React State
  const [isConnected, setIsConnected] = useState(false);
  const [isSynced, setIsSynced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeUsers, setActiveUsers] = useState<Map<string, PresenceUser>>(new Map());
  
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);

  useEffect(() => {
    if (!token || !user) return;

    // Set local awareness state
    awareness.setLocalStateField("user", {
      name: user.displayName,
      color: getUserColor(user.id),
      colorLight: getUserColor(user.id) // y-codemirror.next uses this for cursor selection
    });

    // 1. Initialize Socket.io connection
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, {
      auth: { token },
      transports: ["websocket"],
    });
    
    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      setError(null);
      
      // 2. Join the document room
      socket.emit("doc:join", docId, (response) => {
        if (!response.success) {
          setError(response.error || "Failed to join document");
        } else {
          // Send initial awareness state
          const update = encodeAwarenessUpdate(awareness, [awareness.clientID]);
          socket.emit("sync:awareness", docId, update);
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

    // 3. Document Sync
    socket.on("doc:loaded", (stateBuffer) => {
      const state = new Uint8Array(stateBuffer);
      Y.applyUpdate(doc, state, "server");
      setIsSynced(true);
    });

    socket.on("sync:update", (updateBuffer) => {
      const update = new Uint8Array(updateBuffer);
      Y.applyUpdate(doc, update, "server");
    });

    const handleYjsUpdate = (update: Uint8Array, origin: any) => {
      if (origin !== "server") {
        socket.emit("sync:update", docId, update);
      }
    };
    doc.on("update", handleYjsUpdate);

    // 4. Awareness Sync
    socket.on("sync:awareness", (updateBuffer) => {
      const update = new Uint8Array(updateBuffer);
      applyAwarenessUpdate(awareness, update, "remote");
    });

    const handleAwarenessUpdate = ({ added, updated, removed }: any, origin: any) => {
      if (origin === "local") {
        const changedClients = added.concat(updated, removed);
        const update = encodeAwarenessUpdate(awareness, changedClients);
        socket.emit("sync:awareness", docId, update);
      }
      
      // Update local React state for the PresenceBar
      const users = new Map<string, PresenceUser>();
      awareness.getStates().forEach((state, clientId) => {
        if (state.user) {
          // Use clientId as the unique key for cursors
          users.set(clientId.toString(), {
            id: clientId.toString(),
            displayName: state.user.name,
            color: state.user.color
          });
        }
      });
      setActiveUsers(users);
    };
    
    awareness.on("update", handleAwarenessUpdate);

    return () => {
      doc.off("update", handleYjsUpdate);
      awareness.off("update", handleAwarenessUpdate);
      socket.emit("doc:leave", docId);
      socket.disconnect();
      awareness.destroy();
    };
  }, [docId, token, user, doc, awareness]);

  return { doc, ytext, awareness, isConnected, isSynced, error, activeUsers };
}
