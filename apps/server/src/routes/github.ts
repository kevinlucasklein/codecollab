import { Router } from "express";
import { Octokit } from "octokit";
import { authenticate } from "../middleware/auth.js";

export const githubRouter: ReturnType<typeof Router> = Router();

// Middleware to ensure user has connected GitHub
githubRouter.use(authenticate);
githubRouter.use((req, res, next) => {
  if (!req.user || !req.user.githubAccessToken) {
    return res.status(403).json({ success: false, error: "GitHub account not connected" });
  }
  next();
});

// GET /api/github/repos
// Fetches the repositories the user has access to
githubRouter.get("/repos", async (req, res) => {
  try {
    const octokit = new Octokit({ auth: req.user!.githubAccessToken });
    
    // Fetch user's repos, sorting by most recently updated
    const response = await octokit.rest.repos.listForAuthenticatedUser({
      sort: "updated",
      per_page: 50,
    });
    
    const repos = response.data.map((repo: any) => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      owner: repo.owner.login,
      private: repo.private,
      updatedAt: repo.updated_at,
    }));

    return res.json({ success: true, data: repos });
  } catch (error: any) {
    console.error("Error fetching GitHub repos:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch repositories" });
  }
});

// GET /api/github/repos/:owner/:repo/branches
// Fetches branches for a specific repository
githubRouter.get("/repos/:owner/:repo/branches", async (req, res) => {
  const { owner, repo } = req.params;
  try {
    const octokit = new Octokit({ auth: req.user!.githubAccessToken });
    
    const response = await octokit.rest.repos.listBranches({
      owner,
      repo,
      per_page: 100,
    });
    
    const branches = response.data.map((branch: any) => ({
      name: branch.name,
      commitSha: branch.commit.sha,
    }));

    return res.json({ success: true, data: branches });
  } catch (error: any) {
    console.error("Error fetching GitHub branches:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch branches" });
  }
});

// GET /api/github/repos/:owner/:repo/tree/:branch
// Fetches the file tree for a specific branch
githubRouter.get("/repos/:owner/:repo/tree/:branch", async (req, res) => {
  const { owner, repo, branch } = req.params;
  try {
    const octokit = new Octokit({ auth: req.user!.githubAccessToken });
    
    // recursive: "1" gets the entire tree flattened
    const response = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: branch,
      recursive: "1",
    });
    
    // Filter out directories, we only want files
    const files = response.data.tree
      .filter((node: any) => node.type === "blob")
      .map((node: any) => ({
        path: node.path,
        size: node.size,
      }));

    return res.json({ success: true, data: files });
  } catch (error: any) {
    console.error("Error fetching GitHub file tree:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch file tree" });
  }
});
