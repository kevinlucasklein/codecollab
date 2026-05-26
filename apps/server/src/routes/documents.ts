import { Router } from "express";
import { pool, query } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import type { Document } from "@codecollab/shared";

export const documentsRouter: ReturnType<typeof Router> = Router();

// All document routes require authentication
documentsRouter.use(authenticate);

// ----------------------------------------------------------------------------
// GET /api/documents
// List all documents for the authenticated user
// ----------------------------------------------------------------------------
documentsRouter.get("/", async (req, res) => {
  const userId = req.user!.id;

  try {
    const result = await query(
      `SELECT d.id, d.title, d.owner_id, d.language, d.review_status, d.created_at, d.updated_at, d.github_repo, d.github_branch, d.github_file_path, u.display_name as owner_display_name
       FROM documents d
       JOIN users u ON d.owner_id = u.id
       WHERE d.owner_id = $1 
       ORDER BY d.updated_at DESC`,
      [userId]
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
    console.error("Failed to fetch documents:", error);
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
    const octokit = new (await import("octokit")).Octokit({ auth: githubToken });

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

  if (!["pending", "approved", "changes_requested"].includes(status)) {
    return res.status(400).json({ success: false, error: "Invalid status" });
  }

  try {
    const checkResult = await query("SELECT owner_id FROM documents WHERE id = $1", [docId]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Document not found" });
    }

    if (checkResult.rows[0].owner_id === userId) {
      return res.status(403).json({ success: false, error: "You cannot review your own document" });
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
