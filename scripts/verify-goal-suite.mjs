import { spawn, spawnSync } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const OUT_PATH =
  process.env.GOAL_SUITE_OUT ??
  path.join("data", "review-artifacts", "goal-suite", "goal-suite.json");
const BENCHMARK_PROJECT_ID =
  process.env.PHASE2FG_PROJECT_ID ??
  "24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99";
const WORKER_REPO_DIR =
  process.env.WORKER_REPO_DIR ??
  "C:\\Users\\LENOVO\\Documents\\medvideo-render-worker";
const RUN_COMPLETION_AUDIT = process.env.GOAL_SUITE_RUN_COMPLETION_AUDIT === "1";
const STUDIO_BASE_URL = process.env.STUDIO_SMOKE_BASE_URL ?? "http://localhost:8080";
const STUDIO_READY_URL =
  process.env.STUDIO_SMOKE_READY_URL ?? `${STUDIO_BASE_URL.replace(/\/$/, "")}/@vite/client`;
const AUTO_START_STUDIO =
  process.env.GOAL_SUITE_AUTO_START_STUDIO !== "0" &&
  process.env.GOAL_SUITE_INCLUDE_BROWSER === "1";
const WORKER_BASE_URL = process.env.GOAL_SUITE_WORKER_BASE_URL ?? "http://localhost:8788";
const AUTO_START_WORKER = process.env.GOAL_SUITE_AUTO_START_WORKER !== "0";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const steps = [
  {
    name: "active_goal_readiness",
    command: `${npmCommand} run verify:active-goal`,
    timeoutMs: 240_000,
    requiresWorkerServer: true,
  },
  {
    name: "self_hosting_audit",
    command: `${npmCommand} run verify:self-hosting`,
    timeoutMs: 240_000,
  },
  {
    name: "phase2fg_workflow",
    command: `${npmCommand} run verify:phase2fg`,
    timeoutMs: 360_000,
  },
  {
    name: "latest_render_evidence",
    command: `${npmCommand} run verify:phase2fg-render-latest`,
    timeoutMs: 240_000,
    requiresWorkerServer: true,
  },
  {
    name: "worker_typecheck",
    command: `${npmCommand} run typecheck`,
    cwd: WORKER_REPO_DIR,
    timeoutMs: 300_000,
  },
  {
    name: "worker_build",
    command: `${npmCommand} run build`,
    cwd: WORKER_REPO_DIR,
    timeoutMs: 300_000,
  },
  {
    name: "studio_typecheck",
    command: `${npmCommand} run typecheck`,
    timeoutMs: 360_000,
  },
];

if (process.env.GOAL_SUITE_INCLUDE_BROWSER === "1") {
  steps.push(
    {
      name: "phase2fg_ui_smoke",
      command: `${npmCommand} run smoke:phase2fg-ui`,
      timeoutMs: 360_000,
      requiresStudioServer: true,
    },
    {
      name: "scene_review_browser_smoke",
      command: `${npmCommand} run smoke:scene-review`,
      timeoutMs: 360_000,
      requiresStudioServer: true,
      env: {
        STUDIO_SMOKE_PROJECT_ID: BENCHMARK_PROJECT_ID,
      },
    },
  );
}

if (process.env.GOAL_SUITE_INCLUDE_BUILD === "1") {
  steps.push({
    name: "studio_build",
    command: `${npmCommand} run build`,
    timeoutMs: 360_000,
  });
}

function outputTail(value, maxLength = 4000) {
  const text = String(value ?? "");
  return text.length <= maxLength ? text : text.slice(text.length - maxLength);
}

function taskkillOk(result) {
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  return result.status === 0 || (/SUCCESS:/i.test(stdout) && /no running instance/i.test(stderr));
}

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(value, null, 2), "utf8");
  try {
    await fs.rename(tempFile, file);
  } catch (error) {
    if (error?.code !== "EEXIST" && error?.code !== "EPERM") throw error;
    await fs.rm(file, { force: true });
    await fs.rename(tempFile, file);
  }
}

function appendOutput(buffer, chunk, maxLength = 200_000) {
  const next = `${buffer}${chunk.toString()}`;
  return next.length <= maxLength ? next : next.slice(next.length - maxLength);
}

function parseLastJsonObject(value) {
  const text = String(value ?? "");
  for (let index = text.lastIndexOf("{"); index >= 0; index = text.lastIndexOf("{", index - 1)) {
    try {
      return JSON.parse(text.slice(index));
    } catch {
      // Keep walking backward; command output may contain nested JSON or logs.
    }
  }
  return null;
}

function loadEnvFile(file) {
  if (!fsSync.existsSync(file)) return {};
  const out = {};
  for (const line of fsSync.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeUrl(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return {
      ok: response.ok || response.status < 500,
      status: response.status,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

let startedStudioServer = null;
const startedStudioServerOutput = [];
let startedWorkerServer = null;
const startedWorkerServerOutput = [];

function outputContainsReadySignal(output) {
  return output.some((row) => /\bVITE\b[\s\S]*ready in|Local:\s+http/i.test(row.text));
}

async function ensureStudioServer() {
  const existing = await probeUrl(STUDIO_READY_URL, 10_000);
  if (existing.ok) {
    return {
      ok: true,
      base_url: STUDIO_BASE_URL,
      readiness_url: STUDIO_READY_URL,
      started_by_suite: false,
      probe: existing,
    };
  }
  if (!AUTO_START_STUDIO) {
    return {
      ok: false,
      base_url: STUDIO_BASE_URL,
      readiness_url: STUDIO_READY_URL,
      started_by_suite: false,
      probe: existing,
      error: "Studio server is not reachable and GOAL_SUITE_AUTO_START_STUDIO=0.",
    };
  }

  let child;
  try {
    child = spawn(`${npmCommand} run dev`, {
      cwd: process.cwd(),
      env: { ...process.env },
      shell: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return {
        ok: false,
        base_url: STUDIO_BASE_URL,
        readiness_url: STUDIO_READY_URL,
        started_by_suite: false,
        probe: existing,
        error: error instanceof Error ? error.message : String(error),
    };
  }
  startedStudioServer = child;
  const capture = (streamName) => (chunk) => {
    startedStudioServerOutput.push({
      stream: streamName,
      text: outputTail(chunk.toString(), 1000),
      at: new Date().toISOString(),
    });
    if (startedStudioServerOutput.length > 20) startedStudioServerOutput.shift();
  };
  child.stdout?.on("data", capture("stdout"));
  child.stderr?.on("data", capture("stderr"));

  const deadline = Date.now() + 180_000;
  let lastProbe = existing;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      return {
        ok: false,
        base_url: STUDIO_BASE_URL,
        readiness_url: STUDIO_READY_URL,
        started_by_suite: true,
        pid: child.pid,
        exit_code: child.exitCode,
        probe: lastProbe,
        output_tail: startedStudioServerOutput,
        error: "Studio dev server exited before becoming reachable.",
      };
    }
    await sleep(1500);
    if (outputContainsReadySignal(startedStudioServerOutput)) {
      return {
        ok: true,
        base_url: STUDIO_BASE_URL,
        readiness_url: STUDIO_READY_URL,
        started_by_suite: true,
        pid: child.pid,
        readiness_source: "vite_output",
        probe: lastProbe,
        output_tail: startedStudioServerOutput,
      };
    }
    lastProbe = await probeUrl(STUDIO_READY_URL, 15_000);
    if (lastProbe.ok) {
      return {
        ok: true,
        base_url: STUDIO_BASE_URL,
        readiness_url: STUDIO_READY_URL,
        started_by_suite: true,
        pid: child.pid,
        readiness_source: "http_probe",
        probe: lastProbe,
        output_tail: startedStudioServerOutput,
      };
    }
  }
  return {
    ok: false,
    base_url: STUDIO_BASE_URL,
    readiness_url: STUDIO_READY_URL,
    started_by_suite: true,
    pid: child.pid,
    probe: lastProbe,
    output_tail: startedStudioServerOutput,
    error: "Timed out waiting for Studio dev server.",
  };
}

function stopStartedStudioServer() {
  if (!startedStudioServer?.pid) return null;
  const result = spawnSync("taskkill", ["/PID", String(startedStudioServer.pid), "/T", "/F"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    pid: startedStudioServer.pid,
    ok: taskkillOk(result),
    exit_code: result.status,
    stdout_tail: outputTail(result.stdout, 1000),
    stderr_tail: outputTail(result.stderr, 1000),
  };
}

async function ensureWorkerServer() {
  const healthUrl = `${WORKER_BASE_URL.replace(/\/$/, "")}/health`;
  const existing = await probeUrl(healthUrl);
  if (existing.ok) {
    return {
      ok: true,
      base_url: WORKER_BASE_URL,
      health_url: healthUrl,
      started_by_suite: false,
      probe: existing,
    };
  }
  if (!AUTO_START_WORKER) {
    return {
      ok: false,
      base_url: WORKER_BASE_URL,
      health_url: healthUrl,
      started_by_suite: false,
      probe: existing,
      error: "Worker server is not reachable and GOAL_SUITE_AUTO_START_WORKER=0.",
    };
  }

  const studioEnv = loadEnvFile(path.resolve(".env"));
  const workerEnv = loadEnvFile(path.join(WORKER_REPO_DIR, ".env"));
  const childEnv = {
    ...studioEnv,
    ...workerEnv,
    ...process.env,
  };
  childEnv.PORT ??= "8788";
  childEnv.WORKER_PUBLIC_BASE_URL ??= WORKER_BASE_URL;
  const secretConfigured = Boolean(childEnv.CUSTOM_WORKER_SECRET);
  if (!secretConfigured) {
    return {
      ok: false,
      base_url: WORKER_BASE_URL,
      health_url: healthUrl,
      started_by_suite: false,
      probe: existing,
      secret_configured: false,
      error: "CUSTOM_WORKER_SECRET is missing from process, Studio .env, and worker .env.",
    };
  }

  let child;
  try {
    child = spawn(`${npmCommand} start`, {
      cwd: WORKER_REPO_DIR,
      env: childEnv,
      shell: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return {
      ok: false,
      base_url: WORKER_BASE_URL,
      health_url: healthUrl,
      started_by_suite: false,
      probe: existing,
      secret_configured: secretConfigured,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  startedWorkerServer = child;
  const capture = (streamName) => (chunk) => {
    startedWorkerServerOutput.push({
      stream: streamName,
      text: outputTail(chunk.toString(), 1000),
      at: new Date().toISOString(),
    });
    if (startedWorkerServerOutput.length > 20) startedWorkerServerOutput.shift();
  };
  child.stdout?.on("data", capture("stdout"));
  child.stderr?.on("data", capture("stderr"));

  const deadline = Date.now() + 45_000;
  let lastProbe = existing;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      return {
        ok: false,
        base_url: WORKER_BASE_URL,
        health_url: healthUrl,
        started_by_suite: true,
        pid: child.pid,
        exit_code: child.exitCode,
        probe: lastProbe,
        secret_configured: secretConfigured,
        output_tail: startedWorkerServerOutput,
        error: "Worker server exited before becoming reachable.",
      };
    }
    await sleep(1000);
    lastProbe = await probeUrl(healthUrl);
    if (lastProbe.ok) {
      return {
        ok: true,
        base_url: WORKER_BASE_URL,
        health_url: healthUrl,
        started_by_suite: true,
        pid: child.pid,
        probe: lastProbe,
        secret_configured: secretConfigured,
        output_tail: startedWorkerServerOutput,
      };
    }
  }
  return {
    ok: false,
    base_url: WORKER_BASE_URL,
    health_url: healthUrl,
    started_by_suite: true,
    pid: child.pid,
    probe: lastProbe,
    secret_configured: secretConfigured,
    output_tail: startedWorkerServerOutput,
    error: "Timed out waiting for Worker server.",
  };
}

function stopStartedWorkerServer() {
  if (!startedWorkerServer?.pid) return null;
  const result = spawnSync("taskkill", ["/PID", String(startedWorkerServer.pid), "/T", "/F"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    pid: startedWorkerServer.pid,
    ok: taskkillOk(result),
    exit_code: result.status,
    stdout_tail: outputTail(result.stdout, 1000),
    stderr_tail: outputTail(result.stderr, 1000),
  };
}

function killProcessTree(pid) {
  if (!pid) return null;
  if (process.platform !== "win32") {
    try {
      process.kill(pid, "SIGKILL");
      return { pid, method: "SIGKILL", exit_code: 0, stdout_tail: "", stderr_tail: "" };
    } catch (error) {
      return {
        pid,
        method: "SIGKILL",
        exit_code: 1,
        stdout_tail: "",
        stderr_tail: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    pid,
    method: "taskkill",
    exit_code: result.status,
    stdout_tail: outputTail(result.stdout, 1000),
    stderr_tail: outputTail(result.stderr, 1000),
  };
}

async function runStep(step) {
  const stepStartedAt = new Date();
  let stdout = "";
  let stderr = "";
  let child;

  const baseResult = () => ({
    name: step.name,
    command: step.command,
    cwd: step.cwd ?? process.cwd(),
  });

  try {
    child = spawn(step.command, {
      cwd: step.cwd ?? process.cwd(),
      shell: true,
      windowsHide: true,
      env: {
        ...process.env,
        STUDIO_REPO_DIR: process.env.STUDIO_REPO_DIR ?? process.cwd(),
        WORKER_REPO_DIR,
        ...(step.env ?? {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const stepFinishedAt = new Date();
    return {
      ...baseResult(),
      status: "failed",
      exit_code: null,
      signal: null,
      error: { name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error), code: error?.code ?? null },
      started_at: stepStartedAt.toISOString(),
      finished_at: stepFinishedAt.toISOString(),
      duration_ms: stepFinishedAt.getTime() - stepStartedAt.getTime(),
      stdout_tail: "",
      stderr_tail: "",
      parsed_json: null,
    };
  }

  return await new Promise((resolve) => {
    let settled = false;
    const finish = ({ status, exitCode = null, signal = null, error = null, killResult = null }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stepFinishedAt = new Date();
      resolve({
        ...baseResult(),
        status,
        exit_code: exitCode,
        signal,
        error,
        kill_result: killResult,
        started_at: stepStartedAt.toISOString(),
        finished_at: stepFinishedAt.toISOString(),
        duration_ms: stepFinishedAt.getTime() - stepStartedAt.getTime(),
        stdout_tail: outputTail(stdout),
        stderr_tail: outputTail(stderr),
        parsed_json: parseLastJsonObject(stdout),
      });
    };

    const timer = setTimeout(() => {
      const killResult = killProcessTree(child.pid);
      child.stdout?.destroy();
      child.stderr?.destroy();
      finish({
        status: "timed_out",
        error: {
          name: "TimeoutError",
          message: `Step timed out after ${step.timeoutMs} ms.`,
          code: "ETIMEDOUT",
        },
        killResult,
      });
    }, step.timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout = appendOutput(stdout, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendOutput(stderr, chunk);
    });
    child.on("error", (error) => {
      finish({
        status: "failed",
        error: { name: error.name, message: error.message, code: error.code ?? null },
      });
    });
    child.on("close", (code, signal) => {
      finish({
        status: code === 0 ? "passed" : "failed",
        exitCode: code,
        signal: signal ?? null,
      });
    });
  });
}

const startedAt = new Date();
const results = [];
let studioServerEnsured = false;
let studioServerState = null;
let workerServerEnsured = false;
let workerServerState = null;
for (const step of steps) {
  if (step.requiresWorkerServer && !workerServerEnsured) {
    const serverStepStartedAt = new Date();
    workerServerState = await ensureWorkerServer();
    const serverStepFinishedAt = new Date();
    results.push({
      name: "worker_http_server",
      command: AUTO_START_WORKER ? `${npmCommand} start` : "probe only",
      cwd: WORKER_REPO_DIR,
      status: workerServerState.ok ? "passed" : "failed",
      exit_code: workerServerState.ok ? 0 : 1,
      signal: null,
      error: workerServerState.ok ? null : { name: "WorkerServerUnavailable", message: workerServerState.error ?? "Worker server unavailable", code: null },
      started_at: serverStepStartedAt.toISOString(),
      finished_at: serverStepFinishedAt.toISOString(),
      duration_ms: serverStepFinishedAt.getTime() - serverStepStartedAt.getTime(),
      stdout_tail: "",
      stderr_tail: workerServerState.ok ? "" : (workerServerState.error ?? ""),
      parsed_json: workerServerState,
    });
    workerServerEnsured = true;
    if (!workerServerState.ok) break;
  }
  if (step.requiresStudioServer && !studioServerEnsured) {
    const serverStepStartedAt = new Date();
    studioServerState = await ensureStudioServer();
    const serverStepFinishedAt = new Date();
    results.push({
      name: "studio_dev_server",
      command: AUTO_START_STUDIO ? `${npmCommand} run dev` : "probe only",
      cwd: process.cwd(),
      status: studioServerState.ok ? "passed" : "failed",
      exit_code: studioServerState.ok ? 0 : 1,
      signal: null,
      error: studioServerState.ok ? null : { name: "StudioServerUnavailable", message: studioServerState.error ?? "Studio server unavailable", code: null },
      started_at: serverStepStartedAt.toISOString(),
      finished_at: serverStepFinishedAt.toISOString(),
      duration_ms: serverStepFinishedAt.getTime() - serverStepStartedAt.getTime(),
      stdout_tail: "",
      stderr_tail: studioServerState.ok ? "" : (studioServerState.error ?? ""),
      parsed_json: studioServerState,
    });
    studioServerEnsured = true;
    if (!studioServerState.ok) break;
  }
  const result = await runStep(step);
  results.push(result);
  if (result.status !== "passed") break;
}

const finishedAt = new Date();
const requestedStepResults = results.filter((step) => step.name !== "studio_dev_server" && step.name !== "worker_http_server");
const report = {
  generated_at: startedAt.toISOString(),
  finished_at: finishedAt.toISOString(),
  duration_ms: finishedAt.getTime() - startedAt.getTime(),
  include_build: process.env.GOAL_SUITE_INCLUDE_BUILD === "1",
  include_browser: process.env.GOAL_SUITE_INCLUDE_BROWSER === "1",
  run_completion_audit: RUN_COMPLETION_AUDIT,
  studio_server: studioServerState,
  worker_server: workerServerState,
  benchmark_project_id: BENCHMARK_PROJECT_ID,
  worker_repo_dir: WORKER_REPO_DIR,
  ready: requestedStepResults.length === steps.length && results.every((step) => step.status === "passed"),
  steps: results,
  post_checks: [],
  artifacts: {
    active_goal: path.join("data", "review-artifacts", "active-goal-readiness.json"),
    completion_audit: path.join("data", "review-artifacts", "active-goal-completion-audit.json"),
    package_manifest: path.join("data", "review-artifacts", "active-goal-package-manifest.json"),
    cleanup_pr_package_audit: path.join("data", "review-artifacts", "cleanup-pr-package-audit.json"),
    self_hosting: path.join("data", "review-artifacts", "self-hosting", "self-hosting-audit.json"),
    phase2fg: path.join("data", "review-artifacts", "24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99", "phase-2fg-g1"),
    latest_render: path.join("data", "review-artifacts", "24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99", "phase-2fg-g1", "benchmark_render_latest_verified.json"),
  },
};

await writeJsonAtomic(OUT_PATH, report);

if (RUN_COMPLETION_AUDIT && report.ready) {
  const worktreeInventoryResult = await runStep({
    name: "active_goal_worktree_inventory",
    command: `${npmCommand} run audit:active-goal-worktree`,
    timeoutMs: 60_000,
  });
  report.post_checks.push(worktreeInventoryResult);
  report.ready = report.ready && worktreeInventoryResult.status === "passed";
  const postInventoryFinishedAt = new Date();
  report.finished_at = postInventoryFinishedAt.toISOString();
  report.duration_ms = postInventoryFinishedAt.getTime() - startedAt.getTime();
  await writeJsonAtomic(OUT_PATH, report);
}

if (RUN_COMPLETION_AUDIT && report.ready) {
  const packageManifestResult = await runStep({
    name: "active_goal_package_manifest",
    command: `${npmCommand} run audit:active-goal-package`,
    timeoutMs: 60_000,
  });
  report.post_checks.push(packageManifestResult);
  report.ready = report.ready && packageManifestResult.status === "passed";
  const postPackageFinishedAt = new Date();
  report.finished_at = postPackageFinishedAt.toISOString();
  report.duration_ms = postPackageFinishedAt.getTime() - startedAt.getTime();
  await writeJsonAtomic(OUT_PATH, report);
}

if (RUN_COMPLETION_AUDIT && report.ready) {
  const cleanupPackageResult = await runStep({
    name: "cleanup_pr_package_audit",
    command: `${npmCommand} run audit:cleanup-pr-package`,
    timeoutMs: 60_000,
    env: {
      GOAL_SUITE_CLEANUP_POST_CHECK: "1",
    },
  });
  report.post_checks.push(cleanupPackageResult);
  report.ready = report.ready && cleanupPackageResult.status === "passed";
  const postCleanupPackageFinishedAt = new Date();
  report.finished_at = postCleanupPackageFinishedAt.toISOString();
  report.duration_ms = postCleanupPackageFinishedAt.getTime() - startedAt.getTime();
  await writeJsonAtomic(OUT_PATH, report);
}

if (RUN_COMPLETION_AUDIT && report.ready) {
  const auditResult = await runStep({
    name: "active_goal_completion_audit",
    command: `${npmCommand} run audit:active-goal`,
    timeoutMs: 120_000,
    env: {
      GOAL_SUITE_AUDIT_POST_CHECK: "1",
    },
  });
  report.post_checks.push(auditResult);
  report.ready = report.ready && auditResult.status === "passed";
  const postAuditFinishedAt = new Date();
  report.finished_at = postAuditFinishedAt.toISOString();
  report.duration_ms = postAuditFinishedAt.getTime() - startedAt.getTime();
  await writeJsonAtomic(OUT_PATH, report);
}

const stoppedStudioServer = stopStartedStudioServer();
if (stoppedStudioServer) {
  report.studio_server_stop = stoppedStudioServer;
  await writeJsonAtomic(OUT_PATH, report);
}
const stoppedWorkerServer = stopStartedWorkerServer();
if (stoppedWorkerServer) {
  report.worker_server_stop = stoppedWorkerServer;
  await writeJsonAtomic(OUT_PATH, report);
}

const summary = JSON.stringify({
  ready: report.ready,
  duration_ms: report.duration_ms,
  include_build: report.include_build,
  include_browser: report.include_browser,
  run_completion_audit: report.run_completion_audit,
  failed_step: report.steps.find((step) => step.status !== "passed")?.name ?? null,
  failed_post_check: report.post_checks.find((step) => step.status !== "passed")?.name ?? null,
  artifact: OUT_PATH,
}, null, 2);

process.stdout.write(`${summary}\n`, () => {
  process.exit(report.ready ? 0 : 1);
});
