import { Router } from "express";
import { Octokit } from "octokit";
import { query } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";

export const foldersRouter: ReturnType<typeof Router> = Router();

// Result of attempting to add a user as a GitHub repo collaborator.
type GithubInviteStatus = "invited" | "already" | "not_linked" | "no_owner_github" | "failed";

// Ensure we know the target user's GitHub login; backfill it from their token
// if we stored a token but not a login (e.g. connected before this feature).
async function resolveGithubLogin(targetUserId: string): Promise<string | null> {
  const r = await query("SELECT github_login, github_access_token FROM users WHERE id = $1", [targetUserId]);
  if (r.rows.length === 0) return null;
  let { github_login: login, github_access_token: token } = r.rows[0];
  if (login) return login;
  if (!token) return null;
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    const data: any = await res.json();
    if (data?.login) {
      await query("UPDATE users SET github_login = $1 WHERE id = $2", [data.login, targetUserId]);
      return data.login;
    }
  } catch {
    /* ignore */
  }
  return null;
}

// Invite a user as a write-access collaborator on the repo, using the folder
// owner's GitHub token. Best-effort: returns a status, never throws.
async function inviteRepoCollaborator(ownerUserId: string, targetUserId: string, repo: string): Promise<GithubInviteStatus> {
  const ownerRow = await query("SELECT github_access_token FROM users WHERE id = $1", [ownerUserId]);
  const ownerToken = ownerRow.rows[0]?.github_access_token;
  if (!ownerToken) return "no_owner_github";

  const login = await resolveGithubLogin(targetUserId);
  if (!login) return "not_linked";

  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) return "failed";

  try {
    const octokit = new Octokit({ auth: ownerToken });
    const resp = await octokit.rest.repos.addCollaborator({
      owner,
      repo: repoName,
      username: login,
      permission: "push",
    });
    // 201 => invitation created; 204 => already a collaborator (no body).
    // (Octokit's types only declare 201, so compare as a number.)
    return (resp.status as number) === 204 ? "already" : "invited";
  } catch (e: any) {
    console.error("addCollaborator failed:", e?.status, e?.message);
    return "failed";
  }
}

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
  const { repo, branch = "", email, permission = "editor", addGithubCollaborator = false } = req.body as {
    repo?: string;
    branch?: string;
    email?: string;
    permission?: string;
    addGithubCollaborator?: boolean;
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

    // Optionally invite them to push directly on GitHub (repo-level write).
    let githubInvite: GithubInviteStatus | undefined;
    if (addGithubCollaborator) {
      githubInvite = await inviteRepoCollaborator(userId, target.id, repo);
    }

    return res.status(201).json({
      success: true,
      data: { userId: target.id, email: target.email, displayName: target.display_name, permission, githubInvite },
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
