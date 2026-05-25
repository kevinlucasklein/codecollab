import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../server";
import { pool, query } from "../../db";

describe("Comments Routes", () => {
  const testUser = {
    email: `comment-test-${Date.now()}@example.com`,
    password: "password123",
    displayName: "Comment Tester",
  };

  let token: string;
  let documentId: string;
  let threadId: string;

  beforeAll(async () => {
    // 1. Register a user
    const resAuth = await request(app)
      .post("/api/auth/register")
      .send(testUser);
    token = resAuth.body.data.token;

    // 2. Create a document to comment on
    const resDoc = await request(app)
      .post("/api/documents")
      .set("Authorization", `Bearer ${token}`);
    documentId = resDoc.body.data.id;
  });

  afterAll(async () => {
    try {
      if (documentId) {
        await query("DELETE FROM documents WHERE id = $1", [documentId]);
      }
      await query("DELETE FROM users WHERE email = $1", [testUser.email]);
    } catch (e) {
      console.error("Cleanup failed:", e);
    }
  });

  describe("POST /api/documents/:documentId/comments", () => {
    it("should create a new comment thread", async () => {
      const res = await request(app)
        .post(`/api/documents/${documentId}/comments`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          lineNumber: 5,
          content: "This is a test comment",
        });
      
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.lineNumber).toBe(5);
      expect(res.body.data.comments.length).toBe(1);
      expect(res.body.data.comments[0].content).toBe("This is a test comment");
      
      threadId = res.body.data.id;
    });

    it("should allow replying to an existing thread", async () => {
      const res = await request(app)
        .post(`/api/documents/${documentId}/comments/${threadId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          content: "This is a reply",
        });
      
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.content).toBe("This is a reply");
    });
  });

  describe("GET /api/documents/:documentId/comments", () => {
    it("should fetch all unresolved comment threads for a document", async () => {
      const res = await request(app)
        .get(`/api/documents/${documentId}/comments`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].id).toBe(threadId);
      expect(res.body.data[0].comments.length).toBe(2); // Initial comment + reply
    });
  });

  describe("PATCH /api/documents/:documentId/comments/:threadId/resolve", () => {
    it("should resolve a comment thread", async () => {
      const res = await request(app)
        .patch(`/api/documents/${documentId}/comments/${threadId}/resolve`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should no longer return resolved threads in the main fetch query", async () => {
      const res = await request(app)
        .get(`/api/documents/${documentId}/comments`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(0); // Should be hidden now
    });
  });
});
