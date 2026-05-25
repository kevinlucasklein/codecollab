import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool, query } from "../db/index.js"; // Note the .js extension for ES modules
import { authenticate } from "../middleware/auth.js";
import type { RegisterInput, LoginInput, User } from "@codecollab/shared";

export const authRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production-use-a-long-random-string";

// ----------------------------------------------------------------------------
// POST /api/auth/register
// ----------------------------------------------------------------------------
authRouter.post("/register", async (req, res) => {
  const { email, password, displayName } = req.body as RegisterInput;

  if (!email || !password || !displayName) {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }

  try {
    // Check if user exists
    const existingUser = await query("SELECT id FROM users WHERE email = $1", [email]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ success: false, error: "Email already in use" });
    }

    // Hash password & insert
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const result = await query(
      "INSERT INTO users (email, password, display_name) VALUES ($1, $2, $3) RETURNING id, email, display_name, created_at",
      [email, hashedPassword, displayName]
    );

    const user: User = {
      id: result.rows[0].id,
      email: result.rows[0].email,
      displayName: result.rows[0].display_name,
      createdAt: result.rows[0].created_at,
    };

    const token = jwt.sign(user, JWT_SECRET, { expiresIn: "7d" });

    return res.status(201).json({ success: true, data: { user, token } });
  } catch (error) {
    console.error("Register error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ----------------------------------------------------------------------------
// POST /api/auth/login
// ----------------------------------------------------------------------------
authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body as LoginInput;

  if (!email || !password) {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }

  try {
    const result = await query(
      "SELECT id, email, password, display_name, created_at FROM users WHERE email = $1",
      [email]
    );

    const row = result.rows[0];
    if (!row) {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }

    const isValid = await bcrypt.compare(password, row.password);
    if (!isValid) {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }

    const user: User = {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      createdAt: row.created_at,
    };

    const token = jwt.sign(user, JWT_SECRET, { expiresIn: "7d" });

    return res.json({ success: true, data: { user, token } });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ----------------------------------------------------------------------------
// GET /api/auth/me
// ----------------------------------------------------------------------------
authRouter.get("/me", authenticate, (req, res) => {
  // If the authenticate middleware passes, req.user is set
  return res.json({ success: true, data: req.user });
});
