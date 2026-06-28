import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const STUDIO_ROOT = process.env.STUDIO_REPO_DIR ?? process.cwd();
const WORKER_ROOT = process.env.WORKER_REPO_DIR ?? "C:\\Users\\LENOVO\\Documents\\medvideo-render-worker";
const OUT_PATH =
  process.env.ACTIVE_GOAL_WORKTREE_INVENTORY_OUT ??
  path.join(STUDIO_ROOT, "data", "review-artifacts", "active-goal-worktree-inventory.json");

const coordinationPaths = [
  "package.json",
  path.join("scripts", "verify-goal-suite.mjs"),
  path.join("scripts", "audit-active-goal-completion.mjs"),
  path.join("scripts", "audit-active-goal-worktree.mjs"),
  path.join("scripts", "audit-active-goal-package.mjs"),
  path.join("scripts", "audit-cleanup-pr-package.mjs"),
  path.join("scripts", "phase2g-render-quality-verifier.mjs"),
  path.join("docs", "active-medvideo-goal.md"),
  path.join("docs", "active-goal-inventory.md"),
  path.join("docs", "phase-2g-render-quality-acceptance.md"),
  path.join("data", "review-artifacts", "goal-suite", "goal-suite.json"),
  path.join("data", "review-artifacts", "active-goal-completion-audit.json"),
  path.join("data", "review-artifacts", "active-goal-worktree-inventory.json"),
  path.join("data", "review-artifacts", "active-goal-package-manifest.json"),
  path.join("data", "review-artifacts", "cleanup-pr-package-audit.json"),
].map((file) => file.replace(/\\/g, "/"));

function gitStatus(cwd) {
  const child = spawnSync("git status --porcelain=v1", {
    cwd,
    encoding: "utf8",
    shell: true,
    timeout: 30_000,
  });
  if (child.status !== 0) {
    return {
      ok: false,
      error: child.stderr || child.error?.message || "git status failed",
      entries: [],
    };
  }
  const entries = child.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => ({
      status: line.slice(0, 2),
      file: line.slice(3).replace(/\\/g, "/"),
    }));
  return { ok: true, entries };
}

function summarize(entries) {
  const groups = { modified: [], untracked: [], deleted: [], renamed: [], other: [] };
  for (const entry of entries) {
    const bucket = entry.status.includes("R") ? "renamed" :
      entry.status.includes("D") ? "deleted" :
      entry.status === "??" ? "untracked" :
      entry.status.trim() ? "modified" :
      "other";
    groups[bucket].push(entry.file);
  }
  return {
    total: entries.length,
    counts: Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, value.length])),
    groups,
    secret_sensitive_paths_present: entries
      .filter((entry) => /(^|\/)\.env($|\.)/i.test(entry.file))
      .map((entry) => entry.file),
    note: "Only paths/statuses are recorded; file contents and secrets are not read into this artifact.",
  };
}

function isSecretSensitivePath(file) {
  return /(^|\/)\.env($|\.)/i.test(file) ||
    /(^|\/)(?:secrets?|credentials?|service-role|service_role)(?:\.|\/|$)/i.test(file);
}

function isGeneratedEvidencePath(file) {
  return file.startsWith("data/review-artifacts/");
}

function fileInfo(root, file) {
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute)) return { file, exists: false };
  const stat = fs.statSync(absolute);
  return { file, exists: true, mtime: stat.mtime.toISOString(), size: stat.size };
}

function writeJsonAtomicSync(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(value, null, 2), "utf8");
  try {
    fs.renameSync(tempFile, file);
  } catch (error) {
    if (error?.code !== "EEXIST" && error?.code !== "EPERM") throw error;
    fs.rmSync(file, { force: true });
    fs.renameSync(tempFile, file);
  }
}

function matchingStatusEntries(entries, file) {
  return entries.filter((entry) => entry.file === file || file.startsWith(entry.file.replace(/\/$/, "") + "/"));
}

function pathStatus(entries, file) {
  const matches = matchingStatusEntries(entries, file);
  return {
    file,
    status: matches.length === 0 ? "clean_or_nested_untracked_not_reported" : matches.map((entry) => entry.status.trim() || "modified").join(","),
    matched_git_entries: matches,
  };
}

const studioStatus = gitStatus(STUDIO_ROOT);
const workerStatus = gitStatus(WORKER_ROOT);
const studioEntries = studioStatus.entries ?? [];
const workerEntries = workerStatus.entries ?? [];
const coordinationPathStatus = coordinationPaths.map((file) => ({
  ...fileInfo(STUDIO_ROOT, file),
  ...pathStatus(studioEntries, file),
}));
const coordinationMatchedGitFiles = new Set(
  coordinationPathStatus.flatMap((row) => row.matched_git_entries.map((entry) => entry.file)),
);
const nonCoordinationEntries = studioEntries.filter((entry) => !coordinationMatchedGitFiles.has(entry.file));
const stageCandidates = coordinationPathStatus.map((row) => {
  const broadUntrackedParentMatches = row.matched_git_entries
    .filter((entry) => entry.status === "??" && entry.file.endsWith("/") && entry.file !== row.file)
    .map((entry) => entry.file);
  return {
    file: row.file,
    exists: row.exists,
    status: row.status,
    generated_evidence: isGeneratedEvidencePath(row.file),
    secret_sensitive_path: isSecretSensitivePath(row.file),
    broad_untracked_parent_matches: broadUntrackedParentMatches,
    stage_instruction: broadUntrackedParentMatches.length > 0
      ? "Stage this explicit file path only; do not stage the untracked parent directory wholesale."
      : "Stage this explicit file path if it belongs to the chosen PR scope.",
  };
});
const packagingWarnings = [
  ...stageCandidates
    .filter((row) => row.broad_untracked_parent_matches.length > 0)
    .map((row) => ({
      file: row.file,
      warning: `Untracked parent ${row.broad_untracked_parent_matches.join(", ")} also contains other files; stage explicit paths only.`,
    })),
  ...summarize(nonCoordinationEntries).secret_sensitive_paths_present.map((file) => ({
    file,
    warning: "Secret-sensitive non-coordination path is dirty; do not stage it in the active-goal coordination package.",
  })),
];

const report = {
  generated_at: new Date().toISOString(),
  purpose: "Path-only inventory to separate active-goal coordination files from broader accumulated repo changes.",
  active_goal_scope_note: "This inventory does not prove completion; use npm.cmd run verify:goal-suite:audited and npm.cmd run audit:active-goal for current-phase verification.",
  studio: {
    root: STUDIO_ROOT,
    git_status_ok: studioStatus.ok,
    coordination_path_status: coordinationPathStatus,
    coordination_packaging_plan: {
      scope: "active-goal coordination handoff only",
      stage_explicit_paths_only: true,
      secret_sensitive_coordination_paths: stageCandidates
        .filter((row) => row.secret_sensitive_path)
        .map((row) => row.file),
      explicit_stage_paths: coordinationPaths,
      stage_candidates: stageCandidates,
      warnings: packagingWarnings,
      note: "This is a path-only packaging manifest. It does not stage files, read secret file contents, or decide whether generated evidence should be committed.",
    },
    non_coordination_summary: summarize(nonCoordinationEntries),
    full_summary: summarize(studioEntries),
  },
  worker: {
    root: WORKER_ROOT,
    git_status_ok: workerStatus.ok,
    summary: summarize(workerEntries),
  },
};

writeJsonAtomicSync(OUT_PATH, report);

console.log(JSON.stringify({
  artifact: path.relative(STUDIO_ROOT, OUT_PATH).replace(/\\/g, "/"),
  studio_total: report.studio.full_summary.total,
  coordination_paths: report.studio.coordination_path_status.length,
  worker_total: report.worker.summary.total,
}, null, 2));
