import { Router } from "express";
import { query } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";

export const foldersRouter: ReturnType<typeof Router> = Router();

foldersRouter.use(authenticate);

// A "folder" is identified by (owner_id, github_repo, github_branch). Only the
// owner of that folder may manage its shares. Sharing a folder grants access to
// all of the owner's documents in that repo+branch, including future imports.

async function ownsFolder(ownerId: string, repo: string, branch: string): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM documents
     WHERE owner_id = $1 AND github_repo = $2 AND COALESCE(github_branch, '') = $3
     LIMIT 1`,
    [ownerId, repo, branch]
  );
  return result.rows.length > 0;
}

// GET /api/folders/shares?repo=&branch=
foldersRouter.get("/shares", async (req, res) => {
  const userId = req.user!.id;
  const repo = req.query.repo as string | undefined;
  const branch = (req.query.branch as string | undefined) ?? "";

  if (!repo) return res.status(400).json({ success: false, error: "Missing repo" });

  try {
    if (!(await ownsFolder(userId, repo, branch))) {
      return res.status(403).json({ success: false, error: "Only the owner can view folder shares" });
    }

    const result = await query(
      `SELECT fs.shared_with as user_id, u.email, u.display_name, fs.permission
       FROM folder_shares fs JOIN users u ON u.id = fs.shared_with
       WHERE fs.owner_id = $1 AND fs.github_repo = $2 AND fs.github_branch = $3
       ORDER BY u.display_name ASC`,
      [userId, repo, branch]
    );

    const shares = result.rows.map((r) => ({
      userId: r.user_id,
      email: r.email,
      displayName: r.display_name,
      permission: r.permission,
    }));

    return res.json({ success: true, data: shares });
  } catch (error) {
    console.error("Failed to list folder shares:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// POST /api/folders/shares  { repo, branch, email, permission }
foldersRouter.post("/shares", async (req, res) => {
  const userId = req.user!.id;
  const { repo, branch = "", email, permission = "editor" } = req.body as {
    repo?: string;
    branch?: string;
    email?: string;
    permission?: string;
  };

  if (!repo || !email) return res.status(400).json({ success: false, error: "Missing repo or email" });
  if (!["viewer", "editor"].includes(permission)) {
    return res.status(400).json({ success: false, error: "Invalid permission" });
  }

  try {
    if (!(await ownsFolder(userId, repo, branch))) {
      return res.status(403).json({ success: false, error: "Only the owner can share this folder" });
    }

    const userRow = await query("SELECT id, email, display_name FROM users WHERE LOWER(email) = LOWER($1)", [email]);
    if (userRow.rows.length === 0) {
      return res.status(404).json({ success: false, error: "No CodeCollab user with that email" });
    }
    const target = userRow.rows[0];
    if (target.id === userId) {
      return res.status(400).json({ success: false, error: "You already own this folder" });
    }

    await query(
      `INSERT INTO folder_shares (owner_id, github_repo, github_branch, shared_with, permission)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (owner_id, github_repo, github_branch, shared_with)
       DO UPDATE SET permission = EXCLUDED.permission`,
      [userId, repo, branch, target.id, permission]
    );

    return res.status(201).json({
      success: true,
      data: { userId: target.id, email: target.email, displayName: target.display_name, permission },
    });
  } catch (error) {
    console.error("Failed to add folder share:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// DELETE /api/folders/shares  { repo, branch, userId }
foldersRouter.delete("/shares", async (req, res) => {
  const userId = req.user!.id;
  const { repo, branch = "", userId: targetUserId } = req.body as {
    repo?: string;
    branch?: string;
    userId?: string;
  };

  if (!repo || !targetUserId) return res.status(400).json({ success: false, error: "Missing repo or userId" });

  try {
    if (!(await ownsFolder(userId, repo, branch))) {
      return res.status(403).json({ success: false, error: "Only the owner can manage folder shares" });
    }

    await query(
      "DELETE FROM folder_shares WHERE owner_id = $1 AND github_repo = $2 AND github_branch = $3 AND shared_with = $4",
      [userId, repo, branch, targetUserId]
    );
    return res.json({ success: true, data: { revoked: true } });
  } catch (error) {
    console.error("Failed to revoke folder share:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});
