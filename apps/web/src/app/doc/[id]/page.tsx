"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../../lib/auth";
import { useYjsSync } from "../../../hooks/useYjsSync";
import { useComments } from "../../../hooks/useComments";
import { Editor } from "../../../components/Editor";
import { DiffEditor } from "../../../components/DiffEditor";
import { PresenceBar } from "../../../components/PresenceBar";
import { CommentSidebar } from "../../../components/CommentSidebar";
import { FileTreeSidebar } from "../../../components/FileTreeSidebar";
import { ShareDialog } from "../../../components/ShareDialog";
import { PushDialog } from "../../../components/PushDialog";
import { RequestReviewDialog } from "../../../components/RequestReviewDialog";
import type { FolderContext } from "../../../lib/folderLink";
import { Sidebar, GitBranch, GitPullRequest } from "lucide-react";
import styles from "../../../components/editor.module.css";
import type { Document, PresenceUser, FolderPresenceEntry } from "@codecollab/shared";
import toast from "react-hot-toast";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001";

// Cache document metadata across navigations so revisiting a file renders its
// header/editor immediately instead of flashing the loading skeleton.
const docMetaCache = new Map<string, Document>();

export default function DocumentPage() {
  const params = useParams();
  const docId = params.id as string;
  const router = useRouter();

  // Folder context (set when arriving from / sharing a folder view).
  // Read from the URL on the client to avoid the Suspense requirement that
  // useSearchParams imposes during prerendering.
  const [folderContext, setFolderContext] = useState<FolderContext | undefined>(undefined);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const fuid = sp.get("fuid");
    const frepo = sp.get("frepo");
    const fbranch = sp.get("fbranch");
    setFolderContext(fuid && frepo ? { uid: fuid, repo: frepo, branch: fbranch ?? "" } : undefined);
  }, [docId]);

  const { user, token, isLoading } = useAuth();
  const [docMeta, setDocMeta] = useState<Document | null>(() => docMetaCache.get(docId) ?? null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  
  // UI State
  const [activeNewLine, setActiveNewLine] = useState<number | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState("");
  const [viewMode, setViewMode] = useState<"code" | "diff">("code");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isPushOpen, setIsPushOpen] = useState(false);
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  // Map of docId -> collaborators currently on that file (within the folder).
  const [folderPresence, setFolderPresence] = useState<Map<string, PresenceUser[]>>(new Map());

  // 1. Fetch document metadata.
  // Show any cached metadata for this file immediately (no skeleton flash on
  // revisit), then refresh in the background to pick up any changes.
  useEffect(() => {
    if (!token || !docId) return;

    const cached = docMetaCache.get(docId);
    if (cached) {
      setDocMeta(cached);
      setFetchError(null);
    }

    const fetchDocMeta = async () => {
      try {
        const res = await fetch(`${SERVER_URL}/api/documents/${docId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();

        if (data.success && data.data) {
          docMetaCache.set(docId, data.data);
          setDocMeta(data.data);
        } else if (!cached) {
          setFetchError(data.error || "Document not found");
        }
      } catch (err) {
        if (!cached) setFetchError("Failed to fetch document");
      }
    };

    fetchDocMeta();
  }, [docId, token]);

  // 2. Initialize Yjs + Socket.io sync engine
  const { doc, ytext, awareness, isConnected, isSynced, error: syncError, activeUsers, socket } = useYjsSync(docId);

  // 2b. Folder presence — subscribe to where others in the folder are working.
  // Leaving only happens when we exit the folder or unmount, not on file switch.
  useEffect(() => {
    if (!socket || !folderContext) {
      setFolderPresence(new Map());
      return;
    }
    const folderKey = `${folderContext.uid}|${folderContext.repo}|${folderContext.branch}`;

    const handleFolderPresence = (entries: FolderPresenceEntry[]) => {
      const byDoc = new Map<string, PresenceUser[]>();
      for (const e of entries) {
        if (e.userId === user?.id) continue; // don't show ourselves
        const list = byDoc.get(e.docId) ?? [];
        list.push({ id: e.userId, displayName: e.displayName, color: e.color });
        byDoc.set(e.docId, list);
      }
      setFolderPresence(byDoc);
    };

    socket.on("folder:presence", handleFolderPresence);
    return () => {
      socket.off("folder:presence", handleFolderPresence);
      socket.emit("folder:leave", folderKey);
    };
  }, [socket, folderContext, user?.id]);

  // 2c. Announce the file we're currently on within the folder. Re-runs on file
  // switch; the server updates our location in place (no leave/rejoin churn).
  useEffect(() => {
    if (!socket || !folderContext) return;
    const folderKey = `${folderContext.uid}|${folderContext.repo}|${folderContext.branch}`;
    const announce = () => socket.emit("folder:join", folderKey, docId);
    if (socket.connected) announce();
    socket.on("connect", announce);
    return () => {
      socket.off("connect", announce);
    };
  }, [socket, folderContext, docId]);

  // 3. Listen for WebSocket title updates
  useEffect(() => {
    if (!socket) return;
    const handleRenamed = (newTitle: string) => {
      setDocMeta(prev => prev ? { ...prev, title: newTitle } : prev);
    };
    socket.on("document:renamed", handleRenamed);
    return () => {
      socket.off("document:renamed", handleRenamed);
    };
  }, [socket]);

  const handleTitleClick = () => {
    if (!docMeta || docMeta.githubFilePath) return; // Cannot edit GitHub docs
    setEditTitleValue(docMeta.title);
    setIsEditingTitle(true);
  };

  const handleTitleSave = async () => {
    setIsEditingTitle(false);
    if (!docMeta || !editTitleValue.trim() || editTitleValue === docMeta.title) return;

    const oldTitle = docMeta.title;
    const newTitle = editTitleValue.trim();

    // Optimistically update
    setDocMeta({ ...docMeta, title: newTitle });

    try {
      const res = await fetch(`${SERVER_URL}/api/documents/${docId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title: newTitle }),
      });

      if (res.ok && socket) {
        // Broadcast the rename to other users!
        socket.emit("document:renamed", docId, newTitle);
      } else {
        // Revert on error
        setDocMeta({ ...docMeta, title: oldTitle });
        toast.error("Failed to rename document");
      }
    } catch (err) {
      setDocMeta({ ...docMeta, title: oldTitle });
      toast.error("Network error while renaming");
    }
  };

  // 3. Initialize Comments engine
  const { threads, createThread, addReply, resolveThread } = useComments(docId, socket);

  // 3.5. Review Status Socket & Handlers
  useEffect(() => {
    if (!socket) return;
    socket.on("document:review_updated", (status) => {
      setDocMeta(prev => prev ? { ...prev, reviewStatus: status as any } : null);
    });
    return () => {
      socket.off("document:review_updated");
    };
  }, [socket]);

  const handleReviewStatusChange = async (status: 'none' | 'pending' | 'approved' | 'changes_requested') => {
    if (!docMeta) return;
    try {
      const res = await fetch(`${SERVER_URL}/api/documents/${docId}/review`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setDocMeta({ ...docMeta, reviewStatus: status });
        if (status === 'pending') toast.success('Review requested!');
        else if (status === 'none') toast.success('Review cancelled.');
        else toast.success(`Document marked as ${status === 'approved' ? 'Approved' : 'Changes Requested'}`);
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to update review status");
      }
    } catch (err) {
      toast.error("Network error");
    }
  };

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

  const handleShareClick = () => {
    // Owners get the full manage-access dialog; everyone else just copies a link.
    if (docMeta?.access === "owner") {
      setIsShareOpen(true);
    } else {
      navigator.clipboard.writeText(window.location.href);
      toast.success("Share link copied to clipboard!");
    }
  };

  return (
    <div className={styles.container}>
      {/* Top Header */}
      <header className={styles.header}>
        <div className={styles.titleSection}>
          <Link href="/" className={styles.backButton} title="Back to Dashboard">
            ←
          </Link>
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className={styles.sidebarToggleBtn}
            style={{ 
              background: 'transparent', border: 'none', color: 'var(--color-text-secondary)', 
              cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center',
              marginRight: '12px', borderRadius: '4px'
            }}
            title="Toggle File Explorer"
          >
            <Sidebar size={18} />
          </button>
          <span className={styles.docTitle} style={{ display: 'flex', alignItems: 'center' }}>
            {docMeta ? (
              isEditingTitle ? (
                <input
                  type="text"
                  value={editTitleValue}
                  onChange={(e) => setEditTitleValue(e.target.value)}
                  onBlur={handleTitleSave}
                  onKeyDown={(e) => e.key === "Enter" && handleTitleSave()}
                  autoFocus
                  className={styles.titleInput}
                />
              ) : (
                <span 
                  onClick={handleTitleClick} 
                  style={{ cursor: docMeta.githubFilePath ? "default" : "pointer" }}
                  className={!docMeta.githubFilePath ? styles.editableTitleHover : ""}
                >
                  {docMeta.title}
                </span>
              )
            ) : (
              "Loading document..."
            )}
            {docMeta?.githubRepo && (
              <span style={{ fontSize: '0.8rem', color: '#8b949e', marginLeft: '12px', fontWeight: 'normal', background: 'rgba(255,255,255,0.1)', padding: '2px 8px', borderRadius: '12px' }}>
                <svg height="12" width="12" viewBox="0 0 16 16" fill="currentColor" style={{ verticalAlign: "middle", marginRight: "4px", marginBottom: "2px" }}>
                  <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path>
                </svg>
                {docMeta.githubRepo} • {docMeta.githubBranch}
              </span>
            )}
            {docMeta && (
              <span style={{ fontSize: '0.8rem', color: '#8b949e', marginLeft: '12px', fontWeight: 'normal' }}>
                {docMeta.githubFilePath 
                  ? "Imported from GitHub" 
                  : docMeta.ownerId === user?.id ? "Created by You" : `Created by ${docMeta.ownerDisplayName}`}
              </span>
            )}
          </span>

          {docMeta && (
            docMeta.reviewStatus === 'none' || !docMeta.reviewStatus ? (
              docMeta.ownerId === user?.id ? (
                <div style={{ marginLeft: 'auto' }}>
                  <button 
                    onClick={() => handleReviewStatusChange('pending')}
                    style={{
                      background: 'rgba(255,255,255,0.1)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      color: 'white',
                      padding: '4px 12px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      fontWeight: 500
                    }}
                  >
                    Request Review
                  </button>
                </div>
              ) : <div style={{ marginLeft: 'auto' }}></div>
            ) : (
              <div className={styles.reviewStatusContainer} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto', background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '8px' }}>
                {docMeta.reviewStatus === 'approved' && (
                  <span style={{ color: '#4ade80', fontSize: '0.8rem', fontWeight: 600 }}>✅ Approved</span>
                )}
                {docMeta.reviewStatus === 'changes_requested' && (
                  <span style={{ color: '#f87171', fontSize: '0.8rem', fontWeight: 600 }}>❌ Changes Requested</span>
                )}
                {docMeta.reviewStatus === 'pending' && (
                  <span style={{ color: '#9ca3af', fontSize: '0.8rem', fontWeight: 600 }}>⏳ Pending Review</span>
                )}
                
                <div style={{ display: 'flex', gap: '4px', marginLeft: '8px' }}>
                  {docMeta.ownerId === user?.id ? (
                    <button
                      onClick={() => handleReviewStatusChange('none')}
                      style={{
                        background: 'transparent',
                        border: '1px solid rgba(255,255,255,0.3)',
                        color: '#9ca3af',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '0.75rem'
                      }}
                    >
                      Cancel Review
                    </button>
                  ) : (
                    <>
                      <button 
                        onClick={() => handleReviewStatusChange('approved')}
                        title="Approve"
                        style={{
                          background: docMeta.reviewStatus === 'approved' ? 'rgba(74, 222, 128, 0.2)' : 'transparent',
                          border: '1px solid rgba(74, 222, 128, 0.5)',
                          color: '#4ade80',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '0.75rem'
                        }}
                      >
                        Approve
                      </button>
                      <button 
                        onClick={() => handleReviewStatusChange('changes_requested')}
                        title="Request Changes"
                        style={{
                          background: docMeta.reviewStatus === 'changes_requested' ? 'rgba(248, 113, 113, 0.2)' : 'transparent',
                          border: '1px solid rgba(248, 113, 113, 0.5)',
                          color: '#f87171',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '0.75rem'
                        }}
                      >
                        Request Changes
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          )}

          {docMeta?.baseContent && (
            <div className={styles.viewToggle}>
              <button 
                className={`${styles.toggleButton} ${viewMode === "code" ? styles.active : ""}`}
                onClick={() => setViewMode("code")}
              >
                Code
              </button>
              <button 
                className={`${styles.toggleButton} ${viewMode === "diff" ? styles.active : ""}`}
                onClick={() => setViewMode("diff")}
              >
                Diff
              </button>
            </div>
          )}
          {docMeta?.access === "viewer" && (
            <span style={{ fontSize: "0.8rem", color: "#fbbf24", fontWeight: 600, background: "rgba(251,191,36,0.12)", padding: "2px 10px", borderRadius: "12px" }}>
              View only
            </span>
          )}
          <div className={styles.connectionStatus}>
            <div className={`${styles.dot} ${isConnected ? styles.connected : ""}`}></div>
            {isConnected ? (isSynced ? "Synced" : "Syncing...") : "Disconnected"}
          </div>
          {folderContext && folderContext.repo && (
            <>
              <button
                onClick={() => setIsReviewOpen(true)}
                className={styles.shareButton}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                title="Push, open a GitHub PR, and request a review"
              >
                <GitPullRequest size={14} /> Submit for review
              </button>
              <button
                onClick={() => setIsPushOpen(true)}
                className={styles.shareButton}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                title="Push changed files to GitHub"
              >
                <GitBranch size={14} /> Push
              </button>
            </>
          )}
          <button onClick={handleShareClick} className={styles.shareButton}>
            Share
          </button>
        </div>

        {/* Presence / Active Users */}
        <PresenceBar users={activeUsers} />
      </header>

      {/* Main Content Area */}
      <div className={styles.mainContent} style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <FileTreeSidebar currentDocId={docId} isOpen={isSidebarOpen} folderContext={folderContext} presenceByDoc={folderPresence} />
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
            <main className={styles.editorWrapper} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              {viewMode === "diff" && docMeta.baseContent ? (
                <DiffEditor
                  ytext={ytext}
                  awareness={awareness}
                  baseContent={docMeta.baseContent}
                  filename={docMeta.githubFilePath || docMeta.title}
                />
              ) : (
                <Editor
                  ytext={ytext}
                  awareness={awareness}
                  disabled={!isConnected || !isSynced || docMeta.access === "viewer"}
                  filename={docMeta.githubFilePath || docMeta.title}
                  onCommentClick={(line) => setActiveNewLine(line)}
                />
              )}
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

      {isShareOpen && docMeta && (
        <ShareDialog
          target={{ kind: "file", docId: docId, title: docMeta.title }}
          shareLink={`${window.location.origin}/doc/${docId}`}
          onClose={() => setIsShareOpen(false)}
        />
      )}

      {isPushOpen && folderContext && (
        <PushDialog folder={folderContext} onClose={() => setIsPushOpen(false)} />
      )}

      {isReviewOpen && folderContext && (
        <RequestReviewDialog folder={folderContext} onClose={() => setIsReviewOpen(false)} />
      )}
    </div>
  );
}
