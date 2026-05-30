import type { Document } from "@gitlive/shared";

// A "folder" is a group of documents that share the same owner, GitHub repo,
// and branch (e.g. an entire branch imported at once).
export interface FolderContext {
  uid: string; // owner user id of the folder
  repo: string; // GitHub repo full name, e.g. "owner/name"
  branch: string; // GitHub branch
}

// Stable key used to group documents into folders on the dashboard.
export function folderKey(doc: Document): string | null {
  if (!doc.githubRepo) return null;
  return `${doc.ownerId}|${doc.githubRepo}|${doc.githubBranch ?? ""}`;
}

export function folderContextFromDoc(doc: Document): FolderContext {
  return {
    uid: doc.ownerId,
    repo: doc.githubRepo ?? "",
    branch: doc.githubBranch ?? "",
  };
}

// Encode a folder context into URL query params.
export function folderQuery(ctx: FolderContext): string {
  const params = new URLSearchParams();
  params.set("fuid", ctx.uid);
  params.set("frepo", ctx.repo);
  params.set("fbranch", ctx.branch);
  return params.toString();
}

// Link to a specific file while preserving its folder context, so the file
// tree and "shared folder" experience stay intact during navigation.
export function fileHrefInFolder(docId: string, ctx: FolderContext): string {
  return `/doc/${docId}?${folderQuery(ctx)}`;
}
