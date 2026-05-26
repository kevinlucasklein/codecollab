"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/auth";
import type { Document } from "@codecollab/shared";
import { getFileIconMeta } from "../lib/fileIcons";
import { Pencil, Share2, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import styles from "./dashboard.module.css";

import RepoBrowser from "../components/RepoBrowser";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001";

export default function DashboardPage() {
  const { user, token, isLoading, logout } = useAuth();
  const router = useRouter();
  
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [showRepoBrowser, setShowRepoBrowser] = useState(false);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login");
    }
  }, [user, isLoading, router]);

  // Fetch documents
  useEffect(() => {
    if (!user || !token) return;

    const fetchDocs = async () => {
      try {
        const res = await fetch(`${SERVER_URL}/api/documents`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.success && data.data) {
          setDocuments(data.data);
        }
      } catch (error) {
        console.error("Failed to fetch documents:", error);
      } finally {
        setIsFetching(false);
      }
    };

    fetchDocs();
  }, [user, token]);

  const handleConnectGithub = () => {
    if (!token) return;
    window.location.href = `${SERVER_URL}/api/auth/github?token=${token}`;
  };

  const handleCreateNew = async () => {
    if (!token) return;
    setIsCreating(true);

    try {
      const res = await fetch(`${SERVER_URL}/api/documents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title: "Untitled Document", language: "plaintext" }),
      });
      const data = await res.json();
      
      if (data.success && data.data) {
        router.push(`/doc/${data.data.id}`);
      }
    } catch (error) {
      console.error("Failed to create document:", error);
      setIsCreating(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, docId: string) => {
    e.stopPropagation();
    if (!token) return;
    if (!confirm("Are you sure you want to delete this document? This action cannot be undone.")) return;

    try {
      const res = await fetch(`${SERVER_URL}/api/documents/${docId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setDocuments(documents.filter(d => d.id !== docId));
        toast.success("Document deleted");
      } else {
        toast.error("Failed to delete document");
      }
    } catch (err) {
      toast.error("Network error");
    }
  };

  const handleShare = (e: React.MouseEvent, docId: string) => {
    e.stopPropagation();
    const url = `${window.location.origin}/doc/${docId}`;
    navigator.clipboard.writeText(url);
    toast.success("Share link copied to clipboard!");
  };

  const handleRenameStart = (e: React.MouseEvent, doc: Document) => {
    e.stopPropagation();
    if (doc.githubFilePath) return; // Cannot rename GitHub docs
    setEditingDocId(doc.id);
    setEditingTitle(doc.title);
  };

  const handleRenameSave = async (e: React.FocusEvent | React.KeyboardEvent, docId: string) => {
    e.stopPropagation();
    if (!token) return;
    
    setEditingDocId(null);
    const newTitle = editingTitle.trim();
    const doc = documents.find(d => d.id === docId);
    if (!doc || !newTitle || newTitle === doc.title) return;

    // Optimistic update
    setDocuments(documents.map(d => d.id === docId ? { ...d, title: newTitle } : d));

    try {
      const res = await fetch(`${SERVER_URL}/api/documents/${docId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title: newTitle }),
      });
      if (!res.ok) {
        // Revert
        setDocuments(documents.map(d => d.id === docId ? { ...d, title: doc.title } : d));
        toast.error("Failed to rename document");
      }
    } catch (err) {
      setDocuments(documents.map(d => d.id === docId ? { ...d, title: doc.title } : d));
      toast.error("Network error");
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  if (isLoading || !user) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.spinner}></div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <div className={styles.logo}>CodeCollab</div>
          <div className={styles.userSection}>
            <span className={styles.userName}>{user.displayName}</span>
            <button onClick={logout} className={styles.logoutButton}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>Your Documents</h1>
          <div style={{ display: "flex", gap: "var(--spacing-md)" }}>
            {!user.githubAccessToken ? (
              <button 
                className={styles.newButton} 
                style={{ background: "#24292e" }}
                onClick={handleConnectGithub}
              >
                Connect GitHub
              </button>
            ) : (
              <button 
                className={styles.newButton} 
                style={{ background: "#24292e" }}
                onClick={() => setShowRepoBrowser(true)}
              >
                Import from GitHub
              </button>
            )}
            <button 
              className={styles.newButton} 
              onClick={handleCreateNew}
              disabled={isCreating}
            >
              {isCreating ? "Creating..." : "+ New Document"}
            </button>
          </div>
        </div>

        {isFetching ? (
          <div className={styles.docsLoading}>Loading documents...</div>
        ) : documents.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>📄</div>
            <h3>No documents found</h3>
            <p>Create your first code review session!</p>
            <div style={{ display: "flex", gap: "var(--spacing-md)", justifyContent: "center", marginTop: "var(--spacing-lg)" }}>
              {user.githubAccessToken && (
                <button className={styles.newButton} style={{ background: "#24292e" }} onClick={() => setShowRepoBrowser(true)}>
                  Import from GitHub
                </button>
              )}
              <button className={styles.newButton} onClick={handleCreateNew}>
                Create Blank Document
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.grid}>
            {documents.map((doc) => {
              const meta = getFileIconMeta(doc.githubFilePath || doc.title);
              const Icon = meta.icon;

              return (
                <div 
                  key={doc.id} 
                  className={styles.docCard}
                  onClick={() => router.push(`/doc/${doc.id}`)}
                >
                  <div className={styles.cardActions}>
                    <button 
                      className={`${styles.actionButton} ${doc.githubFilePath ? styles.disabledActionButton : ""}`} 
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!doc.githubFilePath) handleRenameStart(e, doc);
                      }}
                      title={doc.githubFilePath ? "Cannot rename files imported from GitHub" : "Rename"}
                      disabled={!!doc.githubFilePath}
                    >
                      <Pencil size={16} />
                    </button>
                    <button 
                      className={styles.actionButton} 
                      onClick={(e) => handleShare(e, doc.id)}
                      title="Share link"
                    >
                      <Share2 size={16} />
                    </button>
                    <button 
                      className={`${styles.actionButton} ${styles.dangerButton}`} 
                      onClick={(e) => handleDelete(e, doc.id)}
                      title="Delete document"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>

                  <div className={styles.docIcon} style={{ 
                    color: meta.color, 
                    backgroundColor: `${meta.color}15`, 
                    border: `1px solid ${meta.color}30` 
                  }}>
                    <Icon size={24} />
                  </div>
                  <div className={styles.docInfo}>
                    {editingDocId === doc.id ? (
                      <input
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={(e) => handleRenameSave(e, doc.id)}
                        onKeyDown={(e) => e.key === "Enter" && handleRenameSave(e, doc.id)}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                        className={styles.dashboardTitleInput}
                      />
                    ) : (
                      <h3 className={styles.docTitle}>{doc.title}</h3>
                    )}
                    <div className={styles.docMeta}>
                      <span className={styles.repoTag}>
                        {doc.githubRepo ? (
                          <>
                            <svg height="14" width="14" viewBox="0 0 16 16" fill="currentColor" style={{ verticalAlign: "text-bottom", marginRight: "4px" }}>
                              <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path>
                            </svg>
                            {doc.githubRepo}
                          </>
                        ) : ""}
                      </span>
                      <span className={styles.metaType}>{meta.displayName}</span>
                      <span className={styles.metaAuthor}>
                        {doc.githubFilePath 
                          ? "Imported from GitHub" 
                          : doc.ownerId === user?.id ? "Created by You" : `Created by ${doc.ownerDisplayName}`}
                      </span>
                      <span>Edited {formatDate(doc.updatedAt)}</span>
                      {doc.reviewStatus === 'approved' || doc.reviewStatus === 'changes_requested' ? (
                        <span style={{ 
                          color: doc.reviewStatus === 'approved' ? '#4ade80' : '#f87171',
                          fontWeight: 600,
                          marginTop: '2px',
                          display: 'inline-block'
                        }}>
                          {doc.reviewStatus === 'approved' ? '✅ Approved' : '❌ Changes Requested'}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {showRepoBrowser && token && (
        <RepoBrowser token={token} onClose={() => setShowRepoBrowser(false)} />
      )}
    </div>
  );
}
