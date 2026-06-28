import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const PROJECT_ID = process.env.PHASE2FG_PROJECT_ID ?? "24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99";
const OUT_DIR = process.env.PHASE2FG_OUT_DIR ?? path.join("data", "review-artifacts", PROJECT_ID, "phase-2fg-g1");

const REPAIRS = [
  {
    reason: "Replace mismatched tobacco-risk infographic with approved uploaded cervical lymph node anatomy visual.",
    requirement_id: "req_543c1204_bfa2195b_cervical_lymph_node_infographic",
    render_manifest_id: "bfa2195b-d9bb-4590-9393-31f9203a013c",
    timeline_item_id: "01e129d7-1879-46e6-816a-d21f3585b36b",
    asset_id: "52c5d176-dbf3-49c3-a87b-36ec0587e825",
    expected_concept: "cervical_lymph_node",
  },
  {
    reason: "Link approved uploaded non-healing mouth ulcer visual into the first oral ulcer timeline requirement.",
    requirement_id: "req_78265959_9a5a7172_oral_ulcer_clinical_image",
    render_manifest_id: "9a5a7172-8125-4be5-995f-5b606dd4d0af",
    timeline_item_id: "92818b15-fa83-47e2-bbb1-b82bdb05bf45",
    asset_id: "917b78a7-9440-4d66-8c90-276c3d7fa638",
    expected_concept: "oral_ulcer",
  },
  {
    reason: "Reuse the approved uploaded non-healing mouth ulcer visual for the later oral ulcer reminder requirement.",
    requirement_id: "req_de5312b1_0786fbec_oral_ulcer_clinical_image",
    render_manifest_id: "0786fbec-3f2a-4f05-b4cf-7c13035f24db",
    timeline_item_id: "be6bd9fd-f168-4254-8f78-4fa93095b980",
    asset_id: "917b78a7-9440-4d66-8c90-276c3d7fa638",
    expected_concept: "oral_ulcer",
  },
  {
    reason: "Link approved manual CTA/end-screen visual into the final CTA manifest row.",
    requirement_id: "req_d1ada2e6_2bb8f5fc_cta_branding_infographic",
    render_manifest_id: "2bb8f5fc-174e-4e93-8242-29566738e3ee",
    timeline_item_id: "81ffcab0-2e0e-47a6-b728-0ac4be004f8c",
    asset_id: "01c03e81-859b-4988-a273-da5b17c7b853",
    expected_concept: "cta_branding",
  },
];

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

function textForAsset(asset) {
  const meta = plainObject(asset?.metadata);
  const candidateData = plainObject(meta.candidate_data ?? meta.original_candidate_data);
  const intent = plainObject(meta.intent ?? candidateData.intent);
  return [
    asset?.title,
    asset?.description,
    asset?.asset_type,
    meta.visual_concept,
    meta.mapped_visual_intent,
    meta.search_query,
    candidateData.search_query,
    candidateData.title,
    candidateData.description,
    intent.visual_goal,
    intent.expected_visual,
    intent.original_instruction,
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

function redactUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}${parsed.search ? "?[redacted]" : ""}`;
  } catch {
    return url.startsWith("data:") ? "data:[redacted]" : url;
  }
}

loadEnv(path.resolve(".env"));
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase URL or service role key.");

const apply = process.env.PHASE2FG_APPLY_REPAIRS === "1";
const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const applied = [];

for (const repair of REPAIRS) {
  const [{ data: asset, error: assetError }, { data: manifest, error: manifestError }, { data: timeline, error: timelineError }] = await Promise.all([
    sb.from("assets").select("*").eq("id", repair.asset_id).eq("project_id", PROJECT_ID).maybeSingle(),
    sb.from("render_manifest").select("*").eq("id", repair.render_manifest_id).eq("project_id", PROJECT_ID).maybeSingle(),
    sb.from("timeline_items").select("*").eq("id", repair.timeline_item_id).eq("project_id", PROJECT_ID).maybeSingle(),
  ]);
  if (assetError) throw new Error(`Asset ${repair.asset_id}: ${assetError.message}`);
  if (manifestError) throw new Error(`Manifest ${repair.render_manifest_id}: ${manifestError.message}`);
  if (timelineError) throw new Error(`Timeline ${repair.timeline_item_id}: ${timelineError.message}`);
  if (!asset) throw new Error(`Asset ${repair.asset_id} not found.`);
  if (!manifest) throw new Error(`Render manifest row ${repair.render_manifest_id} not found.`);
  if (!timeline) throw new Error(`Timeline item ${repair.timeline_item_id} not found.`);
  if (!["approved", "locked", "render_ready"].includes(String(asset.status))) throw new Error(`Asset ${asset.id} is not approved.`);
  const sourceUrl = sourceUrlForAsset(asset);
  if (!sourceUrl) throw new Error(`Asset ${asset.id} has no renderable URL.`);
  const actualConcept = conceptForText(textForAsset(asset));
  if (actualConcept !== repair.expected_concept) {
    throw new Error(`Asset ${asset.id} concept ${actualConcept} does not match expected ${repair.expected_concept}.`);
  }

  const timelineMetadata = {
    ...plainObject(timeline.metadata),
    phase2fg_repair: {
      requirement_id: repair.requirement_id,
      render_manifest_id: repair.render_manifest_id,
      asset_id: repair.asset_id,
      reason: repair.reason,
      repaired_at: new Date().toISOString(),
    },
  };
  const manifestPatch = {
    asset_id: repair.asset_id,
    asset_url: sourceUrl,
    asset_source: "approved_asset",
    status: "ready",
  };
  const timelinePatch = {
    asset_id: repair.asset_id,
    metadata: timelineMetadata,
  };

  if (apply) {
    const { error: manifestUpdateError } = await sb.from("render_manifest").update(manifestPatch).eq("id", repair.render_manifest_id);
    if (manifestUpdateError) throw new Error(`Manifest update ${repair.render_manifest_id}: ${manifestUpdateError.message}`);
    const { error: timelineUpdateError } = await sb.from("timeline_items").update(timelinePatch).eq("id", repair.timeline_item_id);
    if (timelineUpdateError) throw new Error(`Timeline update ${repair.timeline_item_id}: ${timelineUpdateError.message}`);
  }

  applied.push({
    requirement_id: repair.requirement_id,
    render_manifest_id: repair.render_manifest_id,
    timeline_item_id: repair.timeline_item_id,
    asset_id: repair.asset_id,
    asset_title: asset.title,
    asset_type: asset.asset_type,
    source_type: asset.source_type ?? asset.source ?? null,
    concept: actualConcept,
    action: apply ? "applied" : "dry_run",
    source_url_redacted: redactUrl(sourceUrl),
    reason: repair.reason,
  });
}

const result = {
  project_id: PROJECT_ID,
  applied_at: new Date().toISOString(),
  applied: apply,
  repairs: applied,
  unresolved_by_design: [
    {
      requirement_id: "req_6de0d3b1_337fec7e_oral_examination_text_overlay",
      reason: "No matching approved renderable asset exists; leave blocked for human review/upload/generation.",
    },
  ],
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "safe_repair_applied.json"), JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify(result, null, 2));
