"use client";

import React, { useEffect, useState } from "react";
import { X, GitPullRequest } from "lucide-react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { useAuth } from "../lib/auth";
import type { FolderContext } from "../lib/folderLink";
import type { ShareEntry } from "@codecollab/shared";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001";

interface RequestReviewDialogProps {
  folder: FolderContext; // uid (owner), repo, branch (base)
  onClose: () => void;
}

function suggestBranch(displayName: string | undefined): string {
  const slug = (displayName || "user").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `codecollab/${slug}-${new Date().toISOString().slice(0, 10)}`;
}

export function RequestReviewDialog({ folder, onClose }: RequestReviewDialogProps) {
  const { token, user } = useAuth();
  const router = useRouter();
  const [shares, setShares] = useState<ShareEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewerId, setReviewerId] = useState("");
  const [headBranch, setHeadBranch] = useState(suggestBranch(user?.displayName));
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(
          `${SERVER_URL}/api/folders/shares?repo=${encodeURIComponent(folder.repo)}&branch=${encodeURIComponent(folder.branch)}`,
          { headers: authHeaders }
        );
        const data = await res.json();
        if (data.success) {
          setShares(data.data);
          if (data.data.length > 0) setReviewerId(data.data[0].userId);
        }
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    };
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewerId || !headBranch.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${SERVER_URL}/api/reviews/submit`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          ownerId: folder.uid,
          repo: folder.repo,
          baseBranch: folder.branch,
          headBranch: headBranch.trim(),
          reviewerId,
          title,
          description,
          commitMessage: title,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Pushed, PR opened, review requested");
        onClose();
        router.push(`/review/${data.data.id}`);
      } else {
        toast.error(data.error || "Failed to submit for review");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={header}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <GitPullRequest size={18} />
            <h2 style={{ fontSize: "1.1rem", fontWeight: 600 }}>Submit for review</h2>
          </div>
          <button onClick={onClose} style={iconBtn}><X size={18} /></button>
        </div>

        <form onSubmit={submit} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: "0.82rem", color: "#8b949e" }}>
            Pushes your changes to a branch, opens a GitHub PR into{" "}
            <code style={code}>{folder.branch || "(default)"}</code>, and requests a review.
          </div>

          <label style={label}>
            Reviewer
            {loading ? (
              <span style={hint}>Loading people…</span>
            ) : shares.length === 0 ? (
              <span style={hint}>No one has this folder shared yet. Share it first, then request a review.</span>
            ) : (
              <select value={reviewerId} onChange={(e) => setReviewerId(e.target.value)} style={input} required>
                {shares.map((s) => (
                  <option key={s.userId} value={s.userId}>
                    {s.displayName} ({s.email})
                  </option>
                ))}
              </select>
            )}
          </label>

          <label style={label}>
            Head branch (your changes get pushed here)
            <input value={headBranch} onChange={(e) => setHeadBranch(e.target.value)} style={input} required />
          </label>

          <label style={label}>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} style={input} placeholder="Review request" />
          </label>

          <label style={label}>
            Description (optional)
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ ...input, minHeight: 70, resize: "vertical" }} placeholder="What should they focus on?" />
          </label>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" onClick={onClose} style={ghostBtn}>Cancel</button>
            <button type="submit" disabled={submitting || shares.length === 0} style={primaryBtn}>
              {submitting ? "Submitting…" : "Submit for review"}
            </button>
          </div>
          <span style={hint}>You need write access to the repo (your connected GitHub account).</span>
        </form>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(2px)" };
const modal: React.CSSProperties = { width: "min(520px, 92vw)", background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.5)", overflow: "hidden", color: "#e6edf3" };
const header: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottom: "1px solid rgba(255,255,255,0.08)" };
const label: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6, fontSize: "0.82rem", color: "#8b949e" };
const input: React.CSSProperties = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, padding: "8px 10px", color: "#e6edf3", fontSize: "0.9rem", outline: "none" };
const hint: React.CSSProperties = { fontSize: "0.78rem", color: "#6e7681" };
const code: React.CSSProperties = { background: "rgba(255,255,255,0.08)", padding: "1px 6px", borderRadius: 4, fontFamily: "monospace", color: "#e6edf3" };
const iconBtn: React.CSSProperties = { background: "transparent", border: "none", color: "#8b949e", cursor: "pointer", display: "flex", alignItems: "center", padding: 4 };
const primaryBtn: React.CSSProperties = { background: "var(--color-accent)", color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", fontWeight: 600, fontSize: "0.85rem", cursor: "pointer" };
const ghostBtn: React.CSSProperties = { background: "rgba(255,255,255,0.06)", color: "#e6edf3", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, padding: "8px 14px", fontSize: "0.85rem", cursor: "pointer" };
