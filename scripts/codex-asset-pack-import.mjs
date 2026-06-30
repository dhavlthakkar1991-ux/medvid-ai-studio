import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] ??= value;
  }
}

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function flag(name) {
  return process.argv.includes(name);
}

function usage() {
  return [
    "Usage:",
    "  npm run codex:asset-pack:import -- --file <codex_asset_import_template.json> [--apply]",
    "",
    "Without --apply this performs a dry-run. The import accepts PNG/WebP/JPG/MP4 only.",
  ].join("\n");
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function numberOrNull(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function extname(value) {
  return path.extname(String(value ?? "")).replace(".", "").toLowerCase();
}

function contentTypeFor(filePath, explicit) {
  const type = String(explicit ?? "").toLowerCase();
  if (type && type !== "application/octet-stream") return type;
  const ext = extname(filePath);
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "mp4") return "video/mp4";
  if (ext === "mov") return "video/quicktime";
  return "application/octet-stream";
}

function assertAllowedMedia(source, contentType) {
  const ext = extname(source);
  const type = String(contentType ?? "").toLowerCase();
  if (ext === "svg" || type.includes("svg")) {
    throw new Error(`${source}: SVG is not allowed in the primary Codex asset workflow.`);
  }
  const allowedExt = ["png", "jpg", "jpeg", "webp", "mp4", "mov"];
  const allowedTypes = ["image/png", "image/jpeg", "image/webp", "video/mp4", "video/quicktime"];
  if (ext && !allowedExt.includes(ext)) throw new Error(`${source}: unsupported file extension .${ext}`);
  if (type && type !== "application/octet-stream" && !allowedTypes.includes(type)) throw new Error(`${source}: unsupported content type ${type}`);
}

function roleFor(assetType) {
  const type = String(assetType ?? "").toLowerCase();
  if (type.includes("broll") || type.includes("video")) return "B-roll";
  if (type.includes("clinical")) return "Clinical Image";
  if (type.includes("diagram") || type.includes("illustration")) return "Medical Diagram";
  if (type.includes("lower") || type.includes("overlay") || type.includes("cta")) return "Overlay";
  return "Infographic";
}

function sourceFor(row, candidate) {
  const tool = String(row.tool ?? row.provider ?? "").toLowerCase();
  if (tool.includes("hyperframes")) return "codex_hyperframes";
  if (tool.includes("imagegen")) return "codex_imagegen";
  const data = plainObject(candidate?.candidate_data);
  const metadata = plainObject(data.metadata);
  const codexTool = String(data.codex_tool ?? metadata.codex_tool ?? "").toLowerCase();
  if (codexTool.includes("hyperframes")) return "codex_hyperframes";
  return "codex_imagegen";
}

function sourceTypeFor(source) {
  return source.includes("hyperframes") || source.includes("imagegen") ? "generated" : "manual";
}

function storagePathFor(projectId, candidateId, filename) {
  const ext = extname(filename) || "bin";
  return `codex-assets/${projectId}/${candidateId}/${crypto.randomUUID()}.${ext}`;
}

async function uploadLocalFile(sb, projectId, candidateId, localPath, contentType) {
  const absolute = path.resolve(localPath);
  if (!fs.existsSync(absolute)) throw new Error(`Generated file not found: ${absolute}`);
  const stat = fs.statSync(absolute);
  if (!stat.isFile() || stat.size <= 0) throw new Error(`Generated file is empty or not a file: ${absolute}`);
  const type = contentTypeFor(absolute, contentType);
  assertAllowedMedia(absolute, type);
  const storagePath = storagePathFor(projectId, candidateId, absolute);
  const { error: uploadError } = await sb.storage
    .from("videos")
    .upload(storagePath, fs.readFileSync(absolute), { contentType: type, upsert: false });
  if (uploadError) throw new Error(uploadError.message);
  const { data: signed, error: signError } = await sb.storage.from("videos").createSignedUrl(storagePath, 60 * 60 * 24 * 7);
  if (signError || !signed?.signedUrl) throw new Error(signError?.message ?? "Could not sign uploaded Codex asset");
  return {
    source_url: signed.signedUrl,
    storage_bucket: "videos",
    storage_path: storagePath,
    file_size: stat.size,
    content_type: type,
    local_path: absolute,
  };
}

function buildAssetMetadata({ row, candidate, source, media, manifest }) {
  const data = plainObject(candidate.candidate_data);
  const metadata = plainObject(data.metadata);
  return {
    classification: "REAL_RENDERABLE_MEDIA",
    source: "codex_asset_pack_import",
    source_type: sourceTypeFor(source),
    codex_creative_workflow: true,
    codex_tool: row.tool ?? data.codex_tool ?? metadata.codex_tool ?? null,
    generation_prompt: row.generation_prompt ?? row.prompt ?? data.generation_prompt ?? metadata.generation_prompt ?? null,
    negative_prompt: row.negative_prompt ?? data.negative_prompt ?? metadata.negative_prompt ?? null,
    generation_provider: source,
    approval_source: "codex_asset_pack_import",
    approval_status: "approved",
    medical_asset_taxonomy: data.medical_asset_taxonomy ?? data.taxonomy ?? null,
    medical_source_class: sourceTypeFor(source),
    source_render_manifest_id: row.render_manifest_id ?? data.source_render_manifest_id ?? manifest?.id ?? null,
    mapped_scene_id: candidate.scene_id ?? manifest?.scene_id ?? null,
    mapped_timeline_item_id: data.timeline_item_id ?? plainObject(data.intent).timeline_item_id ?? null,
    mapped_storyboard_item_id: candidate.storyboard_item_id ?? manifest?.storyboard_item_id ?? null,
    start_time: manifest?.timeline_start ?? data.matched_manifest_timeline_start ?? null,
    end_time: manifest?.timeline_end ?? data.matched_manifest_timeline_end ?? null,
    original_candidate_data: candidate.candidate_data ?? null,
    upload: media.storage_path
      ? {
          bucket: media.storage_bucket,
          path: media.storage_path,
          content_type: media.content_type,
          file_size: media.file_size,
          local_path: media.local_path,
        }
      : null,
  };
}

loadEnv(path.resolve(".env"));

if (flag("--help") || flag("-h")) {
  console.log(usage());
  process.exit(0);
}

const file = argValue("--file", process.env.CODEX_ASSET_IMPORT_FILE);
if (!file) throw new Error("Missing --file.");

const apply = flag("--apply") || process.env.CODEX_ASSET_IMPORT_APPLY === "1";
const inputPath = path.resolve(file);
const payload = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const projectId = payload.project_id ?? payload.project?.id;
if (!projectId) throw new Error("Import file is missing project_id.");

const generatedAssets = Array.isArray(payload.generated_assets)
  ? payload.generated_assets
  : Array.isArray(payload.assets)
    ? payload.assets
    : [];
if (generatedAssets.length === 0) throw new Error("Import file contains no generated_assets.");

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase URL or service role key.");

const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const results = [];

for (const row of generatedAssets) {
  const candidateId = firstString(row.candidate_id, row.asset_candidate_id);
  if (!candidateId) throw new Error("Generated asset row is missing candidate_id.");

  const { data: candidate, error: candidateError } = await sb
    .from("asset_candidates")
    .select("*")
    .eq("id", candidateId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (candidateError) throw new Error(candidateError.message);
  if (!candidate) throw new Error(`Candidate ${candidateId} not found for project ${projectId}.`);

  const candidateData = plainObject(candidate.candidate_data);
  const manifestId = firstString(row.render_manifest_id, candidateData.source_render_manifest_id);
  const { data: manifest, error: manifestError } = manifestId
    ? await sb.from("render_manifest").select("*").eq("id", manifestId).eq("project_id", projectId).maybeSingle()
    : { data: null, error: null };
  if (manifestError) throw new Error(manifestError.message);

  const sourceUrl = firstString(row.source_url, row.url, row.public_url);
  const localPath = firstString(row.local_path, row.file_path, row.path);
  const contentType = contentTypeFor(localPath ?? sourceUrl ?? row.title, row.content_type);
  if (sourceUrl) assertAllowedMedia(sourceUrl, contentType);
  if (!sourceUrl && !localPath) throw new Error(`${candidateId}: provide local_path or source_url.`);

  const plan = {
    candidate_id: candidateId,
    title: row.title ?? candidate.title ?? candidate.search_query,
    source: sourceFor(row, candidate),
    content_type: contentType,
    local_path: localPath ? path.resolve(localPath) : null,
    source_url: sourceUrl || null,
    render_manifest_id: manifest?.id ?? null,
    apply,
  };

  if (!apply) {
    results.push({ ...plan, status: "dry_run" });
    continue;
  }

  const uploaded = sourceUrl
    ? { source_url: sourceUrl, content_type: contentType, storage_bucket: null, storage_path: null, file_size: null, local_path: null }
    : await uploadLocalFile(sb, projectId, candidateId, localPath, contentType);

  const source = sourceFor(row, candidate);
  const metadata = buildAssetMetadata({ row, candidate, source, media: uploaded, manifest });
  const now = new Date().toISOString();
  const title = row.title ?? candidate.title ?? candidate.search_query?.slice(0, 80) ?? "Codex generated asset";
  const description = row.description ?? candidate.description ?? `Imported from Codex asset pack via ${source}.`;
  const mediaUrl = uploaded.source_url;

  const { data: asset, error: assetError } = await sb
    .from("assets")
    .insert({
      project_id: projectId,
      scene_id: candidate.scene_id ?? manifest?.scene_id ?? null,
      asset_type: candidate.asset_type,
      source_type: sourceTypeFor(source),
      source,
      status: "approved",
      title,
      description,
      url: mediaUrl,
      preview_url: mediaUrl,
      thumbnail_url: String(contentType).startsWith("image/") ? mediaUrl : row.thumbnail_url ?? null,
      duration_seconds: numberOrNull(row.duration_seconds, manifest && Number(manifest.timeline_end) - Number(manifest.timeline_start)),
      width: numberOrNull(row.width),
      height: numberOrNull(row.height),
      search_query: candidate.search_query,
      metadata,
      reviewed_at: now,
      review_note: "Imported from Codex generated asset pack.",
    })
    .select("id")
    .single();
  if (assetError || !asset) throw new Error(assetError?.message ?? "Failed to insert Codex asset.");

  await sb.from("project_assets").upsert(
    {
      project_id: projectId,
      asset_id: asset.id,
      role: roleFor(candidate.asset_type),
      status: "approved",
      notes: "Imported from Codex generated asset pack.",
    },
    { onConflict: "project_id,asset_id,role" },
  );

  const mergedCandidateData = {
    ...candidateData,
    render_ready: true,
    classification: "REAL_RENDERABLE_MEDIA",
    codex_creative_workflow: true,
    generation_provider: source,
    result_url: mediaUrl,
    url: mediaUrl,
    source_url: mediaUrl,
    media_url: mediaUrl,
    preview_url: mediaUrl,
    thumbnail_url: String(contentType).startsWith("image/") ? mediaUrl : row.thumbnail_url ?? null,
    duration_seconds: numberOrNull(row.duration_seconds, manifest && Number(manifest.timeline_end) - Number(manifest.timeline_start)),
    width: numberOrNull(row.width),
    height: numberOrNull(row.height),
    fulfilled_asset_id: asset.id,
    approval_status: "approved",
    approved_at: now,
    approval_reason: "Imported from Codex generated asset pack.",
    storage_bucket: uploaded.storage_bucket,
    storage_path: uploaded.storage_path,
  };

  const { error: candidateUpdateError } = await sb
    .from("asset_candidates")
    .update({
      status: "approved",
      linked_asset_id: asset.id,
      thumbnail_url: String(contentType).startsWith("image/") ? mediaUrl : row.thumbnail_url ?? candidate.thumbnail_url,
      reviewed_at: now,
      review_note: "Imported from Codex generated asset pack.",
      candidate_data: mergedCandidateData,
    })
    .eq("id", candidate.id);
  if (candidateUpdateError) throw new Error(candidateUpdateError.message);

  const { error: manifestUpdateError } = manifest
    ? await sb
        .from("render_manifest")
        .update({
          asset_id: asset.id,
          asset_url: mediaUrl,
          asset_source: "review_approved",
          status: "ready",
        })
        .eq("id", manifest.id)
    : { error: null };
  if (manifestUpdateError) throw new Error(manifestUpdateError.message);

  results.push({ ...plan, status: "imported", asset_id: asset.id, source_url: mediaUrl });
}

const result = {
  ok: true,
  apply,
  project_id: projectId,
  checked: results.length,
  imported: results.filter((row) => row.status === "imported").length,
  results,
};

const outPath = path.join(path.dirname(inputPath), "codex_asset_import_result.json");
fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...result, result_file: outPath }, null, 2));
