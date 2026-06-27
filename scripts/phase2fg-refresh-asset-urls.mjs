import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const PROJECT_ID = process.env.PHASE2FG_PROJECT_ID ?? "24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99";
const OUT_DIR = process.env.PHASE2FG_OUT_DIR ?? path.join("data", "review-artifacts", PROJECT_ID, "phase-2fg-g1");
const APPLY = process.env.PHASE2FG_REFRESH_URLS === "1";

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

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function parseSupabaseStorageUrl(value) {
  if (!value || typeof value !== "string" || !value.includes("/storage/v1/object/")) return null;
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const objectIndex = parts.findIndex((part, index) => part === "object" && (parts[index + 1] === "sign" || parts[index + 1] === "public"));
    if (objectIndex < 0) return null;
    const bucket = parts[objectIndex + 2];
    const objectPath = parts.slice(objectIndex + 3).map((part) => decodeURIComponent(part)).join("/");
    return bucket && objectPath ? { bucket, path: objectPath } : null;
  } catch {
    return null;
  }
}

async function probeUrl(url) {
  if (!url) return { ok: false, status: null, content_type: null, reason: "missing URL" };
  if (url.startsWith("data:")) return { ok: true, status: 200, content_type: url.slice(5, url.indexOf(";")) || null, reason: null };
  try {
    const response = await fetch(url, { headers: { Range: "bytes=0-0" } });
    await response.body?.cancel?.();
    const contentType = response.headers.get("content-type");
    const ok = (response.ok || response.status === 206) && !String(contentType ?? "").includes("application/json");
    return { ok, status: response.status, content_type: contentType, reason: ok ? null : `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, status: null, content_type: null, reason: error instanceof Error ? error.message : String(error) };
  }
}

function storageInfoForAsset(asset) {
  const metadata = plainObject(asset.metadata);
  const upload = plainObject(metadata.upload);
  const direct = {
    bucket: firstString(metadata.storage_bucket, metadata.storageBucket, upload.bucket),
    path: firstString(metadata.storage_path, metadata.storagePath, upload.path),
  };
  if (direct.bucket && direct.path) return direct;

  for (const candidate of [
    asset.url,
    asset.preview_url,
    asset.thumbnail_url,
    metadata.url,
    metadata.source_url,
    metadata.preview_url,
    metadata.thumbnail_url,
  ]) {
    const parsed = parseSupabaseStorageUrl(candidate);
    if (parsed) return parsed;
  }
  return null;
}

loadEnv(path.resolve(".env"));
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase URL or service role key.");

const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const { data: assets, error: assetError } = await sb
  .from("assets")
  .select("*")
  .eq("project_id", PROJECT_ID)
  .in("status", ["approved", "locked", "render_ready"]);
if (assetError) throw new Error(assetError.message);

const results = [];
for (const asset of assets ?? []) {
  const currentUrl = firstString(asset.url, asset.preview_url, asset.thumbnail_url, asset.metadata?.url, asset.metadata?.source_url, asset.metadata?.preview_url, asset.metadata?.thumbnail_url);
  const before = await probeUrl(currentUrl);
  const storage = storageInfoForAsset(asset);
  const result = {
    asset_id: asset.id,
    title: asset.title,
    asset_type: asset.asset_type,
    had_storage_info: Boolean(storage),
    before,
    refreshed: false,
    after: null,
    error: null,
  };
  if (!storage) {
    result.error = "No Supabase storage bucket/path could be recovered.";
    results.push(result);
    continue;
  }

  const { data: signed, error } = await sb.storage.from(storage.bucket).createSignedUrl(storage.path, 60 * 60 * 12);
  if (error || !signed?.signedUrl) {
    result.error = error?.message ?? "Could not create signed URL.";
    results.push(result);
    continue;
  }
  result.after = await probeUrl(signed.signedUrl);
  result.refreshed = Boolean(result.after.ok);

  if (APPLY && result.refreshed) {
    const metadata = {
      ...plainObject(asset.metadata),
      storage_bucket: storage.bucket,
      storage_path: storage.path,
      url: signed.signedUrl,
      source_url: signed.signedUrl,
      media_url: signed.signedUrl,
      preview_url: signed.signedUrl,
      thumbnail_url: signed.signedUrl,
      upload: {
        ...plainObject(plainObject(asset.metadata).upload),
        bucket: storage.bucket,
        path: storage.path,
      },
      phase2fg_url_refresh: {
        refreshed_at: new Date().toISOString(),
        reason: before.ok ? "Backfilled storage provenance for future signing." : "Replaced expired signed URL and backfilled storage provenance.",
      },
    };
    const { error: updateError } = await sb
      .from("assets")
      .update({
        url: signed.signedUrl,
        preview_url: signed.signedUrl,
        thumbnail_url: signed.signedUrl,
        metadata,
      })
      .eq("id", asset.id);
    if (updateError) {
      result.error = updateError.message;
      results.push(result);
      continue;
    }
    const { error: manifestError } = await sb
      .from("render_manifest")
      .update({ asset_url: signed.signedUrl })
      .eq("project_id", PROJECT_ID)
      .eq("asset_id", asset.id);
    if (manifestError) result.error = `render_manifest update: ${manifestError.message}`;
  }
  results.push(result);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const output = {
  project_id: PROJECT_ID,
  applied: APPLY,
  checked_assets: results.length,
  refreshed_assets: results.filter((row) => row.refreshed).length,
  skipped_valid_non_storage_assets: results.filter((row) => !row.refreshed && row.before?.ok).length,
  unresolved_assets: results.filter((row) => !row.refreshed && !row.before?.ok && !row.after?.ok),
  results: results.map((row) => ({
    ...row,
    before: row.before ? { ...row.before, url: undefined } : null,
    after: row.after ? { ...row.after, url: undefined } : null,
  })),
};
fs.writeFileSync(path.join(OUT_DIR, "asset_url_refresh_report.json"), JSON.stringify(output, null, 2), "utf8");
console.log(JSON.stringify({
  project_id: output.project_id,
  applied: output.applied,
  checked_assets: output.checked_assets,
  refreshed_assets: output.refreshed_assets,
  skipped_valid_non_storage_assets: output.skipped_valid_non_storage_assets,
  unresolved_assets: output.unresolved_assets.length,
  output: path.join(OUT_DIR, "asset_url_refresh_report.json"),
}, null, 2));
