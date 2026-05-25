"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../../lib/auth";
import { useYjsSync } from "../../../hooks/useYjsSync";
import { useComments } from "../../../hooks/useComments";
import { Editor } from "../../../components/Editor";
import { PresenceBar } from "../../../components/PresenceBar";
import { CommentSidebar } from "../../../components/CommentSidebar";
import styles from "../../../components/editor.module.css";
import type { Document } from "@codecollab/shared";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001";

export default function DocumentPage() {
  const params = useParams();
  const docId = params.id as string;
  const router = useRouter();
  
  const { user, token, isLoading } = useAuth();
  const [docMeta, setDocMeta] = useState<Document | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  
  // Comment UI state
  const [activeNewLine, setActiveNewLine] = useState<number | null>(null);

  // 1. Fetch document metadata
  useEffect(() => {
    if (!token || !docId) return;

    const fetchDocMeta = async () => {
      try {
        const res = await fetch(`${SERVER_URL}/api/documents/${docId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        
        if (data.success && data.data) {
          setDocMeta(data.data);
        } else {
          setFetchError(data.error || "Document not found");
        }
      } catch (err) {
        setFetchError("Failed to fetch document");
      }
    };

    fetchDocMeta();
  }, [docId, token]);

  // 2. Initialize Yjs + Socket.io sync engine
  const { doc, ytext, awareness, isConnected, isSynced, error: syncError, activeUsers, socket } = useYjsSync(docId);

  // 3. Initialize Comments engine
  const { threads, createThread, addReply, resolveThread } = useComments(docId, socket);

  // Authentication check
  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login");
    }
  }, [user, isLoading, router]);

  if (isLoading || !user) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner}></div>
        <p>Authenticating...</p>
      </div>
    );
  }

  if (fetchError || syncError) {
    return (
      <div className={styles.errorBox}>
        <h2>{fetchError || syncError}</h2>
        <button className={styles.button} onClick={() => router.push("/")}>
          Return to Dashboard
        </button>
      </div>
    );
  }

  const copyShareLink = () => {
    navigator.clipboard.writeText(window.location.href);
    alert("Share link copied to clipboard!"); // Simple alert for Layer 1
  };

  return (
    <div className={styles.container}>
      {/* Top Header */}
      <header className={styles.header}>
        <div className={styles.titleSection}>
          <Link href="/" className={styles.backButton} title="Back to Dashboard">
            ←
          </Link>
          <span className={styles.docTitle}>
            {docMeta ? docMeta.title : "Loading document..."}
          </span>
          <div className={styles.connectionStatus}>
            <div className={`${styles.dot} ${isConnected ? styles.connected : ""}`}></div>
            {isConnected ? (isSynced ? "Synced" : "Syncing...") : "Disconnected"}
          </div>
          <button onClick={copyShareLink} className={styles.shareButton}>
            Share
          </button>
        </div>

        {/* Presence / Active Users */}
        <PresenceBar users={activeUsers} />
      </header>

      {/* Main Content Area */}
      <div className={styles.mainContent} style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Main Editor Area */}
        <main className={styles.editorWrapper} style={{ flex: 1, minWidth: 0 }}>
          <Editor 
            ytext={ytext} 
            awareness={awareness}
            disabled={!isConnected || !isSynced} 
            onCommentClick={(line) => setActiveNewLine(line)}
          />
        </main>

        {/* Sidebar */}
        <CommentSidebar 
          threads={threads}
          activeNewLine={activeNewLine}
          onCloseNewLine={() => setActiveNewLine(null)}
          onCreateThread={createThread}
          onAddReply={addReply}
          onResolveThread={resolveThread}
        />
      </div>
    </div>
  );
}
