import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../server";
import { pool } from "../../db";

describe("Auth Routes", () => {
  // Use a unique email for each test run to avoid uniqueness constraints
  const testUser = {
    email: `testuser-${Date.now()}@example.com`,
    password: "password123",
    displayName: "Test User",
  };

  let token: string;

  afterAll(async () => {
    // Clean up test user to keep DB clean, but fail gracefully if it doesn't work
    try {
      await pool.query("DELETE FROM users WHERE email = $1", [testUser.email]);
    } catch (e) {
      console.error("Cleanup failed:", e);
    }
  });

  describe("POST /api/auth/register", () => {
    it("should successfully register a new user", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send(testUser);
      
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.user).toBeDefined();
      expect(res.body.data.user.email).toBe(testUser.email);
      expect(res.body.data.user.displayName).toBe(testUser.displayName);
      
      // Save token for future tests
      token = res.body.data.token;
    });

    it("should fail if email is already in use", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send(testUser);
      
      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("Email already in use");
    });
  });

  describe("POST /api/auth/login", () => {
    it("should login with correct credentials", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({
          email: testUser.email,
          password: testUser.password,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.user.email).toBe(testUser.email);
    });

    it("should fail with incorrect password", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({
          email: testUser.email,
          password: "wrongpassword",
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("Invalid credentials");
    });
  });

  describe("GET /api/auth/me", () => {
    it("should return user data for a valid token", async () => {
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe(testUser.email);
    });

    it("should fail if no token is provided", async () => {
      const res = await request(app).get("/api/auth/me");
      
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });
});
