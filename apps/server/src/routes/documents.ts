import { Router } from "express";
import { pool, query } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import type { Document } from "@gitlive/shared";
import { Octokit } from "octokit";

export const documentsRouter: ReturnType<typeof Router> = Router();

// All document routes require authentication
documentsRouter.use(authenticate);

// ----------------------------------------------------------------------------
// GET /api/documents
// List all documents for the authenticated user
// ----------------------------------------------------------------------------
documentsRouter.get("/debug", async (req, res) => {
  try {
    const result = await query("SELECT id, title, github_repo, github_file_path FROM documents ORDER BY created_at DESC LIMIT 50");
    return res.json({ success: true, data: result.rows });
  } catch (error: any) {
    return res.json({ success: false, error: error.message });
  }
});

documentsRouter.get("/", async (req, res) => {
  const userId = req.user!.id;

  try {
    // Owned documents, plus documents shared with this user directly (file
    // share) or via a folder share. The `access` column carries the user's role.
    const result = await query(
      `SELECT d.id, d.title, d.owner_id, d.language, d.review_status, d.created_at, d.updated_at,
              d.github_repo, d.github_branch, d.github_file_path, u.display_name as owner_display_name,
              'owner' as access
       FROM documents d
       JOIN users u ON d.owner_id = u.id
       WHERE d.owner_id = $1

       UNION

       SELECT d.id, d.title, d.owner_id, d.language, d.review_status, d.created_at, d.updated_at,
              d.github_repo, d.github_branch, d.github_file_path, u.display_name as owner_display_name,
              ds.permission as access
       FROM documents d
       JOIN users u ON d.owner_id = u.id
       JOIN document_shares ds ON ds.document_id = d.id
       WHERE ds.shared_with = $1

       UNION

       SELECT d.id, d.title, d.owner_id, d.language, d.review_status, d.created_at, d.updated_at,
              d.github_repo, d.github_branch, d.github_file_path, u.display_name as owner_display_name,
              fs.permission as access
       FROM documents d
       JOIN users u ON d.owner_id = u.id
       JOIN folder_shares fs ON fs.owner_id = d.owner_id
            AND fs.github_repo = d.github_repo
            AND fs.github_branch = COALESCE(d.github_branch, '')
       WHERE fs.shared_with = $1

       ORDER BY updated_at DESC`,
      [userId]
    );

    // A document can appear more than once (owned + shared, or both share types).
    // Collapse to one row per id, keeping the strongest access.
    const rank: Record<string, number> = { viewer: 1, editor: 2, owner: 3 };
    const byId = new Map<string, Document>();
    for (const row of result.rows) {
      const existing = byId.get(row.id);
      const access = row.access as Document["access"];
      if (existing && rank[existing.access!] >= rank[access!]) continue;
      byId.set(row.id, {
        id: row.id,
        title: row.title,
        ownerId: row.owner_id,
        ownerDisplayName: row.owner_display_name,
        language: row.language,
        reviewStatus: row.review_status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        githubRepo: row.github_repo,
        githubBranch: row.github_branch,
        githubFilePath: row.github_file_path,
        access,
      });
    }

    const documents: Document[] = Array.from(byId.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    return res.json({ success: true, data: documents });
  } catch (error) {
    console.error("Failed to fetch documents:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ----------------------------------------------------------------------------
// GET /api/documents/folder
// List all documents belonging to a single GitHub repo+branch "folder".
// Accessible to any authenticated user (so shared folder links work), scoped
// by the folder owner so different users' imports don't collide.
// NOTE: must be declared before GET /:id so "folder" isn't treated as an id.
// ----------------------------------------------------------------------------
documentsRouter.get("/folder", async (req, res) => {
  const owner = req.query.owner as string | undefined;
  const repo = req.query.repo as string | undefined;
  const branch = req.query.branch as string | undefined;

  if (!owner || !repo) {
    return res.status(400).json({ success: false, error: "Missing owner or repo" });
  }

  try {
    const result = await query(
      `SELECT d.id, d.title, d.owner_id, d.language, d.review_status, d.created_at, d.updated_at, d.github_repo, d.github_branch, d.github_file_path, u.display_name as owner_display_name
       FROM documents d
       JOIN users u ON d.owner_id = u.id
       WHERE d.owner_id = $1 AND d.github_repo = $2 AND ($3::text IS NULL OR d.github_branch = $3)
       ORDER BY d.github_file_path ASC NULLS LAST, d.title ASC`,
      [owner, repo, branch ?? null]
    );

    const documents: Document[] = result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      ownerId: row.owner_id,
      ownerDisplayName: row.owner_display_name,
      language: row.language,
      reviewStatus: row.review_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      githubRepo: row.github_repo,
      githubBranch: row.github_branch,
      githubFilePath: row.github_file_path,
    }));

    return res.json({ success: true, data: documents });
  } catch (error) {
    console.error("Failed to fetch folder documents:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ----------------------------------------------------------------------------
// POST /api/documents/from-github
// Creates a new document seeded from a GitHub file
// ----------------------------------------------------------------------------
documentsRouter.post("/from-github", authenticate, async (req, res) => {
  const { repoFullName, branch, filePath } = req.body;

  if (!repoFullName || !branch || !filePath) {
    return res.status(400).json({ success: false, error: "Missing GitHub parameters" });
  }

  let githubToken = req.user?.githubAccessToken;
  if (!githubToken && req.user?.id) {
    const userRow = await query("SELECT github_access_token FROM users WHERE id = $1", [req.user.id]);
    if (userRow.rows.length > 0 && userRow.rows[0].github_access_token) {
      githubToken = userRow.rows[0].github_access_token;
    }
  }

  if (!githubToken) {
    return res.status(403).json({ success: false, error: "GitHub not connected" });
  }

  try {
    const [owner, repo] = repoFullName.split("/");
    const octokit = new Octokit({ auth: githubToken });

    // Fetch file content from GitHub
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref: branch,
    });

    if (Array.isArray(response.data) || response.data.type !== "file") {
      return res.status(400).json({ success: false, error: "Path is not a file" });
    }

    const content = Buffer.from(response.data.content, "base64").toString("utf-8");
    const title = filePath.split("/").pop() || "Untitled from GitHub";

    // Create the document in DB
    const result = await query(
      `INSERT INTO documents (title, owner_id, language, github_repo, github_branch, github_file_path, base_content) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [title, req.user!.id, "plaintext", repoFullName, branch, filePath, content]
    );

    // We do NOT seed the Yjs state here in the REST API. 
    // The frontend will do it upon first connection if the document is empty.
    // We just return the raw initial content to the frontend.

    return res.status(201).json({
      success: true,
      data: result.rows[0],
      initialContent: content
    });
  } catch (error: any) {
    console.error("Create from GitHub error:", error);
    return res.status(500).json({ success: false, error: "Failed to create document from GitHub" });
  }
});

// ----------------------------------------------------------------------------
// POST /api/documents
// Create a new document
// ----------------------------------------------------------------------------
documentsRouter.post("/", async (req, res) => {
  const userId = req.user!.id;
  const { title = "Untitled", language = "plaintext" } = req.body;

  try {
    const result = await query(
      "INSERT INTO documents (title, owner_id, language) VALUES ($1, $2, $3) RETURNING id, title, owner_id, language, created_at, updated_at",
      [title, userId, language]
    );

    const row = result.rows[0];
    const document: Document = {
      id: row.id,
      title: row.title,
      ownerId: row.owner_id,
      language: row.language,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    return res.status(201).json({ success: true, data: document });
  } catch (error) {
    console.error("Failed to create document:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ----------------------------------------------------------------------------
// GET /api/documents/:id
// Get document metadata
// ----------------------------------------------------------------------------
documentsRouter.get("/:id", async (req, res) => {
  const docId = req.params.id;
  const userId = req.user!.id;

  try {
    const result = await query(
      `SELECT d.id, d.title, d.owner_id, d.language, d.review_status, d.created_at, d.updated_at, d.github_repo, d.github_branch, d.github_file_path, d.base_content, u.display_name as owner_display_name
       FROM documents d
       JOIN users u ON d.owner_id = u.id
       WHERE d.id = $1`,
      [docId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Document not found" });
    }

    const row = result.rows[0];

    // Determine the current user's access role for this document.
    let access: Document["access"] = undefined;
    if (row.owner_id === userId) {
      access = "owner";
    } else {
      const shareRes = await query(
        `SELECT permission FROM document_shares WHERE document_id = $1 AND shared_with = $2
         UNION
         SELECT permission FROM folder_shares
           WHERE owner_id = $3 AND github_repo = $4 AND github_branch = COALESCE($5, '') AND shared_with = $2`,
        [docId, userId, row.owner_id, row.github_repo, row.github_branch]
      );
      if (shareRes.rows.length > 0) {
        // If both viewer and editor grants exist, take the stronger one.
        access = shareRes.rows.some((r) => r.permission === "editor") ? "editor" : "viewer";
      }
    }

    const document: Document = {
      id: row.id,
      title: row.title,
      ownerId: row.owner_id,
      ownerDisplayName: row.owner_display_name,
      language: row.language,
      reviewStatus: row.review_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      githubRepo: row.github_repo,
      githubBranch: row.github_branch,
      githubFilePath: row.github_file_path,
      baseContent: row.base_content,
      access,
    };

    return res.json({ success: true, data: document });
  } catch (error) {
    console.error("Failed to fetch document:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ----------------------------------------------------------------------------
// PATCH /api/documents/:id
// Update document metadata (title, language)
// ----------------------------------------------------------------------------
documentsRouter.patch("/:id", async (req, res) => {
  const userId = req.user!.id;
  const docId = req.params.id;
  const { title, language } = req.body;

  try {
    // First ensure the document exists and belongs to the user
    const checkResult = await query("SELECT id FROM documents WHERE id = $1 AND owner_id = $2", [docId, userId]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Document not found" });
    }

    const result = await query(
      `UPDATE documents 
       SET title = COALESCE($1, title), 
           language = COALESCE($2, language),
           updated_at = NOW() 
       WHERE id = $3 
       RETURNING id, title, owner_id, language, created_at, updated_at`,
      [title, language, docId]
    );

    const row = result.rows[0];
    const document: Document = {
      id: row.id,
      title: row.title,
      ownerId: row.owner_id,
      language: row.language,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    if (title) {
      const io = req.app.get("io");
      if (io) {
        io.to(docId).emit("document:renamed", title);
      }
    }

    return res.json({ success: true, data: document });
  } catch (error) {
    console.error("Failed to update document:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ----------------------------------------------------------------------------
// PATCH /api/documents/:id/review
// Update document review status
// ----------------------------------------------------------------------------
documentsRouter.patch("/:id/review", async (req, res) => {
  const userId = req.user!.id;
  const docId = req.params.id;
  const { status } = req.body;

  if (!["none", "pending", "approved", "changes_requested"].includes(status)) {
    return res.status(400).json({ success: false, error: "Invalid status" });
  }

  try {
    const checkResult = await query("SELECT owner_id FROM documents WHERE id = $1", [docId]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Document not found" });
    }

    const isOwner = checkResult.rows[0].owner_id === userId;

    if (isOwner && ["approved", "changes_requested"].includes(status)) {
      return res.status(403).json({ success: false, error: "You cannot approve your own document" });
    }

    if (!isOwner && ["pending", "none"].includes(status)) {
      return res.status(403).json({ success: false, error: "Only the owner can request or cancel a review" });
    }

    await query("UPDATE documents SET review_status = $1, updated_at = NOW() WHERE id = $2", [status, docId]);

    const io = req.app.get("io");
    if (io) {
      io.to(docId).emit("document:review_updated", status);
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("Failed to update review status:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ----------------------------------------------------------------------------
// DELETE /api/documents/:id
// Delete a document
// ----------------------------------------------------------------------------
documentsRouter.delete("/:id", async (req, res) => {
  const userId = req.user!.id;
  const docId = req.params.id;

  try {
    const result = await query(
      "DELETE FROM documents WHERE id = $1 AND owner_id = $2 RETURNING id",
      [docId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Document not found" });
    }

    return res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    console.error("Failed to delete document:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ----------------------------------------------------------------------------
// Per-document sharing (grant / list / revoke). Owner only.
// ----------------------------------------------------------------------------

// GET /api/documents/:id/shares
documentsRouter.get("/:id/shares", async (req, res) => {
  const userId = req.user!.id;
  const docId = req.params.id;

  try {
    const owns = await query("SELECT id FROM documents WHERE id = $1 AND owner_id = $2", [docId, userId]);
    if (owns.rows.length === 0) {
      return res.status(403).json({ success: false, error: "Only the owner can view shares" });
    }

    const result = await query(
      `SELECT ds.shared_with as user_id, u.email, u.display_name, ds.permission
       FROM document_shares ds JOIN users u ON u.id = ds.shared_with
       WHERE ds.document_id = $1
       ORDER BY u.display_name ASC`,
      [docId]
    );

    const shares = result.rows.map((r) => ({
      userId: r.user_id,
      email: r.email,
      displayName: r.display_name,
      permission: r.permission,
    }));

    return res.json({ success: true, data: shares });
  } catch (error) {
    console.error("Failed to list shares:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// POST /api/documents/:id/shares  { email, permission }
documentsRouter.post("/:id/shares", async (req, res) => {
  const userId = req.user!.id;
  const docId = req.params.id;
  const { email, permission = "editor" } = req.body as { email?: string; permission?: string };

  if (!email) return res.status(400).json({ success: false, error: "Email is required" });
  if (!["viewer", "editor"].includes(permission)) {
    return res.status(400).json({ success: false, error: "Invalid permission" });
  }

  try {
    const owns = await query("SELECT id FROM documents WHERE id = $1 AND owner_id = $2", [docId, userId]);
    if (owns.rows.length === 0) {
      return res.status(403).json({ success: false, error: "Only the owner can share this document" });
    }

    const userRow = await query("SELECT id, email, display_name FROM users WHERE LOWER(email) = LOWER($1)", [email]);
    if (userRow.rows.length === 0) {
      return res.status(404).json({ success: false, error: "No GitLive user with that email" });
    }
    const target = userRow.rows[0];
    if (target.id === userId) {
      return res.status(400).json({ success: false, error: "You already own this document" });
    }

    await query(
      `INSERT INTO document_shares (document_id, shared_with, permission)
       VALUES ($1, $2, $3)
       ON CONFLICT (document_id, shared_with) DO UPDATE SET permission = EXCLUDED.permission`,
      [docId, target.id, permission]
    );

    return res.status(201).json({
      success: true,
      data: { userId: target.id, email: target.email, displayName: target.display_name, permission },
    });
  } catch (error) {
    console.error("Failed to add share:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// DELETE /api/documents/:id/shares/:userId
documentsRouter.delete("/:id/shares/:userId", async (req, res) => {
  const userId = req.user!.id;
  const docId = req.params.id;
  const targetUserId = req.params.userId;

  try {
    const owns = await query("SELECT id FROM documents WHERE id = $1 AND owner_id = $2", [docId, userId]);
    if (owns.rows.length === 0) {
      return res.status(403).json({ success: false, error: "Only the owner can manage shares" });
    }

    await query("DELETE FROM document_shares WHERE document_id = $1 AND shared_with = $2", [docId, targetUserId]);
    return res.json({ success: true, data: { revoked: true } });
  } catch (error) {
    console.error("Failed to revoke share:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});
