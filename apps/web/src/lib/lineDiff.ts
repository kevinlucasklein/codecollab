// Minimal line-based diff (LCS) for rendering review diffs. Self-contained so we
// don't pull in a dependency. Returns a unified sequence of lines tagged as
// context, addition, or deletion.

export type DiffLineType = "ctx" | "add" | "del";

export interface DiffLine {
  type: DiffLineType;
  text: string;
  // 1-based line number in the new (current) file, when applicable.
  newLine?: number;
  oldLine?: number;
}

export function lineDiff(base: string, current: string): DiffLine[] {
  const a = base.length === 0 ? [] : base.split("\n");
  const b = current.length === 0 ? [] : current.split("\n");
  const n = a.length;
  const m = b.length;

  // LCS table
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldLine = 1;
  let newLine = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "ctx", text: a[i], oldLine: oldLine++, newLine: newLine++ });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: a[i], oldLine: oldLine++ });
      i++;
    } else {
      out.push({ type: "add", text: b[j], newLine: newLine++ });
      j++;
    }
  }
  while (i < n) out.push({ type: "del", text: a[i++], oldLine: oldLine++ });
  while (j < m) out.push({ type: "add", text: b[j++], newLine: newLine++ });
  return out;
}

export function diffStats(lines: DiffLine[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const l of lines) {
    if (l.type === "add") additions++;
    else if (l.type === "del") deletions++;
  }
  return { additions, deletions };
}
