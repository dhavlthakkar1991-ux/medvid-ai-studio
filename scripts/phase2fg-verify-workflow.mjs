import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const PROJECT_ID = process.env.PHASE2FG_PROJECT_ID ?? "24c46f1f-fb5e-4aad-bdb6-ad61a7f2ca99";
const OUT_DIR = process.env.PHASE2FG_OUT_DIR ?? path.join("data", "review-artifacts", PROJECT_ID, "phase-2fg-g1");

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

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function redactUrl(value) {
  if (typeof value !== "string" || !value) return value ?? null;
  if (value.startsWith("data:")) return "[inline data URI redacted]";
  try {
    const url = new URL(value);
    if (url.searchParams.has("token")) url.searchParams.set("token", "[redacted]");
    if (url.searchParams.has("apikey")) url.searchParams.set("apikey", "[redacted]");
    if (url.searchParams.has("signature")) url.searchParams.set("signature", "[redacted]");
    return url.toString();
  } catch {
    return value.replace(/([?&](?:token|apikey|signature)=)[^&]+/gi, "$1[redacted]");
  }
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

const NON_PROFESSIONAL_PROVENANCE_PATTERN = /(?:placeholder|cartoon|internal[\s_-]*(?:template|svg[\s_-]*library))/;

function sourceClassForAsset(asset) {
  const metadata = plainObject(asset?.metadata);
  const source = String(asset?.source ?? asset?.source_type ?? metadata.source ?? metadata.source_type ?? "").toLowerCase();
  if (!asset || (!asset.url && !asset.preview_url && !asset.thumbnail_url && !metadata.source_url && !metadata.url)) return "placeholder";
  if (source.includes("manual_upload") || source === "upload") return "manual_upload";
  if (source.includes("manual_url") || source === "manual") return "manual_url";
  if (source.includes("curated")) return "curated_library";
  if (source.includes("codex") || source.includes("generated") || source.includes("internal")) return "codex_generated_asset";
  return "manual_url";
}

function assetProfessionalRisk(asset, requiredType, hasUsableUrl, taxonomyValue = null) {
  if (!asset) return { blocks: true, reason: "No approved asset is mapped." };
  if (!hasUsableUrl) return { blocks: true, reason: "Mapped asset does not have a reachable media URL." };

  const metadata = plainObject(asset.metadata);
  const original = plainObject(metadata.original_candidate_data);
  const originalMetadata = plainObject(original.metadata);
  const sourceClass = sourceClassForAsset(asset);
  const directProvenance = textSignature(
    asset.status,
    metadata.classification,
    metadata.medical_source_class,
    metadata.source,
    metadata.source_type,
    sourceClass,
  );
  const originalProvenance = textSignature(
    original.provider,
    original.source_type,
    original.source,
    plainObject(original.license).type,
    plainObject(original.license).license_status,
    originalMetadata.medical_source_class,
    originalMetadata.classification,
    plainObject(originalMetadata.license).type,
    plainObject(plainObject(originalMetadata.original_asset).metadata).classification,
  );
  const qualityScore = numberOrNull(metadata.quality_score ?? asset.quality_score ?? original.quality_score ?? plainObject(original.worker_score).overall_asset_score);
  const requiredProfessionalAsset = [
    "clinical_image",
    "medical_diagram",
    "infographic",
    "infographic_or_diagram",
    "cta_branding",
  ].includes(String(requiredType)) ||
    ["CLINICAL_IMAGE", "MEDICAL_ILLUSTRATION", "INFOGRAPHIC_CARD"].includes(String(taxonomyValue ?? metadata.medical_asset_taxonomy ?? metadata.taxonomy ?? "").toUpperCase());

  if (/approved_placeholder|needs_asset|placeholder_plan|placeholder_do_not_render/.test(directProvenance)) {
    return { blocks: true, reason: "Mapped asset is still marked as a placeholder/planning asset." };
  }
  if (requiredProfessionalAsset && NON_PROFESSIONAL_PROVENANCE_PATTERN.test(directProvenance)) {
    return { blocks: true, reason: "Mapped required asset is an internal/template-generated substitute, not a professional final asset." };
  }
  if (requiredProfessionalAsset && sourceClass.includes("upload") && NON_PROFESSIONAL_PROVENANCE_PATTERN.test(originalProvenance) && qualityScore !== null && qualityScore < 75) {
    return { blocks: true, reason: `Mapped manual upload still carries low-quality internal/template provenance (quality ${qualityScore}).` };
  }
  if (requiredProfessionalAsset && qualityScore !== null && qualityScore < 60) {
    return { blocks: true, reason: `Mapped required asset quality score is too low for professional readiness (${qualityScore}).` };
  }
  return { blocks: false, reason: null };
}

function normalizedWords(value) {
  return new Set(
    String(value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3),
  );
}

function wordOverlapScore(a, b) {
  const left = normalizedWords(a);
  const right = normalizedWords(b);
  if (left.size === 0 || right.size === 0) return 0;
  let hits = 0;
  for (const word of left) if (right.has(word)) hits += 1;
  return hits / Math.max(1, Math.min(left.size, right.size));
}

function textSignature(...values) {
  return values
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ")
    .replace(/[_-]+/g, " ");
}

function visualConceptForText(text) {
  const t = String(text ?? "").toLowerCase();
  if (/biopsy|punch biopsy|tissue sample|pathology|specimen/.test(t)) return { key: "biopsy_workflow", label: "Biopsy / tissue sample workflow visual" };
  if (/leukoplakia|erythroplakia|white patches?|red patches?/.test(t)) return { key: "leukoplakia_erythroplakia", label: "Leukoplakia / erythroplakia comparison visual" };
  if (/ulcer|non healing|non-healing|mouth sore|oral lesion/.test(t)) return { key: "oral_ulcer", label: "Non-healing oral ulcer clinical visual" };
  if (/lymph|neck lump|neck node|cervical node|swelling/.test(t)) return { key: "cervical_lymph_node", label: "Cervical lymph node anatomy visual" };
  if (/early detection|detected at an early stage|treatment[^.]{0,40}effective|outcomes[^.]{0,40}better|comparison infographic/.test(t)) return { key: "early_detection", label: "Early detection patient-education visual" };
  if (/oral exam|examination|examining|screening|mouth opening|consult specialist|consultation/.test(t)) return { key: "oral_examination", label: "Oral examination / specialist consultation visual" };
  if (/india|prevalence|common cancers|map/.test(t)) return { key: "india_prevalence", label: "India prevalence map/stat visual" };
  if (/tobacco|gutkha|mawa|smoking|chewing tobacco/.test(t)) return { key: "tobacco_gutkha_risk", label: "Tobacco / gutkha risk visual" };
  if (/alcohol|risk factor/.test(t)) return { key: "risk_factor_infographic", label: "Risk factor infographic" };
  if (/share|family|friends|cta|early diagnosis|save lives|contact/.test(t)) return { key: "cta_branding", label: "CTA branding/contact polish" };
  if (/lower third|surgical oncologist|doctor intro|credentials/.test(t)) return { key: "doctor_lower_third", label: "Doctor lower-third / intro graphic" };
  if (/broll|b-roll|clinic|consultation|hospital|patient/.test(t)) return { key: "contextual_broll", label: "Contextual medical B-roll" };
  const words = Array.from(normalizedWords(t)).slice(0, 5).join("_");
  return { key: words || "medical_visual", label: "Medical visual asset" };
}

function refineConceptWithNarration(concept, narration) {
  const narrationConcept = visualConceptForText(narration);
  if (
    concept?.key === "oral_examination" &&
    narrationConcept.key === "leukoplakia_erythroplakia"
  ) {
    return narrationConcept;
  }
  return concept;
}

function normalizedAssetType(value, text = "") {
  const source = `${String(value ?? "")} ${text}`.toLowerCase();
  if (source.includes("presenter")) return "presenter_video";
  if (source.includes("caption")) return "caption";
  if (source.includes("lower_third") || source.includes("lower third") || source.includes("credentials")) return "lower_third";
  if (source.includes("cta") || source.includes("contact") || source.includes("share") || source.includes("end card")) return source.includes("end card") ? "end_card" : "cta_branding";
  if (source.includes("broll") || source.includes("b-roll") || source.includes("contextual")) return "contextual_broll";
  if (source.includes("clinical") || source.includes("ulcer") || source.includes("leukoplakia") || source.includes("erythroplakia")) return "clinical_image";
  if (source.includes("medical illustration") || source.includes("diagram") || source.includes("anatomy") || source.includes("lymph") || source.includes("node") || source.includes("biopsy")) return "medical_diagram";
  if (source.includes("text_overlay") || source.includes("text overlay")) return "text_overlay";
  if (source.includes("callout")) return "callout";
  if (source.includes("infographic") || source.includes("workflow") || source.includes("prevalence") || source.includes("risk")) return "infographic";
  return "infographic";
}

function isInlineRenderableGraphicRow(row, requiredType) {
  const signature = textSignature(row.asset_type, row.asset_source, row.action_type, row.layout_name);
  const type = String(requiredType ?? "");
  if (["lower_third", "text_overlay", "callout", "cta_branding", "end_card"].includes(type)) return true;
  return /compiled graphic|show lower third|show text overlay|show callout|show cta|kinetic typography|highlight keyword|full screen cta/.test(signature);
}

function parseSupabaseStorageUrl(value) {
  if (!value || typeof value !== "string" || !value.includes("/storage/v1/object/")) return null;
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const objectIndex = parts.findIndex((part, index) => part === "object" && parts[index + 1] === "sign");
    if (objectIndex < 0) return null;
    const bucket = parts[objectIndex + 2];
    const objectPath = parts.slice(objectIndex + 3).map((part) => decodeURIComponent(part)).join("/");
    return bucket && objectPath ? { bucket, path: objectPath } : null;
  } catch {
    return null;
  }
}

async function sourceUrlForAsset(asset, sb) {
  const meta = plainObject(asset?.metadata);
  const upload = plainObject(meta.upload);
  const storagePath = firstString(meta.storage_path, meta.storagePath, upload.path);
  const storageBucket = firstString(meta.storage_bucket, meta.storageBucket, upload.bucket, "videos");
  if (storagePath && storageBucket) {
    const { data, error } = await sb.storage.from(storageBucket).createSignedUrl(storagePath, 60 * 60 * 12);
    if (!error && data?.signedUrl) return data.signedUrl;
  }
  const storedUrl = firstString(asset?.url, asset?.preview_url, asset?.thumbnail_url, meta.url, meta.source_url, meta.preview_url, meta.thumbnail_url);
  const parsed = parseSupabaseStorageUrl(storedUrl);
  if (parsed) {
    const { data, error } = await sb.storage.from(parsed.bucket).createSignedUrl(parsed.path, 60 * 60 * 12);
    if (!error && data?.signedUrl) return data.signedUrl;
  }
  return storedUrl;
}

async function probeMediaUrl(value) {
  if (!value) return { ok: false, kind: "missing", status: null, content_type: null, reason: "missing URL" };
  if (String(value).startsWith("data:")) return { ok: true, kind: "data_uri", status: 200, content_type: String(value).slice(5, String(value).indexOf(";")) || null, reason: null };
  try {
    const response = await fetch(value, { headers: { Range: "bytes=0-0" } });
    await response.body?.cancel?.();
    const contentType = response.headers.get("content-type");
    const ok = response.ok || response.status === 206;
    return {
      ok: ok && !String(contentType ?? "").includes("application/json"),
      kind: "http",
      status: response.status,
      content_type: contentType,
      reason: ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    return { ok: false, kind: "http", status: null, content_type: null, reason: error instanceof Error ? error.message : String(error) };
  }
}

function assetText(asset) {
  const meta = plainObject(asset?.metadata);
  const candidateData = plainObject(meta.candidate_data);
  return textSignature(
    asset?.title,
    asset?.description,
    asset?.asset_type,
    asset?.search_query,
    meta.visual_concept,
    meta.mapped_visual_intent,
    meta.search_query,
    candidateData.search_query,
    candidateData.title,
    candidateData.description,
  );
}

function assetVisibleText(asset) {
  const meta = plainObject(asset?.metadata);
  const candidateData = plainObject(meta.candidate_data);
  return textSignature(
    asset?.title,
    asset?.description,
    asset?.asset_type,
    asset?.search_query,
    meta.search_query,
    candidateData.search_query,
    candidateData.title,
    candidateData.description,
  );
}

function isCompatibleWarningSignsTextOverlay(asset, conceptKey, requiredType) {
  if (conceptKey !== "leukoplakia_erythroplakia" || requiredType !== "text_overlay") return false;
  const meta = plainObject(asset?.metadata);
  const signature = textSignature(assetVisibleText(asset), meta.source_domain, meta.license_status, meta.usage_recommendation);
  return (
    String(asset?.asset_type ?? "").toLowerCase() === "text_overlay" &&
    /warning signs?|checklist|white patches?|red patches?/.test(signature) &&
    /studio owned|studio curated|safe to use/.test(signature)
  );
}

function isSpecificConcept(key) {
  return [
    "biopsy_workflow",
    "leukoplakia_erythroplakia",
    "oral_ulcer",
    "cervical_lymph_node",
    "oral_examination",
    "early_detection",
    "india_prevalence",
    "tobacco_gutkha_risk",
    "risk_factor_infographic",
    "cta_branding",
    "doctor_lower_third",
  ].includes(key);
}

function rowText(row, scene, editAction, storyboard) {
  return textSignature(
    row?.asset_query,
    row?.asset_type,
    row?.action_type,
    row?.layout_name,
    row?.rationale,
    scene?.title,
    editAction?.asset_query,
    editAction?.action_type,
    storyboard?.asset_prompt,
    storyboard?.visual_description,
  );
}

function requirementPrompt(row) {
  return [
    "Create or select a professional medical education visual.",
    `Required visual: ${row.visual_intent}.`,
    row.narration_excerpt ? `Narration context: "${row.narration_excerpt}".` : null,
    `Asset type: ${row.required_asset_type}.`,
    row.layout_name ? `Layout target: ${row.layout_name}.` : null,
    row.time_range ? `Visible during ${row.time_range.start}-${row.time_range.end}s.` : null,
    "Use only Studio-approved facts from transcript/storyboard/editorial decisions.",
    "No fake statistics, no fake labels, no watermark, no cartoon substitute for clinical/anatomy requirements.",
  ].filter(Boolean).join(" ");
}

function findBuiltChunk(prefix) {
  const dir = path.join(process.cwd(), "dist", "server", "assets");
  if (!fs.existsSync(dir)) return null;
  const file = fs.readdirSync(dir).find((name) => name.startsWith(prefix) && name.endsWith(".js"));
  return file ? path.join(dir, file) : null;
}

async function maybeBuildRenderSpec(sb, projectId) {
  const builderChunk = findBuiltChunk("render-spec-builder.server-");
  const validationChunk = findBuiltChunk("render-validation-");
  if (!builderChunk || !validationChunk) {
    return { spec: null, validation: null, reason: "Build chunks not found. Run npm.cmd run build first." };
  }
  const { buildRenderSpec } = await import(pathToFileURL(builderChunk).href);
  const { validateRenderSpec } = await import(pathToFileURL(validationChunk).href);
  const spec = await buildRenderSpec(sb, projectId, { quality: "preview" });
  return { spec, validation: validateRenderSpec(spec), reason: null };
}

loadEnv(path.resolve(".env"));

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");

const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const [
  projectRes,
  scenesRes,
  manifestRes,
  timelineRes,
  storyboardRes,
  actionsRes,
  candidatesRes,
  assetsRes,
  transcriptRes,
] = await Promise.all([
  sb.from("projects").select("*").eq("id", PROJECT_ID).maybeSingle(),
  sb.from("scenes").select("*").eq("project_id", PROJECT_ID),
  sb.from("render_manifest").select("*").eq("project_id", PROJECT_ID).order("timeline_start", { ascending: true }),
  sb.from("timeline_items").select("*").eq("project_id", PROJECT_ID).order("start_time", { ascending: true }),
  sb.from("storyboard_items").select("*").eq("project_id", PROJECT_ID).order("item_index", { ascending: true }),
  sb.from("edit_actions").select("*").eq("project_id", PROJECT_ID),
  sb.from("asset_candidates").select("*").eq("project_id", PROJECT_ID),
  sb.from("assets").select("*").eq("project_id", PROJECT_ID),
  sb.from("transcript_segments").select("*").eq("project_id", PROJECT_ID).order("start_time", { ascending: true }),
]);

for (const [name, res] of Object.entries({ projectRes, scenesRes, manifestRes, timelineRes, storyboardRes, actionsRes, candidatesRes, assetsRes, transcriptRes })) {
  if (res.error) throw new Error(`${name}: ${res.error.message}`);
}
if (!projectRes.data) throw new Error(`Project ${PROJECT_ID} not found.`);

const scenes = scenesRes.data ?? [];
const manifest = manifestRes.data ?? [];
const timeline = timelineRes.data ?? [];
const storyboard = storyboardRes.data ?? [];
const actions = actionsRes.data ?? [];
const candidates = candidatesRes.data ?? [];
const assets = assetsRes.data ?? [];
const transcript = transcriptRes.data ?? [];

const sceneById = new Map(scenes.map((row) => [String(row.id), row]));
const assetById = new Map(assets.map((row) => [String(row.id), row]));
const actionById = new Map(actions.map((row) => [String(row.id), row]));
const storyboardById = new Map(storyboard.map((row) => [String(row.id), row]));
const timelineByAction = new Map(timeline.filter((row) => row.edit_action_id).map((row) => [String(row.edit_action_id), row]));
const timelineByManifestTime = (row) => timeline.find((item) => {
  const sameAction = row.edit_action_id && item.edit_action_id && String(row.edit_action_id) === String(item.edit_action_id);
  const sameStoryboard = row.storyboard_item_id && item.metadata?.storyboard_item_id && String(row.storyboard_item_id) === String(item.metadata.storyboard_item_id);
  const sameTime = Math.abs(Number(item.start_time ?? 0) - Number(row.timeline_start ?? 0)) < 0.1 && Math.abs(Number(item.end_time ?? 0) - Number(row.timeline_end ?? 0)) < 0.1;
  return sameAction || sameStoryboard || (sameTime && String(item.asset_type ?? "") === String(row.asset_type ?? ""));
}) ?? null;

const renderSpecResult = await maybeBuildRenderSpec(sb, PROJECT_ID).catch((error) => ({
  spec: null,
  validation: null,
  reason: error instanceof Error ? error.message : String(error),
}));
const specItemsByManifest = new Map();
const specItemsByTimeline = new Map();
const specItemsByAsset = new Map();
if (renderSpecResult.spec?.items) {
  for (const item of renderSpecResult.spec.items) {
    const manifestId = item.source_render_manifest_id ?? item.meta?.source_render_manifest_id ?? item.id;
    if (manifestId) specItemsByManifest.set(String(manifestId), item);
    const timelineId = item.source_timeline_item_id ?? item.meta?.source_timeline_item_id;
    if (timelineId) specItemsByTimeline.set(String(timelineId), item);
    if (item.asset_id) {
      const key = `${item.asset_id}:${Number(item.start_time ?? item.start ?? 0).toFixed(2)}:${Number(item.end_time ?? item.end ?? 0).toFixed(2)}`;
      specItemsByAsset.set(key, item);
    }
  }
}
const specAssetsById = new Map();
if (renderSpecResult.spec?.assets) {
  for (const asset of renderSpecResult.spec.assets) {
    if (asset?.id) specAssetsById.set(String(asset.id), asset);
  }
}

function expectedSpecAssetId(row) {
  if (row?.asset_type === "presenter_video") return "source:presenter";
  if (row?.asset_id) return `asset:${row.asset_id}`;
  if (row?.compiled_graphic_id) return `graphic:${row.compiled_graphic_id}`;
  if (row?.asset_url) return `url:${row.id}`;
  return null;
}

function specItemForRequirement(row, timelineItem, start, end) {
  const byManifest = specItemsByManifest.get(String(row.id));
  if (byManifest) return byManifest;
  const timelineId = timelineItem?.id ?? row.timeline_item_id ?? row.metadata?.source_timeline_item_id;
  if (timelineId && specItemsByTimeline.has(String(timelineId))) return specItemsByTimeline.get(String(timelineId));
  const assetId = expectedSpecAssetId(row);
  if (assetId) {
    const exact = specItemsByAsset.get(`${assetId}:${Number(start).toFixed(2)}:${Number(end).toFixed(2)}`);
    if (exact) return exact;
    return (renderSpecResult.spec?.items ?? []).find((item) => {
      if (item.asset_id !== assetId) return false;
      const itemStart = Number(item.start_time ?? item.start ?? 0);
      const itemEnd = Number(item.end_time ?? item.end ?? itemStart);
      return Math.abs(itemStart - start) < 0.15 && Math.abs(itemEnd - end) < 0.15;
    }) ?? null;
  }
  return null;
}

const canonical = [];
const mismatchReport = [];
const timelineFitReport = [];
const generationPrompts = [];
const singleAssetAudit = [];

for (const row of manifest) {
  const scene = row.scene_id ? sceneById.get(String(row.scene_id)) : null;
  const action = row.edit_action_id ? actionById.get(String(row.edit_action_id)) : null;
  const story = row.storyboard_item_id ? storyboardById.get(String(row.storyboard_item_id)) : null;
  const tItem = (row.edit_action_id ? timelineByAction.get(String(row.edit_action_id)) : null) ?? timelineByManifestTime(row);
  const start = numberOrNull(row.timeline_start) ?? numberOrNull(tItem?.start_time) ?? 0;
  const end = numberOrNull(row.timeline_end) ?? numberOrNull(tItem?.end_time) ?? start;
  const narration = transcript
    .filter((seg) => Number(seg.end_time ?? seg.start_time ?? 0) >= start && Number(seg.start_time ?? 0) <= end)
    .map((seg) => seg.text ?? seg.content ?? "")
    .filter(Boolean)
    .join(" ")
    .slice(0, 360);
  const intentText = rowText(row, scene, action, story);
  const concept = refineConceptWithNarration(visualConceptForText(intentText), narration);
  const requiredType = normalizedAssetType(row.asset_type, intentText);
  const requiredOrOptional = concept.key === "contextual_broll" || concept.key === "doctor_lower_third" ? "optional" : "required";
  const asset = row.asset_id ? assetById.get(String(row.asset_id)) : null;
  const assetConcept = asset ? visualConceptForText(assetText(asset)) : null;
  const visibleAssetConcept = asset ? visualConceptForText(assetVisibleText(asset)) : null;
  const sourceUrl = await sourceUrlForAsset(asset, sb);
  const sourceUrlProbe = await probeMediaUrl(sourceUrl);
  const explicitAsset = Boolean(asset && row.asset_id && String(row.asset_id) === String(asset.id));
  const intentOverlap = asset ? wordOverlapScore(intentText, assetText(asset)) : 0;
  const approvedStatus = asset ? ["approved", "locked", "render_ready"].includes(String(asset.status)) : false;
  const hasUrl = Boolean(sourceUrl);
  const hasUsableUrl = hasUrl && sourceUrlProbe.ok;
  const professionalRisk = assetProfessionalRisk(asset, requiredType, hasUsableUrl, asset?.metadata?.medical_asset_taxonomy ?? asset?.metadata?.taxonomy);
  const compatibleWarningSignsTextOverlay = asset ? isCompatibleWarningSignsTextOverlay(asset, concept.key, requiredType) : false;
  const visibleConceptMismatch = Boolean(visibleAssetConcept && concept.key !== visibleAssetConcept.key && isSpecificConcept(visibleAssetConcept.key) && !compatibleWarningSignsTextOverlay);
  const conceptMismatch = Boolean(assetConcept && concept.key !== assetConcept.key && !compatibleWarningSignsTextOverlay && (intentOverlap < 0.28 || visibleConceptMismatch));
  const presenterResolved = requiredType === "presenter_video" && Boolean(projectRes.data.video_path) && Boolean(renderSpecResult.spec?.assets?.some((candidate) => candidate.id === "source:presenter" && candidate.source_url));
  const specItem = specItemForRequirement(row, tItem, start, end);
  const specAsset = specItem?.asset_id ? specAssetsById.get(String(specItem.asset_id)) : null;
  const inlineGraphicResolved = Boolean(
    row.compiled_graphic_id &&
    specItem &&
    String(specItem.asset_id) === `graphic:${row.compiled_graphic_id}` &&
    specAsset &&
    isInlineRenderableGraphicRow(row, requiredType) &&
    (specAsset.source_url || specAsset.inline || specAsset.kind === "graphic"),
  );
  const validApproved = Boolean(
    presenterResolved ||
    inlineGraphicResolved ||
    (explicitAsset && approvedStatus && hasUsableUrl && !conceptMismatch && !visibleConceptMismatch && !professionalRisk.blocks),
  );
  const status =
    validApproved ? "resolved" :
    asset && visibleConceptMismatch ? "approved_asset_mismatch" :
    asset && conceptMismatch ? "approved_asset_mismatch" :
    asset && !hasUrl ? "missing_asset_url" :
    asset && !hasUsableUrl ? "unusable_asset_url" :
    asset && professionalRisk.blocks ? "non_professional_asset" :
    "missing_required";
  const notRenderableReason =
    !hasUrl ? "Mapped asset has no media URL." :
    !hasUsableUrl ? `Mapped asset media URL is not reachable (${sourceUrlProbe.reason ?? sourceUrlProbe.status ?? "unknown failure"}).` :
    professionalRisk.reason ?? "Mapped asset is not professional/render-ready.";
  const timelineFit = (() => {
    if (!tItem) return { status: "missing_from_timeline", reason: "No timeline item matched this manifest row." };
    if (end <= start) return { status: "ends_too_early", reason: "Timeline/manifest duration is zero or negative." };
    if (row.layout_name && tItem.layout && String(row.layout_name) !== String(tItem.layout)) {
      return { status: "wrong_layout", reason: `Manifest layout ${row.layout_name} differs from timeline layout ${tItem.layout}.` };
    }
    if (presenterResolved) return { status: "renderspec_ok", reason: "Presenter is supplied by project.video_path and RenderSpec source:presenter." };
    if (inlineGraphicResolved) return { status: "renderspec_ok", reason: "Inline compiled graphic is present in RenderSpec and renderable by the worker." };
    if (!row.asset_id) return { status: "missing_asset", reason: "Manifest does not point to an approved asset." };
    if (!validApproved) return { status: "wrong_asset_mapped", reason: visibleConceptMismatch ? `Mapped asset visible content is ${visibleAssetConcept?.label}, not ${concept.label}.` : conceptMismatch ? `Mapped asset is ${assetConcept?.label}, not ${concept.label}.` : notRenderableReason };
    if (!specItem) return { status: "missing_from_renderspec", reason: "No RenderSpec item found for this manifest row." };
    return { status: "renderspec_ok", reason: "Timeline, manifest, approved asset, and RenderSpec item align." };
  })();
  const requirement = {
    requirement_id: `req_${String(row.scene_id ?? "project").slice(0, 8)}_${String(row.id).slice(0, 8)}_${concept.key}_${requiredType}`,
    project_id: PROJECT_ID,
    scene_id: row.scene_id ?? null,
    scene_number: scene?.scene_number ?? null,
    scene_title: scene?.title ?? null,
    timeline_item_id: tItem?.id ?? null,
    storyboard_item_id: row.storyboard_item_id ?? null,
    editorial_action_id: row.edit_action_id ?? null,
    source_render_manifest_id: row.id,
    time_range: { start, end, duration: Math.max(0, end - start) },
    narration_excerpt: narration || null,
    visual_intent: concept.label,
    concept_key: concept.key,
    required_asset_type: requiredType,
    required_or_optional: requiredOrOptional,
    layout_name: row.layout_name ?? tItem?.layout ?? null,
    current_status: status,
    blocking_reason: validApproved ? null : timelineFit.reason,
    suggested_resolution: validApproved ? null : "Upload/replace with a licensed, source-backed asset matching this exact requirement.",
    matched_approved_asset_id: presenterResolved ? "source:presenter" : inlineGraphicResolved ? `graphic:${row.compiled_graphic_id}` : validApproved ? asset?.id ?? null : null,
    source_url_probe: sourceUrlProbe,
    existing_approved_asset: presenterResolved ? {
      id: "source:presenter",
      title: "Presenter/source video",
      asset_type: "presenter_video",
      source_url: "[signed at RenderSpec build time]",
      concept_key: "presenter_video",
    } : inlineGraphicResolved ? {
      id: `graphic:${row.compiled_graphic_id}`,
      title: row.asset_query ?? row.action_type ?? "Compiled graphic",
      asset_type: row.asset_type,
      source_url_present: Boolean(specAsset?.source_url || specAsset?.inline),
      source_url_redacted: specAsset?.source_url ? redactUrl(specAsset.source_url) : "[inline RenderSpec graphic]",
      concept_key: concept.key,
    } : validApproved && asset ? {
      id: asset.id,
      title: asset.title,
      asset_type: asset.asset_type,
      source_url_present: Boolean(sourceUrl),
      source_url_redacted: redactUrl(sourceUrl),
      concept_key: assetConcept?.key ?? null,
    } : null,
    mismatched_asset: !validApproved && asset ? {
      id: asset.id,
      title: asset.title,
      asset_type: asset.asset_type,
      concept_key: assetConcept?.key ?? null,
      visible_concept_key: visibleAssetConcept?.key ?? null,
      reason: visibleConceptMismatch ? `Mapped asset visible content is ${visibleAssetConcept?.label}, not ${concept.label}.` : conceptMismatch ? `Mapped asset is ${assetConcept?.label}, not ${concept.label}.` : timelineFit.reason,
    } : null,
    timeline_fit_status: timelineFit.status,
    timeline_fit_reason: timelineFit.reason,
    present_in_manifest: true,
    present_in_renderspec: Boolean(specItem),
    render_spec_item_id: specItem?.id ?? null,
    candidate_ids: candidates
      .filter((candidate) => {
        const cText = textSignature(candidate.title, candidate.search_query, candidate.description, candidate.asset_type, candidate.candidate_data?.intent?.expected_visual);
        const sameScene = !candidate.scene_id || !row.scene_id || String(candidate.scene_id) === String(row.scene_id);
        return sameScene && (visualConceptForText(cText).key === concept.key || wordOverlapScore(cText, intentText) >= 0.35);
      })
      .map((candidate) => candidate.id)
      .slice(0, 25),
  };
  const prompt = requirementPrompt(requirement);
  requirement.prompt_for_ai_generation = prompt;
  requirement.external_generation_prompt = prompt;
  requirement.negative_prompt = "No cartoon style, no childish illustration, no distorted anatomy, no fake labels, no unrelated dental clinic stock, no watermark, no text errors, no hallucinated statistics.";
  requirement.recommended_dimensions = "1920x1080";
  requirement.recommended_aspect_ratio = "16:9";
  canonical.push(requirement);
  timelineFitReport.push({
    requirement_id: requirement.requirement_id,
    required_or_optional: requirement.required_or_optional,
    timeline_item_id: requirement.timeline_item_id,
    source_render_manifest_id: requirement.source_render_manifest_id,
    start,
    end,
    layout_name: requirement.layout_name,
    status: timelineFit.status,
    reason: timelineFit.reason,
    present_in_manifest: true,
    present_in_renderspec: Boolean(specItem),
    render_spec_item_id: specItem?.id ?? null,
    matched_approved_asset_id: requirement.matched_approved_asset_id,
  });
  if (requirement.mismatched_asset) {
    mismatchReport.push({
      requirement_id: requirement.requirement_id,
      visual_intent: requirement.visual_intent,
      required_asset_type: requirement.required_asset_type,
      scene_title: requirement.scene_title,
      time_range: requirement.time_range,
      mismatched_asset: requirement.mismatched_asset,
      reason: requirement.mismatched_asset.reason,
    });
  }
  generationPrompts.push({
    requirement_id: requirement.requirement_id,
    visual_intent: requirement.visual_intent,
    prompt_for_ai_generation: requirement.prompt_for_ai_generation,
    external_generation_prompt: requirement.external_generation_prompt,
    negative_prompt: requirement.negative_prompt,
  });
  singleAssetAudit.push({
    requirement_id: requirement.requirement_id,
    generate_with_ai_available: true,
    show_prompt_available: true,
    copy_prompt_available: true,
    upload_replace_available: true,
    paste_url_available: true,
    prompt_specific_to_requirement: Boolean(requirement.visual_intent && requirement.time_range && requirement.required_asset_type),
  });
}

canonical.sort((a, b) => {
  const req = Number(b.required_or_optional === "required") - Number(a.required_or_optional === "required");
  if (req) return req;
  const statusRank = { approved_asset_mismatch: 0, non_professional_asset: 1, unusable_asset_url: 2, missing_asset_url: 3, missing_required: 4, resolved: 9 };
  const sr = (statusRank[a.current_status] ?? 4) - (statusRank[b.current_status] ?? 4);
  if (sr) return sr;
  return a.time_range.start - b.time_range.start;
});

const required = canonical.filter((row) => row.required_or_optional === "required");
const optional = canonical.filter((row) => row.required_or_optional === "optional");
const requiredUnresolved = required.filter((row) => row.current_status !== "resolved");
const requiredTimingProblems = timelineFitReport.filter(
  (row) => row.required_or_optional === "required" && !["renderspec_ok", "missing_asset"].includes(row.status),
);
const optionalTimingProblems = timelineFitReport.filter(
  (row) => row.required_or_optional === "optional" && !["renderspec_ok", "missing_asset"].includes(row.status),
);
const renderSpecErrors = renderSpecResult.validation?.issues?.filter((issue) => issue.level === "error") ?? [];
const topBlockers = [
  ...requiredUnresolved.map((row) => ({
    requirement_id: row.requirement_id,
    visual_intent: row.visual_intent,
    status: row.current_status,
    reason: row.blocking_reason,
  })),
  ...mismatchReport.map((row) => ({
    requirement_id: row.requirement_id,
    visual_intent: row.visual_intent,
    status: "approved_asset_mismatch",
    reason: row.reason,
  })),
  ...requiredTimingProblems.map((row) => ({
    requirement_id: row.requirement_id,
    visual_intent: canonical.find((candidate) => candidate.requirement_id === row.requirement_id)?.visual_intent ?? null,
    status: row.status,
    reason: row.reason,
  })),
].slice(0, 10);
const professionalReadinessSummary = {
  project_id: PROJECT_ID,
  generated_at: new Date().toISOString(),
  professional_ready:
    requiredUnresolved.length === 0 &&
    mismatchReport.length === 0 &&
    requiredTimingProblems.length === 0 &&
    renderSpecErrors.length === 0,
  requirements_total: canonical.length,
  required_total: required.length,
  required_resolved: required.length - requiredUnresolved.length,
  required_unresolved: requiredUnresolved.length,
  optional_total: optional.length,
  optional_unresolved: optional.filter((row) => row.current_status !== "resolved").length,
  mismatch_count: mismatchReport.length,
  required_timing_problem_count: requiredTimingProblems.length,
  optional_timing_problem_count: optionalTimingProblems.length,
  timing_problem_count: requiredTimingProblems.length + optionalTimingProblems.length,
  render_spec_valid: renderSpecResult.validation ? renderSpecErrors.length === 0 : null,
  render_spec_errors: renderSpecErrors,
  top_blockers: topBlockers,
};

const triageReport = {
  project_id: PROJECT_ID,
  project_title: projectRes.data.title,
  source_counts: {
    render_manifest: manifest.length,
    timeline_items: timeline.length,
    asset_candidates: candidates.length,
    assets: assets.length,
  },
  deduped_requirements: canonical.length,
  required_count: required.length,
  optional_count: optional.length,
  clinically_meaningful_short_list: canonical.length <= Math.max(30, manifest.length * 2),
  grouping_basis: [
    "scene_id",
    "source_render_manifest_id",
    "timeline_item_id",
    "storyboard_item_id",
    "editorial_action_id",
    "time_range",
    "required_asset_type",
    "visual_concept",
  ],
  professionalReadinessSummary,
};

const humanLoopCompletionReport = {
  project_id: PROJECT_ID,
  actionable_required_first: canonical.slice(0, required.length).every((row) => row.required_or_optional === "required"),
  controls_expected_per_requirement: [
    "Search providers",
    "Generate with AI",
    "Show prompt",
    "Copy prompt",
    "Upload / Replace",
    "Paste URL",
    "Use existing approved asset",
    "Fix timing",
    "Preview at timestamp",
  ],
  unresolved_required: requiredUnresolved.map((row) => ({
    requirement_id: row.requirement_id,
    visual_intent: row.visual_intent,
    status: row.current_status,
    action: row.suggested_resolution,
  })),
  optional_unresolved_do_not_block: optional.filter((row) => row.current_status !== "resolved").map((row) => row.requirement_id),
};

const markdown = [
  "# Asset To-Do List",
  "",
  `Project: ${projectRes.data.title} (${PROJECT_ID})`,
  "",
  `Requirements: ${canonical.length} (${required.length} required, ${optional.length} optional)`,
  `Professional ready: ${professionalReadinessSummary.professional_ready ? "YES" : "NO"}`,
  "",
  ...canonical.map((row) => [
    `## ${row.visual_intent}`,
    `- Requirement: ${row.required_or_optional}`,
    `- Scene/timestamp: Scene ${row.scene_number ?? "-"} ${row.scene_title ?? ""} @ ${row.time_range.start}-${row.time_range.end}s`,
    `- Suggested type: ${row.required_asset_type}`,
    `- Current status: ${row.current_status}`,
    `- Timeline fit: ${row.timeline_fit_status}`,
    `- Blocking reason: ${row.blocking_reason ?? "None"}`,
    `- Existing approved asset: ${row.existing_approved_asset ? `${row.existing_approved_asset.title ?? row.existing_approved_asset.id}` : "None matching"}`,
    `- Narration: ${row.narration_excerpt ?? "No narration mapped"}`,
    `- Prompt: ${row.external_generation_prompt}`,
  ].join("\n")),
].join("\n\n");

const externalPromptsMd = generationPrompts
  .map((row) => `## ${row.visual_intent}\n\n${row.external_generation_prompt}\n\nNegative prompt: ${row.negative_prompt}`)
  .join("\n\n");

const biopsyIndiaInvariant = canonical.filter((row) =>
  row.concept_key === "biopsy_workflow" &&
  row.existing_approved_asset?.concept_key === "india_prevalence"
);

const files = {
  "asset_requirement_triage_report.json": triageReport,
  "asset_todo_list.json": canonical,
  "asset_todo_list.md": markdown,
  "canonical_asset_requirements.json": canonical,
  "approved_asset_mismatch_report.json": mismatchReport,
  "asset_timeline_fit_report.json": timelineFitReport,
  "asset_generation_prompts.json": generationPrompts,
  "external_generation_prompts.md": externalPromptsMd,
  "single_asset_generation_audit.json": singleAssetAudit,
  "human_loop_completion_report.json": humanLoopCompletionReport,
  "professional_readiness_summary.json": professionalReadinessSummary,
};

await fsp.mkdir(OUT_DIR, { recursive: true });
for (const [filename, payload] of Object.entries(files)) {
  const file = path.join(OUT_DIR, filename);
  await fsp.writeFile(file, typeof payload === "string" ? payload : JSON.stringify(payload, null, 2), "utf8");
}

const result = {
  ok: biopsyIndiaInvariant.length === 0,
  project_id: PROJECT_ID,
  out_dir: OUT_DIR,
  files: Object.keys(files).map((filename) => path.join(OUT_DIR, filename)),
  deduped_requirements: canonical.length,
  source_asset_candidates: candidates.length,
  professional_ready: professionalReadinessSummary.professional_ready,
  required_unresolved: professionalReadinessSummary.required_unresolved,
  mismatch_count: mismatchReport.length,
  worker_render_spec_available: Boolean(renderSpecResult.spec),
  render_spec_valid: professionalReadinessSummary.render_spec_valid,
  render_spec_reason: renderSpecResult.reason,
  biopsy_india_map_valid_match_count: biopsyIndiaInvariant.length,
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
