import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const STUDIO_ROOT = process.env.STUDIO_REPO_DIR ?? process.cwd();
const INVENTORY_PATH =
  process.env.ACTIVE_GOAL_WORKTREE_INVENTORY_OUT ??
  path.join(STUDIO_ROOT, "data", "review-artifacts", "active-goal-worktree-inventory.json");
const OUT_PATH =
  process.env.ACTIVE_GOAL_PACKAGE_MANIFEST_OUT ??
  path.join(STUDIO_ROOT, "data", "review-artifacts", "active-goal-package-manifest.json");

const secretPatterns = [
  {
    name: "jwt_token",
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    name: "openai_api_key",
    regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    name: "google_api_key",
    regex: /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  },
  {
    name: "bearer_token",
    regex: /\bBearer\s+(?!\[redacted\])[A-Za-z0-9._-]{20,}\b/g,
  },
  {
    name: "unredacted_url_secret",
    regex: /[?&](?:token|token_hash|access_token|refresh_token|apikey|signature)=((?!%5Bredacted%5D|\[redacted\]|redacted)[^&\s"']{12,})/gi,
  },
  {
    name: "service_role_assignment",
    regex: /\bSUPABASE_SERVICE_ROLE_KEY\s*=\s*(?!\[redacted\]|<|your_|replace_|example_|$)[^\s"']{16,}/gi,
  },
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

function toPosixRelative(root, file) {
  return path.relative(root, file).replace(/\\/g, "/");
}

function assertInsideRoot(root, relativeFile) {
  const absoluteRoot = path.resolve(root);
  const absoluteFile = path.resolve(root, relativeFile);
  const lowerRoot = absoluteRoot.toLowerCase();
  const lowerFile = absoluteFile.toLowerCase();
  if (lowerFile !== lowerRoot && !lowerFile.startsWith(`${lowerRoot}${path.sep}`)) {
    throw new Error(`Refusing to inspect path outside Studio root: ${relativeFile}`);
  }
  return absoluteFile;
}

function redactedPreview(line, match) {
  return line.replace(match, "[redacted]").slice(0, 220);
}

function scanText(file, text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const pattern of secretPatterns) {
      pattern.regex.lastIndex = 0;
      for (const match of line.matchAll(pattern.regex)) {
        const rawMatch = match[0];
        if (!rawMatch) continue;
        findings.push({
          file,
          line: index + 1,
          pattern: pattern.name,
          preview: redactedPreview(line, rawMatch),
        });
      }
    }
  }
  return findings;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort();
}

function scriptFileReferences(packageJsonPath) {
  const packageJson = readJson(packageJsonPath);
  const references = [];
  for (const command of Object.values(packageJson.scripts ?? {})) {
    const matches = String(command).match(/scripts\/[A-Za-z0-9._/-]+\.(?:mjs|js|ts|tsx)/g) ?? [];
    references.push(...matches);
  }
  return uniqueSorted(references);
}

function isVolatileGeneratedEvidence(file) {
  return [
    "data/review-artifacts/goal-suite/goal-suite.json",
    "data/review-artifacts/active-goal-completion-audit.json",
    "data/review-artifacts/active-goal-worktree-inventory.json",
    "data/review-artifacts/active-goal-package-manifest.json",
    "data/review-artifacts/cleanup-pr-package-audit.json",
  ].includes(file);
}

const inventory = readJson(INVENTORY_PATH);
const packagePlan = inventory?.studio?.coordination_packaging_plan;
if (!packagePlan?.stage_explicit_paths_only || !Array.isArray(packagePlan.explicit_stage_paths)) {
  throw new Error("Missing coordination_packaging_plan.explicit_stage_paths. Run npm.cmd run audit:active-goal-worktree first.");
}

const files = [];
const allFindings = [];
const missingFiles = [];
const outRelative = toPosixRelative(STUDIO_ROOT, OUT_PATH);
const explicitStagePaths = packagePlan.explicit_stage_paths;
const packageScriptDependencyPaths = scriptFileReferences(path.join(STUDIO_ROOT, "package.json"));
const missingPackageScriptDependencyPaths = packageScriptDependencyPaths.filter((file) => {
  const absoluteFile = assertInsideRoot(STUDIO_ROOT, file);
  return !fs.existsSync(absoluteFile);
});
const lockfilePaths = fs.existsSync(path.join(STUDIO_ROOT, "package-lock.json")) ? ["package-lock.json"] : [];
const stableStagePaths = uniqueSorted([
  ...explicitStagePaths.filter((file) => !isVolatileGeneratedEvidence(file)),
  ...packageScriptDependencyPaths,
  ...lockfilePaths,
]);
const evidenceStagePaths = explicitStagePaths.filter((file) => isVolatileGeneratedEvidence(file));
const manifestPaths = uniqueSorted([...stableStagePaths, ...evidenceStagePaths]);
const broadParentDirectories = Array.from(
  new Set(
    (packagePlan.warnings ?? [])
      .flatMap((row) => String(row.warning ?? "").match(/Untracked parent ([^ ]+)/)?.[1] ?? [])
      .filter(Boolean),
  ),
).sort();

for (const relativeFile of manifestPaths) {
  if (isVolatileGeneratedEvidence(relativeFile)) {
    const absoluteFile = assertInsideRoot(STUDIO_ROOT, relativeFile);
    files.push({
      file: relativeFile,
      exists: fs.existsSync(absoluteFile),
      generated_evidence: true,
      volatile_generated_evidence: true,
      self_manifest: relativeFile === outRelative,
      note: "Existence-only entry. This generated artifact is rewritten during the audited suite, so hashing it would become stale during the same run.",
    });
    continue;
  }

  const absoluteFile = assertInsideRoot(STUDIO_ROOT, relativeFile);
  if (!fs.existsSync(absoluteFile)) {
    missingFiles.push(relativeFile);
    files.push({
      file: relativeFile,
      exists: false,
    });
    continue;
  }

  const buffer = fs.readFileSync(absoluteFile);
  const text = buffer.toString("utf8");
  const findings = scanText(relativeFile, text);
  allFindings.push(...findings);
  const stat = fs.statSync(absoluteFile);
  files.push({
    file: relativeFile,
    exists: true,
    generated_evidence: relativeFile.startsWith("data/review-artifacts/"),
    size: stat.size,
    mtime: stat.mtime.toISOString(),
    sha256: sha256(buffer),
    secret_findings_count: findings.length,
  });
}

const report = {
  generated_at: new Date().toISOString(),
  purpose: "Preview-only manifest for the active-goal coordination package. It does not stage files or modify git.",
  source_inventory: toPosixRelative(STUDIO_ROOT, INVENTORY_PATH),
  package_scope: packagePlan.scope ?? "active-goal coordination handoff only",
  stage_explicit_paths_only: packagePlan.stage_explicit_paths_only === true,
  explicit_stage_paths: explicitStagePaths,
  dependency_closure: {
    package_script_dependency_paths: packageScriptDependencyPaths,
    missing_package_script_dependency_paths: missingPackageScriptDependencyPaths,
    lockfile_paths: lockfilePaths,
    note: "These paths are added to the recommended staging preview because package.json scripts or dependency metadata reference them.",
  },
  stage_command_preview: {
    preview_only: true,
    shell: "PowerShell",
    recommended_default: "stable_code_docs_only",
    recommended_command: `git add -- ${stableStagePaths.map(quotePowerShell).join(" ")}`,
    optional_evidence_command: `git add -- ${evidenceStagePaths.map(quotePowerShell).join(" ")}`,
    command: `git add -- ${explicitStagePaths.map(quotePowerShell).join(" ")}`,
    stable_code_doc_paths: stableStagePaths,
    optional_evidence_paths: evidenceStagePaths,
    per_file_commands: explicitStagePaths.map((file) => `git add -- ${quotePowerShell(file)}`),
    never_stage_parent_directories: broadParentDirectories,
    note: "Preview only. Prefer recommended_command for a code/docs PR. Use optional_evidence_command only if the PR intentionally includes generated evidence artifacts. Do not run git add on broad untracked parent directories.",
  },
  files,
  missing_files: missingFiles,
  secret_scan: {
    ok: allFindings.length === 0,
    findings_count: allFindings.length,
    findings: allFindings,
    exclusions: files
      .filter((file) => file.volatile_generated_evidence)
      .map((file) => file.file),
    note: "Findings are redacted previews from stable explicit coordination package files only. Volatile generated evidence is recorded as existence-only, and secret-sensitive non-coordination paths such as .env are intentionally not read.",
  },
  packaging_warnings: packagePlan.warnings ?? [],
};

await writeJsonAtomic(OUT_PATH, report);

console.log(JSON.stringify({
  artifact: toPosixRelative(STUDIO_ROOT, OUT_PATH),
  files: files.length,
  missing_files: missingFiles.length,
  secret_findings: allFindings.length,
}, null, 2));

if (missingFiles.length > 0 || allFindings.length > 0) process.exit(1);
if (missingPackageScriptDependencyPaths.length > 0) process.exit(1);
