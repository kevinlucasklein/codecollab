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
      "SELECT id, title, owner_id, language, created_at, updated_at FROM documents WHERE owner_id = $1 ORDER BY updated_at DESC",
      [userId]
    );

    const documents: Document[] = result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      ownerId: row.owner_id,
      language: row.language,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return res.json({ success: true, data: documents });
  } catch (error) {
    console.error("Failed to fetch documents:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
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
      "SELECT id, title, owner_id, language, created_at, updated_at FROM documents WHERE id = $1",
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
      language: row.language,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
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

    return res.json({ success: true, data: document });
  } catch (error) {
    console.error("Failed to update document:", error);
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
