import { useEffect, useState, useMemo } from "react";
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

// ---------------------------------------------------------------------------
// Persistent (warm) socket — shared across file switches.
// Reconnecting the WebSocket on every navigation is the main source of the
// "blink": each switch paid for a fresh handshake + auth + room join before
// any content could appear. Keeping one connection alive and just switching
// rooms makes switching feel instant.
// ---------------------------------------------------------------------------
let sharedSocket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
let sharedSocketToken: string | null = null;

function getSharedSocket(token: string): Socket<ServerToClientEvents, ClientToServerEvents> {
  // If the auth token changed (e.g. re-login), drop the old socket.
  if (sharedSocket && sharedSocketToken !== token) {
    sharedSocket.disconnect();
    sharedSocket = null;
  }
  if (!sharedSocket) {
    sharedSocket = io(SERVER_URL, {
      auth: { token },
      transports: ["websocket"],
    });
    sharedSocketToken = token;
  }
  return sharedSocket;
}

// ---------------------------------------------------------------------------
// One Y.Doc cached per document id. This guarantees content never bleeds
// between files, and means revisiting a file is instant (its CRDT state is
// already in memory, so there's nothing to re-fetch and nothing to flash).
// ---------------------------------------------------------------------------
const docCache = new Map<string, { doc: Y.Doc; ytext: Y.Text }>();

function getDocEntry(docId: string): { doc: Y.Doc; ytext: Y.Text } {
  let entry = docCache.get(docId);
  if (!entry) {
    const doc = new Y.Doc();
    entry = { doc, ytext: doc.getText("monaco") };
    docCache.set(docId, entry);
  }
  return entry;
}

export function useYjsSync(docId: string) {
  const { token, user } = useAuth();

  // Per-document Yjs state (stable for a given docId, recreated when it changes).
  const { doc, ytext } = useMemo(() => getDocEntry(docId), [docId]);

  // Awareness is per-document (cursors/presence belong to the open file).
  const awareness = useMemo(() => new Awareness(doc), [doc]);

  // React State
  const [isConnected, setIsConnected] = useState(false);
  const [isSynced, setIsSynced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeUsers, setActiveUsers] = useState<Map<string, PresenceUser>>(new Map());
  const [socket, setSocket] = useState<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);

  useEffect(() => {
    if (!token || !user) return;

    // Reuse the warm, shared socket instead of opening a new one per file.
    const sock = getSharedSocket(token);
    setSocket(sock);

    // Set local awareness state
    awareness.setLocalStateField("user", {
      name: user.displayName,
      color: getUserColor(user.id),
      colorLight: getUserColor(user.id) // y-codemirror.next uses this for cursor selection
    });

    // If this document's CRDT state is already in memory (revisiting a file),
    // treat it as synced immediately so the editor shows content with no flash.
    if (ytext.length > 0) {
      setIsSynced(true);
    }

    // Join the document room (works whether the socket is already connected
    // or connects in a moment).
    const joinRoom = () => {
      setIsConnected(true);
      setError(null);
      sock.emit("doc:join", docId, (response) => {
        if (!response.success) {
          setError(response.error || "Failed to join document");
        } else {
          const update = encodeAwarenessUpdate(awareness, [awareness.clientID]);
          sock.emit("sync:awareness", docId, update);
        }
      });
    };

    const handleConnect = () => joinRoom();
    const handleDisconnect = () => {
      setIsConnected(false);
      setIsSynced(false);
    };
    const handleConnectError = (err: Error) => {
      setError(`Connection error: ${err.message}`);
      setIsConnected(false);
    };

    const handleDocLoaded = (stateBuffer: Uint8Array) => {
      Y.applyUpdate(doc, new Uint8Array(stateBuffer), "server");
      setIsSynced(true);
    };
    const handleSyncUpdate = (updateBuffer: Uint8Array) => {
      Y.applyUpdate(doc, new Uint8Array(updateBuffer), "server");
    };
    const handleRemoteAwareness = (updateBuffer: Uint8Array) => {
      applyAwarenessUpdate(awareness, new Uint8Array(updateBuffer), "remote");
    };

    const handleYjsUpdate = (update: Uint8Array, origin: any) => {
      if (origin !== "server") {
        sock.emit("sync:update", docId, update);
      }
    };
    // Awareness is still used for live cursors (via y-codemirror); we only
    // broadcast local changes. The participant list itself now comes from the
    // server's authoritative presence:update event (no stale ghosts).
    const handleAwarenessUpdate = ({ added, updated, removed }: any, origin: any) => {
      if (origin === "local") {
        const changedClients = added.concat(updated, removed);
        const update = encodeAwarenessUpdate(awareness, changedClients);
        sock.emit("sync:awareness", docId, update);
      }
    };

    // Server-authoritative presence: a deduped list of users in the room.
    // Exclude ourselves so the bar shows "others editing".
    const handlePresence = (users: PresenceUser[]) => {
      const map = new Map<string, PresenceUser>();
      users.forEach((u) => {
        if (u.id !== user.id) map.set(u.id, u);
      });
      setActiveUsers(map);
    };

    sock.on("connect", handleConnect);
    sock.on("disconnect", handleDisconnect);
    sock.on("connect_error", handleConnectError);
    sock.on("doc:loaded", handleDocLoaded);
    sock.on("sync:update", handleSyncUpdate);
    sock.on("sync:awareness", handleRemoteAwareness);
    sock.on("presence:update", handlePresence);
    doc.on("update", handleYjsUpdate);
    awareness.on("update", handleAwarenessUpdate);

    // Socket may already be connected (warm) — join right away.
    if (sock.connected) {
      joinRoom();
    }

    return () => {
      // Detach only this file's handlers; keep the socket warm for the next file.
      doc.off("update", handleYjsUpdate);
      awareness.off("update", handleAwarenessUpdate);
      sock.off("connect", handleConnect);
      sock.off("disconnect", handleDisconnect);
      sock.off("connect_error", handleConnectError);
      sock.off("doc:loaded", handleDocLoaded);
      sock.off("sync:update", handleSyncUpdate);
      sock.off("sync:awareness", handleRemoteAwareness);
      sock.off("presence:update", handlePresence);
      setActiveUsers(new Map());
      sock.emit("doc:leave", docId);
      awareness.destroy();
    };
  }, [docId, token, user, doc, awareness, ytext]);

  return { doc, ytext, awareness, isConnected, isSynced, error, activeUsers, socket };
}
