import { Router } from "express";
import { query } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import type { CommentThread, Comment } from "@codecollab/shared";

// We use mergeParams so we can access :documentId from the parent router
export const commentsRouter: ReturnType<typeof Router> = Router({ mergeParams: true });

commentsRouter.use(authenticate);

// ----------------------------------------------------------------------------
// GET /api/documents/:documentId/comments
// Fetch all active comment threads and their comments for a document
// ----------------------------------------------------------------------------
commentsRouter.get("/", async (req, res) => {
  const { documentId } = req.params;

  try {
    // 1. Fetch threads
    const threadsResult = await query(
      "SELECT id, document_id, line_number, resolved, created_at FROM comment_threads WHERE document_id = $1 ORDER BY created_at ASC",
      [documentId]
    );

    if (threadsResult.rows.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const threads: CommentThread[] = threadsResult.rows.map(row => ({
      id: row.id,
      documentId: row.document_id,
      lineNumber: row.line_number,
      resolved: row.resolved,
      createdAt: row.created_at,
      comments: []
    }));

    // 2. Fetch comments for these threads, joined with user display names
    const threadIds = threads.map(t => t.id);
    const commentsResult = await query(
      `SELECT c.id, c.thread_id, c.author_id, c.content, c.created_at, u.display_name as author_name
       FROM comments c
       JOIN users u ON c.author_id = u.id
       WHERE c.thread_id = ANY($1::uuid[])
       ORDER BY c.created_at ASC`,
      [threadIds]
    );

    const comments: Comment[] = commentsResult.rows.map(row => ({
      id: row.id,
      threadId: row.thread_id,
      authorId: row.author_id,
      authorName: row.author_name,
      content: row.content,
      createdAt: row.created_at
    }));

    // 3. Attach comments to their threads
    threads.forEach(thread => {
      thread.comments = comments.filter(c => c.threadId === thread.id);
    });

    return res.json({ success: true, data: threads });
  } catch (error) {
    console.error("Failed to fetch comments:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ----------------------------------------------------------------------------
// POST /api/documents/:documentId/comments
// Create a new comment thread and the first comment
// ----------------------------------------------------------------------------
commentsRouter.post("/", async (req, res) => {
  const { documentId } = req.params;
  const userId = req.user!.id;
  const { lineNumber, content } = req.body;

  if (lineNumber === undefined || !content) {
    return res.status(400).json({ success: false, error: "Missing lineNumber or content" });
  }

  try {
    // We must do this in a transaction, but for simplicity we'll just run queries sequentially
    // (In production, use BEGIN/COMMIT)
    
    // 1. Create the thread
    const threadResult = await query(
      "INSERT INTO comment_threads (document_id, line_number) VALUES ($1, $2) RETURNING *",
      [documentId, lineNumber]
    );
    const threadRow = threadResult.rows[0];

    // 2. Create the comment
    const commentResult = await query(
      "INSERT INTO comments (thread_id, author_id, content) VALUES ($1, $2, $3) RETURNING *",
      [threadRow.id, userId, content]
    );
    const commentRow = commentResult.rows[0];

    // 3. Get author name
    const userResult = await query("SELECT display_name FROM users WHERE id = $1", [userId]);
    const authorName = userResult.rows[0].display_name;

    const newComment: Comment = {
      id: commentRow.id,
      threadId: commentRow.thread_id,
      authorId: commentRow.author_id,
      authorName,
      content: commentRow.content,
      createdAt: commentRow.created_at
    };

    const newThread: CommentThread = {
      id: threadRow.id,
      documentId: threadRow.document_id,
      lineNumber: threadRow.line_number,
      resolved: threadRow.resolved,
      createdAt: threadRow.created_at,
      comments: [newComment]
    };

    return res.status(201).json({ success: true, data: newThread });
  } catch (error) {
    console.error("Failed to create thread:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ----------------------------------------------------------------------------
// POST /api/documents/:documentId/comments/:threadId
// Reply to an existing thread
// ----------------------------------------------------------------------------
commentsRouter.post("/:threadId", async (req, res) => {
  const { threadId } = req.params;
  const userId = req.user!.id;
  const { content } = req.body;

  if (!content) {
    return res.status(400).json({ success: false, error: "Missing content" });
  }

  try {
    const commentResult = await query(
      "INSERT INTO comments (thread_id, author_id, content) VALUES ($1, $2, $3) RETURNING *",
      [threadId, userId, content]
    );
    const commentRow = commentResult.rows[0];

    const userResult = await query("SELECT display_name FROM users WHERE id = $1", [userId]);
    const authorName = userResult.rows[0].display_name;

    const newComment: Comment = {
      id: commentRow.id,
      threadId: commentRow.thread_id,
      authorId: commentRow.author_id,
      authorName,
      content: commentRow.content,
      createdAt: commentRow.created_at
    };

    return res.status(201).json({ success: true, data: newComment });
  } catch (error) {
    console.error("Failed to add comment reply:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ----------------------------------------------------------------------------
// PATCH /api/documents/:documentId/comments/:threadId/resolve
// Resolve a thread
// ----------------------------------------------------------------------------
commentsRouter.patch("/:threadId/resolve", async (req, res) => {
  const { threadId } = req.params;

  try {
    const result = await query(
      "UPDATE comment_threads SET resolved = true WHERE id = $1 RETURNING id",
      [threadId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Thread not found" });
    }

    return res.json({ success: true, data: { resolved: true } });
  } catch (error) {
    console.error("Failed to resolve thread:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});
