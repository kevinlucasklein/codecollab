"use client";

import React, { useState } from "react";
import { X, GitBranch, Check, ExternalLink } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "../lib/auth";
import type { FolderContext } from "../lib/folderLink";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001";

interface PushDialogProps {
  folder: FolderContext; // uid (owner), repo, branch (base)
  onClose: () => void;
}

interface PushResult {
  branch?: string;
  commitSha?: string;
  pushedFiles: string[];
  coAuthors?: number;
  branchUrl?: string;
  compareUrl?: string;
  message?: string;
}

function suggestBranch(displayName: string | undefined): string {
  const slug = (displayName || "user").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const date = new Date().toISOString().slice(0, 10);
  return `gitlive/${slug}-${date}`;
}

export function PushDialog({ folder, onClose }: PushDialogProps) {
  const { token, user } = useAuth();
  const [branch, setBranch] = useState(suggestBranch(user?.displayName));
  const [message, setMessage] = useState("Update via GitLive");
  const [pushing, setPushing] = useState(false);
  const [result, setResult] = useState<PushResult | null>(null);

  const push = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branch.trim()) return;
    setPushing(true);
    try {
      const res = await fetch(`${SERVER_URL}/api/github/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ownerId: folder.uid,
          repo: folder.repo,
          baseBranch: folder.branch,
          newBranch: branch.trim(),
          commitMessage: message,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setResult(data.data);
        if (data.data.pushedFiles.length === 0) {
          toast("No changes to push.");
        } else {
          toast.success(`Pushed ${data.data.pushedFiles.length} file(s) to ${data.data.branch}`);
        }
      } else {
        toast.error(data.error || "Push failed");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setPushing(false);
    }
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={header}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <GitBranch size={18} />
            <h2 style={{ fontSize: "1.1rem", fontWeight: 600 }}>Push to GitHub</h2>
          </div>
          <button onClick={onClose} style={iconBtn} title="Close">
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: "14px 16px", fontSize: "0.82rem", color: "#8b949e", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          Repo <code style={code}>{folder.repo}</code> · base branch <code style={code}>{folder.branch || "(default)"}</code>
        </div>

        {result ? (
          <div style={{ padding: "16px" }}>
            {result.pushedFiles.length === 0 ? (
              <div style={{ color: "#e6edf3", fontSize: "0.9rem" }}>
                Nothing to push — the folder's files match what's on GitHub.
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#4ade80", fontWeight: 600, marginBottom: 10 }}>
                  <Check size={18} /> Pushed {result.pushedFiles.length} file(s) to{" "}
                  <code style={code}>{result.branch}</code>
                </div>
                {!!result.coAuthors && result.coAuthors > 0 && (
                  <div style={{ fontSize: "0.8rem", color: "#8b949e", marginBottom: 10 }}>
                    Credited {result.coAuthors} co-author{result.coAuthors > 1 ? "s" : ""} on the commit.
                  </div>
                )}
                <div style={{ maxHeight: 160, overflowY: "auto", fontSize: "0.8rem", fontFamily: "monospace", color: "#8b949e", marginBottom: 12 }}>
                  {result.pushedFiles.map((f) => (
                    <div key={f}>{f}</div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {result.compareUrl && (
                    <a href={result.compareUrl} target="_blank" rel="noreferrer" style={primaryLink}>
                      Open a Pull Request <ExternalLink size={14} />
                    </a>
                  )}
                  {result.branchUrl && (
                    <a href={result.branchUrl} target="_blank" rel="noreferrer" style={ghostLink}>
                      View branch <ExternalLink size={14} />
                    </a>
                  )}
                </div>
              </>
            )}
            <div style={{ marginTop: 16, textAlign: "right" }}>
              <button onClick={onClose} style={ghostBtn}>Done</button>
            </div>
          </div>
        ) : (
          <form onSubmit={push} style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={label}>
              Branch to push to
              <input value={branch} onChange={(e) => setBranch(e.target.value)} style={input} placeholder="my-feature-branch" required />
              <span style={hint}>Created off {folder.branch || "the base branch"} if it doesn&apos;t exist yet.</span>
            </label>
            <label style={label}>
              Commit message
              <input value={message} onChange={(e) => setMessage(e.target.value)} style={input} />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
              <button type="button" onClick={onClose} style={ghostBtn}>Cancel</button>
              <button type="submit" disabled={pushing} style={primaryBtn}>
                {pushing ? "Pushing…" : "Push changed files"}
              </button>
            </div>
            <span style={{ ...hint, marginTop: 0 }}>
              Only files you&apos;ve changed get committed. You need write access to the repo (your GitHub account).
            </span>
          </form>
        )}
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(2px)",
};
const modal: React.CSSProperties = {
  width: "min(520px, 92vw)", background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.5)", overflow: "hidden", color: "#e6edf3",
};
const header: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "16px", borderBottom: "1px solid rgba(255,255,255,0.08)",
};
const label: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6, fontSize: "0.82rem", color: "#8b949e" };
const input: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6,
  padding: "8px 10px", color: "#e6edf3", fontSize: "0.9rem", outline: "none",
};
const hint: React.CSSProperties = { fontSize: "0.75rem", color: "#6e7681", marginTop: 2 };
const code: React.CSSProperties = { background: "rgba(255,255,255,0.08)", padding: "1px 6px", borderRadius: 4, fontFamily: "monospace", color: "#e6edf3" };
const iconBtn: React.CSSProperties = { background: "transparent", border: "none", color: "#8b949e", cursor: "pointer", display: "flex", alignItems: "center", padding: 4 };
const primaryBtn: React.CSSProperties = { background: "var(--color-accent)", color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", fontWeight: 600, fontSize: "0.85rem", cursor: "pointer" };
const ghostBtn: React.CSSProperties = { background: "rgba(255,255,255,0.06)", color: "#e6edf3", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, padding: "8px 14px", fontSize: "0.85rem", cursor: "pointer" };
const primaryLink: React.CSSProperties = { ...primaryBtn, display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" };
const ghostLink: React.CSSProperties = { ...ghostBtn, display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" };
