import { Octokit } from "octokit";
import * as Y from "yjs";
import { query } from "../db/index.js";

// Reconstruct a document's current text from its stored Yjs state, falling back
// to the originally imported content.
export function currentDocText(yjsState: Buffer | null, baseContent: string | null): string {
  if (yjsState) {
    try {
      const ydoc = new Y.Doc();
      Y.applyUpdate(ydoc, new Uint8Array(yjsState));
      return ydoc.getText("monaco").toString();
    } catch {
      /* fall through */
    }
  }
  return baseContent ?? "";
}

export interface ChangedFile {
  docId: string;
  path: string;
  content: string;
}

// All files in a folder whose current collaborative content differs from what
// was imported (base_content).
export async function getChangedFolderFiles(ownerId: string, repo: string, baseBranch: string): Promise<ChangedFile[]> {
  const docsRes = await query(
    `SELECT id, github_file_path, yjs_state, base_content
     FROM documents
     WHERE owner_id = $1 AND github_repo = $2 AND COALESCE(github_branch, '') = COALESCE($3, '')
       AND github_file_path IS NOT NULL`,
    [ownerId, repo, baseBranch]
  );
  const changed: ChangedFile[] = [];
  for (const row of docsRes.rows) {
    const text = currentDocText(row.yjs_state ?? null, row.base_content ?? null);
    if (text !== (row.base_content ?? "")) {
      changed.push({ docId: row.id, path: row.github_file_path, content: text });
    }
  }
  return changed;
}

// Build Co-authored-by trailers for everyone (except the pusher) who edited the
// given documents, mapped to GitHub identities when known.
export async function buildCoAuthorTrailers(changedDocIds: string[], pusherId: string): Promise<string[]> {
  if (changedDocIds.length === 0) return [];
  const rows = await query(
    `SELECT DISTINCT u.id, u.display_name, u.email, u.github_login, u.github_id
     FROM doc_contributors dc JOIN users u ON u.id = dc.user_id
     WHERE dc.document_id = ANY($1::uuid[])`,
    [changedDocIds]
  );
  const trailers: string[] = [];
  for (const c of rows.rows) {
    if (c.id === pusherId) continue;
    const name = c.github_login || c.display_name;
    const email = c.github_id && c.github_login ? `${c.github_id}+${c.github_login}@users.noreply.github.com` : c.email;
    trailers.push(`Co-authored-by: ${name} <${email}>`);
  }
  return trailers;
}

export async function clearContributors(changedDocIds: string[]): Promise<void> {
  if (changedDocIds.length === 0) return;
  await query("DELETE FROM doc_contributors WHERE document_id = ANY($1::uuid[])", [changedDocIds]);
}

export interface PushResult {
  commitSha: string;
  branchExisted: boolean;
}

// Create/update a branch with a single commit of the given changed files,
// branching off baseBranch when the target branch doesn't exist yet.
export async function pushFiles(
  token: string,
  owner: string,
  repoName: string,
  baseBranch: string,
  newBranch: string,
  changed: ChangedFile[],
  commitMessage: string,
  trailers: string[]
): Promise<PushResult> {
  const octokit = new Octokit({ auth: token });

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

  const newTree = await octokit.rest.git.createTree({ owner, repo: repoName, base_tree: baseTreeSha, tree: treeItems });

  const subject = commitMessage?.trim() || `Update ${changed.length} file(s) via CodeCollab`;
  const fullMessage = trailers.length > 0 ? `${subject}\n\n${trailers.join("\n")}` : subject;

  const commit = await octokit.rest.git.createCommit({
    owner,
    repo: repoName,
    message: fullMessage,
    tree: newTree.data.sha,
    parents: [parentSha],
  });

  if (branchExisted) {
    await octokit.rest.git.updateRef({ owner, repo: repoName, ref: `heads/${newBranch}`, sha: commit.data.sha });
  } else {
    await octokit.rest.git.createRef({ owner, repo: repoName, ref: `refs/heads/${newBranch}`, sha: commit.data.sha });
  }

  return { commitSha: commit.data.sha, branchExisted };
}

// Find an existing open PR for head->base, or create one. Returns number+url.
export async function ensurePullRequest(
  token: string,
  owner: string,
  repoName: string,
  headBranch: string,
  baseBranch: string,
  title: string,
  body: string
): Promise<{ number: number; url: string }> {
  const octokit = new Octokit({ auth: token });
  try {
    const created = await octokit.rest.pulls.create({
      owner,
      repo: repoName,
      head: headBranch,
      base: baseBranch,
      title: title || `Review: ${headBranch}`,
      body,
    });
    return { number: created.data.number, url: created.data.html_url };
  } catch (e: any) {
    // 422 typically means a PR already exists for this head/base.
    const existing = await octokit.rest.pulls.list({
      owner,
      repo: repoName,
      head: `${owner}:${headBranch}`,
      base: baseBranch,
      state: "open",
    });
    if (existing.data.length > 0) {
      return { number: existing.data[0].number, url: existing.data[0].html_url };
    }
    throw e;
  }
}

export async function getOwnerGithubToken(ownerId: string): Promise<string | null> {
  const r = await query("SELECT github_access_token FROM users WHERE id = $1", [ownerId]);
  return r.rows[0]?.github_access_token ?? null;
}
