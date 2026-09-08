import { execFile } from "child_process";
import * as path from "path";

/**
 * project line의 git 배지와 변경 파일 줄용 상태 — claude-hud의 git.ts와 같은 명령·파싱.
 * 렌더마다 실행하며(캐시 없음) 각 명령은 1~2초 안에 끝나지 않으면 버린다.
 * git이 없거나 저장소가 아니면 null (배지를 그리지 않는다).
 */
export interface LineDiff {
  added: number;
  deleted: number;
}

export interface TrackedFile {
  basename: string;
  fullPath: string;
  type: "modified" | "added" | "deleted";
  lineDiff?: LineDiff;
}

export interface FileStats {
  modified: number;
  added: number;
  deleted: number;
  untracked: number;
  trackedFiles: TrackedFile[];
}

export interface GitStatus {
  branch: string;
  isDirty: boolean;
  ahead: number;
  behind: number;
  fileStats?: FileStats;
  lineDiff?: LineDiff;
  branchUrl?: string;
}

const GIT_MAX_OUTPUT_BYTES = 1024 * 1024;
const BRANCH_MAX_LEN = 64;

const GIT_ENV = {
  ...process.env,
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "Never",
};

function git(cwd: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, env: GIT_ENV, encoding: "utf8", timeout, maxBuffer: GIT_MAX_OUTPUT_BYTES, windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

function sanitizeBranch(value: string): string {
  const cleaned = value.replace(/[\p{Cc}\p{Cf}]/gu, "").trim();
  return cleaned.length > BRANCH_MAX_LEN ? `${cleaned.slice(0, BRANCH_MAX_LEN - 1)}…` : cleaned;
}

async function resolveRef(cwd: string): Promise<string | null> {
  const branch = (await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"], 1000)).trim();
  if (branch && branch !== "HEAD") return branch;
  try {
    const tag = (await git(cwd, ["describe", "--tags", "--exact-match", "HEAD"], 1000)).trim();
    if (tag) return tag;
  } catch {
    // 태그가 없는 detached HEAD — 짧은 SHA로.
  }
  const sha = (await git(cwd, ["rev-parse", "--short", "HEAD"], 1000)).trim();
  return sha ? `detached:${sha}` : null;
}

function parsePorcelainPath(field: string): string {
  if (field.startsWith('"') && field.endsWith('"')) {
    try {
      return JSON.parse(field) as string;
    } catch {
      return field.slice(1, -1);
    }
  }
  return field;
}

/** `git status --porcelain` → 파일 개수와 추적 파일 목록 (Starship과 같은 분류). */
export function parseFileStats(porcelain: string): FileStats {
  const stats: FileStats = { modified: 0, added: 0, deleted: 0, untracked: 0, trackedFiles: [] };
  for (const line of porcelain.split("\n").filter(Boolean)) {
    if (line.length < 2) continue;
    const index = line[0];
    const worktree = line[1];
    const pathField = line.slice(2).trimStart();
    if (line.startsWith("??")) {
      stats.untracked++;
    } else if (index === "A") {
      stats.added++;
      const fullPath = parsePorcelainPath(pathField);
      stats.trackedFiles.push({ basename: fullPath.split("/").pop() ?? fullPath, fullPath, type: "added" });
    } else if (index === "D" || worktree === "D") {
      stats.deleted++;
      const fullPath = parsePorcelainPath(pathField);
      stats.trackedFiles.push({ basename: fullPath.split("/").pop() ?? fullPath, fullPath, type: "deleted" });
    } else if (index === "M" || worktree === "M" || index === "R" || index === "C") {
      stats.modified++;
      // 이름 변경은 "old -> new"로 오므로 목적지 경로를 쓴다.
      const fullPath = parsePorcelainPath(pathField.split(" -> ").pop() ?? pathField);
      stats.trackedFiles.push({ basename: fullPath.split("/").pop() ?? fullPath, fullPath, type: "modified" });
    }
  }
  return stats;
}

/** numstat의 이름 변경 표기(`old => new`, `dir/{old => new}`)를 목적지 경로로 바꾼다. */
function numstatDestination(filePath: string): string {
  const brace = filePath.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (brace) return `${brace[1]}${brace[3]}${brace[4]}`.replace(/\/{2,}/g, "/");
  const arrow = filePath.indexOf(" => ");
  return arrow === -1 ? filePath : filePath.slice(arrow + 4);
}

export function parseNumstat(output: string, trackedPaths: Set<string>): { total: LineDiff; perFile: Map<string, LineDiff> } {
  const total: LineDiff = { added: 0, deleted: 0 };
  const perFile = new Map<string, LineDiff>();
  for (const line of output.trim().split("\n").filter(Boolean)) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const added = parseInt(parts[0], 10);
    const deleted = parseInt(parts[1], 10);
    if (Number.isNaN(added) || Number.isNaN(deleted)) continue; // binary
    let filePath = parts[2];
    if (!trackedPaths.has(filePath)) {
      const destination = numstatDestination(filePath);
      if (trackedPaths.has(destination)) filePath = destination;
    }
    total.added += added;
    total.deleted += deleted;
    perFile.set(filePath, { added, deleted });
  }
  return { total, perFile };
}

function buildGitHubRefUrl(remote: string, ref: string): string | undefined {
  const base = remote
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//, "https://github.com/")
    .replace(/\.git$/, "");
  if (!base.startsWith("https://github.com/")) return undefined;
  const detached = ref.match(/^detached:([0-9a-f]+)$/);
  if (detached) return `${base}/commit/${detached[1]}`;
  return `${base}/tree/${ref.split("/").map(encodeURIComponent).join("/")}`;
}

export async function getGitStatus(cwd: string | undefined): Promise<GitStatus | null> {
  if (!cwd || !path.isAbsolute(cwd)) return null;
  let branch: string | null;
  try {
    branch = await resolveRef(cwd);
  } catch {
    return null;
  }
  if (!branch) return null;

  let isDirty = false;
  let fileStats: FileStats | undefined;
  let lineDiff: LineDiff | undefined;
  try {
    const out = (await git(cwd, ["-c", "core.quotePath=false", "--no-optional-locks", "status", "--porcelain"], 1000)).trim();
    isDirty = out.length > 0;
    if (isDirty) fileStats = parseFileStats(out);
  } catch {
    // status 실패는 배지에서 dirty 표시만 빠진다.
  }

  if (isDirty) {
    try {
      const out = await git(cwd, ["-c", "core.quotePath=false", "--no-optional-locks", "diff", "--numstat", "HEAD"], 2000);
      const tracked = new Set(fileStats?.trackedFiles.map((f) => f.fullPath) ?? []);
      const { total, perFile } = parseNumstat(out, tracked);
      lineDiff = total;
      for (const file of fileStats?.trackedFiles ?? []) {
        const diff = perFile.get(file.fullPath);
        if (diff) file.lineDiff = diff;
      }
    } catch {
      // 줄 수 차이는 선택 정보.
    }
  }

  let ahead = 0;
  let behind = 0;
  try {
    const parts = (await git(cwd, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], 1000)).trim().split(/\s+/);
    if (parts.length === 2) {
      behind = parseInt(parts[0], 10) || 0;
      ahead = parseInt(parts[1], 10) || 0;
    }
  } catch {
    // upstream 없음
  }

  let branchUrl: string | undefined;
  try {
    branchUrl = buildGitHubRefUrl((await git(cwd, ["remote", "get-url", "origin"], 1000)).trim(), branch);
  } catch {
    // origin 없음
  }

  return { branch: sanitizeBranch(branch), isDirty, ahead, behind, fileStats, lineDiff, branchUrl };
}
