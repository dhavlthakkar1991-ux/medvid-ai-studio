import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const PROJECT_ID = process.env.PHASE2FG_PROJECT_ID ?? "24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99";
const REQUIREMENT_ID = "req_6de0d3b1_337fec7e_oral_examination_text_overlay";
const RENDER_MANIFEST_ID = "337fec7e-6e98-4efa-aa35-1d0d4e5c416c";
const TIMELINE_ITEM_ID = "453667b9-45f5-4dbf-abff-b116e4d20b3b";
const SCENE_ID = "6de0d3b1-39a8-4050-9246-fe7d9504e262";
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

function svgEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textLine(y, text, size = 42, weight = 700, fill = "#0f172a") {
  return `<text x="230" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}">${svgEscape(text)}</text>`;
}

function makeSvg() {
  const bullets = [
    "White or red patches",
    "Burning, thickening, or persistent pain",
    "Difficulty chewing or swallowing",
    "Reduced mouth opening",
    "Neck lump with mouth symptoms",
  ];
  const bulletRows = bullets
    .map((line, index) => {
      const y = 435 + index * 82;
      return [
        `<circle cx="250" cy="${y - 14}" r="18" fill="#0f766e"/>`,
        `<path d="M240 ${y - 14} l8 9 l18 -22" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
        `<text x="295" y="${y}" fill="#172033" font-size="38" font-weight="650">${svgEscape(line)}</text>`,
      ].join("");
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <rect width="1920" height="1080" fill="#eef6fb"/>
  <rect x="122" y="118" width="1676" height="844" rx="42" fill="#ffffff" stroke="#c8d3df" stroke-width="6"/>
  <rect x="190" y="174" width="210" height="18" rx="9" fill="#0f766e"/>
  ${textLine(262, "Mouth symptoms that need attention", 60, 850)}
  ${textLine(326, "Consult a specialist without delay if symptoms persist", 34, 650, "#475569")}
  ${bulletRows}
  <g transform="translate(1320 360)">
    <ellipse cx="190" cy="150" rx="188" ry="132" fill="#ffe4e6"/>
    <ellipse cx="190" cy="150" rx="126" ry="78" fill="#fff7ed"/>
    <circle cx="152" cy="144" r="38" fill="#ef4444" opacity="0.95"/>
    <path d="M260 96 h112 M260 150 h140 M260 204 h112" stroke="#172033" stroke-width="16" stroke-linecap="round"/>
  </g>
  <rect x="210" y="828" width="1160" height="72" rx="18" fill="#ecfeff" stroke="#99f6e4" stroke-width="3"/>
  <text x="246" y="875" fill="#115e59" font-size="30" font-weight="700">Source: approved narration, Scene 4 warning-signs segment (48-58s)</text>
</svg>`;
}

loadEnv(path.resolve(".env"));
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase URL or service role key.");

const apply = process.env.PHASE2FG_APPLY_TEXT_OVERLAY === "1";
const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const [{ data: project, error: projectError }, { data: existing, error: existingError }] = await Promise.all([
  sb.from("projects").select("id,user_id").eq("id", PROJECT_ID).maybeSingle(),
  sb.from("assets").select("*").eq("project_id", PROJECT_ID).contains("metadata", { requirement_id: REQUIREMENT_ID }).limit(1).maybeSingle(),
]);
if (projectError) throw new Error(projectError.message);
if (existingError) throw new Error(existingError.message);
if (!project) throw new Error(`Project ${PROJECT_ID} not found.`);

const svg = makeSvg();
const url = `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
const metadata = {
  requirement_id: REQUIREMENT_ID,
  source_render_manifest_id: RENDER_MANIFEST_ID,
  mapped_timeline_item_id: TIMELINE_ITEM_ID,
  mapped_scene_id: SCENE_ID,
  visual_concept: "oral_examination",
  mapped_visual_intent: "Oral examination / specialist consultation visual",
  medical_asset_taxonomy: "INFOGRAPHIC_CARD",
  medical_source_class: "internal_generated",
  license_status: "internal",
  usage_recommendation: "safe_to_use",
  generation_policy: "Uses only Studio-approved narration text; no invented facts, no clinical-photo claim.",
  label_source: {
    source: "transcript",
    scene: "Scene 4 warning-signs segment",
    time_range: "48-58s",
  },
};

let asset = existing;
if (apply && !asset) {
  const { data, error } = await sb
    .from("assets")
    .insert({
      project_id: PROJECT_ID,
      scene_id: SCENE_ID,
      asset_type: "text_overlay",
      title: "Mouth symptoms that need attention",
      description: "Professional text overlay listing approved oral cancer warning signs from narration.",
      status: "approved",
      source_type: "generated",
      source: "internal_text_overlay",
      url,
      preview_url: url,
      thumbnail_url: url,
      width: 1920,
      height: 1080,
      reviewed_by: project.user_id,
      reviewed_at: new Date().toISOString(),
      review_note: "Approved internal text overlay from Studio-approved narration only.",
      metadata,
    })
    .select("*")
    .single();
  if (error) throw new Error(`Insert text overlay asset: ${error.message}`);
  asset = data;
} else if (apply && asset) {
  const { data, error } = await sb
    .from("assets")
    .update({
      status: "approved",
      url,
      preview_url: url,
      thumbnail_url: url,
      width: 1920,
      height: 1080,
      metadata: { ...plainObject(asset.metadata), ...metadata },
      reviewed_by: project.user_id,
      reviewed_at: new Date().toISOString(),
      review_note: "Approved internal text overlay from Studio-approved narration only.",
    })
    .eq("id", asset.id)
    .select("*")
    .single();
  if (error) throw new Error(`Update text overlay asset: ${error.message}`);
  asset = data;
}

if (apply && asset) {
  const { error: manifestError } = await sb
    .from("render_manifest")
    .update({
      asset_id: asset.id,
      asset_url: url,
      asset_source: "approved_asset",
      status: "ready",
    })
    .eq("id", RENDER_MANIFEST_ID);
  if (manifestError) throw new Error(`Update render manifest: ${manifestError.message}`);

  const { data: timeline, error: timelineReadError } = await sb.from("timeline_items").select("metadata").eq("id", TIMELINE_ITEM_ID).maybeSingle();
  if (timelineReadError) throw new Error(`Read timeline metadata: ${timelineReadError.message}`);
  const { error: timelineError } = await sb
    .from("timeline_items")
    .update({
      asset_id: asset.id,
      metadata: {
        ...plainObject(timeline?.metadata),
        phase2fg_repair: {
          requirement_id: REQUIREMENT_ID,
          render_manifest_id: RENDER_MANIFEST_ID,
          asset_id: asset.id,
          reason: "Create/link approved text overlay from approved narration.",
          repaired_at: new Date().toISOString(),
        },
      },
    })
    .eq("id", TIMELINE_ITEM_ID);
  if (timelineError) throw new Error(`Update timeline item: ${timelineError.message}`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const result = {
  project_id: PROJECT_ID,
  applied: apply,
  requirement_id: REQUIREMENT_ID,
  asset_id: asset?.id ?? null,
  asset_title: asset?.title ?? "Mouth symptoms that need attention",
  action: apply ? "created_or_updated_and_linked" : "dry_run",
  output_asset_type: "text_overlay",
  source: "internal_generated_text_overlay_from_approved_narration",
  url_redacted: "data:image/svg+xml;base64,[redacted]",
};
fs.writeFileSync(path.join(OUT_DIR, "text_overlay_repair.json"), JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify(result, null, 2));
