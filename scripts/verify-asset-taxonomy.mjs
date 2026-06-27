import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ASSET_TYPES = [
  "clinical_image",
  "medical_diagram",
  "infographic",
  "callout",
  "lower_third",
  "cta_branding",
  "contextual_broll",
  "text_overlay",
  "end_card",
  "caption",
  "presenter_video",
];

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] ??= value;
  }
}

function projectRefFromUrl(url) {
  try {
    return new URL(url).hostname.split(".")[0] ?? null;
  } catch {
    return null;
  }
}

function shortError(error) {
  if (!error) return null;
  return {
    code: error.code ?? null,
    message: error.message ?? String(error),
    details: error.details ?? null,
  };
}

loadEnv(path.resolve(".env"));

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  throw new Error("Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

const outDir = process.env.ASSET_TAXONOMY_PROBE_OUT_DIR ?? path.join("data", "review-artifacts", "asset-taxonomy");
await fsp.mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, "asset-taxonomy-probe.json");
const manualSqlFile = path.join("supabase", "pending_remote_taxonomy_migration.sql");

const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const marker = `taxonomy_probe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const result = {
  generated_at: new Date().toISOString(),
  project_ref: process.env.SUPABASE_PROJECT_ID || projectRefFromUrl(supabaseUrl),
  attempted_asset_types: ASSET_TYPES,
  required_migration: "20260624143000_expand_assets_asset_type_taxonomy.sql",
  manual_sql_file: manualSqlFile,
  marker,
  project_created: false,
  accepted: [],
  rejected: [],
  cleanup: {},
};

let projectId = null;
try {
  const { data: userRows, error: userError } = await sb.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (userError) throw userError;
  const userId = userRows.users?.[0]?.id;
  if (!userId) throw new Error("No Supabase auth user exists to own the probe project.");

  const { data: project, error: projectError } = await sb
    .from("projects")
    .insert({
      user_id: userId,
      title: marker,
      status: "draft",
      video_path: `${marker}.mp4`,
      duration_seconds: 1,
    })
    .select("id")
    .single();
  if (projectError) throw projectError;
  projectId = project.id;
  result.project_id = projectId;
  result.project_created = true;

  for (const assetType of ASSET_TYPES) {
    const { data, error } = await sb
      .from("assets")
      .insert({
        project_id: projectId,
        asset_type: assetType,
        source_type: "manual",
        source: "taxonomy_probe",
        status: "approved",
        title: `${marker}:${assetType}`,
        url: "https://example.com/probe.png",
        metadata: { taxonomy_probe: marker, normalized_asset_type: assetType },
      })
      .select("id, asset_type")
      .single();
    if (error) result.rejected.push({ asset_type: assetType, error: shortError(error) });
    else result.accepted.push(data);
  }
} finally {
  if (projectId) {
    const { error: assetCleanupError } = await sb.from("assets").delete().eq("project_id", projectId);
    result.cleanup.assets = assetCleanupError ? shortError(assetCleanupError) : "ok";
    const { error: projectCleanupError } = await sb.from("projects").delete().eq("id", projectId);
    result.cleanup.project = projectCleanupError ? shortError(projectCleanupError) : "ok";
  }
  result.ok = result.rejected.length === 0 && result.accepted.length === ASSET_TYPES.length;
  result.remote_taxonomy_migration_pending =
    !result.ok &&
    result.rejected.some((row) =>
      row.error?.code === "23514" &&
      /assets_asset_type_check/i.test(`${row.error.message ?? ""} ${row.error.details ?? ""}`),
    );
  result.finished_at = new Date().toISOString();
  await fsp.writeFile(outPath, JSON.stringify(result, null, 2));
}

console.log(JSON.stringify({
  ok: result.ok,
  project_ref: result.project_ref,
  accepted: result.accepted.length,
  rejected: result.rejected.length,
  remote_taxonomy_migration_pending: result.remote_taxonomy_migration_pending,
  manual_sql_file: result.manual_sql_file,
  artifact: outPath,
}, null, 2));

if (!result.ok) process.exit(1);
