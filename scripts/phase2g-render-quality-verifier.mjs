import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const PROJECT_ID = process.env.PHASE2G_PROJECT_ID ?? "24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99";
const RENDER_TYPE = process.env.PHASE2G_RENDER_TYPE === "full" ? "full" : "preview";
const WORKER_REPO_DIR = process.env.WORKER_REPO_DIR ?? "C:\\Users\\LENOVO\\Documents\\medvideo-render-worker";
const SOURCE_PHASE_DIR = path.join("data", "review-artifacts", PROJECT_ID, "phase-2fg-g1");
const OUT_DIR = path.join("data", "review-artifacts", PROJECT_ID, "phase-2g-render-quality");
const FRAME_DIR = path.join(OUT_DIR, "frame_grabs");

const TARGET_SCENES = [
  {
    code: "0005",
    label: "00:05",
    seconds: 5,
    concept_keys: ["india_prevalence"],
    required_intent: "India oral-cancer prevalence / awareness",
    expected_visual_behavior: "A polished India-specific visual, map, or stat card using only approved wording; no invented numbers.",
  },
  {
    code: "0020",
    label: "00:20",
    seconds: 20,
    concept_keys: ["tobacco_gutkha_risk"],
    required_intent: "Tobacco / gutkha risk",
    expected_visual_behavior: "Contextual tobacco/gutkha visual or b-roll that is relevant to the Indian oral-cancer risk context; no generic unrelated lifestyle stock.",
  },
  {
    code: "0036",
    label: "00:36",
    seconds: 36,
    concept_keys: ["oral_ulcer"],
    required_intent: "Non-healing oral ulcer",
    expected_visual_behavior: "Clinically appropriate oral ulcer visual, review-gated and not cartoonish.",
    requires_human_clinical_review: true,
  },
  {
    code: "0048",
    label: "00:48",
    seconds: 48,
    concept_keys: ["leukoplakia_erythroplakia"],
    required_intent: "Leukoplakia / erythroplakia / warning patches",
    expected_visual_behavior: "Accurate white/red patch or warning-sign visual if Studio-approved content exists; otherwise clear non-fabricated educational text, not invented pathology.",
    requires_human_clinical_review: true,
  },
  {
    code: "0059",
    label: "00:59",
    seconds: 59,
    concept_keys: ["cervical_lymph_node"],
    required_intent: "Neck node warning sign",
    expected_visual_behavior: "Cervical lymph node visual that clearly communicates neck lump risk without misleading anatomy.",
    requires_human_clinical_review: true,
  },
  {
    code: "0121",
    label: "01:21",
    seconds: 81,
    concept_keys: ["oral_examination", "biopsy_workflow"],
    required_intent: "Oral exam / biopsy workflow",
    expected_visual_behavior: "Professional workflow diagram or consultation/exam visual that matches the narration and approved labels.",
    requires_human_clinical_review: true,
  },
  {
    code: "0139",
    label: "01:39",
    seconds: 99,
    concept_keys: ["cta_branding"],
    required_intent: "CTA / awareness close",
    expected_visual_behavior: "Clean branded CTA or awareness card, readable and not visually generic.",
  },
];

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

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
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

function redactUrl(value) {
  if (typeof value !== "string" || !value) return value ?? null;
  if (value.startsWith("data:")) return "[inline data URI redacted]";
  try {
    const url = new URL(value);
    for (const key of Array.from(url.searchParams.keys())) {
      url.searchParams.set(key, "[redacted]");
    }
    return url.toString();
  } catch {
    return value.replace(/([?&](?:token|apikey|key|sig|signature|access_token)=)[^&\s"']+/gi, "$1[redacted]");
  }
}

function sourceDomain(value) {
  if (typeof value !== "string" || !value || value.startsWith("data:")) return null;
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
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
  if (!filePath || !fs.existsSync(filePath)) return { ok: false, reason: "missing file" };
  const probe = spawnSync("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ], { encoding: "utf8" });
  if (probe.status !== 0) return { ok: false, reason: probe.stderr || probe.stdout || `ffprobe exited ${probe.status}` };
  const parsed = JSON.parse(probe.stdout);
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  const audio = parsed.streams?.find((stream) => stream.codec_type === "audio");
  return {
    ok: true,
    raw: parsed,
    duration_seconds: Number(parsed.format?.duration ?? 0),
    size: Number(parsed.format?.size ?? 0),
    video: video ? { codec: video.codec_name, width: video.width, height: video.height } : null,
    audio: audio ? { codec: audio.codec_name, channels: audio.channels } : null,
  };
}

function runFfmpeg(args, label) {
  const result = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${result.stderr || result.stdout || `ffmpeg exited ${result.status}`}`);
  }
  return result;
}

function extractFrame(videoPath, seconds, outPath) {
  runFfmpeg([
    "-y",
    "-ss",
    String(seconds),
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    outPath,
  ], `extract frame ${seconds}`);
}

function frameMetrics(framePath) {
  const stat = fs.existsSync(framePath) ? fs.statSync(framePath) : null;
  if (!stat) return { exists: false, file_size: 0, sampled: false, luma_mean: null, luma_variance: null, non_blank: false };
  const sample = spawnSync("ffmpeg", [
    "-v",
    "error",
    "-i",
    framePath,
    "-vf",
    "scale=32:18",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "pipe:1",
  ], { encoding: "buffer", maxBuffer: 1024 * 1024 });
  if (sample.status !== 0 || !sample.stdout?.length) {
    return { exists: true, file_size: stat.size, sampled: false, luma_mean: null, luma_variance: null, non_blank: stat.size > 10_000 };
  }
  const lumas = [];
  for (let index = 0; index + 2 < sample.stdout.length; index += 3) {
    const r = sample.stdout[index];
    const g = sample.stdout[index + 1];
    const b = sample.stdout[index + 2];
    lumas.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
  }
  const mean = lumas.reduce((sum, value) => sum + value, 0) / Math.max(1, lumas.length);
  const variance = lumas.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, lumas.length);
  return {
    exists: true,
    file_size: stat.size,
    sampled: true,
    luma_mean: Number(mean.toFixed(2)),
    luma_variance: Number(variance.toFixed(2)),
    non_blank: stat.size > 10_000 && variance > 5,
  };
}

function activeAt(row, seconds, tolerance = 0.25) {
  const start = Number(row.startTime ?? row.time_range?.start ?? row.start ?? 0);
  const duration = Number(row.durationSeconds ?? row.time_range?.duration ?? 0);
  const end = Number(row.end ?? row.time_range?.end ?? (start + duration));
  return seconds + tolerance >= start && seconds - tolerance <= end;
}

function nearestDistance(row, seconds) {
  const start = Number(row.startTime ?? row.time_range?.start ?? row.start ?? 0);
  const duration = Number(row.durationSeconds ?? row.time_range?.duration ?? 0);
  const end = Number(row.end ?? row.time_range?.end ?? (start + duration));
  if (seconds >= start && seconds <= end) return 0;
  return Math.min(Math.abs(seconds - start), Math.abs(seconds - end));
}

function matchRequirement(target, requirements) {
  const conceptMatches = requirements.filter((row) => target.concept_keys.includes(row.concept_key));
  const activeConcept = conceptMatches.find((row) => activeAt({
    time_range: row.time_range,
  }, target.seconds, 0.5));
  if (activeConcept) return { row: activeConcept, match_kind: "concept_and_time" };

  const nearestConcept = conceptMatches
    .map((row) => ({ row, distance: nearestDistance({ time_range: row.time_range }, target.seconds) }))
    .sort((a, b) => a.distance - b.distance)[0];
  if (nearestConcept && nearestConcept.distance <= 3) return { row: nearestConcept.row, match_kind: "nearby_concept", distance_seconds: nearestConcept.distance };
  if (nearestConcept && nearestConcept.distance <= 10) {
    return { row: nearestConcept.row, match_kind: "concept_timing_mismatch", distance_seconds: nearestConcept.distance };
  }

  const activeAny = requirements.find((row) => activeAt({ time_range: row.time_range }, target.seconds, 0.5));
  if (activeAny) return { row: activeAny, match_kind: "time_only_wrong_concept" };

  const nearestAny = requirements
    .map((row) => ({ row, distance: nearestDistance({ time_range: row.time_range }, target.seconds) }))
    .sort((a, b) => a.distance - b.distance)[0];
  return nearestAny ? { row: nearestAny.row, match_kind: "nearest_only", distance_seconds: nearestAny.distance } : { row: null, match_kind: "missing" };
}

function activeOverlaysForTarget(target, overlays) {
  const active = overlays.filter((row) => activeAt(row, target.seconds, 0.5));
  if (active.length) return { overlays: active, match_kind: "active_at_time" };
  const nearest = overlays
    .map((row) => ({ row, distance: nearestDistance(row, target.seconds) }))
    .sort((a, b) => a.distance - b.distance)
    .filter((row) => row.distance <= 3)
    .map((row) => ({ ...row.row, nearest_distance_seconds: row.distance }));
  return { overlays: nearest, match_kind: nearest.length ? "nearby_overlay" : "none" };
}

function assetIdWithoutPrefix(value) {
  return String(value ?? "").replace(/^asset:/, "");
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function licenseStatusForAsset(asset) {
  const metadata = plainObject(asset?.metadata);
  const original = plainObject(metadata.original_candidate_data);
  return String(
    asset?.license_status ??
    metadata.license_status ??
    plainObject(metadata.license).license_status ??
    plainObject(original.license).license_status ??
    plainObject(original.license).type ??
    "unknown",
  );
}

function scoreScene({ target, requirementMatch, overlayMatch, asset, frame, downloadedAsset, debugReady }) {
  const requirement = requirementMatch.row;
  const conceptMatches = Boolean(requirement && target.concept_keys.includes(requirement.concept_key));
  const timeAligned = requirementMatch.match_kind === "concept_and_time" || requirementMatch.match_kind === "nearby_concept";
  const overlayPresent = overlayMatch.overlays.length > 0;
  const sourceUrlPresent = Boolean(overlayMatch.overlays.some((row) => row.sourceUrl || row.source_url) || requirement?.existing_approved_asset?.source_url_present);
  const skipped = Boolean(downloadedAsset?.skipped);
  const licenseStatus = licenseStatusForAsset(asset);
  const unsafeLicense = /restricted|unsafe|do_not_use/i.test(licenseStatus);
  const stockDomain = sourceDomain(overlayMatch.overlays[0]?.sourceUrl ?? overlayMatch.overlays[0]?.source_url);
  const lowDetailFrame = frame.exists && Number(frame.file_size) > 0 && Number(frame.file_size) < 50_000;
  const stockRestrictedClinical =
    target.requires_human_clinical_review &&
    /pexels|pixabay/i.test(stockDomain ?? "");
  const needsHumanClinicalReview = Boolean(target.requires_human_clinical_review);

  const intent = conceptMatches && timeAligned ? 88 : conceptMatches ? 72 : 45;
  const relevance = conceptMatches && sourceUrlPresent ? 86 : conceptMatches ? 70 : 42;
  const visual = lowDetailFrame ? 60 : frame.non_blank && overlayPresent && !skipped ? 82 : frame.non_blank ? 68 : 20;
  const label = conceptMatches && requirement?.narration_excerpt ? 90 : conceptMatches ? 75 : 40;
  const sourceSafety = unsafeLicense || stockRestrictedClinical ? 30 : licenseStatus === "unknown" ? 70 : 85;
  const polish = lowDetailFrame ? 55 : frame.non_blank && debugReady ? 82 : frame.non_blank ? 68 : 20;

  const failureReasons = [];
  if (!frame.non_blank) failureReasons.push("Frame extraction succeeded but frame appears blank or low-variance.");
  if (lowDetailFrame) failureReasons.push("Frame has very low visual detail/file size for a final quality target; review for placeholder-like or underdesigned output.");
  if (!conceptMatches) failureReasons.push(`No matching canonical requirement for expected concept(s): ${target.concept_keys.join(", ")}.`);
  if (conceptMatches && !timeAligned) {
    const distance = Number.isFinite(requirementMatch.distance_seconds) ? ` nearest matching requirement is ${Number(requirementMatch.distance_seconds).toFixed(1)}s away.` : "";
    failureReasons.push(`Matching requirement is not aligned to the target timestamp.${distance}`);
  }
  if (!overlayPresent) failureReasons.push("No active or nearby overlay found in Worker normalized render plan.");
  if (!sourceUrlPresent) failureReasons.push("No renderable source URL is visible for the target scene asset.");
  if (skipped) failureReasons.push(`Worker skipped the downloaded asset: ${downloadedAsset?.reason ?? "unknown reason"}.`);
  if (unsafeLicense) failureReasons.push(`Unsafe or restricted license status: ${licenseStatus}.`);
  if (licenseStatus === "unknown") failureReasons.push("License status is unknown, so source safety remains review-required.");
  if (stockRestrictedClinical) failureReasons.push(`Clinical/anatomy target uses restricted stock source domain: ${stockDomain}.`);
  if (needsHumanClinicalReview) failureReasons.push("Automated verifier cannot certify clinical/anatomy accuracy from pixels; human review required.");
  if (intent < 85) failureReasons.push(`Intent fidelity score ${intent} is below the Phase 2G threshold of 85.`);
  if (relevance < 85) failureReasons.push(`Medical relevance score ${relevance} is below the Phase 2G threshold of 85.`);
  if (visual < 80) failureReasons.push(`Visual quality score ${visual} is below the Phase 2G threshold of 80.`);
  if (label < 90) failureReasons.push(`Label accuracy score ${label} is below the Phase 2G threshold of 90.`);
  if (sourceSafety < 80) failureReasons.push(`Source safety score ${sourceSafety} is below the Phase 2G threshold of 80.`);
  if (polish < 80) failureReasons.push(`Professional polish score ${polish} is below the Phase 2G threshold of 80.`);

  const pass =
    intent >= 85 &&
    relevance >= 85 &&
    visual >= 80 &&
    label >= 90 &&
    sourceSafety >= 80 &&
    polish >= 80 &&
    !needsHumanClinicalReview &&
    failureReasons.length === 0;

  return {
    intent_fidelity_score: intent,
    medical_relevance_score: relevance,
    visual_quality_score: visual,
    label_accuracy_score: label,
    source_safety_score: sourceSafety,
    professional_polish_score: polish,
    human_review_required: needsHumanClinicalReview,
    pass,
    failure_reason: pass ? null : failureReasons.join(" "),
    remaining_gap: pass ? null : failureReasons.join(" ") || "Manual quality review required.",
  };
}

async function createContactSheet(scenes, outPath) {
  const rows = scenes.map((scene) => {
    const img = `data:image/png;base64,${fs.readFileSync(scene.frame_path).toString("base64")}`;
    const verdict = scene.pass ? "PASS" : scene.human_review_required ? "NEEDS HUMAN REVIEW" : "FAIL";
    return `
      <tr>
        <td class="time">${scene.time}</td>
        <td><img src="${img}" /></td>
        <td>
          <strong>${escapeHtml(verdict)}</strong>
          <div>${escapeHtml(scene.required_intent)}</div>
          <small>${escapeHtml(scene.failure_reason ?? "Meets automated checks.")}</small>
        </td>
      </tr>`;
  }).join("\n");
  const html = `<!doctype html>
    <html>
      <head>
        <style>
          body { margin: 0; font-family: Arial, sans-serif; background: #f7f9fb; color: #15202b; }
          h1 { margin: 20px 24px 10px; font-size: 24px; }
          table { border-collapse: collapse; width: 1160px; margin: 0 20px 20px; background: white; }
          td { border: 1px solid #ccd6dd; padding: 10px; vertical-align: top; }
          .time { width: 90px; font-size: 20px; font-weight: 700; }
          img { width: 480px; height: 270px; object-fit: cover; background: #111; display: block; }
          small { display: block; margin-top: 8px; line-height: 1.35; color: #52616f; }
        </style>
      </head>
      <body>
        <h1>Phase 2G Render Quality Contact Sheet</h1>
        <table>${rows}</table>
      </body>
    </html>`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1220, height: 2380 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load" });
    await page.screenshot({ path: outPath, fullPage: true });
  } finally {
    await browser.close();
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function markdownReport(report) {
  const rows = report.scenes.map((scene) =>
    `| ${scene.time} | ${scene.pass ? "PASS" : scene.human_review_required ? "NEEDS REVIEW" : "FAIL"} | ${scene.intent_fidelity_score} | ${scene.medical_relevance_score} | ${scene.visual_quality_score} | ${scene.label_accuracy_score} | ${scene.source_safety_score} | ${scene.professional_polish_score} | ${scene.remaining_gap ?? ""} |`,
  ).join("\n");
  return `# Phase 2G Render Quality Report

Project: ${report.project_id}

Render job: ${report.render_job_id}

Provider job: ${report.provider_job_id}

Overall verdict: **${report.overall_verdict}**

This verifier extracts real frames and checks technical evidence. It deliberately does not certify clinical/anatomy accuracy from pixels; those scenes are marked for human review.

| Time | Verdict | Intent | Relevance | Visual | Label | Source | Polish | Gap |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
${rows}

## Output Evidence

- Output path: \`${report.output_path}\`
- Output URL: \`${report.output_url_redacted}\`
- ffprobe: ${report.ffprobe.ok ? `${report.ffprobe.video?.codec} ${report.ffprobe.video?.width}x${report.ffprobe.video?.height}, audio ${report.ffprobe.audio?.codec ?? "none"}, duration ${report.ffprobe.duration_seconds}s` : report.ffprobe.reason}
- Contact sheet: \`${report.contact_sheet_path}\`
`;
}

loadEnv(path.resolve(".env"));
await fsp.mkdir(FRAME_DIR, { recursive: true });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase URL or service role key.");
const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

const renderEvidence = readJson(path.join(SOURCE_PHASE_DIR, "benchmark_render_latest_verified.json"));
if (!renderEvidence?.provider?.provider_job_id) throw new Error("Missing latest benchmark render evidence. Run npm.cmd run verify:phase2fg-render-latest first.");
const providerJobId = renderEvidence.provider.provider_job_id;
const renderJobId = renderEvidence.render_job_id;
const outputPath = renderEvidence.local_output?.path ?? path.join(WORKER_REPO_DIR, "data", "outputs", `${providerJobId}.mp4`);
const outputUrl = renderEvidence.output?.file_url_redacted?.replace("%5Bredacted%5D", "[redacted]") ?? null;
const ffprobe = ffprobeFile(outputPath);
if (!ffprobe.ok) throw new Error(`Cannot verify output MP4: ${ffprobe.reason}`);

const debugDir = path.join(WORKER_REPO_DIR, "data", "debug", providerJobId);
const normalizedPlan = readJson(path.join(debugDir, "normalized_render_plan.json"), {});
const downloadedAssets = readJson(path.join(debugDir, "downloaded_assets.json"), []);
const renderGating = readJson(path.join(debugDir, "render_gating_report.json"), {});
const canonicalRequirements = readJson(path.join(SOURCE_PHASE_DIR, "canonical_asset_requirements.json"), []);
const timelineFit = readJson(path.join(SOURCE_PHASE_DIR, "asset_timeline_fit_report.json"), []);

const { data: renderJob, error: renderJobError } = await sb.from("render_jobs").select("*").eq("id", renderJobId).single();
if (renderJobError) throw new Error(renderJobError.message);
const { data: outputs, error: outputsError } = await sb.from("render_outputs").select("*").eq("render_job_id", renderJobId).order("created_at", { ascending: false });
if (outputsError) throw new Error(outputsError.message);
const { data: providerRows, error: providerRowsError } = await sb.from("render_provider_jobs").select("*").eq("render_job_id", renderJobId).order("created_at", { ascending: false });
if (providerRowsError) throw new Error(providerRowsError.message);
const outputHead = await headUrl(outputs?.[0]?.file_url ?? null);

const overlays = Array.isArray(normalizedPlan.overlays) ? normalizedPlan.overlays : [];
const assetIds = Array.from(new Set(
  overlays
    .map((row) => row.assetId)
    .filter((value) => /^asset:[0-9a-f-]{36}$/i.test(String(value ?? "")))
    .map(assetIdWithoutPrefix),
));
const { data: assets, error: assetsError } = assetIds.length
  ? await sb.from("assets").select("*").in("id", assetIds)
  : { data: [], error: null };
if (assetsError) throw new Error(assetsError.message);
const assetById = new Map((assets ?? []).map((row) => [row.id, row]));
const downloadedByAssetId = new Map(downloadedAssets.map((row) => [row.asset_id, row]));

const scenes = [];
for (const target of TARGET_SCENES) {
  const framePath = path.join(FRAME_DIR, `${target.code}.png`);
  extractFrame(outputPath, target.seconds, framePath);
  const frame = frameMetrics(framePath);
  const requirementMatch = matchRequirement(target, canonicalRequirements);
  const overlayMatch = activeOverlaysForTarget(target, overlays);
  const primaryOverlay = overlayMatch.overlays[0] ?? null;
  const assetKey = primaryOverlay?.assetId ?? requirementMatch.row?.matched_approved_asset_id ?? null;
  const asset = assetById.get(assetIdWithoutPrefix(assetKey));
  const downloadedAsset = downloadedByAssetId.get(primaryOverlay?.assetId) ?? null;
  const debugReady = Boolean(renderGating?.professional_ready) && Array.isArray(downloadedAssets);
  const scores = scoreScene({ target, requirementMatch, overlayMatch, asset, frame, downloadedAsset, debugReady });
  scenes.push({
    time: target.label,
    seconds: target.seconds,
    frame_path: framePath,
    required_intent: target.required_intent,
    expected_visual_behavior: target.expected_visual_behavior,
    narration_excerpt: requirementMatch.row?.narration_excerpt ?? null,
    storyboard_intent: requirementMatch.row?.visual_intent ?? null,
    layout_intent: requirementMatch.row?.layout_name ?? primaryOverlay?.layout ?? null,
    requirement_match_kind: requirementMatch.match_kind,
    requirement_id: requirementMatch.row?.requirement_id ?? null,
    timeline_item_id: primaryOverlay?.itemId ?? requirementMatch.row?.render_spec_item_id ?? null,
    asset_id: assetKey,
    asset_type: asset?.asset_type ?? requirementMatch.row?.required_asset_type ?? primaryOverlay?.kind ?? null,
    source_url_present: Boolean(primaryOverlay?.sourceUrl ?? primaryOverlay?.source_url ?? requirementMatch.row?.existing_approved_asset?.source_url_present),
    source_domain: sourceDomain(primaryOverlay?.sourceUrl ?? primaryOverlay?.source_url),
    license_status: licenseStatusForAsset(asset),
    approval_status: asset?.status ?? requirementMatch.row?.current_status ?? null,
    frame,
    active_overlay_match_kind: overlayMatch.match_kind,
    active_overlays: overlayMatch.overlays.map((row) => ({
      item_id: row.itemId,
      asset_id: row.assetId,
      layout: row.layout,
      track_kind: row.trackKind,
      start_time: row.startTime,
      duration_seconds: row.durationSeconds,
      source_domain: sourceDomain(row.sourceUrl ?? row.source_url),
      source_url_redacted: redactUrl(row.sourceUrl ?? row.source_url),
      text: row.text ?? null,
      nearest_distance_seconds: row.nearest_distance_seconds ?? null,
    })),
    ...scores,
  });
}

const contactSheetPath = path.join(OUT_DIR, "quality_contact_sheet.png");
await createContactSheet(scenes, contactSheetPath);

const requiredDebugFiles = [
  "normalized_render_plan.json",
  "downloaded_assets.json",
  "ffmpeg_command.txt",
  "ffmpeg_stderr.log",
  "output_probe.json",
];
const debugArtifactCheck = {
  debug_dir: debugDir,
  required_files: requiredDebugFiles.map((file) => ({
    file,
    exists: fs.existsSync(path.join(debugDir, file)),
  })),
  available_files: fs.existsSync(debugDir) ? fs.readdirSync(debugDir).sort() : [],
};
debugArtifactCheck.ok = debugArtifactCheck.required_files.every((row) => row.exists);

const studioPersistenceCheck = {
  render_job_id: renderJobId,
  provider_job_id: providerJobId,
  render_job_status: renderJob?.status ?? null,
  progress_percent: renderJob?.progress_percent ?? null,
  output_count: outputs?.length ?? 0,
  provider_job_count: providerRows?.length ?? 0,
  latest_output: outputs?.[0] ? {
    id: outputs[0].id,
    file_url_present: Boolean(outputs[0].file_url),
    file_url_redacted: redactUrl(outputs[0].file_url),
    duration_seconds: outputs[0].duration_seconds,
    file_size: outputs[0].file_size,
    resolution: outputs[0].resolution,
  } : null,
  ok: renderJob?.status === "completed" &&
    Number(renderJob?.progress_percent) === 100 &&
    Boolean(renderJob?.provider_job_id) &&
    Boolean(outputs?.[0]?.file_url) &&
    Number(outputs?.[0]?.duration_seconds) > 0 &&
    Number(outputs?.[0]?.file_size) > 0,
};

const renderSpecAssetMap = {
  project_id: PROJECT_ID,
  render_job_id: renderJobId,
  provider_job_id: providerJobId,
  target_scenes: scenes.map((scene) => ({
    time: scene.time,
    requirement_id: scene.requirement_id,
    timeline_item_id: scene.timeline_item_id,
    asset_id: scene.asset_id,
    asset_type: scene.asset_type,
    layout_intent: scene.layout_intent,
    source_url_present: scene.source_url_present,
    source_domain: scene.source_domain,
    active_overlay_match_kind: scene.active_overlay_match_kind,
  })),
  timeline_fit_refs: timelineFit.filter((row) => TARGET_SCENES.some((target) => nearestDistance({ time_range: { start: row.start, end: row.end } }, target.seconds) <= 1)),
};

const allTechnicalChecksPass =
  ffprobe.ok &&
  ffprobe.video?.codec === "h264" &&
  Boolean(ffprobe.audio?.codec) &&
  outputHead.ok &&
  String(outputHead.content_type ?? "").includes("video/mp4") &&
  studioPersistenceCheck.ok &&
  debugArtifactCheck.ok &&
  scenes.every((scene) => scene.frame.exists && scene.frame.non_blank);
const allScenesPass = scenes.every((scene) => scene.pass);
const report = {
  generated_at: new Date().toISOString(),
  project_id: PROJECT_ID,
  render_type: RENDER_TYPE,
  render_job_id: renderJobId,
  provider_job_id: providerJobId,
  output_path: outputPath,
  output_url_redacted: redactUrl(outputs?.[0]?.file_url ?? outputUrl),
  output_head: outputHead,
  ffprobe: {
    ok: ffprobe.ok,
    duration_seconds: ffprobe.duration_seconds,
    size: ffprobe.size,
    video: ffprobe.video,
    audio: ffprobe.audio,
  },
  contact_sheet_path: contactSheetPath,
  technical_checks_pass: allTechnicalChecksPass,
  all_scenes_pass: allScenesPass,
  overall_verdict: allTechnicalChecksPass && allScenesPass ? "ACCEPTED" : allTechnicalChecksPass ? "NEEDS_HUMAN_REVIEW_OR_SMALL_FIXES" : "BLOCKED",
  scenes,
};

await writeJsonAtomic(path.join(OUT_DIR, "render_quality_report.json"), report);
await fsp.writeFile(path.join(OUT_DIR, "render_quality_report.md"), markdownReport(report), "utf8");
await writeJsonAtomic(path.join(OUT_DIR, "renderspec_asset_map.json"), renderSpecAssetMap);
await writeJsonAtomic(path.join(OUT_DIR, "studio_persistence_check.json"), studioPersistenceCheck);
await writeJsonAtomic(path.join(OUT_DIR, "worker_debug_artifact_check.json"), debugArtifactCheck);
await writeJsonAtomic(path.join(OUT_DIR, "ffprobe.json"), ffprobe.raw ?? ffprobe);

console.log(JSON.stringify({
  artifact: path.join(OUT_DIR, "render_quality_report.json"),
  contact_sheet: contactSheetPath,
  overall_verdict: report.overall_verdict,
  technical_checks_pass: report.technical_checks_pass,
  all_scenes_pass: report.all_scenes_pass,
  scene_verdicts: scenes.map((scene) => ({
    time: scene.time,
    pass: scene.pass,
    human_review_required: scene.human_review_required,
    remaining_gap: scene.remaining_gap,
  })),
}, null, 2));

if (process.env.PHASE2G_REQUIRE_ACCEPTED === "1" && report.overall_verdict !== "ACCEPTED") {
  process.exitCode = 1;
}
