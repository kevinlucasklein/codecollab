import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { User } from "@codecollab/shared";

// Extend Express Request to include our User
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export const authenticate = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "change-me-in-production-use-a-long-random-string"
    ) as User;
    
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ success: false, error: "Invalid token" });
  }
};
