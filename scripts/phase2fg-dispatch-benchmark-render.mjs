import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PROJECT_ID = process.env.PHASE2FG_PROJECT_ID ?? "24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99";
const RENDER_TYPE = process.env.PHASE2FG_RENDER_TYPE === "full" ? "full" : "preview";
const OUT_DIR = path.join("data", "review-artifacts", PROJECT_ID, "phase-2fg-g1");
const POLL_TIMEOUT_MS = Number(process.env.PHASE2FG_RENDER_TIMEOUT_MS ?? 20 * 60 * 1000);
const POLL_INTERVAL_MS = Number(process.env.PHASE2FG_RENDER_POLL_MS ?? 5000);
const WORKER_REPO_DIR = process.env.WORKER_REPO_DIR ?? "C:\\Users\\LENOVO\\Documents\\medvideo-render-worker";

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] ??= value;
  }
}

function builtChunk(prefix) {
  const dir = path.join(process.cwd(), "dist", "server", "assets");
  const file = fs.readdirSync(dir).find((name) => name.startsWith(prefix) && name.endsWith(".js"));
  if (!file) throw new Error(`Build chunk not found for ${prefix}. Run npm.cmd run build first.`);
  return path.join(dir, file);
}

function redactUrl(value) {
  if (!value) return value;
  try {
    const url = new URL(value);
    for (const key of Array.from(url.searchParams.keys())) {
      url.searchParams.set(key, "[redacted]");
    }
    return url.toString();
  } catch {
    return String(value).replace(/([?&](?:token|apikey|key|sig|signature|access_token)=)[^&]+/gi, "$1[redacted]");
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function headUrl(url) {
  if (!url) return { ok: false, status: null, content_type: null, content_length: null, reason: "missing URL" };
  try {
    const response = await fetch(url, { method: "HEAD" });
    return {
      ok: response.ok,
      status: response.status,
      content_type: response.headers.get("content-type"),
      content_length: response.headers.get("content-length"),
      reason: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    return { ok: false, status: null, content_type: null, content_length: null, reason: error instanceof Error ? error.message : String(error) };
  }
}

function ffprobeFile(filePath) {
  if (!fs.existsSync(filePath)) return { ok: false, reason: "missing output file" };
  const probe = spawnSync("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ], { encoding: "utf8" });
  if (probe.status !== 0) {
    return { ok: false, reason: probe.stderr || probe.stdout || `ffprobe exited ${probe.status}` };
  }
  try {
    const parsed = JSON.parse(probe.stdout);
    const video = parsed.streams?.find((stream) => stream.codec_type === "video");
    const audio = parsed.streams?.find((stream) => stream.codec_type === "audio");
    return {
      ok: true,
      duration_seconds: Number(parsed.format?.duration ?? 0),
      size: Number(parsed.format?.size ?? 0),
      video: video ? { codec: video.codec_name, width: video.width, height: video.height } : null,
      audio: audio ? { codec: audio.codec_name, channels: audio.channels } : null,
    };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

loadEnv(path.resolve(".env"));
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase URL or service role key.");

const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
if (process.env.PHASE2FG_VERIFY_LATEST_ONLY === "1") {
  await fsp.mkdir(OUT_DIR, { recursive: true });
  const { data: project, error: projectError } = await sb
    .from("projects")
    .select("id,title,user_id,duration_seconds")
    .eq("id", PROJECT_ID)
    .single();
  if (projectError || !project) throw new Error(projectError?.message ?? "Project not found.");

  const { data: latestJob, error: latestJobError } = await sb
    .from("render_jobs")
    .select("*")
    .eq("project_id", PROJECT_ID)
    .eq("render_type", RENDER_TYPE)
    .not("provider_job_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestJobError) throw new Error(latestJobError.message);
  if (!latestJob) throw new Error(`No ${RENDER_TYPE} render job with provider_job_id found for ${PROJECT_ID}.`);

  const { data: providerJob, error: providerJobError } = await sb
    .from("render_provider_jobs")
    .select("*")
    .eq("render_job_id", latestJob.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (providerJobError) throw new Error(providerJobError.message);

  const { data: outputs, error: outputError } = await sb
    .from("render_outputs")
    .select("*")
    .eq("render_job_id", latestJob.id)
    .order("created_at", { ascending: false });
  if (outputError) throw new Error(outputError.message);

  const output = outputs?.[0] ?? null;
  const head = await headUrl(output?.file_url ?? null);
  const outputFilename = latestJob.provider_job_id ? `${latestJob.provider_job_id}.mp4` : null;
  const outputFilePath = outputFilename ? path.join(WORKER_REPO_DIR, "data", "outputs", outputFilename) : null;
  const localStat = outputFilePath && fs.existsSync(outputFilePath) ? fs.statSync(outputFilePath) : null;
  const ffprobe = outputFilePath ? ffprobeFile(outputFilePath) : { ok: false, reason: "missing provider job id" };
  const debugDir = latestJob.provider_job_id ? path.join(WORKER_REPO_DIR, "data", "debug", latestJob.provider_job_id) : null;
  const debugFiles = debugDir && fs.existsSync(debugDir) ? fs.readdirSync(debugDir).sort() : [];
  const lifecycle = Array.isArray(providerJob?.logs)
    ? providerJob.logs.map((entry) => ({
        at: entry.at ?? null,
        status: String(entry.msg ?? "").match(/provider callback: ([^(]+)\s*\((\d+)%\)/)?.[1]?.trim() ?? providerJob.status ?? latestJob.status,
        progress_percent: Number(String(entry.msg ?? "").match(/\((\d+)%\)/)?.[1] ?? latestJob.progress_percent ?? 0),
        provider_status: providerJob.status ?? null,
      }))
    : [];

  const result = {
    project_id: PROJECT_ID,
    project_title: project.title,
    render_type: RENDER_TYPE,
    verify_latest_only: true,
    started_at: latestJob.started_at ?? latestJob.created_at ?? null,
    finished_at: new Date().toISOString(),
    render_job_id: latestJob.id,
    provider: {
      provider_type: "custom_worker",
      provider_id: latestJob.provider_id ?? providerJob?.provider_id ?? null,
      provider_job_id: latestJob.provider_job_id,
    },
    lifecycle,
    final_job: {
      id: latestJob.id,
      status: latestJob.status,
      progress_percent: latestJob.progress_percent,
      provider_job_id: latestJob.provider_job_id,
      error_message: latestJob.error_message,
      completed_at: latestJob.completed_at,
    },
    provider_job: providerJob ? {
      id: providerJob.id,
      status: providerJob.status,
      provider_job_id: providerJob.provider_job_id,
      last_callback_status: providerJob.response_payload?.last_callback?.status ?? null,
      last_callback_progress: providerJob.response_payload?.last_callback?.progress ?? null,
      last_callback_output_url_present: Boolean(providerJob.response_payload?.last_callback?.output_url),
    } : null,
    output: output ? {
      id: output.id,
      output_type: output.output_type,
      file_url_present: Boolean(output.file_url),
      file_url_redacted: redactUrl(output.file_url),
      duration_seconds: output.duration_seconds,
      resolution: output.resolution,
      file_size: output.file_size,
    } : null,
    output_head: head,
    local_output: outputFilePath ? {
      path: outputFilePath,
      exists: Boolean(localStat),
      size: localStat?.size ?? null,
    } : null,
    ffprobe,
    debug: {
      dir: debugDir,
      files: debugFiles,
    },
  };
  const artifact = path.join(OUT_DIR, "benchmark_render_latest_verified.json");
  await fsp.writeFile(artifact, JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify({
    artifact,
    render_job_id: result.render_job_id,
    provider_job_id: result.provider?.provider_job_id,
    final_status: result.final_job?.status,
    progress_percent: result.final_job?.progress_percent,
    output_head: result.output_head,
    ffprobe: result.ffprobe,
    debug_files: result.debug.files,
  }, null, 2));
  const ok = result.final_job.status === "completed" && result.output_head.ok && result.ffprobe.ok;
  await new Promise((resolve) => process.stdout.write("", resolve));
  await new Promise((resolve) => process.stderr.write("", resolve));
  process.exit(ok ? 0 : 1);
}

const { buildRenderSpec } = await import(pathToFileURL(builtChunk("render-spec-builder.server-")).href);
const { validateRenderSpec } = await import(pathToFileURL(builtChunk("render-validation-")).href);
const { adapterCreateRender } = await import(pathToFileURL(builtChunk("render-adapter.server-")).href);

await fsp.mkdir(OUT_DIR, { recursive: true });
const startedAt = new Date().toISOString();

const { data: inFlight, error: inFlightError } = await sb
  .from("render_jobs")
  .select("id,status,render_type,provider_job_id,created_at,progress_percent")
  .eq("project_id", PROJECT_ID)
  .in("status", ["queued", "preparing", "rendering"]);
if (inFlightError) throw new Error(inFlightError.message);
if (inFlight?.length) {
  throw new Error(`Render already in flight for benchmark project: ${inFlight.map((job) => `${job.id}:${job.status}`).join(", ")}`);
}

const { data: project, error: projectError } = await sb
  .from("projects")
  .select("id,title,user_id,duration_seconds")
  .eq("id", PROJECT_ID)
  .single();
if (projectError || !project) throw new Error(projectError?.message ?? "Project not found.");

const spec = await buildRenderSpec(sb, PROJECT_ID, { quality: RENDER_TYPE });
const validation = validateRenderSpec(spec);
if (!validation.ok) {
  throw new Error(`RenderSpec validation failed before dispatch: ${validation.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`);
}

const { data: job, error: jobError } = await sb
  .from("render_jobs")
  .insert({
    project_id: PROJECT_ID,
    status: "preparing",
    render_type: RENDER_TYPE,
    progress_percent: 0,
    manifest_version: 6,
    requested_by: project.user_id,
    started_at: startedAt,
  })
  .select("*")
  .single();
if (jobError || !job) throw new Error(jobError?.message ?? "Could not create render job.");

let providerInfo = null;
try {
  const created = await adapterCreateRender(sb, {
    projectId: PROJECT_ID,
    renderJobId: job.id,
    renderType: RENDER_TYPE,
  });
  providerInfo = {
    provider_type: created.providerRow?.provider_type ?? null,
    provider_id: created.providerRow?.id ?? null,
    provider_job_id: created.providerJobId,
  };
} catch (error) {
  await sb
    .from("render_jobs")
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: error instanceof Error ? error.message : String(error),
    })
    .eq("id", job.id);
  throw error;
}

const lifecycle = [];
let latestJob = null;
let providerJob = null;
const deadline = Date.now() + POLL_TIMEOUT_MS;
while (Date.now() < deadline) {
  const [{ data: jobRow, error: jobPollError }, { data: providerRow, error: providerPollError }] = await Promise.all([
    sb.from("render_jobs").select("*").eq("id", job.id).maybeSingle(),
    sb.from("render_provider_jobs").select("*").eq("render_job_id", job.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (jobPollError) throw new Error(jobPollError.message);
  if (providerPollError) throw new Error(providerPollError.message);
  latestJob = jobRow;
  providerJob = providerRow;
  const last = lifecycle[lifecycle.length - 1];
  if (!last || last.status !== latestJob?.status || last.progress_percent !== latestJob?.progress_percent) {
    lifecycle.push({
      at: new Date().toISOString(),
      status: latestJob?.status ?? null,
      progress_percent: latestJob?.progress_percent ?? null,
      provider_status: providerJob?.status ?? null,
    });
  }
  if (latestJob && ["completed", "failed", "cancelled"].includes(String(latestJob.status))) break;
  await sleep(POLL_INTERVAL_MS);
}

if (!latestJob || !["completed", "failed", "cancelled"].includes(String(latestJob.status))) {
  throw new Error(`Timed out waiting for render ${job.id}; last status ${latestJob?.status ?? "unknown"}.`);
}

const { data: outputs, error: outputError } = await sb
  .from("render_outputs")
  .select("*")
  .eq("render_job_id", job.id)
  .order("created_at", { ascending: false });
if (outputError) throw new Error(outputError.message);

const output = outputs?.[0] ?? null;
const head = await headUrl(output?.file_url ?? null);
const outputFilename = providerInfo?.provider_job_id ? `${providerInfo.provider_job_id}.mp4` : null;
const outputFilePath = outputFilename ? path.join(WORKER_REPO_DIR, "data", "outputs", outputFilename) : null;
const localStat = outputFilePath && fs.existsSync(outputFilePath) ? fs.statSync(outputFilePath) : null;
const ffprobe = outputFilePath ? ffprobeFile(outputFilePath) : { ok: false, reason: "missing provider job id" };
const debugDir = providerInfo?.provider_job_id ? path.join(WORKER_REPO_DIR, "data", "debug", providerInfo.provider_job_id) : null;
const debugFiles = debugDir && fs.existsSync(debugDir) ? fs.readdirSync(debugDir).sort() : [];

const result = {
  project_id: PROJECT_ID,
  project_title: project.title,
  render_type: RENDER_TYPE,
  started_at: startedAt,
  finished_at: new Date().toISOString(),
  render_job_id: job.id,
  provider: providerInfo,
  lifecycle,
  final_job: latestJob ? {
    id: latestJob.id,
    status: latestJob.status,
    progress_percent: latestJob.progress_percent,
    provider_job_id: latestJob.provider_job_id,
    error_message: latestJob.error_message,
    completed_at: latestJob.completed_at,
  } : null,
  provider_job: providerJob ? {
    id: providerJob.id,
    status: providerJob.status,
    provider_job_id: providerJob.provider_job_id,
    last_callback_status: providerJob.response_payload?.last_callback?.status ?? null,
    last_callback_progress: providerJob.response_payload?.last_callback?.progress ?? null,
    last_callback_output_url_present: Boolean(providerJob.response_payload?.last_callback?.output_url),
  } : null,
  output: output ? {
    id: output.id,
    output_type: output.output_type,
    file_url_present: Boolean(output.file_url),
    file_url_redacted: redactUrl(output.file_url),
    duration_seconds: output.duration_seconds,
    resolution: output.resolution,
    file_size: output.file_size,
  } : null,
  output_head: head,
  local_output: outputFilePath ? {
    path: outputFilePath,
    exists: Boolean(localStat),
    size: localStat?.size ?? null,
  } : null,
  ffprobe,
  debug: {
    dir: debugDir,
    files: debugFiles,
  },
};

const artifact = path.join(OUT_DIR, `benchmark_render_${job.id}.json`);
await fsp.writeFile(artifact, JSON.stringify(result, null, 2), "utf8");
await fsp.writeFile(path.join(OUT_DIR, "benchmark_render_latest.json"), JSON.stringify(result, null, 2), "utf8");

console.log(JSON.stringify({
  artifact,
  render_job_id: result.render_job_id,
  provider_job_id: result.provider?.provider_job_id,
  final_status: result.final_job?.status,
  progress_percent: result.final_job?.progress_percent,
  output_head: result.output_head,
  ffprobe: result.ffprobe,
  debug_files: result.debug.files,
}, null, 2));

if (result.final_job?.status !== "completed") {
  process.exitCode = 1;
}
if (!result.output_head.ok || !result.ffprobe.ok) {
  process.exitCode = 1;
}

await new Promise((resolve) => process.stdout.write("", resolve));
await new Promise((resolve) => process.stderr.write("", resolve));
process.exit(process.exitCode ?? 0);
