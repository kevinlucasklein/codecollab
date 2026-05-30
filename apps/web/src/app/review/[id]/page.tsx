"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../../lib/auth";
import { lineDiff, diffStats } from "../../../lib/lineDiff";
import { fileHrefInFolder } from "../../../lib/folderLink";
import type { Review, ReviewFile } from "@gitlive/shared";
import toast from "react-hot-toast";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001";

const STATUS_META: Record<string, { label: string; color: string }> = {
  open: { label: "Open", color: "#9ca3af" },
  approved: { label: "Approved", color: "#4ade80" },
  changes_requested: { label: "Changes requested", color: "#f87171" },
  closed: { label: "Closed", color: "#8b949e" },
};

export default function ReviewPage() {
  const params = useParams();
  const reviewId = params.id as string;
  const router = useRouter();
  const { user, token, isLoading } = useAuth();

  const [review, setReview] = useState<Review | null>(null);
  const [files, setFiles] = useState<ReviewFile[]>([]);
  const [threadCounts, setThreadCounts] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) router.push("/login");
  }, [user, isLoading, router]);

  const load = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${SERVER_URL}/api/reviews/${reviewId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setReview(data.data.review);
        setFiles(data.data.files);
        setExpanded(new Set<string>(data.data.files.map((f: ReviewFile) => f.docId ?? f.path)));
        // Fetch open comment thread counts per file that maps to a document.
        const counts: Record<string, number> = {};
        await Promise.all(
          data.data.files
            .filter((f: ReviewFile) => !!f.docId)
            .map(async (f: ReviewFile) => {
              try {
                const cr = await fetch(`${SERVER_URL}/api/documents/${f.docId}/comments`, {
                  headers: { Authorization: `Bearer ${token}` },
                });
                const cd = await cr.json();
                counts[f.docId!] = cd.success ? cd.data.length : 0;
              } catch {
                counts[f.docId!] = 0;
              }
            })
        );
        setThreadCounts(counts);
      } else {
        setError(data.error || "Review not found");
      }
    } catch {
      setError("Failed to load review");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, reviewId]);

  const setStatus = async (status: string) => {
    try {
      const res = await fetch(`${SERVER_URL}/api/reviews/${reviewId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (data.success) {
        setReview(data.data);
        toast.success("Review updated");
      } else {
        toast.error(data.error || "Failed to update");
      }
    } catch {
      toast.error("Network error");
    }
  };

  const toggle = (docId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(docId) ? next.delete(docId) : next.add(docId);
      return next;
    });

  if (isLoading || loading) {
    return <div style={center}>Loading review…</div>;
  }
  if (error || !review) {
    return (
      <div style={center}>
        <div style={{ textAlign: "center" }}>
          <p>{error || "Review not found"}</p>
          <Link href="/" style={link}>Back to dashboard</Link>
        </div>
      </div>
    );
  }

  const isReviewer = user?.id === review.reviewerId;
  const isRequester = user?.id === review.requesterId;
  const status = STATUS_META[review.status] ?? STATUS_META.open;
  const folderCtx = { uid: review.ownerId, repo: review.githubRepo, branch: review.githubBranch };

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "24px 20px", color: "#e6edf3" }}>
      <Link href="/" style={{ ...link, fontSize: "0.85rem" }}>← Dashboard</Link>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginTop: 12 }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>{review.title}</h1>
          <div style={{ color: "#8b949e", fontSize: "0.85rem", marginTop: 4 }}>
            {review.requesterName} requested review from {review.reviewerName} ·{" "}
            <code style={code}>{review.githubRepo}</code>{" "}
            <code style={code}>{review.headBranch || review.githubBranch}</code> →{" "}
            <code style={code}>{review.githubBranch || "(default)"}</code>
          </div>
          {review.githubPrUrl && (
            <a href={review.githubPrUrl} target="_blank" rel="noreferrer" style={{ ...link, fontSize: "0.82rem", display: "inline-block", marginTop: 6 }}>
              View pull request on GitHub →
            </a>
          )}
          {review.description && <p style={{ marginTop: 10, color: "#c9d1d9", fontSize: "0.9rem", whiteSpace: "pre-wrap" }}>{review.description}</p>}
        </div>
        <span style={{ color: status.color, border: `1px solid ${status.color}55`, background: `${status.color}18`, padding: "4px 12px", borderRadius: 20, fontSize: "0.8rem", fontWeight: 600, whiteSpace: "nowrap" }}>
          {status.label}
        </span>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        {isReviewer && (review.status === "open" || review.status === "changes_requested") && (
          <button onClick={() => setStatus("approved")} style={{ ...btn, background: "rgba(74,222,128,0.15)", color: "#4ade80", borderColor: "rgba(74,222,128,0.4)" }}>
            Approve
          </button>
        )}
        {isReviewer && review.status !== "changes_requested" && review.status !== "closed" && (
          <button onClick={() => setStatus("changes_requested")} style={{ ...btn, background: "rgba(248,113,113,0.15)", color: "#f87171", borderColor: "rgba(248,113,113,0.4)" }}>
            Request changes
          </button>
        )}
        {isRequester && review.status === "changes_requested" && (
          <button onClick={() => setStatus("open")} style={btn}>Re-request review</button>
        )}
        {isRequester && review.status !== "closed" && (
          <button onClick={() => setStatus("closed")} style={btn}>Close</button>
        )}
        {isRequester && review.status === "closed" && (
          <button onClick={() => setStatus("open")} style={btn}>Reopen</button>
        )}
      </div>

      {/* Changed files */}
      <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "24px 0 12px" }}>
        Changed files ({files.length})
      </h2>

      {files.length === 0 ? (
        <div style={{ color: "#8b949e", fontSize: "0.9rem" }}>No changes vs. the imported version.</div>
      ) : (
        files.map((f, fi) => {
          const key = f.docId ?? f.path ?? String(fi);
          // Prefer GitHub's patch; otherwise compute a local diff.
          const rows = f.patch !== undefined
            ? f.patch.split("\n").map((text) => ({
                type: text.startsWith("+") && !text.startsWith("+++")
                  ? "add"
                  : text.startsWith("-") && !text.startsWith("---")
                  ? "del"
                  : text.startsWith("@@")
                  ? "hunk"
                  : "ctx",
                text,
              }))
            : lineDiff(f.baseContent ?? "", f.currentContent ?? "").map((l) => ({
                type: l.type as string,
                text: (l.type === "add" ? "+" : l.type === "del" ? "-" : " ") + l.text,
              }));
          const stats =
            f.additions !== undefined
              ? { additions: f.additions, deletions: f.deletions ?? 0 }
              : diffStats(lineDiff(f.baseContent ?? "", f.currentContent ?? ""));
          const isOpen = expanded.has(key);
          const threads = f.docId ? threadCounts[f.docId] ?? 0 : 0;
          return (
            <div key={key} style={fileCard}>
              <div style={fileHeader} onClick={() => toggle(key)}>
                <span style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>{f.path}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: "0.78rem" }}>
                  <span style={{ color: "#4ade80" }}>+{stats.additions}</span>
                  <span style={{ color: "#f87171" }}>-{stats.deletions}</span>
                  {threads > 0 && <span style={{ color: "#8b949e" }}>{threads} thread{threads > 1 ? "s" : ""}</span>}
                  {f.docId && (
                    <Link
                      href={fileHrefInFolder(f.docId, folderCtx)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ ...link, fontSize: "0.78rem" }}
                    >
                      Open in editor →
                    </Link>
                  )}
                </span>
              </div>
              {isOpen && (
                <div style={{ overflowX: "auto", fontFamily: "monospace", fontSize: "0.8rem", lineHeight: 1.5 }}>
                  {rows.map((l, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: "flex",
                        background:
                          l.type === "add" ? "rgba(74,222,128,0.12)"
                          : l.type === "del" ? "rgba(248,113,113,0.12)"
                          : l.type === "hunk" ? "rgba(88,166,255,0.10)"
                          : "transparent",
                        color: l.type === "hunk" ? "#58a6ff" : undefined,
                        whiteSpace: "pre",
                        padding: "0 8px",
                      }}
                    >
                      {l.text || " "}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}

      <p style={{ color: "#6e7681", fontSize: "0.78rem", marginTop: 20 }}>
        To leave line comments, open a file in the editor — reviewers add comments on lines and the requester resolves them there.
      </p>
    </div>
  );
}

const center: React.CSSProperties = { minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", color: "#e6edf3" };
const link: React.CSSProperties = { color: "var(--color-accent)", textDecoration: "none" };
const code: React.CSSProperties = { background: "rgba(255,255,255,0.08)", padding: "1px 6px", borderRadius: 4, fontFamily: "monospace" };
const btn: React.CSSProperties = { background: "rgba(255,255,255,0.06)", color: "#e6edf3", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6, padding: "8px 14px", fontSize: "0.85rem", cursor: "pointer", fontWeight: 600 };
const fileCard: React.CSSProperties = { border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, marginBottom: 12, overflow: "hidden", background: "rgba(255,255,255,0.02)" };
const fileHeader: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.08)" };
