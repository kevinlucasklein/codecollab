import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../server";
import { pool, query } from "../../db";

describe("Documents Routes", () => {
  const testUser = {
    email: `doc-test-${Date.now()}@example.com`,
    password: "password123",
    displayName: "Doc Tester",
  };

  let token: string;
  let documentId: string;

  beforeAll(async () => {
    // Register a user to get a token
    const res = await request(app)
      .post("/api/auth/register")
      .send(testUser);
    
    token = res.body.data.token;
  });

  afterAll(async () => {
    try {
      // Clean up documents and user
      if (documentId) {
        await query("DELETE FROM documents WHERE id = $1", [documentId]);
      }
      await query("DELETE FROM users WHERE email = $1", [testUser.email]);
    } catch (e) {
      console.error("Cleanup failed:", e);
    }
  });

  describe("POST /api/documents", () => {
    it("should create a new document for an authenticated user", async () => {
      const res = await request(app)
        .post("/api/documents")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.title).toBe("Untitled");
      
      documentId = res.body.data.id;
    });

    it("should reject unauthenticated requests", async () => {
      const res = await request(app).post("/api/documents");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/documents", () => {
    it("should return a list of documents for the user", async () => {
      const res = await request(app)
        .get("/api/documents")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].id).toBe(documentId);
    });
  });

  describe("PATCH /api/documents/:id", () => {
    it("should update document title", async () => {
      const newTitle = "Updated Title";
      const res = await request(app)
        .patch(`/api/documents/${documentId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ title: newTitle });
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe(newTitle);
    });
  });
});
