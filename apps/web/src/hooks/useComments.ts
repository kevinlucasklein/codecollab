import { useState, useEffect, useCallback } from "react";
import type { CommentThread, Comment, ServerToClientEvents, ClientToServerEvents } from "@gitlive/shared";
import { Socket } from "socket.io-client";
import { useAuth } from "../lib/auth";

const API_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001";

export function useComments(
  documentId: string, 
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null
) {
  const { token } = useAuth();
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Initial fetch
  useEffect(() => {
    if (!token) return;

    const fetchThreads = async () => {
      try {
        const res = await fetch(`${API_URL}/api/documents/${documentId}/comments`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const json = await res.json();
        if (json.success) {
          setThreads(json.data);
        }
      } catch (err) {
        console.error("Failed to fetch comments", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchThreads();
  }, [documentId, token]);

  // Listen to Socket.io events
  useEffect(() => {
    if (!socket) return;

    const onThreadCreated = (thread: CommentThread) => {
      console.log("[useComments] Received comment:thread_created", thread);
      setThreads(prev => [...prev, thread]);
    };

    const onCommentAdded = (comment: Comment) => {
      console.log("[useComments] Received comment:added", comment);
      setThreads(prev => prev.map(t => {
        if (t.id === comment.threadId) {
          return { ...t, comments: [...t.comments, comment] };
        }
        return t;
      }));
    };

    const onThreadResolved = (threadId: string) => {
      console.log("[useComments] Received comment:resolved", threadId);
      setThreads(prev => prev.filter(t => t.id !== threadId));
    };

    socket.on("comment:thread_created", onThreadCreated);
    socket.on("comment:added", onCommentAdded);
    socket.on("comment:resolved", onThreadResolved);

    return () => {
      socket.off("comment:thread_created", onThreadCreated);
      socket.off("comment:added", onCommentAdded);
      socket.off("comment:resolved", onThreadResolved);
    };
  }, [socket]);

  // Actions
  const createThread = useCallback(async (lineNumber: number, content: string) => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/documents/${documentId}/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ lineNumber, content })
      });
      const json = await res.json();
      if (json.success) {
        // Optimistic update
        setThreads(prev => [...prev, json.data]);
        // Broadcast
        console.log("[useComments] Emitting comment:thread_created", json.data);
        socket?.emit("comment:thread_created", documentId, json.data);
      }
    } catch (err) {
      console.error("Failed to create thread", err);
    }
  }, [documentId, token, socket]);

  const addReply = useCallback(async (threadId: string, content: string) => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/documents/${documentId}/comments/${threadId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ content })
      });
      const json = await res.json();
      if (json.success) {
        setThreads(prev => prev.map(t => {
          if (t.id === threadId) {
            return { ...t, comments: [...t.comments, json.data] };
          }
          return t;
        }));
        socket?.emit("comment:added", documentId, json.data);
      }
    } catch (err) {
      console.error("Failed to add reply", err);
    }
  }, [documentId, token, socket]);

  const resolveThread = useCallback(async (threadId: string) => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/documents/${documentId}/comments/${threadId}/resolve`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await res.json();
      if (json.success) {
        setThreads(prev => prev.filter(t => t.id !== threadId));
        socket?.emit("comment:resolved", documentId, threadId);
      }
    } catch (err) {
      console.error("Failed to resolve thread", err);
    }
  }, [documentId, token, socket]);

  return {
    threads,
    isLoading,
    createThread,
    addReply,
    resolveThread
  };
}
