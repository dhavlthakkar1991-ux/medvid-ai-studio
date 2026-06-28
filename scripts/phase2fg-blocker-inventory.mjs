import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const PROJECT_ID = process.env.PHASE2FG_PROJECT_ID ?? "24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99";
const OUT_DIR = process.env.PHASE2FG_OUT_DIR ?? path.join("data", "review-artifacts", PROJECT_ID, "phase-2fg-g1");

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

function sourceUrlForAsset(asset) {
  const meta = plainObject(asset?.metadata);
  return firstString(asset?.url, asset?.preview_url, asset?.thumbnail_url, meta.url, meta.source_url, meta.preview_url, meta.thumbnail_url);
}

function textForRow(row) {
  const meta = plainObject(row.metadata ?? row.candidate_data);
  const intent = plainObject(meta.intent);
  return [
    row.title,
    row.description,
    row.search_query,
    row.asset_type,
    meta.search_query,
    meta.visual_concept,
    meta.mapped_visual_intent,
    intent.visual_goal,
    intent.expected_visual,
    intent.original_instruction,
    Array.isArray(intent.search_queries) ? intent.search_queries.join(" ") : null,
  ].filter(Boolean).join(" ").toLowerCase();
}

function conceptForText(text) {
  if (/biopsy|punch biopsy|tissue sample|pathology|specimen/.test(text)) return "biopsy_workflow";
  if (/leukoplakia|erythroplakia|white patches?|red patches?/.test(text)) return "leukoplakia_erythroplakia";
  if (/ulcer|non healing|non-healing|mouth sore|oral lesion/.test(text)) return "oral_ulcer";
  if (/lymph|neck lump|neck node|cervical node|swelling/.test(text)) return "cervical_lymph_node";
  if (/oral exam|examination|screening|mouth opening|consult specialist/.test(text)) return "oral_examination";
  if (/india|prevalence|common cancers|map/.test(text)) return "india_prevalence";
  if (/tobacco|gutkha|mawa|smoking|chewing tobacco/.test(text)) return "tobacco_gutkha_risk";
  if (/share|family|friends|cta|early diagnosis|save lives|contact/.test(text)) return "cta_branding";
  return "medical_visual";
}

loadEnv(path.resolve(".env"));

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase URL or service role key.");

const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const readinessPath = path.join(OUT_DIR, "professional_readiness_summary.json");
const todosPath = path.join(OUT_DIR, "asset_todo_list.json");
const todos = fs.existsSync(todosPath) ? JSON.parse(fs.readFileSync(todosPath, "utf8")) : [];
const blockers = todos.filter((row) => row.required_or_optional === "required" && row.current_status !== "resolved");

const [assetsRes, candidatesRes, manifestRes] = await Promise.all([
  sb.from("assets").select("*").eq("project_id", PROJECT_ID),
  sb.from("asset_candidates").select("*").eq("project_id", PROJECT_ID),
  sb.from("render_manifest").select("*").eq("project_id", PROJECT_ID),
]);
for (const [name, res] of Object.entries({ assetsRes, candidatesRes, manifestRes })) {
  if (res.error) throw new Error(`${name}: ${res.error.message}`);
}

const approvedAssets = (assetsRes.data ?? []).filter((asset) =>
  ["approved", "locked", "render_ready"].includes(String(asset.status)) && sourceUrlForAsset(asset),
);
const candidateRows = candidatesRes.data ?? [];

const inventory = blockers.map((blocker) => {
  const matchingAssets = approvedAssets
    .map((asset) => ({ asset, concept: conceptForText(textForRow(asset)), text: textForRow(asset) }))
    .filter((row) => row.concept === blocker.concept_key || row.text.includes(String(blocker.visual_intent ?? "").toLowerCase().slice(0, 18)))
    .slice(0, 12)
    .map(({ asset, concept }) => ({
      id: asset.id,
      title: asset.title,
      asset_type: asset.asset_type,
      status: asset.status,
      source_type: asset.source_type ?? asset.source,
      concept,
      url_present: Boolean(sourceUrlForAsset(asset)),
      source_url: sourceUrlForAsset(asset),
      metadata_keys: Object.keys(plainObject(asset.metadata)).slice(0, 12),
    }));
  const matchingCandidates = candidateRows
    .map((candidate) => ({ candidate, concept: conceptForText(textForRow(candidate)), text: textForRow(candidate) }))
    .filter((row) => row.concept === blocker.concept_key)
    .slice(0, 20)
    .map(({ candidate, concept }) => ({
      id: candidate.id,
      title: candidate.title,
      asset_type: candidate.asset_type,
      status: candidate.status,
      provider: candidate.provider,
      concept,
      candidate_has_url: Boolean(firstString(candidate.thumbnail_url, candidate.candidate_data?.url, candidate.candidate_data?.source_url, candidate.candidate_data?.media_url, candidate.candidate_data?.preview_url, candidate.candidate_data?.thumbnail_url)),
      linked_asset_id: candidate.linked_asset_id,
      score: candidate.candidate_data?.worker_score?.overall_asset_score ?? candidate.candidate_data?.score?.overall_asset_score ?? null,
      license_status: candidate.candidate_data?.license_status ?? candidate.candidate_data?.license?.status ?? null,
    }));
  return {
    requirement_id: blocker.requirement_id,
    concept_key: blocker.concept_key,
    visual_intent: blocker.visual_intent,
    source_render_manifest_id: blocker.source_render_manifest_id,
    timeline_item_id: blocker.timeline_item_id,
    status: blocker.current_status,
    blocking_reason: blocker.blocking_reason,
    matching_approved_assets: matchingAssets,
    matching_candidates: matchingCandidates,
  };
});

const result = {
  project_id: PROJECT_ID,
  readiness_file_exists: fs.existsSync(readinessPath),
  blocker_count: blockers.length,
  approved_renderable_assets: approvedAssets.length,
  candidate_count: candidateRows.length,
  inventory,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "blocker_inventory.json"), JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify({
  project_id: PROJECT_ID,
  blocker_count: blockers.length,
  approved_renderable_assets: approvedAssets.length,
  candidate_count: candidateRows.length,
  output: path.join(OUT_DIR, "blocker_inventory.json"),
  summaries: inventory.map((row) => ({
    requirement_id: row.requirement_id,
    concept_key: row.concept_key,
    approved_matches: row.matching_approved_assets.length,
    candidate_matches: row.matching_candidates.length,
  })),
}, null, 2));
