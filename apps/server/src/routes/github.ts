import { Router } from "express";
import { Octokit } from "octokit";
import * as Y from "yjs";
import { authenticate } from "../middleware/auth.js";
import { query } from "../db/index.js";

export const githubRouter: ReturnType<typeof Router> = Router();

// Reconstruct a document's current text from its stored Yjs state, falling back
// to the originally-imported content if there's no collaborative state yet.
function currentDocText(yjsState: Buffer | null, baseContent: string | null): string {
  if (yjsState) {
    try {
      const ydoc = new Y.Doc();
      Y.applyUpdate(ydoc, new Uint8Array(yjsState));
      return ydoc.getText("monaco").toString();
    } catch {
      // fall through to base content
    }
  }
  return baseContent ?? "";
}

// Does this user have access to push the given folder (owner, or shared)?
async function canAccessFolder(userId: string, ownerId: string, repo: string, branch: string): Promise<boolean> {
  if (userId === ownerId) return true;
  const res = await query(
    `SELECT 1 FROM folder_shares
       WHERE owner_id = $1 AND github_repo = $2 AND github_branch = COALESCE($3, '') AND shared_with = $4
     UNION
     SELECT 1 FROM document_shares ds
       JOIN documents d ON d.id = ds.document_id
       WHERE d.owner_id = $1 AND d.github_repo = $2 AND COALESCE(d.github_branch, '') = COALESCE($3, '') AND ds.shared_with = $4
     LIMIT 1`,
    [ownerId, repo, branch, userId]
  );
  return res.rows.length > 0;
}

// Middleware to ensure user has connected GitHub
githubRouter.use(authenticate);
githubRouter.use(async (req, res, next) => {
  if (!req.user) {
    return res.status(403).json({ success: false, error: "Not authenticated" });
  }
  try {
    const result = await query("SELECT github_access_token FROM users WHERE id = $1", [req.user.id]);
    if (result.rows.length === 0 || !result.rows[0].github_access_token) {
      return res.status(403).json({ success: false, error: "GitHub account not connected" });
    }
    req.user.githubAccessToken = result.rows[0].github_access_token;
    next();
  } catch (err) {
    return res.status(500).json({ success: false, error: "Database error" });
  }
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

// POST /api/github/push
// Commit the folder's changed files (current collaborative content vs. what was
// imported) to a branch, under the acting user's GitHub account.
// Body: { ownerId, repo, baseBranch, newBranch, commitMessage }
githubRouter.post("/push", async (req, res) => {
  const userId = req.user!.id;
  const { ownerId, repo, baseBranch, newBranch, commitMessage } = req.body as {
    ownerId?: string;
    repo?: string;
    baseBranch?: string;
    newBranch?: string;
    commitMessage?: string;
  };

  if (!ownerId || !repo || !baseBranch || !newBranch) {
    return res.status(400).json({ success: false, error: "Missing ownerId, repo, baseBranch, or newBranch" });
  }
  if (!/^[A-Za-z0-9._\/-]+$/.test(newBranch) || newBranch.startsWith("/") || newBranch.endsWith("/")) {
    return res.status(400).json({ success: false, error: "Invalid branch name" });
  }

  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) {
    return res.status(400).json({ success: false, error: "Invalid repo" });
  }

  try {
    // 1. Authorization: must own or have the folder shared.
    if (!(await canAccessFolder(userId, ownerId, repo, baseBranch))) {
      return res.status(403).json({ success: false, error: "You don't have access to this folder" });
    }

    // 2. Gather the folder's documents and compute which ones changed.
    const docsRes = await query(
      `SELECT id, github_file_path, yjs_state, base_content
       FROM documents
       WHERE owner_id = $1 AND github_repo = $2 AND COALESCE(github_branch, '') = COALESCE($3, '')
         AND github_file_path IS NOT NULL`,
      [ownerId, repo, baseBranch]
    );

    const changed: { path: string; content: string }[] = [];
    const changedDocIds: string[] = [];
    for (const row of docsRes.rows) {
      const text = currentDocText(row.yjs_state ?? null, row.base_content ?? null);
      if (text !== (row.base_content ?? "")) {
        changed.push({ path: row.github_file_path, content: text });
        changedDocIds.push(row.id);
      }
    }

    if (changed.length === 0) {
      return res.json({ success: true, data: { pushedFiles: [], message: "No changes to push" } });
    }

    // 2b. Gather contributors across the changed files and build Co-authored-by
    // trailers, so GitHub credits everyone who collaborated (not just the
    // pusher). Map to the GitHub noreply email when we know their account.
    const coAuthors = await query(
      `SELECT DISTINCT u.id, u.display_name, u.email, u.github_login, u.github_id
       FROM doc_contributors dc JOIN users u ON u.id = dc.user_id
       WHERE dc.document_id = ANY($1::uuid[])`,
      [changedDocIds]
    );

    const trailers: string[] = [];
    for (const c of coAuthors.rows) {
      if (c.id === userId) continue; // the pusher is the commit author already
      const name = c.github_login || c.display_name;
      const email =
        c.github_id && c.github_login
          ? `${c.github_id}+${c.github_login}@users.noreply.github.com`
          : c.email;
      trailers.push(`Co-authored-by: ${name} <${email}>`);
    }

    const octokit = new Octokit({ auth: req.user!.githubAccessToken });

    // 3. Determine the parent commit: an existing target branch head, else the
    //    base branch head (so we can branch off it).
    let parentSha: string;
    let branchExisted = false;
    try {
      const existing = await octokit.rest.git.getRef({ owner, repo: repoName, ref: `heads/${newBranch}` });
      parentSha = existing.data.object.sha;
      branchExisted = true;
    } catch {
      const baseRef = await octokit.rest.git.getRef({ owner, repo: repoName, ref: `heads/${baseBranch}` });
      parentSha = baseRef.data.object.sha;
    }

    const parentCommit = await octokit.rest.git.getCommit({ owner, repo: repoName, commit_sha: parentSha });
    const baseTreeSha = parentCommit.data.tree.sha;

    // 4. Create blobs + a tree for the changed files.
    const treeItems = await Promise.all(
      changed.map(async (file) => {
        const blob = await octokit.rest.git.createBlob({
          owner,
          repo: repoName,
          content: Buffer.from(file.content, "utf-8").toString("base64"),
          encoding: "base64",
        });
        return { path: file.path, mode: "100644" as const, type: "blob" as const, sha: blob.data.sha };
      })
    );

    const newTree = await octokit.rest.git.createTree({
      owner,
      repo: repoName,
      base_tree: baseTreeSha,
      tree: treeItems,
    });

    // 5. Create the commit and point the branch at it.
    // Co-authored-by trailers must be separated from the subject by a blank
    // line, and each on its own line, for GitHub to recognize them.
    const subject = commitMessage?.trim() || `Update ${changed.length} file(s) via GitLive`;
    const fullMessage = trailers.length > 0 ? `${subject}\n\n${trailers.join("\n")}` : subject;

    const commit = await octokit.rest.git.createCommit({
      owner,
      repo: repoName,
      message: fullMessage,
      tree: newTree.data.sha,
      parents: [parentSha],
    });

    if (branchExisted) {
      await octokit.rest.git.updateRef({
        owner,
        repo: repoName,
        ref: `heads/${newBranch}`,
        sha: commit.data.sha,
      });
    } else {
      await octokit.rest.git.createRef({
        owner,
        repo: repoName,
        ref: `refs/heads/${newBranch}`,
        sha: commit.data.sha,
      });
    }

    // Changes are now on GitHub — reset contributor tracking for these files so
    // the next push only credits people who edit from here on.
    if (changedDocIds.length > 0) {
      await query("DELETE FROM doc_contributors WHERE document_id = ANY($1::uuid[])", [changedDocIds]);
    }

    return res.json({
      success: true,
      data: {
        branch: newBranch,
        commitSha: commit.data.sha,
        pushedFiles: changed.map((c) => c.path),
        coAuthors: trailers.length,
        branchUrl: `https://github.com/${owner}/${repoName}/tree/${encodeURIComponent(newBranch)}`,
        compareUrl: `https://github.com/${owner}/${repoName}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(newBranch)}?expand=1`,
      },
    });
  } catch (error: any) {
    console.error("GitHub push error:", error?.status, error?.message);
    if (error?.status === 403 || error?.status === 404) {
      return res.status(403).json({
        success: false,
        error: "GitHub rejected the push. You likely don't have write access to this repository.",
      });
    }
    return res.status(500).json({ success: false, error: "Failed to push to GitHub" });
  }
});
