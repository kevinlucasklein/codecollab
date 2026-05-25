"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/auth";
import type { Document } from "@codecollab/shared";
import styles from "./dashboard.module.css";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001";

export default function DashboardPage() {
  const { user, token, isLoading, logout } = useAuth();
  const router = useRouter();
  
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

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
          <button 
            className={styles.newButton} 
            onClick={handleCreateNew}
            disabled={isCreating}
          >
            {isCreating ? "Creating..." : "+ New Document"}
          </button>
        </div>

        {isFetching ? (
          <div className={styles.docsLoading}>Loading documents...</div>
        ) : documents.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>📄</div>
            <h3>No documents found</h3>
            <p>Create your first code review session!</p>
            <button className={styles.newButton} onClick={handleCreateNew}>
              Create Document
            </button>
          </div>
        ) : (
          <div className={styles.grid}>
            {documents.map((doc) => (
              <div 
                key={doc.id} 
                className={styles.docCard}
                onClick={() => router.push(`/doc/${doc.id}`)}
              >
                <div className={styles.docIcon}>{"</>"}</div>
                <div className={styles.docInfo}>
                  <h3 className={styles.docTitle}>{doc.title}</h3>
                  <div className={styles.docMeta}>
                    <span>{doc.language}</span>
                    <span>•</span>
                    <span>Edited {formatDate(doc.updatedAt)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
