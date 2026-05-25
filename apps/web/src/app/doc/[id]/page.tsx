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
import toast from "react-hot-toast";

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

  // 4. Handle GitHub Initial Seeding
  useEffect(() => {
    if (isSynced && ytext && ytext.toString() === "") {
      const seed = localStorage.getItem(`github_seed_${docId}`);
      if (seed) {
        ytext.insert(0, seed);
        localStorage.removeItem(`github_seed_${docId}`);
      }
    }
  }, [isSynced, ytext, docId]);

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
    toast.success("Share link copied to clipboard!");
  };

  return (
    <div className={styles.container}>
      {/* Top Header */}
      <header className={styles.header}>
        <div className={styles.titleSection}>
          <Link href="/" className={styles.backButton} title="Back to Dashboard">
            ←
          </Link>
          <span className={styles.docTitle} style={{ display: 'flex', alignItems: 'center' }}>
            {docMeta ? docMeta.title : "Loading document..."}
            {docMeta?.githubRepo && (
              <span style={{ fontSize: '0.8rem', color: '#8b949e', marginLeft: '12px', fontWeight: 'normal', background: 'rgba(255,255,255,0.1)', padding: '2px 8px', borderRadius: '12px' }}>
                <svg height="12" width="12" viewBox="0 0 16 16" fill="currentColor" style={{ verticalAlign: "middle", marginRight: "4px", marginBottom: "2px" }}>
                  <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path>
                </svg>
                {docMeta.githubRepo} • {docMeta.githubBranch}
              </span>
            )}
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
        {!docMeta ? (
          <div className={styles.skeletonWrapper}>
            <div className={styles.skeletonLine} style={{ width: '60%' }}></div>
            <div className={styles.skeletonLine} style={{ width: '80%' }}></div>
            <div className={styles.skeletonLine} style={{ width: '40%' }}></div>
            <div className={styles.skeletonLine} style={{ width: '70%' }}></div>
            <div className={styles.skeletonLine} style={{ width: '50%' }}></div>
          </div>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
