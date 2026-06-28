import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const STUDIO_ROOT = process.env.STUDIO_REPO_DIR ?? process.cwd();
const RUNNING_AS_SUITE_PRE_COMPLETION = process.env.GOAL_SUITE_CLEANUP_POST_CHECK === "1";
const ARTIFACT_ROOT = path.join(STUDIO_ROOT, "data", "review-artifacts");
const WORKTREE_INVENTORY_PATH =
  process.env.ACTIVE_GOAL_WORKTREE_INVENTORY_OUT ??
  path.join(ARTIFACT_ROOT, "active-goal-worktree-inventory.json");
const PACKAGE_MANIFEST_PATH =
  process.env.ACTIVE_GOAL_PACKAGE_MANIFEST_OUT ??
  path.join(ARTIFACT_ROOT, "active-goal-package-manifest.json");
const COMPLETION_AUDIT_PATH =
  process.env.ACTIVE_GOAL_COMPLETION_AUDIT_OUT ??
  path.join(ARTIFACT_ROOT, "active-goal-completion-audit.json");
const OUT_PATH =
  process.env.CLEANUP_PR_PACKAGE_AUDIT_OUT ??
  path.join(ARTIFACT_ROOT, "cleanup-pr-package-audit.json");

const requiredStablePaths = [
  "package.json",
  "package-lock.json",
  "docs/active-medvideo-goal.md",
  "docs/active-goal-inventory.md",
];

const forbiddenStagePathPatterns = [
  { name: "environment_file", regex: /(^|\/)\.env(?:$|\.)/i },
  { name: "log_file", regex: /\.log$/i },
  { name: "broad_parent_directory", regex: /^(?:data|docs|scripts|src|supabase)\/?$/i },
  { name: "worker_log", regex: /^worker-.*\.log$/i },
  { name: "worker_error_log", regex: /^worker-.*\.err\.log$/i },
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function writeJsonAtomic(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tempFile, JSON.stringify(value, null, 2), "utf8");
  try {
    await fsp.rename(tempFile, file);
  } catch (error) {
    if (error?.code !== "EEXIST" && error?.code !== "EPERM") throw error;
    await fsp.rm(file, { force: true });
    await fsp.rename(tempFile, file);
  }
}

function pathMatchesForbidden(file) {
  return forbiddenStagePathPatterns
    .filter((pattern) => pattern.regex.test(file))
    .map((pattern) => pattern.name);
}

function statusGroups(summary) {
  return summary?.groups ?? {};
}

function pathList(values) {
  return Array.isArray(values) ? values.map(String) : [];
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort();
}

function missingFrom(values, required) {
  const set = new Set(values);
  return required.filter((file) => !set.has(file));
}

const worktreeInventory = readJson(WORKTREE_INVENTORY_PATH);
const packageManifest = readJson(PACKAGE_MANIFEST_PATH);
const completionAudit = readJson(COMPLETION_AUDIT_PATH);
const outRelative = path.relative(STUDIO_ROOT, OUT_PATH).replace(/\\/g, "/");

const stablePaths = pathList(packageManifest?.stage_command_preview?.stable_code_doc_paths);
const optionalEvidencePaths = pathList(packageManifest?.stage_command_preview?.optional_evidence_paths);
const dependencyScriptPaths = pathList(packageManifest?.dependency_closure?.package_script_dependency_paths);
const dependencyLockfilePaths = pathList(packageManifest?.dependency_closure?.lockfile_paths);
const missingDependencyPaths = pathList(packageManifest?.dependency_closure?.missing_package_script_dependency_paths);
const neverStageParentDirectories = pathList(packageManifest?.stage_command_preview?.never_stage_parent_directories);
const allRecommendedPaths = uniqueSorted([...stablePaths, ...optionalEvidencePaths]);
const forbiddenRecommendedPaths = allRecommendedPaths
  .map((file) => ({
    file,
    reasons: pathMatchesForbidden(file),
  }))
  .filter((row) => row.reasons.length > 0);
const missingStablePaths = missingFrom(stablePaths, requiredStablePaths);
const stableEvidencePaths = stablePaths.filter((file) => file.startsWith("data/review-artifacts/"));
const missingScriptsFromStablePaths = missingFrom(stablePaths, dependencyScriptPaths);
const missingLockfilesFromStablePaths = missingFrom(stablePaths, dependencyLockfilePaths);
const optionalEvidenceMissing = optionalEvidencePaths.filter((file) => file !== outRelative && !fs.existsSync(path.join(STUDIO_ROOT, file)));

const studioNonCoordination = worktreeInventory?.studio?.non_coordination_summary ?? {};
const workerSummary = worktreeInventory?.worker?.summary ?? {};
const nonCoordinationDirtyCounts = {
  studio: studioNonCoordination?.counts ?? null,
  worker: workerSummary?.counts ?? null,
};
const explicitDoNotStage = uniqueSorted([
  ...pathList(studioNonCoordination?.secret_sensitive_paths_present),
  ...pathList(workerSummary?.secret_sensitive_paths_present).map((file) => `worker:${file}`),
  ...pathList(statusGroups(studioNonCoordination).untracked).filter((file) => file.endsWith(".sql")),
  ...pathList(statusGroups(workerSummary).untracked).filter((file) => /\.log$/i.test(file)).map((file) => `worker:${file}`),
  "data/",
  "docs/",
  "scripts/",
  "src/",
  "supabase/",
]);

const checks = [
  {
    name: "current_phase_verified",
    passed: RUNNING_AS_SUITE_PRE_COMPLETION || (completionAudit?.all_required_checks_passed === true && completionAudit?.status === "current_phase_verified"),
    evidence: {
      status: completionAudit?.status ?? null,
      all_required_checks_passed: completionAudit?.all_required_checks_passed ?? null,
      running_as_suite_pre_completion: RUNNING_AS_SUITE_PRE_COMPLETION,
      note: RUNNING_AS_SUITE_PRE_COMPLETION
        ? "The audited suite records cleanup before appending the final completion-audit post-check."
        : undefined,
    },
  },
  {
    name: "package_manifest_secret_scan_clean",
    passed: packageManifest?.secret_scan?.ok === true && packageManifest?.secret_scan?.findings_count === 0,
    evidence: packageManifest?.secret_scan ?? null,
  },
  {
    name: "package_dependency_closure_complete",
    passed:
      dependencyScriptPaths.length > 0 &&
      missingDependencyPaths.length === 0 &&
      missingScriptsFromStablePaths.length === 0 &&
      missingLockfilesFromStablePaths.length === 0,
    evidence: {
      dependency_script_count: dependencyScriptPaths.length,
      dependency_lockfile_paths: dependencyLockfilePaths,
      missing_dependency_paths: missingDependencyPaths,
      missing_scripts_from_stable_paths: missingScriptsFromStablePaths,
      missing_lockfiles_from_stable_paths: missingLockfilesFromStablePaths,
    },
  },
  {
    name: "required_stable_paths_present",
    passed: missingStablePaths.length === 0,
    evidence: {
      required_stable_paths: requiredStablePaths,
      missing_stable_paths: missingStablePaths,
    },
  },
  {
    name: "stable_stage_excludes_generated_evidence",
    passed: stableEvidencePaths.length === 0,
    evidence: {
      stable_evidence_paths: stableEvidencePaths,
    },
  },
  {
    name: "optional_evidence_exists",
    passed: optionalEvidencePaths.length > 0 && optionalEvidenceMissing.length === 0,
    evidence: {
      optional_evidence_paths: optionalEvidencePaths,
      missing: optionalEvidenceMissing,
    },
  },
  {
    name: "recommended_paths_avoid_forbidden_patterns",
    passed: forbiddenRecommendedPaths.length === 0,
    evidence: {
      forbidden_recommended_paths: forbiddenRecommendedPaths,
      forbidden_patterns: forbiddenStagePathPatterns.map((pattern) => pattern.name),
    },
  },
  {
    name: "parent_directories_forbidden",
    passed: ["data/", "docs/", "scripts/", "src/", "supabase/"].every((file) => explicitDoNotStage.includes(file)),
    evidence: {
      never_stage_parent_directories: neverStageParentDirectories,
      explicit_do_not_stage_parent_directories: explicitDoNotStage.filter((file) => file.endsWith("/")),
    },
  },
];

const failedChecks = checks.filter((check) => !check.passed).map((check) => check.name);
const safeForCoordinationPr = failedChecks.length === 0;

const report = {
  generated_at: new Date().toISOString(),
  status: safeForCoordinationPr ? "ready_for_coordination_pr" : "needs_cleanup_before_coordination_pr",
  purpose: "Final cleanup/PR package gate for the active-goal coordination layer. This artifact does not stage files.",
  chosen_pr_scope: "active-goal coordination and verification layer only",
  checks,
  failed_checks: failedChecks,
  recommended_stable_stage: {
    paths: stablePaths,
    command: packageManifest?.stage_command_preview?.recommended_command ?? null,
    note: "Use this for the default coordination PR. It includes package.json, package-lock.json, docs, and every package.json script dependency.",
  },
  optional_evidence_stage: {
    paths: optionalEvidencePaths,
    command: packageManifest?.stage_command_preview?.optional_evidence_command ?? null,
    note: "Use only if the PR intentionally includes generated evidence snapshots.",
  },
  explicit_do_not_stage: explicitDoNotStage,
  dirty_state_summary: {
    studio_non_coordination: nonCoordinationDirtyCounts.studio,
    worker: nonCoordinationDirtyCounts.worker,
    note: "Dirty non-coordination paths are inventoried but not part of the chosen coordination PR scope.",
  },
  source_artifacts: {
    worktree_inventory: path.relative(STUDIO_ROOT, WORKTREE_INVENTORY_PATH).replace(/\\/g, "/"),
    package_manifest: path.relative(STUDIO_ROOT, PACKAGE_MANIFEST_PATH).replace(/\\/g, "/"),
    completion_audit: path.relative(STUDIO_ROOT, COMPLETION_AUDIT_PATH).replace(/\\/g, "/"),
  },
};

await writeJsonAtomic(OUT_PATH, report);

console.log(JSON.stringify({
  artifact: path.relative(STUDIO_ROOT, OUT_PATH).replace(/\\/g, "/"),
  status: report.status,
  failed_checks: failedChecks,
  stable_paths: stablePaths.length,
  optional_evidence_paths: optionalEvidencePaths.length,
}, null, 2));

if (!safeForCoordinationPr) process.exit(1);
