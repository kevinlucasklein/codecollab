import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool, query } from "../db/index.js"; // Note the .js extension for ES modules
import { authenticate } from "../middleware/auth.js";
import type { RegisterInput, LoginInput, User } from "@codecollab/shared";

export const authRouter: ReturnType<typeof Router> = Router();

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
authRouter.get("/me", authenticate, async (req, res) => {
  // If the authenticate middleware passes, req.user is set
  // Let's fetch the latest user from DB to check if github_access_token exists
  try {
    const result = await query("SELECT github_access_token FROM users WHERE id = $1", [req.user?.id]);
    if (result.rows.length > 0 && result.rows[0].github_access_token) {
      req.user!.githubAccessToken = result.rows[0].github_access_token;
    }
  } catch (err) {
    console.error("Error fetching github token on /me:", err);
  }
  
  return res.json({ success: true, data: req.user });
});

// ----------------------------------------------------------------------------
// GET /api/auth/github
// ----------------------------------------------------------------------------
authRouter.get("/github", (req, res) => {
  const token = req.query.token as string;
  if (!token) {
    return res.status(401).send("No token provided");
  }

  // Verify token to get user ID
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as User;
    
    // We pass the user ID in the state parameter so we know who they are when GitHub redirects back
    const state = Buffer.from(JSON.stringify({ userId: decoded.id })).toString('base64');
    
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) return res.status(500).send("GitHub Client ID not configured");

    const redirectUri = encodeURIComponent(`${process.env.SERVER_URL || "http://localhost:3001"}/api/auth/github/callback`);
    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=repo&state=${state}`;
    
    res.redirect(githubAuthUrl);
  } catch (err) {
    return res.status(401).send("Invalid token");
  }
});

// ----------------------------------------------------------------------------
// GET /api/auth/github/callback
// ----------------------------------------------------------------------------
authRouter.get("/github/callback", async (req, res) => {
  const { code, state } = req.query;
  const FRONTEND_URL = process.env.CORS_ORIGIN || "http://localhost:3000";

  if (!code || !state) {
    return res.redirect(`${FRONTEND_URL}?error=github_auth_failed`);
  }

  try {
    const decodedState = JSON.parse(Buffer.from(state as string, 'base64').toString('utf-8'));
    const userId = decodedState.userId;

    // Exchange code for access token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      })
    });

    const tokenData: any = await tokenRes.json();

    if (tokenData.access_token) {
      // Also fetch the GitHub login so we can later invite this user as a repo
      // collaborator (best-effort; failure here shouldn't block connecting).
      let githubLogin: string | null = null;
      try {
        const ghUserRes = await fetch("https://api.github.com/user", {
          headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/vnd.github+json" },
        });
        const ghUser: any = await ghUserRes.json();
        githubLogin = ghUser?.login ?? null;
      } catch (e) {
        console.error("Failed to fetch GitHub login:", e);
      }

      // Save to database
      await query("UPDATE users SET github_access_token = $1, github_login = $2 WHERE id = $3", [
        tokenData.access_token,
        githubLogin,
        userId,
      ]);
      return res.redirect(`${FRONTEND_URL}?github_connected=true`);
    } else {
      console.error("GitHub Auth Error:", tokenData);
      return res.redirect(`${FRONTEND_URL}?error=github_auth_failed`);
    }

  } catch (error) {
    console.error("GitHub callback error:", error);
    return res.redirect(`${FRONTEND_URL}?error=github_auth_failed`);
  }
});
