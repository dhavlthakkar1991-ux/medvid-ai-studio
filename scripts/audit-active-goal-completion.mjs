import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const PROJECT_ID = process.env.PHASE2FG_PROJECT_ID ?? "24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99";
const ARTIFACT_ROOT = path.join("data", "review-artifacts");
const PHASE_DIR = path.join(ARTIFACT_ROOT, PROJECT_ID, "phase-2fg-g1");
const OUT_PATH =
  process.env.ACTIVE_GOAL_COMPLETION_AUDIT_OUT ??
  path.join(ARTIFACT_ROOT, "active-goal-completion-audit.json");
const RUNNING_AS_SUITE_POST_CHECK = process.env.GOAL_SUITE_AUDIT_POST_CHECK === "1";

const expectedGoalSuiteSteps = [
  "active_goal_readiness",
  "self_hosting_audit",
  "phase2fg_workflow",
  "latest_render_evidence",
  "worker_typecheck",
  "worker_build",
  "studio_typecheck",
  "phase2fg_ui_smoke",
  "scene_review_browser_smoke",
];

const expectedHumanControls = [
  "Search providers",
  "Generate with AI",
  "Show prompt",
  "Copy prompt",
  "Upload / Replace",
  "Paste URL",
  "Use existing approved asset",
  "Fix timing",
  "Preview at timestamp",
];

const expectedSmokeChecks = [
  "scene_asset_review_visible",
  "scene_groups_present",
  "asset_todo_list_visible",
  "asset_todo_cards_present",
  "required_items_first",
  "required_row_controls_present",
  "upload_replace_file_input_present",
  "prompt_modal_opens",
  "prompt_specific_to_requirement",
  "dialog_upload_generated_result_present",
  "copy_prompt_copies_text",
  "raw_debug_toggle_present",
  "raw_debug_section_present",
  "biopsy_does_not_show_india_map_as_valid_asset",
  "professional_readiness_not_false_green",
];

const requiredPhaseArtifacts = [
  "asset_requirement_triage_report.json",
  "asset_todo_list.json",
  "asset_todo_list.md",
  "canonical_asset_requirements.json",
  "approved_asset_mismatch_report.json",
  "asset_timeline_fit_report.json",
  "asset_generation_prompts.json",
  "external_generation_prompts.md",
  "single_asset_generation_audit.json",
  "human_loop_completion_report.json",
  "professional_readiness_summary.json",
  "benchmark_render_latest_verified.json",
];

const expectedPackageScripts = {
  "audit:active-goal": "node scripts/audit-active-goal-completion.mjs",
  "audit:active-goal-worktree": "node scripts/audit-active-goal-worktree.mjs",
  "audit:active-goal-package": "node scripts/audit-active-goal-package.mjs",
  "audit:cleanup-pr-package": "node scripts/audit-cleanup-pr-package.mjs",
  "verify:active-goal": "node scripts/verify-active-goal.mjs",
  "verify:self-hosting": "node scripts/verify-self-hosting.mjs",
  "verify:goal-suite": "node scripts/verify-goal-suite.mjs",
  "verify:goal-suite:audited": "GOAL_SUITE_RUN_COMPLETION_AUDIT",
  "verify:goal-suite:e2e": "GOAL_SUITE_INCLUDE_BROWSER",
  "verify:goal-suite:full": "GOAL_SUITE_INCLUDE_BUILD",
  "verify:phase2fg": "node scripts/phase2fg-verify-workflow.mjs",
  "verify:phase2fg-render-latest": "PHASE2FG_VERIFY_LATEST_ONLY",
  "verify:phase2g-render-quality": "node scripts/phase2g-render-quality-verifier.mjs",
  "smoke:phase2fg-ui": "node scripts/phase2fg-ui-smoke.mjs",
  "smoke:scene-review": "node scripts/scene-review-smoke.mjs",
};

const suiteFreshnessFiles = [
  "package.json",
  "package-lock.json",
  path.join("scripts", "verify-goal-suite.mjs"),
  path.join("scripts", "audit-active-goal-completion.mjs"),
  path.join("scripts", "audit-active-goal-worktree.mjs"),
  path.join("scripts", "audit-active-goal-package.mjs"),
  path.join("scripts", "audit-cleanup-pr-package.mjs"),
  path.join("scripts", "phase2g-render-quality-verifier.mjs"),
  path.join("docs", "active-medvideo-goal.md"),
  path.join("docs", "active-goal-inventory.md"),
];

function readJson(file) {
  if (!fs.existsSync(file)) return { ok: false, file, missing: true, value: null };
  try {
    return { ok: true, file, value: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (error) {
    return { ok: false, file, parse_error: error instanceof Error ? error.message : String(error), value: null };
  }
}

function exists(file) {
  return fs.existsSync(file);
}

function check(name, passed, evidence = {}, severity = "required") {
  return {
    name,
    severity,
    passed: Boolean(passed),
    evidence,
  };
}

function checkArrayIncludesAll(values, expected) {
  const set = new Set((values ?? []).map(String));
  return expected.filter((item) => !set.has(item));
}

function namedChecks(smoke) {
  const rows = Array.isArray(smoke?.checks) ? smoke.checks : [];
  return new Map(rows.map((row) => [row.name, row]));
}

function fileMtimeIso(file) {
  if (!exists(file)) return null;
  return fs.statSync(file).mtime.toISOString();
}

function listTempFiles(root) {
  if (!exists(root)) return [];
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const directory = stack.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".tmp")) {
        const stat = fs.statSync(fullPath);
        out.push({
          file: fullPath,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        });
      }
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

function timestampMs(value) {
  const timestamp = new Date(String(value ?? "")).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

async function probeTcpListener(baseUrl, required) {
  if (!required) {
    return {
      required: false,
      base_url: baseUrl ?? null,
      host: null,
      port: null,
      listening: null,
      error: null,
    };
  }

  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch (error) {
    return {
      required: true,
      base_url: baseUrl ?? null,
      host: null,
      port: null,
      listening: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
  const host = parsed.hostname || "localhost";

  return await new Promise((resolve) => {
    let settled = false;
    const socket = net.createConnection({ host, port });
    const finish = (listening, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({
        required: true,
        base_url: baseUrl,
        host,
        port,
        listening,
        error,
      });
    };
    const timer = setTimeout(() => {
      finish(false, "timeout");
    }, 1000);
    socket.once("connect", () => {
      finish(true);
    });
    socket.once("error", (error) => {
      finish(false, error.code ?? error.message);
    });
  });
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

function staleFilesSince(timestamp) {
  const suiteTime = timestamp ? new Date(timestamp).getTime() : Number.NaN;
  return suiteFreshnessFiles
    .map((file) => ({
      file,
      mtime: fileMtimeIso(file),
    }))
    .filter((row) => row.mtime && (!Number.isFinite(suiteTime) || new Date(row.mtime).getTime() > suiteTime));
}

const files = {
  goalSuite: path.join(ARTIFACT_ROOT, "goal-suite", "goal-suite.json"),
  activeReadiness: path.join(ARTIFACT_ROOT, "active-goal-readiness.json"),
  activeWorktreeInventory: path.join(ARTIFACT_ROOT, "active-goal-worktree-inventory.json"),
  activePackageManifest: path.join(ARTIFACT_ROOT, "active-goal-package-manifest.json"),
  cleanupPackageAudit: path.join(ARTIFACT_ROOT, "cleanup-pr-package-audit.json"),
  selfHosting: path.join(ARTIFACT_ROOT, "self-hosting", "self-hosting-audit.json"),
  browserSmoke: path.join(ARTIFACT_ROOT, PROJECT_ID, "browser-smoke", "scene-review-smoke.json"),
  packageJson: "package.json",
  activeDoc: path.join("docs", "active-medvideo-goal.md"),
  activeInventory: path.join("docs", "active-goal-inventory.md"),
  professionalReadiness: path.join(PHASE_DIR, "professional_readiness_summary.json"),
  assetTodo: path.join(PHASE_DIR, "asset_todo_list.json"),
  canonicalRequirements: path.join(PHASE_DIR, "canonical_asset_requirements.json"),
  mismatchReport: path.join(PHASE_DIR, "approved_asset_mismatch_report.json"),
  timelineFit: path.join(PHASE_DIR, "asset_timeline_fit_report.json"),
  generationPrompts: path.join(PHASE_DIR, "asset_generation_prompts.json"),
  generationAudit: path.join(PHASE_DIR, "single_asset_generation_audit.json"),
  humanLoop: path.join(PHASE_DIR, "human_loop_completion_report.json"),
  latestRender: path.join(PHASE_DIR, "benchmark_render_latest_verified.json"),
};

const jsonReads = {
  goalSuite: readJson(files.goalSuite),
  activeReadiness: readJson(files.activeReadiness),
  activeWorktreeInventory: readJson(files.activeWorktreeInventory),
  activePackageManifest: readJson(files.activePackageManifest),
  selfHosting: readJson(files.selfHosting),
  browserSmoke: readJson(files.browserSmoke),
  packageJson: readJson(files.packageJson),
  professionalReadiness: readJson(files.professionalReadiness),
  assetTodo: readJson(files.assetTodo),
  canonicalRequirements: readJson(files.canonicalRequirements),
  mismatchReport: readJson(files.mismatchReport),
  timelineFit: readJson(files.timelineFit),
  generationPrompts: readJson(files.generationPrompts),
  generationAudit: readJson(files.generationAudit),
  humanLoop: readJson(files.humanLoop),
  latestRender: readJson(files.latestRender),
};

const goalSuite = jsonReads.goalSuite.value;
const activeReadiness = jsonReads.activeReadiness.value;
const activeWorktreeInventory = jsonReads.activeWorktreeInventory.value;
const activePackageManifest = jsonReads.activePackageManifest.value;
const selfHosting = jsonReads.selfHosting.value;
const browserSmoke = jsonReads.browserSmoke.value;
const packageJson = jsonReads.packageJson.value;
const professionalReadiness = jsonReads.professionalReadiness.value;
const assetTodo = jsonReads.assetTodo.value;
const canonicalRequirements = jsonReads.canonicalRequirements.value;
const mismatchReport = jsonReads.mismatchReport.value;
const timelineFit = jsonReads.timelineFit.value;
const generationPrompts = jsonReads.generationPrompts.value;
const generationAudit = jsonReads.generationAudit.value;
const humanLoop = jsonReads.humanLoop.value;
const latestRender = jsonReads.latestRender.value;

const jsonReadFailures = Object.entries(jsonReads)
  .filter(([, result]) => result.ok !== true)
  .map(([name, result]) => ({
    name,
    file: result.file,
    missing: result.missing === true,
    parse_error: result.parse_error ?? null,
  }));
const jsonReadSummary = Object.fromEntries(
  Object.entries(jsonReads).map(([name, result]) => [name, {
    file: result.file,
    ok: result.ok,
    missing: result.missing === true,
    parse_error: result.parse_error ?? null,
  }]),
);

const goalStepStatus = new Map((goalSuite?.steps ?? []).map((step) => [step.name, step.status]));
const completionAuditPostCheck = (goalSuite?.post_checks ?? []).find((step) => step.name === "active_goal_completion_audit");
const worktreeInventoryPostCheck = (goalSuite?.post_checks ?? []).find((step) => step.name === "active_goal_worktree_inventory");
const packageManifestPostCheck = (goalSuite?.post_checks ?? []).find((step) => step.name === "active_goal_package_manifest");
const cleanupPackageAuditPostCheck = (goalSuite?.post_checks ?? []).find((step) => step.name === "cleanup_pr_package_audit");
const missingGoalSteps = expectedGoalSuiteSteps.filter((name) => goalStepStatus.get(name) !== "passed");
const missingHumanControls = checkArrayIncludesAll(humanLoop?.controls_expected_per_requirement, expectedHumanControls);
const smokeChecks = namedChecks(browserSmoke);
const missingSmokeChecks = expectedSmokeChecks.filter((name) => smokeChecks.get(name)?.ok !== true);
const missingPhaseArtifacts = requiredPhaseArtifacts.filter((file) => !exists(path.join(PHASE_DIR, file)));
const activeDocText = exists(files.activeDoc) ? fs.readFileSync(files.activeDoc, "utf8") : "";
const activeInventoryText = exists(files.activeInventory) ? fs.readFileSync(files.activeInventory, "utf8") : "";
const missingPackageScripts = Object.entries(expectedPackageScripts)
  .filter(([name, expectedSubstring]) => !String(packageJson?.scripts?.[name] ?? "").includes(expectedSubstring))
  .map(([name, expectedSubstring]) => ({
    name,
    expected_substring: expectedSubstring,
    actual: packageJson?.scripts?.[name] ?? null,
  }));
const suiteStaleFiles = staleFilesSince(goalSuite?.finished_at);
const worktreeInventoryCoordinationPaths = activeWorktreeInventory?.studio?.coordination_path_status ?? [];
const missingCurrentCoordinationPaths = Array.isArray(worktreeInventoryCoordinationPaths)
  ? worktreeInventoryCoordinationPaths
      .filter((row) => !exists(row.file))
      .map((row) => row.file)
  : null;
const coordinationPackagingPlan = activeWorktreeInventory?.studio?.coordination_packaging_plan ?? null;
const coordinationPackagingCandidates = coordinationPackagingPlan?.stage_candidates ?? [];
const secretSensitiveCoordinationPaths = coordinationPackagingPlan?.secret_sensitive_coordination_paths ?? [];
const packageManifestFiles = activePackageManifest?.files ?? [];
const packageDependencyClosure = activePackageManifest?.dependency_closure ?? null;
const packageScriptDependencyPaths = Array.isArray(packageDependencyClosure?.package_script_dependency_paths)
  ? packageDependencyClosure.package_script_dependency_paths
  : [];
const missingPackageScriptDependencyPaths = Array.isArray(packageDependencyClosure?.missing_package_script_dependency_paths)
  ? packageDependencyClosure.missing_package_script_dependency_paths
  : [];
const packageLockfilePaths = Array.isArray(packageDependencyClosure?.lockfile_paths)
  ? packageDependencyClosure.lockfile_paths
  : [];
const stagePreviewStablePaths = Array.isArray(activePackageManifest?.stage_command_preview?.stable_code_doc_paths)
  ? activePackageManifest.stage_command_preview.stable_code_doc_paths
  : [];
const dependencyClosurePaths = [
  ...packageScriptDependencyPaths,
  ...packageLockfilePaths,
];
const missingDependencyPathsFromStagePreview = dependencyClosurePaths.filter((file) => !stagePreviewStablePaths.includes(file));
const packageLockfileMissingFromClosure = exists("package-lock.json") && !packageLockfilePaths.includes("package-lock.json");
const missingExpectedScriptsFromInventory = Object.keys(expectedPackageScripts)
  .filter((name) => !activeInventoryText.includes(`\`${name}\``));
const goalSuiteStartedMs = timestampMs(goalSuite?.generated_at);
const goalSuiteFinishedMs = timestampMs(goalSuite?.finished_at);
const worktreeInventoryGeneratedMs = timestampMs(activeWorktreeInventory?.generated_at);
const worktreeInventoryMatchesSuiteWindow =
  worktreeInventoryGeneratedMs !== null &&
  goalSuiteStartedMs !== null &&
  goalSuiteFinishedMs !== null &&
  worktreeInventoryGeneratedMs >= goalSuiteStartedMs &&
  worktreeInventoryGeneratedMs <= goalSuiteFinishedMs;
const leftoverArtifactTempFiles = listTempFiles(ARTIFACT_ROOT);
const goalSuiteStartedStudio = goalSuite?.studio_server?.started_by_suite === true;
const goalSuiteStartedWorker = goalSuite?.worker_server?.started_by_suite === true;
const goalSuiteStartedServiceCleanupOk =
  RUNNING_AS_SUITE_POST_CHECK ||
  ((!goalSuiteStartedStudio || goalSuite?.studio_server_stop?.ok === true) &&
    (!goalSuiteStartedWorker || goalSuite?.worker_server_stop?.ok === true));
const suiteStartedServiceListenerProbes = {
  studio: await probeTcpListener(goalSuite?.studio_server?.base_url, goalSuiteStartedStudio && !RUNNING_AS_SUITE_POST_CHECK),
  worker: await probeTcpListener(goalSuite?.worker_server?.base_url, goalSuiteStartedWorker && !RUNNING_AS_SUITE_POST_CHECK),
};
const suiteStartedServiceListenersAbsent =
  RUNNING_AS_SUITE_POST_CHECK ||
  Object.values(suiteStartedServiceListenerProbes).every((probe) => probe.required !== true || probe.listening === false);

const checks = [
  check("active_goal_json_inputs_parseable", jsonReadFailures.length === 0, {
    inputs: jsonReadSummary,
    failures: jsonReadFailures,
  }),
  check("active_goal_temp_artifacts_absent", leftoverArtifactTempFiles.length === 0, {
    directory: ARTIFACT_ROOT,
    temp_files: leftoverArtifactTempFiles,
  }),
  check("combined_e2e_suite_passed", goalSuite?.ready === true && goalSuite?.include_browser === true && missingGoalSteps.length === 0, {
    file: files.goalSuite,
    include_browser: goalSuite?.include_browser ?? null,
    missing_or_failed_steps: missingGoalSteps,
  }),
  check("goal_suite_audit_lifecycle_recorded", goalSuite?.run_completion_audit === true && (RUNNING_AS_SUITE_POST_CHECK || completionAuditPostCheck?.status === "passed"), {
    file: files.goalSuite,
    run_completion_audit: goalSuite?.run_completion_audit ?? null,
    running_as_suite_post_check: RUNNING_AS_SUITE_POST_CHECK,
    completion_audit_post_check_status: completionAuditPostCheck?.status ?? null,
    visibility_note: RUNNING_AS_SUITE_POST_CHECK
      ? "The suite appends this audit result after this process exits, so the current goal-suite artifact cannot contain this exact post-check yet."
      : "Standalone audit expects the latest audited suite artifact to contain a passed active_goal_completion_audit post-check.",
  }),
  check("worktree_inventory_post_check_recorded", worktreeInventoryPostCheck?.status === "passed", {
    file: files.goalSuite,
    post_check_status: worktreeInventoryPostCheck?.status ?? null,
  }),
  check("package_manifest_post_check_recorded", packageManifestPostCheck?.status === "passed", {
    file: files.goalSuite,
    post_check_status: packageManifestPostCheck?.status ?? null,
  }),
  check("cleanup_pr_package_audit_post_check_recorded", cleanupPackageAuditPostCheck?.status === "passed", {
    file: files.goalSuite,
    post_check_status: cleanupPackageAuditPostCheck?.status ?? null,
  }),
  check("active_goal_package_scripts_registered", missingPackageScripts.length === 0, {
    file: files.packageJson,
    expected_scripts: Object.keys(expectedPackageScripts),
    missing_or_mismatched: missingPackageScripts,
  }),
  check("goal_suite_artifact_fresh_for_coordination_files", suiteStaleFiles.length === 0, {
    file: files.goalSuite,
    goal_suite_finished_at: goalSuite?.finished_at ?? null,
    checked_files: suiteFreshnessFiles,
    files_newer_than_suite: suiteStaleFiles,
  }),
  check("active_goal_worktree_inventory_valid", activeWorktreeInventory?.studio?.git_status_ok === true && activeWorktreeInventory?.worker?.git_status_ok === true && Array.isArray(worktreeInventoryCoordinationPaths) && worktreeInventoryCoordinationPaths.length >= suiteFreshnessFiles.length && Array.isArray(missingCurrentCoordinationPaths) && missingCurrentCoordinationPaths.length === 0, {
    file: files.activeWorktreeInventory,
    studio_git_status_ok: activeWorktreeInventory?.studio?.git_status_ok ?? null,
    worker_git_status_ok: activeWorktreeInventory?.worker?.git_status_ok ?? null,
    coordination_path_count: Array.isArray(worktreeInventoryCoordinationPaths) ? worktreeInventoryCoordinationPaths.length : null,
    missing_coordination_paths: missingCurrentCoordinationPaths,
    note: "Generated evidence paths may be created after the worktree inventory snapshot; this check verifies current filesystem existence at audit time.",
  }),
  check("active_goal_coordination_packaging_scope_safe", coordinationPackagingPlan?.stage_explicit_paths_only === true && Array.isArray(coordinationPackagingCandidates) && coordinationPackagingCandidates.length >= suiteFreshnessFiles.length && Array.isArray(secretSensitiveCoordinationPaths) && secretSensitiveCoordinationPaths.length === 0, {
    file: files.activeWorktreeInventory,
    stage_explicit_paths_only: coordinationPackagingPlan?.stage_explicit_paths_only ?? null,
    stage_candidate_count: Array.isArray(coordinationPackagingCandidates) ? coordinationPackagingCandidates.length : null,
    secret_sensitive_coordination_paths: secretSensitiveCoordinationPaths,
    warnings: coordinationPackagingPlan?.warnings ?? null,
    note: "Warnings are allowed for dirty non-coordination secret paths and broad untracked parent directories; this check fails only if the coordination scope itself is unsafe or missing.",
  }),
  check("active_goal_package_manifest_secret_scan_clean", activePackageManifest?.stage_explicit_paths_only === true && activePackageManifest?.stage_command_preview?.preview_only === true && activePackageManifest?.stage_command_preview?.recommended_default === "stable_code_docs_only" && String(activePackageManifest?.stage_command_preview?.recommended_command ?? "").includes("git add --") && String(activePackageManifest?.stage_command_preview?.optional_evidence_command ?? "").includes("git add --") && String(activePackageManifest?.stage_command_preview?.command ?? "").includes("git add --") && Array.isArray(activePackageManifest?.stage_command_preview?.stable_code_doc_paths) && activePackageManifest.stage_command_preview.stable_code_doc_paths.length > 0 && Array.isArray(activePackageManifest?.stage_command_preview?.optional_evidence_paths) && activePackageManifest.stage_command_preview.optional_evidence_paths.length > 0 && Array.isArray(activePackageManifest?.stage_command_preview?.per_file_commands) && activePackageManifest.stage_command_preview.per_file_commands.length === activePackageManifest.explicit_stage_paths?.length && Array.isArray(packageManifestFiles) && packageManifestFiles.length >= suiteFreshnessFiles.length && Array.isArray(packageDependencyClosure?.package_script_dependency_paths) && packageScriptDependencyPaths.length > 0 && Array.isArray(packageDependencyClosure?.missing_package_script_dependency_paths) && missingPackageScriptDependencyPaths.length === 0 && Array.isArray(packageDependencyClosure?.lockfile_paths) && !packageLockfileMissingFromClosure && missingDependencyPathsFromStagePreview.length === 0 && Array.isArray(activePackageManifest?.missing_files) && activePackageManifest.missing_files.length === 0 && activePackageManifest?.secret_scan?.ok === true && activePackageManifest?.secret_scan?.findings_count === 0, {
    file: files.activePackageManifest,
    stage_explicit_paths_only: activePackageManifest?.stage_explicit_paths_only ?? null,
    stage_command_preview: activePackageManifest?.stage_command_preview ?? null,
    dependency_closure: packageDependencyClosure,
    missing_dependency_paths_from_stage_preview: missingDependencyPathsFromStagePreview,
    package_lockfile_missing_from_closure: packageLockfileMissingFromClosure,
    file_count: Array.isArray(packageManifestFiles) ? packageManifestFiles.length : null,
    missing_files: activePackageManifest?.missing_files ?? null,
    secret_scan: activePackageManifest?.secret_scan ?? null,
    note: "This scans explicit coordination package files plus package.json script dependencies and package-lock.json. Non-coordination secret files such as .env are intentionally excluded.",
  }),
  check("worktree_inventory_matches_latest_suite_window", worktreeInventoryMatchesSuiteWindow, {
    file: files.activeWorktreeInventory,
    goal_suite_file: files.goalSuite,
    goal_suite_generated_at: goalSuite?.generated_at ?? null,
    goal_suite_finished_at: goalSuite?.finished_at ?? null,
    worktree_inventory_generated_at: activeWorktreeInventory?.generated_at ?? null,
  }),
  check("goal_suite_started_services_cleaned_up", goalSuiteStartedServiceCleanupOk, {
    file: files.goalSuite,
    running_as_suite_post_check: RUNNING_AS_SUITE_POST_CHECK,
    studio_started_by_suite: goalSuiteStartedStudio,
    worker_started_by_suite: goalSuiteStartedWorker,
    studio_cleanup_ok: goalSuite?.studio_server_stop?.ok ?? null,
    worker_cleanup_ok: goalSuite?.worker_server_stop?.ok ?? null,
    visibility_note: RUNNING_AS_SUITE_POST_CHECK
      ? "The suite stops started services after this in-suite audit process exits, so standalone audit enforces cleanup ok."
      : "Standalone audit expects any suite-started Studio/Worker services to have cleanup ok=true.",
  }),
  check("goal_suite_started_service_ports_released", suiteStartedServiceListenersAbsent, {
    file: files.goalSuite,
    running_as_suite_post_check: RUNNING_AS_SUITE_POST_CHECK,
    probes: suiteStartedServiceListenerProbes,
    visibility_note: RUNNING_AS_SUITE_POST_CHECK
      ? "The suite stops started services after this in-suite audit process exits, so standalone audit probes the ports."
      : "Standalone audit expects ports for suite-started Studio/Worker services to be closed after cleanup.",
  }),
  check("active_infrastructure_ready", activeReadiness?.ready === true && activeReadiness?.worker?.status === "ok" && activeReadiness?.taxonomy?.remote_taxonomy_migration_pending === false, {
    file: files.activeReadiness,
    project_ref: activeReadiness?.project_ref ?? null,
    worker_status: activeReadiness?.worker?.status ?? null,
    taxonomy_pending: activeReadiness?.taxonomy?.remote_taxonomy_migration_pending ?? null,
    blockers: activeReadiness?.blockers ?? null,
  }),
  check("self_hosting_audit_ready", selfHosting?.ready === true && Array.isArray(selfHosting?.failures) && selfHosting.failures.length === 0, {
    file: files.selfHosting,
    warnings: selfHosting?.warnings ?? null,
  }),
  check("phase2fg_required_artifacts_present", missingPhaseArtifacts.length === 0, {
    directory: PHASE_DIR,
    missing: missingPhaseArtifacts,
  }),
  check("asset_todo_is_deduped_and_actionable", Array.isArray(assetTodo) && assetTodo.length === 15 && Array.isArray(canonicalRequirements) && canonicalRequirements.length === assetTodo.length, {
    asset_todo_count: Array.isArray(assetTodo) ? assetTodo.length : null,
    canonical_count: Array.isArray(canonicalRequirements) ? canonicalRequirements.length : null,
  }),
  check("human_loop_controls_recorded", humanLoop?.actionable_required_first === true && missingHumanControls.length === 0 && Array.isArray(humanLoop?.unresolved_required) && humanLoop.unresolved_required.length === 0, {
    file: files.humanLoop,
    missing_controls: missingHumanControls,
    unresolved_required: humanLoop?.unresolved_required ?? null,
  }),
  check("individual_prompt_workflow_artifacts_complete", Array.isArray(generationPrompts) && generationPrompts.length === 15 && Array.isArray(generationAudit) && generationAudit.length === 15, {
    prompts_count: Array.isArray(generationPrompts) ? generationPrompts.length : null,
    audit_count: Array.isArray(generationAudit) ? generationAudit.length : null,
  }),
  check("mismatch_and_timing_gates_clean", Array.isArray(mismatchReport) && mismatchReport.length === 0 && Array.isArray(timelineFit) && timelineFit.length === 15 && professionalReadiness?.professional_ready === true && professionalReadiness?.mismatch_count === 0 && professionalReadiness?.timing_problem_count === 0 && professionalReadiness?.render_spec_valid === true, {
    mismatch_count: Array.isArray(mismatchReport) ? mismatchReport.length : null,
    timeline_fit_count: Array.isArray(timelineFit) ? timelineFit.length : null,
    professional_ready: professionalReadiness?.professional_ready ?? null,
    render_spec_valid: professionalReadiness?.render_spec_valid ?? null,
  }),
  check("scene_review_browser_smoke_passed", browserSmoke?.ok === true && missingSmokeChecks.length === 0 && Array.isArray(browserSmoke?.page_errors) && browserSmoke.page_errors.length === 0 && Array.isArray(browserSmoke?.console) && browserSmoke.console.length === 0, {
    file: files.browserSmoke,
    missing_checks: missingSmokeChecks,
    page_errors: browserSmoke?.page_errors?.length ?? null,
    console_errors: browserSmoke?.console?.length ?? null,
  }),
  check("latest_render_evidence_valid", latestRender?.final_job?.status === "completed" && latestRender?.provider_job?.status === "completed" && latestRender?.output_head?.ok === true && latestRender?.output_head?.content_type === "video/mp4" && latestRender?.ffprobe?.ok === true && latestRender?.ffprobe?.video?.codec === "h264" && latestRender?.ffprobe?.audio?.codec === "aac", {
    file: files.latestRender,
    render_job_id: latestRender?.render_job_id ?? null,
    provider_job_id: latestRender?.provider?.provider_job_id ?? null,
    output_head: latestRender?.output_head ?? null,
    ffprobe: latestRender?.ffprobe ?? null,
  }),
  check("active_goal_doc_has_evidence_index", activeDocText.includes("## Evidence Index") && activeDocText.includes("## Latest Coordination Checkpoint - 2026-06-27") && activeDocText.includes("active-goal-completion-audit.json") && activeDocText.includes("handoff_summary") && activeDocText.includes("active-goal-worktree-inventory.json") && activeDocText.includes("active-goal-package-manifest.json") && activeDocText.includes("cleanup-pr-package-audit.json") && activeDocText.includes("audit:cleanup-pr-package") && activeDocText.includes("stage_command_preview") && activeDocText.includes("dependency_closure") && activeDocText.includes("package-lock.json") && activeDocText.includes("worktree_inventory_matches_latest_suite_window") && activeDocText.includes("active_goal_package_manifest_secret_scan_clean") && activeDocText.includes("active_goal_json_inputs_parseable") && activeDocText.includes("active_goal_temp_artifacts_absent") && activeDocText.includes("goal_suite_started_services_cleaned_up") && activeDocText.includes("goal_suite_started_service_ports_released"), {
    file: files.activeDoc,
    has_evidence_index: activeDocText.includes("## Evidence Index"),
    has_latest_coordination_checkpoint: activeDocText.includes("## Latest Coordination Checkpoint - 2026-06-27"),
    mentions_completion_audit: activeDocText.includes("active-goal-completion-audit.json"),
    mentions_handoff_summary: activeDocText.includes("handoff_summary"),
    mentions_worktree_inventory: activeDocText.includes("active-goal-worktree-inventory.json"),
    mentions_package_manifest: activeDocText.includes("active-goal-package-manifest.json"),
    mentions_cleanup_pr_package_audit: activeDocText.includes("cleanup-pr-package-audit.json"),
    mentions_cleanup_pr_command: activeDocText.includes("audit:cleanup-pr-package"),
    mentions_stage_command_preview: activeDocText.includes("stage_command_preview"),
    mentions_dependency_closure: activeDocText.includes("dependency_closure"),
    mentions_package_lockfile: activeDocText.includes("package-lock.json"),
    mentions_worktree_suite_window_check: activeDocText.includes("worktree_inventory_matches_latest_suite_window"),
    mentions_package_manifest_secret_scan_check: activeDocText.includes("active_goal_package_manifest_secret_scan_clean"),
    mentions_json_parseability_check: activeDocText.includes("active_goal_json_inputs_parseable"),
    mentions_temp_artifact_check: activeDocText.includes("active_goal_temp_artifacts_absent"),
    mentions_suite_started_service_cleanup_ok: activeDocText.includes("goal_suite_started_services_cleaned_up"),
    mentions_suite_started_service_ports_released: activeDocText.includes("goal_suite_started_service_ports_released"),
  }, "informational"),
  check("active_goal_inventory_has_handoff_guardrails", activeInventoryText.includes("npm.cmd run verify:goal-suite:audited") && activeInventoryText.includes("current_phase_verified") && activeInventoryText.includes("handoff_summary") && activeInventoryText.includes("coordination_packaging_plan") && activeInventoryText.includes("active-goal-package-manifest.json") && activeInventoryText.includes("cleanup-pr-package-audit.json") && activeInventoryText.includes("audit:cleanup-pr-package") && activeInventoryText.includes("stage_command_preview") && activeInventoryText.includes("dependency_closure") && activeInventoryText.includes("package-lock.json") && activeInventoryText.includes("stage explicit") && activeInventoryText.includes("Pending Phase Backlog") && activeInventoryText.includes("Entry criteria") && activeInventoryText.includes("Verification expectation") && activeInventoryText.includes("Cloud/provider-backed AI asset generation hardening") && activeInventoryText.includes("Do not mark the broad active goal complete") && activeInventoryText.includes("worktree_inventory_matches_latest_suite_window") && activeInventoryText.includes("active_goal_json_inputs_parseable") && activeInventoryText.includes("active_goal_temp_artifacts_absent") && activeInventoryText.includes("Suite-started service cleanup records an `ok` field") && activeInventoryText.includes("goal_suite_started_service_ports_released") && missingExpectedScriptsFromInventory.length === 0, {
    file: files.activeInventory,
    mentions_audited_suite: activeInventoryText.includes("npm.cmd run verify:goal-suite:audited"),
    mentions_current_phase_status: activeInventoryText.includes("current_phase_verified"),
    mentions_handoff_summary: activeInventoryText.includes("handoff_summary"),
    mentions_coordination_packaging_plan: activeInventoryText.includes("coordination_packaging_plan"),
    mentions_package_manifest: activeInventoryText.includes("active-goal-package-manifest.json"),
    mentions_cleanup_pr_package_audit: activeInventoryText.includes("cleanup-pr-package-audit.json"),
    mentions_cleanup_pr_command: activeInventoryText.includes("audit:cleanup-pr-package"),
    mentions_stage_command_preview: activeInventoryText.includes("stage_command_preview"),
    mentions_dependency_closure: activeInventoryText.includes("dependency_closure"),
    mentions_package_lockfile: activeInventoryText.includes("package-lock.json"),
    mentions_stage_explicit_paths_only: activeInventoryText.includes("stage explicit"),
    mentions_pending_phase_backlog: activeInventoryText.includes("Pending Phase Backlog"),
    mentions_entry_criteria: activeInventoryText.includes("Entry criteria"),
    mentions_verification_expectation: activeInventoryText.includes("Verification expectation"),
    mentions_ai_asset_generation_backlog: activeInventoryText.includes("Cloud/provider-backed AI asset generation hardening"),
    mentions_non_completion_guardrail: activeInventoryText.includes("Do not mark the broad active goal complete"),
    mentions_worktree_suite_window_check: activeInventoryText.includes("worktree_inventory_matches_latest_suite_window"),
    mentions_json_parseability_check: activeInventoryText.includes("active_goal_json_inputs_parseable"),
    mentions_temp_artifact_check: activeInventoryText.includes("active_goal_temp_artifacts_absent"),
    mentions_suite_started_service_cleanup_ok: activeInventoryText.includes("Suite-started service cleanup records an `ok` field"),
    mentions_suite_started_service_ports_released: activeInventoryText.includes("goal_suite_started_service_ports_released"),
    missing_expected_package_scripts: missingExpectedScriptsFromInventory,
  }, "informational"),
];

const requiredChecks = checks.filter((row) => row.severity === "required");
const failedRequiredChecks = requiredChecks.filter((row) => !row.passed).map((row) => row.name);
const allRequiredChecksPassed = failedRequiredChecks.length === 0;
const generatedAt = new Date().toISOString();
const checkByName = new Map(checks.map((row) => [row.name, row]));
const pendingPhaseBacklog = [
  {
    id: "phase2fg_g1_current",
    label: "Phase 2F-G/G1 required asset triage and human-in-loop readiness",
    status: allRequiredChecksPassed ? "current_phase_verified" : "needs_attention",
    evidence: "Verified by verify:goal-suite:audited and audit:active-goal.",
    entry_criteria: "Continue only after active-goal readiness, Phase 2F-G workflow, browser smoke, and latest render evidence are green.",
    next_action: "Keep in regression while choosing the next product phase.",
    verification: "npm.cmd run verify:goal-suite:audited; npm.cmd run audit:active-goal",
  },
  {
    id: "deployment_hardening",
    label: "Production deployment hardening",
    status: "pending_next_phase",
    evidence: "Self-hosting audit and local Studio/Worker checks pass; public HTTPS VPS deployment is not covered by the current audit.",
    entry_criteria: "A public HTTPS Studio URL, public HTTPS Worker URL, matching CUSTOM_WORKER_SECRET, Supabase env, and storage access are available.",
    next_action: "Verify public Worker URL, public Studio callback URL, matching secrets, storage access, and remote health/render dispatch.",
    verification: "Run self-hosting audit, active-goal readiness against public provider config, worker /health over HTTPS, one Studio-to-Worker dispatch, callback persistence, output HEAD, and ffprobe.",
  },
  {
    id: "render_quality_next",
    label: "Next render-quality phase",
    status: "evidence_generated_needs_review",
    evidence: "Latest benchmark MP4 is ffprobe-valid and persisted; docs/phase-2g-render-quality-acceptance.md defines the target; npm.cmd run verify:phase2g-render-quality generates frame/contact-sheet evidence and currently reports NEEDS_HUMAN_REVIEW_OR_SMALL_FIXES. The 01:21 oral-exam classification is repaired, warning-patches are evaluated at 00:48, the 01:39 CTA now passes automated quality checks, 00:20 Pexels license metadata is normalized, the 01:21 Pexels clinical-use source-safety issue is replaced with an approved Studio-owned workflow visual, and npm.cmd run review:phase2g-clinical generates a focused human-review packet.",
    entry_criteria: "Use the Phase 2G report and clinical review packet before changing renderer or layout behavior.",
    next_action: "Human medical/design review must approve or request corrections for 00:36, 00:48, 00:59, and 01:21 using clinical_human_review_packet.md.",
    verification: "Re-run npm.cmd run verify:phase2g-render-quality and npm.cmd run review:phase2g-clinical; require technical checks green, all non-clinical scenes pass, and clinical/anatomy scenes have explicit human approval before final Phase 2G acceptance.",
  },
  {
    id: "ai_asset_generation_cloud_hardening",
    label: "Cloud/provider-backed AI asset generation hardening",
    status: "pending_next_phase",
    evidence: "Basic local generation/review is merged and verified: Studio PR #6 adds focused Review Assets generation controls, Worker PR #1 adds the heygen_hyperframes local HyperFrames provider, and npm.cmd run verify:generation-provider proves MP4/PNG output plus checkStatus/downloadResult. This does not yet prove production cloud HeyGen generation.",
    entry_criteria: "Cloud provider credentials, cost/safety boundaries, output hosting, and review-gating rules are explicit.",
    next_action: "Verify a cloud/provider-backed generation run from a requirement row without bypassing human review, licensing, or Studio-as-Director constraints.",
    verification: "Generate one cloud-backed asset from a requirement row, store prompt/provider/model/cost/result metadata, show it in Review Assets, approve or reject through human review, then prove Manifest/RenderSpec mapping only after approval.",
  },
  {
    id: "cleanup_pr_packaging",
    label: "Cleanup and PR packaging",
    status: "pending_next_phase",
    evidence: "Worktree inventory exists, but the repository still contains accumulated dirty changes from many phases.",
    entry_criteria: "A specific PR scope is chosen, unrelated dirty files are inventoried but not reverted, and secrets/artifacts are excluded.",
    next_action: "Separate coordination changes from product changes before staging, committing, or opening PRs.",
    verification: "Run worktree inventory, diff review, secret scan for staged files, focused tests for the chosen scope, then commit/push/PR only that scope.",
  },
];
const handoffGuardrailNames = [
  "active_goal_json_inputs_parseable",
  "active_goal_temp_artifacts_absent",
  "combined_e2e_suite_passed",
  "goal_suite_artifact_fresh_for_coordination_files",
  "active_goal_coordination_packaging_scope_safe",
  "active_goal_package_manifest_secret_scan_clean",
  "cleanup_pr_package_audit_post_check_recorded",
  "worktree_inventory_matches_latest_suite_window",
  "goal_suite_started_services_cleaned_up",
  "goal_suite_started_service_ports_released",
  "active_infrastructure_ready",
  "phase2fg_required_artifacts_present",
  "asset_todo_is_deduped_and_actionable",
  "mismatch_and_timing_gates_clean",
  "scene_review_browser_smoke_passed",
  "latest_render_evidence_valid",
];
const handoffSummary = {
  generated_at: generatedAt,
  objective: "there are multiple active / pending prompts triggered inside this workspace currently. to avoid chaos, combine them into a goal and work towards it",
  broad_goal_complete: false,
  current_phase_status: allRequiredChecksPassed ? "current_phase_verified" : "needs_attention",
  current_phase_scope: "Phase 2F-G/G1 coordination and verification evidence for the MedVideo Oral Cancer benchmark.",
  project_id: PROJECT_ID,
  suite: {
    ready: goalSuite?.ready ?? null,
    generated_at: goalSuite?.generated_at ?? null,
    finished_at: goalSuite?.finished_at ?? null,
    include_browser: goalSuite?.include_browser ?? null,
    run_completion_audit: goalSuite?.run_completion_audit ?? null,
    first_failed_step: (goalSuite?.steps ?? []).find((step) => step.status !== "passed")?.name ?? null,
    first_failed_post_check: (goalSuite?.post_checks ?? []).find((step) => step.status !== "passed")?.name ?? null,
  },
  active_infrastructure: {
    project_ref: activeReadiness?.project_ref ?? null,
    ready: activeReadiness?.ready ?? null,
    worker_status: activeReadiness?.worker?.status ?? null,
    taxonomy_pending: activeReadiness?.taxonomy?.remote_taxonomy_migration_pending ?? null,
    blockers: activeReadiness?.blockers ?? null,
  },
  phase2fg: {
    asset_todo_count: Array.isArray(assetTodo) ? assetTodo.length : null,
    canonical_requirement_count: Array.isArray(canonicalRequirements) ? canonicalRequirements.length : null,
    required_total: professionalReadiness?.required_total ?? null,
    required_resolved: professionalReadiness?.required_resolved ?? null,
    required_unresolved: professionalReadiness?.required_unresolved ?? null,
    optional_total: professionalReadiness?.optional_total ?? null,
    optional_unresolved: professionalReadiness?.optional_unresolved ?? null,
    mismatch_count: Array.isArray(mismatchReport) ? mismatchReport.length : null,
    timeline_fit_count: Array.isArray(timelineFit) ? timelineFit.length : null,
    render_spec_valid: professionalReadiness?.render_spec_valid ?? null,
    professional_ready: professionalReadiness?.professional_ready ?? null,
  },
  render_evidence: {
    render_job_id: latestRender?.render_job_id ?? null,
    provider_job_id: latestRender?.provider?.provider_job_id ?? null,
    final_status: latestRender?.final_status ?? latestRender?.final_job?.status ?? null,
    output_http_status: latestRender?.output_head?.status ?? null,
    output_content_type: latestRender?.output_head?.content_type ?? null,
    ffprobe_ok: latestRender?.ffprobe?.ok ?? null,
    video_codec: latestRender?.ffprobe?.video?.codec ?? null,
    audio_codec: latestRender?.ffprobe?.audio?.codec ?? null,
  },
  guardrails: Object.fromEntries(
    handoffGuardrailNames.map((name) => [name, checkByName.get(name)?.passed ?? null]),
  ),
  pending_phase_backlog: pendingPhaseBacklog,
  failed_required_checks: failedRequiredChecks,
  key_commands: [
    "npm.cmd run verify:goal-suite:audited",
    "npm.cmd run audit:active-goal",
    "npm.cmd run verify:active-goal",
    "npm.cmd run verify:phase2fg",
  ],
  key_artifacts: {
    goal_suite: files.goalSuite,
    completion_audit: OUT_PATH,
    worktree_inventory: files.activeWorktreeInventory,
    package_manifest: files.activePackageManifest,
    cleanup_package_audit: files.cleanupPackageAudit,
    active_readiness: files.activeReadiness,
    phase2fg_directory: PHASE_DIR,
    latest_render: files.latestRender,
    browser_smoke: files.browserSmoke,
  },
  next_decision: "Choose the next verified product phase: production deployment hardening, next render-quality phase, cloud/provider-backed AI generation hardening, or cleanup/PR packaging of the verified coordination layer.",
  caution: "Do not mark the broad active goal complete from current-phase evidence alone; the Studio and Worker worktrees still contain accumulated phase work and unrelated dirty files.",
};
const report = {
  generated_at: generatedAt,
  project_id: PROJECT_ID,
  status: handoffSummary.current_phase_status,
  all_required_checks_passed: allRequiredChecksPassed,
  handoff_summary: handoffSummary,
  checks,
  audit_context: {
    running_as_suite_post_check: RUNNING_AS_SUITE_POST_CHECK,
    goal_suite_run_completion_audit: goalSuite?.run_completion_audit ?? null,
    goal_suite_worktree_inventory_post_check_status: worktreeInventoryPostCheck?.status ?? null,
    goal_suite_package_manifest_post_check_status: packageManifestPostCheck?.status ?? null,
    goal_suite_cleanup_package_audit_post_check_status: cleanupPackageAuditPostCheck?.status ?? null,
    goal_suite_completion_audit_post_check_status: completionAuditPostCheck?.status ?? null,
  },
  artifacts: files,
  note: "This audit verifies the current Phase 2F-G/G1 coordination state. It does not mark the broader thread goal complete by itself.",
};

await writeJsonAtomic(OUT_PATH, report);

console.log(JSON.stringify({
  status: report.status,
  all_required_checks_passed: report.all_required_checks_passed,
  failed_checks: checks.filter((row) => row.severity === "required" && !row.passed).map((row) => row.name),
  artifact: OUT_PATH,
}, null, 2));

if (!report.all_required_checks_passed) process.exit(1);
