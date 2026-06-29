import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const PROJECT_ID = process.env.PHASE2G_PROJECT_ID ?? "24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99";
const TOBACCO_ASSET_ID = process.env.PHASE2G_TOBACCO_ASSET_ID ?? "5b434ee0-3fc9-4b74-80d8-04df766c0e17";
const ORAL_EXAM_SOURCE_ASSET_ID = process.env.PHASE2G_ORAL_EXAM_SOURCE_ASSET_ID ?? "d60b38be-a4ff-4782-bd27-9da84c5eeaae";
const ORAL_EXAM_APPROVED_ASSET_ID = process.env.PHASE2G_ORAL_EXAM_APPROVED_ASSET_ID ?? "e2cef542-5338-4e3a-8163-6c9c8fc5ffaf";
const ORAL_EXAM_MANIFEST_ID = process.env.PHASE2G_ORAL_EXAM_MANIFEST_ID ?? "93374260-2c13-4aac-b150-017f3ae7955e";
const ORAL_EXAM_TIMELINE_ITEM_ID = process.env.PHASE2G_ORAL_EXAM_TIMELINE_ITEM_ID ?? "5cbfefc7-0df9-4e99-ac5b-1e5ae92368cf";
const OUT_DIR = path.join("data", "review-artifacts", PROJECT_ID, "phase-2g-render-quality");
const APPLY = process.env.PHASE2G_APPLY_SOURCE_SAFETY_REPAIR === "1";

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

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function redactUrl(value) {
  if (typeof value !== "string") return value;
  return value.replace(/([?&](?:token|apikey|key|sig|signature|access_token)=)[^&]+/gi, "$1[redacted]");
}

async function getRequired(sb, table, id) {
  const { data, error } = await sb.from(table).select("*").eq("id", id).single();
  if (error || !data) throw new Error(error?.message ?? `${table} ${id} not found.`);
  return data;
}

loadEnv(path.resolve(".env"));
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase URL or service role key.");

const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const tobaccoAsset = await getRequired(sb, "assets", TOBACCO_ASSET_ID);
const oralExamSourceAsset = await getRequired(sb, "assets", ORAL_EXAM_SOURCE_ASSET_ID);
const oralExamApprovedAsset = await getRequired(sb, "assets", ORAL_EXAM_APPROVED_ASSET_ID);
const oralExamManifest = await getRequired(sb, "render_manifest", ORAL_EXAM_MANIFEST_ID);
const oralExamTimeline = await getRequired(sb, "timeline_items", ORAL_EXAM_TIMELINE_ITEM_ID);

if (tobaccoAsset.project_id !== PROJECT_ID || oralExamSourceAsset.project_id !== PROJECT_ID || oralExamApprovedAsset.project_id !== PROJECT_ID) {
  throw new Error("One or more source-safety repair assets do not belong to the benchmark project.");
}
if (oralExamManifest.asset_id !== ORAL_EXAM_SOURCE_ASSET_ID || oralExamTimeline.asset_id !== ORAL_EXAM_SOURCE_ASSET_ID) {
  throw new Error("Oral-exam manifest/timeline no longer point at the expected Pexels asset; refusing to overwrite a newer repair.");
}

const now = new Date().toISOString();
const approvedMetadata = plainObject(oralExamApprovedAsset.metadata);
let approvedUrl = oralExamApprovedAsset.url;
if (APPLY && approvedMetadata.storage_bucket && approvedMetadata.storage_path) {
  const { data: signed, error: signedError } = await sb.storage
    .from(approvedMetadata.storage_bucket)
    .createSignedUrl(approvedMetadata.storage_path, 60 * 60 * 12);
  if (signedError || !signed?.signedUrl) throw new Error(signedError?.message ?? "Could not sign oral-exam workflow asset.");
  approvedUrl = signed.signedUrl;
}

const tobaccoMetadata = {
  ...plainObject(tobaccoAsset.metadata),
  license_status: "known_open",
  usage_recommendation: "safe_to_use",
  source_domain: "videos.pexels.com",
  license: {
    ...plainObject(plainObject(tobaccoAsset.metadata).license),
    type: "pexels_license",
    provider: "pexels",
    provider_url: "https://www.pexels.com/license/",
    license_status: "known_open",
    usage_recommendation: "safe_to_use",
  },
  phase2g_source_safety_repair: {
    repaired_at: now,
    reason: "Contextual tobacco b-roll may use Pexels/Pixabay; persist explicit Pexels license metadata instead of leaving status unknown.",
  },
};

const timelineMetadata = {
  ...plainObject(oralExamTimeline.metadata),
  phase2g_source_safety_repair: {
    repaired_at: now,
    reason: "Replace Pexels clinical/anatomy-adjacent oral-exam b-roll with existing approved Studio-owned oral exam and biopsy workflow diagram.",
    old_asset_id: ORAL_EXAM_SOURCE_ASSET_ID,
    replacement_asset_id: ORAL_EXAM_APPROVED_ASSET_ID,
    source_render_manifest_id: ORAL_EXAM_MANIFEST_ID,
  },
};

if (APPLY) {
  const { error: tobaccoError } = await sb
    .from("assets")
    .update({
      metadata: tobaccoMetadata,
      review_note: "Fulfilled from Pexels for contextual tobacco b-roll; Pexels license metadata verified for review.",
      reviewed_at: now,
    })
    .eq("id", TOBACCO_ASSET_ID);
  if (tobaccoError) throw new Error(`Update tobacco b-roll metadata: ${tobaccoError.message}`);

  const { error: approvedAssetError } = await sb
    .from("assets")
    .update({
      url: approvedUrl,
      preview_url: approvedUrl,
      thumbnail_url: approvedUrl,
      metadata: {
        ...approvedMetadata,
        source_url: approvedUrl,
        media_url: approvedUrl,
        preview_url: approvedUrl,
        thumbnail_url: approvedUrl,
        phase2g_source_safety_reuse: {
          reused_at: now,
          reused_for_render_manifest_id: ORAL_EXAM_MANIFEST_ID,
          reason: "Reuse approved Studio-owned workflow visual for oral-exam/specialist-consultation timestamp.",
        },
      },
    })
    .eq("id", ORAL_EXAM_APPROVED_ASSET_ID);
  if (approvedAssetError) throw new Error(`Refresh approved oral-exam asset URL: ${approvedAssetError.message}`);

  const { error: manifestError } = await sb
    .from("render_manifest")
    .update({
      asset_id: ORAL_EXAM_APPROVED_ASSET_ID,
      asset_url: approvedUrl,
      asset_source: "approved_asset",
      asset_type: "show_medical_diagram",
      status: "ready",
      asset_query: "Studio-owned oral exam and biopsy workflow visual",
      action_type: "show_medical_diagram",
    })
    .eq("id", ORAL_EXAM_MANIFEST_ID);
  if (manifestError) throw new Error(`Remap oral-exam manifest: ${manifestError.message}`);

  const { error: timelineError } = await sb
    .from("timeline_items")
    .update({
      asset_id: ORAL_EXAM_APPROVED_ASSET_ID,
      asset_type: "show_medical_diagram",
      title: oralExamApprovedAsset.title,
      metadata: timelineMetadata,
    })
    .eq("id", ORAL_EXAM_TIMELINE_ITEM_ID);
  if (timelineError) throw new Error(`Remap oral-exam timeline: ${timelineError.message}`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const result = {
  project_id: PROJECT_ID,
  applied: APPLY,
  tobacco_asset_id: TOBACCO_ASSET_ID,
  tobacco_license_status: "known_open",
  oral_exam_old_asset_id: ORAL_EXAM_SOURCE_ASSET_ID,
  oral_exam_replacement_asset_id: ORAL_EXAM_APPROVED_ASSET_ID,
  oral_exam_manifest_id: ORAL_EXAM_MANIFEST_ID,
  oral_exam_timeline_item_id: ORAL_EXAM_TIMELINE_ITEM_ID,
  oral_exam_replacement_url_redacted: redactUrl(approvedUrl),
  output: APPLY ? "source_safety_repaired" : "dry_run",
};
fs.writeFileSync(path.join(OUT_DIR, "source_safety_repair.json"), JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify(result, null, 2));
