"use client";

import React, { useEffect, useState } from "react";
import { X, Trash2, Link2, Check } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "../lib/auth";
import type { ShareEntry, SharePermission } from "@codecollab/shared";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001";

export type ShareTarget =
  | { kind: "file"; docId: string; title: string }
  | { kind: "folder"; repo: string; branch: string; title: string };

interface ShareDialogProps {
  target: ShareTarget;
  shareLink: string;
  onClose: () => void;
}

export function ShareDialog({ target, shareLink, onClose }: ShareDialogProps) {
  const { token } = useAuth();
  const [shares, setShares] = useState<ShareEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<SharePermission>("editor");
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  const listUrl =
    target.kind === "file"
      ? `${SERVER_URL}/api/documents/${target.docId}/shares`
      : `${SERVER_URL}/api/folders/shares?repo=${encodeURIComponent(target.repo)}&branch=${encodeURIComponent(target.branch)}`;

  const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const loadShares = async () => {
    try {
      const res = await fetch(listUrl, { headers: authHeaders });
      const data = await res.json();
      if (data.success) setShares(data.data);
      else toast.error(data.error || "Failed to load shares");
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) loadShares();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const addShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    try {
      const body =
        target.kind === "file"
          ? JSON.stringify({ email: email.trim(), permission })
          : JSON.stringify({ repo: target.repo, branch: target.branch, email: email.trim(), permission });
      const url =
        target.kind === "file"
          ? `${SERVER_URL}/api/documents/${target.docId}/shares`
          : `${SERVER_URL}/api/folders/shares`;
      const res = await fetch(url, { method: "POST", headers: authHeaders, body });
      const data = await res.json();
      if (data.success) {
        setShares((prev) => {
          const without = prev.filter((s) => s.userId !== data.data.userId);
          return [...without, data.data].sort((a, b) => a.displayName.localeCompare(b.displayName));
        });
        setEmail("");
        toast.success("Access granted");
      } else {
        toast.error(data.error || "Failed to share");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const changePermission = async (entry: ShareEntry, newPermission: SharePermission) => {
    // Re-POST with the same email upserts the permission.
    try {
      const body =
        target.kind === "file"
          ? JSON.stringify({ email: entry.email, permission: newPermission })
          : JSON.stringify({ repo: target.repo, branch: target.branch, email: entry.email, permission: newPermission });
      const url =
        target.kind === "file"
          ? `${SERVER_URL}/api/documents/${target.docId}/shares`
          : `${SERVER_URL}/api/folders/shares`;
      const res = await fetch(url, { method: "POST", headers: authHeaders, body });
      const data = await res.json();
      if (data.success) {
        setShares((prev) => prev.map((s) => (s.userId === entry.userId ? { ...s, permission: newPermission } : s)));
      } else {
        toast.error(data.error || "Failed to update");
      }
    } catch {
      toast.error("Network error");
    }
  };

  const revoke = async (entry: ShareEntry) => {
    try {
      let res: Response;
      if (target.kind === "file") {
        res = await fetch(`${SERVER_URL}/api/documents/${target.docId}/shares/${entry.userId}`, {
          method: "DELETE",
          headers: authHeaders,
        });
      } else {
        res = await fetch(`${SERVER_URL}/api/folders/shares`, {
          method: "DELETE",
          headers: authHeaders,
          body: JSON.stringify({ repo: target.repo, branch: target.branch, userId: entry.userId }),
        });
      }
      if (res.ok) {
        setShares((prev) => prev.filter((s) => s.userId !== entry.userId));
        toast.success("Access revoked");
      } else {
        toast.error("Failed to revoke");
      }
    } catch {
      toast.error("Network error");
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={header}>
          <div>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 600 }}>Share</h2>
            <div style={{ fontSize: "0.85rem", color: "#8b949e", marginTop: 2 }}>
              {target.kind === "folder" ? "Folder · " : ""}
              {target.title}
            </div>
          </div>
          <button onClick={onClose} style={iconBtn} title="Close">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={addShare} style={{ display: "flex", gap: 8, padding: "16px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <input
            type="email"
            placeholder="Add people by email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={input}
            required
          />
          <select value={permission} onChange={(e) => setPermission(e.target.value as SharePermission)} style={select}>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <button type="submit" disabled={submitting} style={primaryBtn}>
            {submitting ? "Adding..." : "Add"}
          </button>
        </form>

        <div style={{ maxHeight: 280, overflowY: "auto", padding: "8px 16px" }}>
          {loading ? (
            <div style={{ color: "#8b949e", padding: "12px 0", fontSize: "0.85rem" }}>Loading…</div>
          ) : shares.length === 0 ? (
            <div style={{ color: "#8b949e", padding: "12px 0", fontSize: "0.85rem" }}>
              Not shared with anyone yet.
            </div>
          ) : (
            shares.map((s) => (
              <div key={s.userId} style={row}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "0.9rem", color: "#e6edf3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.displayName}
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "#8b949e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.email}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <select
                    value={s.permission}
                    onChange={(e) => changePermission(s, e.target.value as SharePermission)}
                    style={{ ...select, padding: "4px 6px" }}
                  >
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button onClick={() => revoke(s)} style={iconBtn} title="Revoke access">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <span style={{ fontSize: "0.8rem", color: "#8b949e" }}>Anyone added can open this from their dashboard.</span>
          <button onClick={copyLink} style={ghostBtn}>
            {copied ? <Check size={15} /> : <Link2 size={15} />}
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  backdropFilter: "blur(2px)",
};

const modal: React.CSSProperties = {
  width: "min(520px, 92vw)",
  background: "#0d1117",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 12,
  boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
  overflow: "hidden",
};

const header: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  padding: "16px",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
};

const input: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 6,
  padding: "8px 10px",
  color: "#e6edf3",
  fontSize: "0.9rem",
  outline: "none",
};

const select: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 6,
  padding: "8px",
  color: "#e6edf3",
  fontSize: "0.85rem",
  cursor: "pointer",
};

const primaryBtn: React.CSSProperties = {
  background: "var(--color-accent)",
  color: "white",
  border: "none",
  borderRadius: 6,
  padding: "8px 14px",
  fontWeight: 600,
  fontSize: "0.85rem",
  cursor: "pointer",
};

const ghostBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  background: "rgba(255,255,255,0.06)",
  color: "#e6edf3",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: "0.83rem",
  cursor: "pointer",
};

const iconBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#8b949e",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  padding: 4,
};

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "8px 0",
  borderBottom: "1px solid rgba(255,255,255,0.05)",
};
