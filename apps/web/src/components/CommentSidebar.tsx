"use client";

import React, { useState } from "react";
import type { CommentThread } from "@codecollab/shared";
import styles from "./commentSidebar.module.css";

interface CommentSidebarProps {
  threads: CommentThread[];
  activeNewLine: number | null;
  onCloseNewLine: () => void;
  onCreateThread: (line: number, content: string) => void;
  onAddReply: (threadId: string, content: string) => void;
  onResolveThread: (threadId: string) => void;
}

export function CommentSidebar({
  threads,
  activeNewLine,
  onCloseNewLine,
  onCreateThread,
  onAddReply,
  onResolveThread
}: CommentSidebarProps) {
  const [newThreadContent, setNewThreadContent] = useState("");
  const [replyContents, setReplyContents] = useState<Record<string, string>>({});

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newThreadContent.trim() || activeNewLine === null) return;
    onCreateThread(activeNewLine, newThreadContent);
    setNewThreadContent("");
    onCloseNewLine();
  };

  const handleReplySubmit = (e: React.FormEvent, threadId: string) => {
    e.preventDefault();
    const content = replyContents[threadId];
    if (!content?.trim()) return;
    onAddReply(threadId, content);
    setReplyContents(prev => ({ ...prev, [threadId]: "" }));
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <h3>Comments</h3>
      </div>
      
      <div className={styles.threadList}>
        {/* Form for new thread (triggered by gutter click) */}
        {activeNewLine !== null && (
          <div className={styles.threadCard}>
            <div className={styles.threadHeader}>
              <span className={styles.lineNumber}>Line {activeNewLine}</span>
              <button className={styles.closeBtn} onClick={onCloseNewLine}>×</button>
            </div>
            <form onSubmit={handleCreateSubmit} className={styles.replyForm}>
              <textarea 
                className={styles.textarea}
                placeholder="Start a discussion..."
                value={newThreadContent}
                onChange={e => setNewThreadContent(e.target.value)}
                autoFocus
              />
              <div className={styles.formActions}>
                <button type="submit" className={styles.submitBtn}>Comment</button>
              </div>
            </form>
          </div>
        )}

        {threads.length === 0 && activeNewLine === null && (
          <div className={styles.emptyState}>
            No comments yet. Hover over a line number to add one!
          </div>
        )}

        {/* Existing Threads */}
        {threads.map(thread => (
          <div key={thread.id} className={styles.threadCard}>
            <div className={styles.threadHeader}>
              <span className={styles.lineNumber}>Line {thread.lineNumber}</span>
              <button 
                className={styles.resolveBtn} 
                onClick={() => onResolveThread(thread.id)}
                title="Resolve thread"
              >
                ✓ Resolve
              </button>
            </div>

            <div className={styles.commentList}>
              {thread.comments.map((comment, index) => (
                <div key={comment.id} className={styles.comment}>
                  <div className={styles.commentMeta}>
                    <strong>{comment.authorName}</strong>
                    <span className={styles.time}>
                      {new Date(comment.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className={styles.commentContent}>{comment.content}</div>
                </div>
              ))}
            </div>

            <form onSubmit={e => handleReplySubmit(e, thread.id)} className={styles.replyForm}>
              <input 
                type="text"
                className={styles.replyInput}
                placeholder="Reply..."
                value={replyContents[thread.id] || ""}
                onChange={e => setReplyContents(prev => ({ ...prev, [thread.id]: e.target.value }))}
              />
              <button type="submit" className={styles.replySubmitBtn}>→</button>
            </form>
          </div>
        ))}
      </div>
    </aside>
  );
}
