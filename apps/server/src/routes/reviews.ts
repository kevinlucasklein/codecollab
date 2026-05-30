import { Router } from "express";
import { Octokit } from "octokit";
import { query } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import type { Review, ReviewFile } from "@codecollab/shared";
import {
  currentDocText,
  getChangedFolderFiles,
  buildCoAuthorTrailers,
  clearContributors,
  pushFiles,
  ensurePullRequest,
  getOwnerGithubToken,
} from "../lib/githubPush.js";

export const reviewsRouter: ReturnType<typeof Router> = Router();
reviewsRouter.use(authenticate);

function mapReview(row: any): Review {
  return {
    id: row.id,
    ownerId: row.owner_id,
    githubRepo: row.github_repo,
    githubBranch: row.github_branch,
    requesterId: row.requester_id,
    requesterName: row.requester_name,
    reviewerId: row.reviewer_id,
    reviewerName: row.reviewer_name,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status,
    headBranch: row.head_branch ?? undefined,
    githubPrNumber: row.github_pr_number ?? undefined,
    githubPrUrl: row.github_pr_url ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const REVIEW_SELECT = `
  SELECT r.*, req.display_name AS requester_name, rev.display_name AS reviewer_name
  FROM reviews r
  JOIN users req ON req.id = r.requester_id
  JOIN users rev ON rev.id = r.reviewer_id
`;

async function canAccessFolder(userId: string, ownerId: string, repo: string, branch: string): Promise<boolean> {
  if (userId === ownerId) return true;
  const res = await query(
    `SELECT 1 FROM folder_shares
       WHERE owner_id = $1 AND github_repo = $2 AND github_branch = COALESCE($3, '') AND shared_with = $4
     LIMIT 1`,
    [ownerId, repo, branch, userId]
  );
  return res.rows.length > 0;
}

// ----------------------------------------------------------------------------
// POST /api/reviews/submit — combined: push changed files, open a GitHub PR,
// and create the in-app review, in one step. Uses the acting user's token.
// Body: { ownerId, repo, baseBranch, headBranch, reviewerId, title, description, commitMessage }
// ----------------------------------------------------------------------------
reviewsRouter.post("/submit", async (req, res) => {
  const userId = req.user!.id;
  const {
    ownerId,
    repo,
    baseBranch = "",
    headBranch,
    reviewerId,
    title,
    description,
    commitMessage,
  } = req.body as Record<string, string>;

  if (!ownerId || !repo || !headBranch || !reviewerId) {
    return res.status(400).json({ success: false, error: "Missing ownerId, repo, headBranch, or reviewerId" });
  }
  if (reviewerId === userId) {
    return res.status(400).json({ success: false, error: "You can't request a review from yourself" });
  }
  if (!/^[A-Za-z0-9._\/-]+$/.test(headBranch) || headBranch === baseBranch) {
    return res.status(400).json({ success: false, error: "Invalid or non-distinct head branch" });
  }

  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) return res.status(400).json({ success: false, error: "Invalid repo" });

  try {
    if (!(await canAccessFolder(userId, ownerId, repo, baseBranch))) {
      return res.status(403).json({ success: false, error: "You don't have access to this folder" });
    }
    if (!(await canAccessFolder(reviewerId, ownerId, repo, baseBranch))) {
      return res.status(400).json({ success: false, error: "That reviewer doesn't have this folder shared with them" });
    }

    const token = await getOwnerGithubToken(userId);
    if (!token) return res.status(403).json({ success: false, error: "Connect your GitHub account first" });

    const changed = await getChangedFolderFiles(ownerId, repo, baseBranch);
    if (changed.length === 0) {
      return res.status(400).json({ success: false, error: "No changes to submit" });
    }

    const changedDocIds = changed.map((c) => c.docId);
    const trailers = await buildCoAuthorTrailers(changedDocIds, userId);

    // 1. Push the changes to the head branch.
    await pushFiles(token, owner, repoName, baseBranch, headBranch, changed, commitMessage || (title ?? "Update via CodeCollab"), trailers);

    // 2. Open (or reuse) the pull request head -> base.
    let pr: { number: number; url: string } | null = null;
    try {
      pr = await ensurePullRequest(token, owner, repoName, headBranch, baseBranch, title || `Review: ${headBranch}`, description || "");
    } catch (e: any) {
      console.error("Failed to open PR:", e?.status, e?.message);
      // Continue without a PR rather than losing the push; review falls back to local diff.
    }

    // 3. Reset contributor tracking now that changes are on GitHub.
    await clearContributors(changedDocIds);

    // 4. Create the review record.
    const result = await query(
      `INSERT INTO reviews (owner_id, github_repo, github_branch, requester_id, reviewer_id, title, description, head_branch, github_pr_number, github_pr_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        ownerId,
        repo,
        baseBranch,
        userId,
        reviewerId,
        title?.trim() || "Review request",
        description ?? null,
        headBranch,
        pr?.number ?? null,
        pr?.url ?? null,
      ]
    );

    const full = await query(`${REVIEW_SELECT} WHERE r.id = $1`, [result.rows[0].id]);
    return res.status(201).json({ success: true, data: mapReview(full.rows[0]) });
  } catch (error: any) {
    console.error("Failed to submit review:", error?.status, error?.message);
    if (error?.status === 403 || error?.status === 404) {
      return res.status(403).json({ success: false, error: "GitHub rejected the push (you may lack write access)." });
    }
    return res.status(500).json({ success: false, error: "Failed to submit for review" });
  }
});

// ----------------------------------------------------------------------------
// GET /api/reviews — reviews I requested or am assigned to review
// ----------------------------------------------------------------------------
reviewsRouter.get("/", async (req, res) => {
  const userId = req.user!.id;
  try {
    const result = await query(
      `${REVIEW_SELECT} WHERE r.requester_id = $1 OR r.reviewer_id = $1 ORDER BY r.updated_at DESC`,
      [userId]
    );
    return res.json({ success: true, data: result.rows.map(mapReview) });
  } catch (error) {
    console.error("Failed to list reviews:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ----------------------------------------------------------------------------
// GET /api/reviews/:id — review plus changed-file diffs. Prefers the live
// GitHub PR diff; falls back to a local diff vs. the imported content.
// ----------------------------------------------------------------------------
reviewsRouter.get("/:id", async (req, res) => {
  const userId = req.user!.id;
  const reviewId = req.params.id;

  try {
    const r = await query(`${REVIEW_SELECT} WHERE r.id = $1`, [reviewId]);
    if (r.rows.length === 0) return res.status(404).json({ success: false, error: "Review not found" });
    const review = mapReview(r.rows[0]);

    if (review.requesterId !== userId && review.reviewerId !== userId && review.ownerId !== userId) {
      return res.status(403).json({ success: false, error: "You don't have access to this review" });
    }

    let files: ReviewFile[] = [];

    // Live GitHub diff when a PR backs this review.
    if (review.githubPrNumber) {
      const ownerToken = await getOwnerGithubToken(review.ownerId);
      const [owner, repoName] = review.githubRepo.split("/");
      if (ownerToken && owner && repoName) {
        try {
          // Map file paths back to our document ids so the UI can deep-link to
          // the editor for inline comments.
          const docRows = await query(
            `SELECT id, github_file_path FROM documents
             WHERE owner_id = $1 AND github_repo = $2 AND COALESCE(github_branch, '') = COALESCE($3, '')`,
            [review.ownerId, review.githubRepo, review.githubBranch]
          );
          const pathToDoc = new Map<string, string>();
          for (const d of docRows.rows) if (d.github_file_path) pathToDoc.set(d.github_file_path, d.id);

          const octokit = new Octokit({ auth: ownerToken });
          const prFiles = await octokit.rest.pulls.listFiles({
            owner,
            repo: repoName,
            pull_number: review.githubPrNumber,
            per_page: 100,
          });
          files = prFiles.data.map((f) => ({
            path: f.filename,
            docId: pathToDoc.get(f.filename),
            patch: f.patch,
            additions: f.additions,
            deletions: f.deletions,
            status: f.status,
          }));
        } catch (e: any) {
          console.error("Failed to fetch PR files:", e?.status, e?.message);
        }
      }
    }

    // Fallback: local diff vs imported content.
    if (files.length === 0) {
      const docsRes = await query(
        `SELECT id, github_file_path, yjs_state, base_content
         FROM documents
         WHERE owner_id = $1 AND github_repo = $2 AND COALESCE(github_branch, '') = COALESCE($3, '')
           AND github_file_path IS NOT NULL`,
        [review.ownerId, review.githubRepo, review.githubBranch]
      );
      for (const row of docsRes.rows) {
        const base = row.base_content ?? "";
        const current = currentDocText(row.yjs_state ?? null, row.base_content ?? null);
        if (current !== base) {
          files.push({ docId: row.id, path: row.github_file_path, baseContent: base, currentContent: current });
        }
      }
      files.sort((a, b) => a.path.localeCompare(b.path));
    }

    return res.json({ success: true, data: { review, files } });
  } catch (error) {
    console.error("Failed to fetch review:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ----------------------------------------------------------------------------
// PATCH /api/reviews/:id — update status
// ----------------------------------------------------------------------------
reviewsRouter.patch("/:id", async (req, res) => {
  const userId = req.user!.id;
  const reviewId = req.params.id;
  const { status } = req.body as { status?: string };

  if (!["open", "approved", "changes_requested", "closed"].includes(status ?? "")) {
    return res.status(400).json({ success: false, error: "Invalid status" });
  }

  try {
    const r = await query(`SELECT requester_id, reviewer_id FROM reviews WHERE id = $1`, [reviewId]);
    if (r.rows.length === 0) return res.status(404).json({ success: false, error: "Review not found" });
    const { requester_id, reviewer_id } = r.rows[0];

    const isReviewer = reviewer_id === userId;
    const isRequester = requester_id === userId;

    if ((status === "approved" || status === "changes_requested") && !isReviewer) {
      return res.status(403).json({ success: false, error: "Only the reviewer can approve or request changes" });
    }
    if ((status === "open" || status === "closed") && !isRequester) {
      return res.status(403).json({ success: false, error: "Only the requester can re-request or close" });
    }

    const updated = await query(`UPDATE reviews SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id`, [status, reviewId]);
    const full = await query(`${REVIEW_SELECT} WHERE r.id = $1`, [updated.rows[0].id]);
    return res.json({ success: true, data: mapReview(full.rows[0]) });
  } catch (error) {
    console.error("Failed to update review:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});
