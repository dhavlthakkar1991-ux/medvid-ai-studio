import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  classifyMedicalAssetRequest,
  isSourceAllowedForTaxonomy,
  qualityForTaxonomy,
  sourceClassForAsset,
} from "./assets/medical-asset-taxonomy.server";

/** Group candidates + approved assets by spec role for the Assets tab. */
const ROLE_FOR_TYPE: Record<string, string> = {
  clinical_image: "Clinical Images",
  medical_diagram: "Medical Diagrams",
  diagram: "Medical Diagrams",
  broll_video: "B-roll",
  broll: "B-roll",
  infographic: "Infographics",
  icon: "Icons",
  thumbnail: "Icons",
  image: "Clinical Images",
  overlay: "Icons",
};

function roleFor(t: string): string {
  return ROLE_FOR_TYPE[t] ?? "Other";
}

function normalizeReviewAssetType(value: unknown, text = "") {
  const source = `${String(value ?? "")} ${text}`.toLowerCase();
  if (source.includes("presenter")) return "presenter_video";
  if (source.includes("caption")) return "caption";
  if (source.includes("lower_third") || source.includes("lower third") || source.includes("credentials")) return "lower_third";
  if (source.includes("cta") || source.includes("contact") || source.includes("share") || source.includes("end card")) return source.includes("end card") ? "end_card" : "cta_branding";
  if (source.includes("broll") || source.includes("b-roll") || source.includes("contextual")) return "contextual_broll";
  if (source.includes("clinical") || source.includes("ulcer") || source.includes("leukoplakia") || source.includes("erythroplakia")) return "clinical_image";
  if (source.includes("medical illustration") || source.includes("diagram") || source.includes("anatomy") || source.includes("lymph") || source.includes("node") || source.includes("biopsy") || source.includes("tissue sample") || source.includes("pathology") || source.includes("specimen")) return "medical_diagram";
  if (source.includes("text_overlay") || source.includes("text overlay")) return "text_overlay";
  if (source.includes("callout")) return "callout";
  if (source.includes("infographic") || source.includes("workflow") || source.includes("prevalence") || source.includes("risk")) return "infographic";
  return "infographic";
}

const LEGACY_DB_ASSET_TYPES = new Set([
  "broll",
  "image",
  "infographic",
  "thumbnail",
  "overlay",
  "animation",
  "logo",
  "video",
  "clinical_image",
  "medical_diagram",
  "broll_video",
  "icon",
  "stock_video",
  "diagram",
  "callout",
  "lower_third",
  "cta_branding",
  "contextual_broll",
  "text_overlay",
  "end_card",
  "caption",
  "presenter_video",
]);

function dbCompatibleAssetType(assetType: unknown, context = "") {
  const normalized = normalizeReviewAssetType(assetType, context);
  const raw = String(assetType ?? "").trim();
  if (LEGACY_DB_ASSET_TYPES.has(raw)) return raw;
  if (LEGACY_DB_ASSET_TYPES.has(normalized)) return normalized;
  if (normalized === "contextual_broll") return "broll";
  if (normalized === "clinical_image") return "clinical_image";
  if (normalized === "medical_diagram") return "medical_diagram";
  if (normalized === "lower_third" || normalized === "text_overlay" || normalized === "cta_branding" || normalized === "end_card") return "overlay";
  if (normalized === "caption") return "overlay";
  if (normalized === "presenter_video") return "video";
  return "infographic";
}

const INLINE_RENDER_ACTIONS = new Set([
  "show_lower_third",
  "lower_third",
  "show_text_overlay",
  "text_overlay",
  "show_callout",
  "callout",
  "show_cta",
  "cta",
  "cta_branding",
  "end_card",
  "kinetic_typography",
  "highlight_keyword",
]);

const NON_PROFESSIONAL_PROVENANCE_PATTERN = /internal[\s_-]*(?:template|svg[\s_-]*library|generated)|placeholder|cartoon/;

function manifestRowRenderable(row: any) {
  const action = String(row?.action_type ?? "").toLowerCase();
  const assetType = String(row?.asset_type ?? "").toLowerCase();
  return Boolean(
    row?.asset_id ||
      row?.asset_url ||
      row?.compiled_graphic_id ||
      row?.status === "ready" ||
      assetType === "presenter_video" ||
      INLINE_RENDER_ACTIONS.has(action) ||
      INLINE_RENDER_ACTIONS.has(assetType),
  );
}

function firstString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function candidateMediaFields(candidate: any) {
  const data =
    candidate?.candidate_data && typeof candidate.candidate_data === "object"
      ? candidate.candidate_data
      : {};
  const media = data.media && typeof data.media === "object" ? data.media : {};
  const asset = data.asset && typeof data.asset === "object" ? data.asset : {};
  const original = data.original && typeof data.original === "object" ? data.original : {};

  return {
    url: firstString(
      candidate?.url,
      candidate?.source_url,
      candidate?.media_url,
      data.url,
      data.source_url,
      data.media_url,
      data.video_url,
      data.image_url,
      media.url,
      media.source_url,
      media.media_url,
      asset.url,
      asset.source_url,
      original.url,
      original.source_url,
    ),
    thumbnail_url: firstString(
      candidate?.thumbnail_url,
      data.thumbnail_url,
      data.thumb_url,
      media.thumbnail_url,
      asset.thumbnail_url,
      original.thumbnail_url,
    ),
    preview_url: firstString(
      candidate?.preview_url,
      data.preview_url,
      media.preview_url,
      asset.preview_url,
      original.preview_url,
    ),
    duration_seconds: firstNumber(
      candidate?.duration_seconds,
      data.duration_seconds,
      media.duration_seconds,
      asset.duration_seconds,
      original.duration_seconds,
    ),
    width: firstNumber(candidate?.width, data.width, media.width, asset.width, original.width),
    height: firstNumber(
      candidate?.height,
      data.height,
      media.height,
      asset.height,
      original.height,
    ),
    metadata: {
      candidate_data: data,
      render_media: {
        has_url: Boolean(
          firstString(
            candidate?.url,
            candidate?.source_url,
            candidate?.media_url,
            data.url,
            data.source_url,
            data.media_url,
            data.video_url,
            data.image_url,
            media.url,
            media.source_url,
            media.media_url,
            asset.url,
            asset.source_url,
            original.url,
            original.source_url,
          ),
        ),
      },
    },
  };
}

function hasUsableMediaUrl(candidate: any) {
  const media = candidateMediaFields(candidate);
  return Boolean(media.url || media.preview_url || media.thumbnail_url);
}

function renderClassification(candidate: any) {
  return hasUsableMediaUrl(candidate) ? "REAL_RENDERABLE_MEDIA" : "PLACEHOLDER_PLAN";
}

function taxonomyForCandidate(candidate: any) {
  return classifyMedicalAssetRequest({
    assetType: candidate?.asset_type,
    query: firstString(candidate?.search_query, candidate?.title, candidate?.description),
    actionType: candidate?.candidate_data?.action_type,
    title: candidate?.title,
    description: candidate?.description,
  });
}

function qualityGradeForAsset(asset: any): { grade: "A+" | "A" | "A-" | "B" | "C" | "D" | "F"; score: number; reason: string } {
  const metadata = asset?.metadata && typeof asset.metadata === "object" ? asset.metadata : {};
  const attribution = metadata.attribution && typeof metadata.attribution === "object" ? metadata.attribution : {};
  const taxonomy = metadata.medical_asset_taxonomy ?? metadata.taxonomy;
  if (taxonomy) {
    const sourceClass = sourceClassForAsset(asset);
    return qualityForTaxonomy(taxonomy as any, sourceClass);
  }
  const explicit = String(metadata.quality_grade ?? attribution.quality_grade ?? "").toUpperCase();
  const map: Record<string, { grade: "A+" | "A" | "A-" | "B" | "C" | "D" | "F"; score: number; reason: string }> = {
    "A+": { grade: "A+", score: 100, reason: "Explicit clinical-grade asset" },
    A: { grade: "A", score: 92, reason: "Explicit professional asset" },
    "A-": { grade: "A-", score: 86, reason: "Explicit high-quality generated graphic" },
    B: { grade: "B", score: 74, reason: "Explicit usable stock or generated media" },
    C: { grade: "C", score: 58, reason: "Explicit acceptable fallback" },
    D: { grade: "D", score: 38, reason: "Explicit low-quality fallback" },
    F: { grade: "F", score: 0, reason: "Explicit non-renderable placeholder" },
  };
  if (explicit && map[explicit]) return map[explicit];
  const sourceType = String(asset?.source_type ?? asset?.source ?? "").toLowerCase();
  const assetType = String(asset?.asset_type ?? "").toLowerCase();
  const hasUrl = Boolean(firstString(asset?.url, asset?.preview_url, asset?.thumbnail_url, metadata.url, metadata.source_url, metadata.preview_url, metadata.thumbnail_url));
  if (!hasUrl) return { grade: "F", score: 0, reason: "No renderable URL" };
  if (sourceType === "upload" || sourceType === "manual") return assetType.includes("clinical") ? { grade: "A+", score: 100, reason: "Reviewed clinical/manual media" } : { grade: "A", score: 92, reason: "Reviewed uploaded/manual media" };
  if (sourceType === "generated" || sourceType === "internal") return assetType.includes("infographic") || assetType.includes("diagram") ? { grade: "A-", score: 86, reason: "Generated medical visual template" } : { grade: "B", score: 74, reason: "Generated visual asset" };
  if (sourceType === "pexels" || sourceType === "pixabay" || sourceType === "unsplash") return assetType.includes("broll") || assetType.includes("video") ? { grade: "B", score: 74, reason: "Renderable stock video" } : { grade: "C", score: 58, reason: "Renderable stock image" };
  return { grade: "C", score: 58, reason: "Renderable asset with unknown provenance" };
}

function qualityGradeForCandidate(candidate: any) {
  const media = candidateMediaFields(candidate);
  if (!media.url && !media.preview_url && !media.thumbnail_url) return { grade: "F", score: 0, reason: "Planning placeholder without renderable URL" as const };
  return qualityGradeForAsset({ ...candidate, url: media.url, preview_url: media.preview_url, thumbnail_url: media.thumbnail_url });
}

function professionalRiskForApprovedAsset(asset: any, args: { requiredAssetType?: unknown; taxonomy?: unknown; hasUsableUrl?: boolean }) {
  if (!asset) return { blocks: true, reason: "No approved asset linked." };
  if (args.hasUsableUrl === false) return { blocks: true, reason: "Approved asset has no usable URL." };

  const metadata = plainObject(asset.metadata);
  const original = plainObject(metadata.original_candidate_data);
  const originalMetadata = plainObject(original.metadata);
  const sourceClass = sourceClassForAsset(asset);
  const directProvenance = `${asset.status ?? ""} ${metadata.classification ?? ""} ${metadata.medical_source_class ?? ""} ${metadata.source ?? ""} ${metadata.source_type ?? ""} ${sourceClass}`.toLowerCase();
  const originalLicense = plainObject(original.license);
  const originalNestedLicense = plainObject(originalMetadata.license);
  const originalAssetMetadata = plainObject(plainObject(originalMetadata.original_asset).metadata);
  const originalProvenance = [
    original.provider,
    original.source_type,
    original.source,
    originalLicense.type,
    originalLicense.license_status,
    originalMetadata.medical_source_class,
    originalMetadata.classification,
    originalNestedLicense.type,
    originalAssetMetadata.classification,
  ].map((value) => String(value ?? "").toLowerCase()).join(" ");
  const qualityScore = firstNumber(
    metadata.quality_score,
    asset.quality_score,
    original.quality_score,
    plainObject(original.worker_score).overall_asset_score,
  );
  const requiredType = normalizeReviewAssetType(args.requiredAssetType, `${asset.asset_type ?? ""} ${asset.title ?? ""}`);
  const taxonomy = String(args.taxonomy ?? metadata.medical_asset_taxonomy ?? metadata.taxonomy ?? "").toUpperCase();
  const requiredProfessionalAsset =
    ["clinical_image", "medical_diagram", "infographic", "infographic_or_diagram", "cta_branding"].includes(requiredType) ||
    ["CLINICAL_IMAGE", "MEDICAL_ILLUSTRATION", "INFOGRAPHIC_CARD"].includes(taxonomy);

  if (/approved_placeholder|needs_asset|placeholder_plan|placeholder_do_not_render/.test(directProvenance)) {
    return { blocks: true, reason: "Approved asset is still marked as a placeholder/planning asset." };
  }
  if (requiredProfessionalAsset && NON_PROFESSIONAL_PROVENANCE_PATTERN.test(directProvenance)) {
    return { blocks: true, reason: "Approved required asset is an internal/template-generated substitute, not a professional final asset." };
  }
  if (
    requiredProfessionalAsset &&
    String(asset.source_type ?? asset.source ?? "").toLowerCase().includes("upload") &&
    NON_PROFESSIONAL_PROVENANCE_PATTERN.test(originalProvenance) &&
    qualityScore !== null &&
    qualityScore < 75
  ) {
    return { blocks: true, reason: `Approved manual upload still carries low-quality internal/template provenance (quality ${qualityScore}).` };
  }
  if (requiredProfessionalAsset && qualityScore !== null && qualityScore < 60) {
    return { blocks: true, reason: `Approved required asset quality score is too low for professional readiness (${qualityScore}).` };
  }
  return { blocks: false, reason: null };
}

function approvedStatusForCandidate(candidate: any) {
  // The richer render state is stored in metadata/render_classification.
  // Persisted status remains compatible with existing deployed CHECK constraints.
  return hasUsableMediaUrl(candidate) ? "approved" : "pending";
}

function candidateReviewNote(candidate: any, fallback?: string | null) {
  if (hasUsableMediaUrl(candidate)) return fallback ?? null;
  return fallback ?? "Approved as planning placeholder only; no renderable media URL is available.";
}

function plainObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function assetSourceTypeFromProvider(provider: unknown, fallback: "manual" | "generated" | "upload" | "pexels" | "pixabay" | "library" = "manual") {
  const source = String(provider ?? "").toLowerCase();
  if (source.includes("upload")) return "upload";
  if (source.includes("pexels")) return "pexels";
  if (source.includes("pixabay")) return "pixabay";
  if (source.includes("library")) return "library";
  if (
    source.includes("generated") ||
    source.includes("heygen") ||
    source.includes("hyperframes") ||
    source.includes("ai")
  ) return "generated";
  return fallback;
}

function assetSourceForReviewCandidate(candidate: any, fallback = "review") {
  const data = plainObject(candidate?.candidate_data);
  const metadata = plainObject(data.metadata);
  return firstString(
    data.generation_provider,
    metadata.generation_provider,
    candidate?.provider,
    data.provider,
    fallback,
  ) ?? fallback;
}

function compactReviewCandidateData(value: unknown): Record<string, any> {
  const data = plainObject(value);
  const intent = plainObject(data.intent);
  const media = plainObject(data.media);
  const asset = plainObject(data.asset);
  const original = plainObject(data.original);
  const metadata = plainObject(data.metadata);
  const score = plainObject(data.worker_score ?? data.score);
  const license = plainObject(data.license ?? metadata.license);
  return {
    action_type: data.action_type ?? null,
    visual_concept: data.visual_concept ?? null,
    required_asset_description: data.required_asset_description ?? null,
    source_render_manifest_id: data.source_render_manifest_id ?? null,
    timeline_item_id: data.timeline_item_id ?? null,
    mapped_timeline_item_id: data.mapped_timeline_item_id ?? null,
    source_page_url: data.source_page_url ?? null,
    source_url: data.source_url ?? null,
    url: data.url ?? null,
    media_url: data.media_url ?? null,
    video_url: data.video_url ?? null,
    image_url: data.image_url ?? null,
    preview_url: data.preview_url ?? null,
    thumbnail_url: data.thumbnail_url ?? null,
    source_domain: data.source_domain ?? null,
    provider: data.provider ?? null,
    source_type: data.source_type ?? null,
    generation_prompt: data.generation_prompt ?? metadata.generation_prompt ?? null,
    generation_provider: data.generation_provider ?? metadata.generation_provider ?? data.provider ?? null,
    generation_model: data.generation_model ?? metadata.generation_model ?? null,
    generation_cost: data.generation_cost ?? metadata.generation_cost ?? null,
    generation_time_ms: data.generation_time_ms ?? metadata.generation_time_ms ?? null,
    result_url: data.result_url ?? metadata.result_url ?? null,
    medical_source_class: data.medical_source_class ?? null,
    medical_asset_taxonomy: data.medical_asset_taxonomy ?? data.taxonomy ?? null,
    taxonomy: data.taxonomy ?? data.medical_asset_taxonomy ?? null,
    license_status: data.license_status ?? null,
    usage_recommendation: data.usage_recommendation ?? null,
    preferred: data.preferred ?? null,
    selection_reason: data.selection_reason ?? null,
    score_reason: data.score_reason ?? null,
    mismatch_reason: data.mismatch_reason ?? null,
    rejection_reason: data.rejection_reason ?? null,
    worker_score: score,
    score,
    license,
    metadata: {
      license,
      medical_source_class: metadata.medical_source_class ?? null,
      classification: metadata.classification ?? null,
      generation_prompt: metadata.generation_prompt ?? data.generation_prompt ?? null,
      generation_provider: metadata.generation_provider ?? data.generation_provider ?? data.provider ?? null,
      generation_model: metadata.generation_model ?? data.generation_model ?? null,
      generation_cost: metadata.generation_cost ?? data.generation_cost ?? null,
      generation_time_ms: metadata.generation_time_ms ?? data.generation_time_ms ?? null,
      result_url: metadata.result_url ?? data.result_url ?? null,
    },
    media: {
      url: media.url ?? null,
      source_url: media.source_url ?? null,
      media_url: media.media_url ?? null,
      preview_url: media.preview_url ?? null,
      thumbnail_url: media.thumbnail_url ?? null,
      duration_seconds: media.duration_seconds ?? null,
      width: media.width ?? null,
      height: media.height ?? null,
    },
    asset: {
      url: asset.url ?? null,
      source_url: asset.source_url ?? null,
      preview_url: asset.preview_url ?? null,
      thumbnail_url: asset.thumbnail_url ?? null,
      duration_seconds: asset.duration_seconds ?? null,
      width: asset.width ?? null,
      height: asset.height ?? null,
    },
    original: {
      url: original.url ?? null,
      source_url: original.source_url ?? null,
      preview_url: original.preview_url ?? null,
      thumbnail_url: original.thumbnail_url ?? null,
      duration_seconds: original.duration_seconds ?? null,
      width: original.width ?? null,
      height: original.height ?? null,
    },
    intent: {
      visual_goal: intent.visual_goal ?? null,
      expected_visual: intent.expected_visual ?? null,
      original_instruction: intent.original_instruction ?? null,
      timeline_item_id: intent.timeline_item_id ?? null,
      item_id: intent.item_id ?? null,
      time_range: intent.time_range ?? null,
      search_queries: Array.isArray(intent.search_queries) ? intent.search_queries.slice(0, 8) : [],
    },
    approval_audit: Array.isArray(data.approval_audit) ? data.approval_audit.slice(-5) : [],
    replacement_history: Array.isArray(data.replacement_history) ? data.replacement_history.slice(-5) : [],
  };
}

function compactReviewCandidate(candidate: any) {
  return {
    ...candidate,
    candidate_data: compactReviewCandidateData(candidate?.candidate_data),
  };
}

function workerScore(candidate: any): Record<string, any> {
  const data = plainObject(candidate?.candidate_data);
  return plainObject(data.worker_score ?? data.score);
}

function candidateOverallScore(candidate: any): number {
  const score = workerScore(candidate);
  const n = Number(
    score.overall_asset_score ??
      score.overall_score ??
      score.score ??
      candidate?.quality_score,
  );
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : qualityGradeForCandidate(candidate).score;
}

function licenseInfo(candidate: any): { license_status: string; usage_recommendation: string } {
  const data = plainObject(candidate?.candidate_data);
  const license = plainObject(data.license ?? data.metadata?.license);
  return {
    license_status: String(
      data.license_status ??
        license.license_status ??
        license.status ??
        license.type ??
        "unknown",
    ),
    usage_recommendation: String(
      data.usage_recommendation ??
        license.usage_recommendation ??
        (["known_open", "public_domain"].includes(String(license.status ?? license.type)) ? "safe_to_use" : "review_required"),
    ),
  };
}

function sourceDomainFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function candidateSource(candidate: any) {
  const data = plainObject(candidate?.candidate_data);
  const media = candidateMediaFields(candidate);
  const sourceUrl = firstString(data.source_page_url, data.source_url, data.url, media.url, media.preview_url, media.thumbnail_url);
  return {
    source_url: sourceUrl,
    source_domain: firstString(data.source_domain, sourceDomainFromUrl(sourceUrl)),
  };
}

function isClinicalCandidate(candidate: any) {
  const t = String(candidate?.asset_type ?? "").toLowerCase();
  const data = plainObject(candidate?.candidate_data);
  const taxonomy = String(data.medical_asset_taxonomy ?? data.taxonomy ?? "").toLowerCase();
  return t.includes("clinical") || taxonomy.includes("clinical");
}

function confidenceTier(candidate: any): { tier: "A" | "B" | "C" | "D"; label: string; bulk_eligible: boolean; reason: string } {
  const score = candidateOverallScore(candidate);
  const { license_status, usage_recommendation } = licenseInfo(candidate);
  const sourceSafety = Number(workerScore(candidate).source_safety_score ?? 0);
  const clinical = isClinicalCandidate(candidate);
  const safeLicense = ["known_open", "public_domain", "attribution_required"].includes(license_status) && usage_recommendation === "safe_to_use";
  if (score >= 90) {
    return {
      tier: "A",
      label: "A high confidence",
      bulk_eligible: safeLicense && sourceSafety >= 80 && !clinical,
      reason: clinical
        ? "Clinical imagery requires manual approval."
        : safeLicense && sourceSafety >= 80
          ? "High score, safe source, and safe license."
          : "High score but license or source safety still needs review.",
    };
  }
  if (score >= 80) return { tier: "B", label: "B review suggested", bulk_eligible: false, reason: "Strong candidate, reviewer should confirm fit." };
  if (score >= 70) return { tier: "C", label: "C manual review", bulk_eligible: false, reason: "Usable candidate with visible review risk." };
  return { tier: "D", label: "D default reject", bulk_eligible: false, reason: "Low score or missing renderable evidence." };
}

function appendReviewAudit(candidate: any, entry: Record<string, any>): Record<string, any> {
  const data = plainObject(candidate?.candidate_data);
  const history = Array.isArray(data.approval_audit) ? data.approval_audit : [];
  return {
    ...data,
    approval_audit: [...history, entry],
  };
}

function rejectionReason(candidate: any, fallback?: string | null) {
  const data = plainObject(candidate?.candidate_data);
  const score = workerScore(candidate);
  return firstString(
    fallback,
    data.rejection_reason,
    data.mismatch_reason,
    score.rejection_reason,
    candidate?.review_note,
  );
}

function candidateRenderSourceClass(candidate: any, fallback: string) {
  const data = plainObject(candidate?.candidate_data);
  const declared = firstString(data.medical_source_class, data.source_type, data.provider);
  if (declared === "internal_generated" || declared === "internal") return "internal_template";
  return fallback;
}

const ProjectIdInput = z.object({ projectId: z.string() });
const WorkerFulfillmentInput = z.object({
  projectId: z.string(),
  candidateId: z.string().optional(),
  promptOverride: z.string().optional(),
  forceGeneration: z.boolean().optional(),
});

async function signWorkerBody(body: string) {
  const secret = process.env.CUSTOM_WORKER_SECRET ?? "";
  if (!secret) return null;
  const { createHmac } = await import("crypto");
  return createHmac("sha256", secret).update(body).digest("hex");
}

function selectAiConfigForWorker() {
  if (process.env.OPENAI_API_KEY) {
    return { provider: "openai", api_key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL ?? "gpt-4o-mini" };
  }
  if (process.env.GEMINI_API_KEY) {
    return { provider: "gemini", api_key: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL ?? "gemini-1.5-flash" };
  }
  if (process.env.OPENROUTER_API_KEY) {
    return { provider: "openrouter", api_key: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini" };
  }
  return { provider: null, api_key: null, model: null };
}

function workerAssetMediaFields(asset: any) {
  return {
    url: firstString(asset?.public_url, asset?.source_url, asset?.thumbnail_url),
    thumbnail_url: firstString(asset?.thumbnail_url, asset?.public_url, asset?.source_url),
    preview_url: firstString(asset?.public_url, asset?.source_url, asset?.thumbnail_url),
    duration_seconds: firstNumber(asset?.duration_seconds),
    width: firstNumber(asset?.width),
    height: firstNumber(asset?.height),
  };
}

function candidateInsertFromWorkerAsset(projectId: string, asset: any, priority: number) {
  const media = workerAssetMediaFields(asset);
  const intent = asset?.intent && typeof asset.intent === "object" ? asset.intent : {};
  return {
    project_id: projectId,
    scene_id: firstString(intent.source_scene_id, intent.scene_id),
    asset_type: asset?.asset_type ?? intent.preferred_asset_type ?? "image",
    search_query:
      firstString(
        asset?.title,
        asset?.description,
        intent.expected_visual,
        intent.original_instruction,
        Array.isArray(intent.search_queries) ? intent.search_queries[0] : null,
      ) ?? "AI worker fulfilled asset",
    priority,
    provider: asset?.provider ?? "ai_worker",
    status: "searched",
    title: asset?.title ?? intent.expected_visual ?? null,
    description: asset?.description ?? intent.original_instruction ?? null,
    thumbnail_url: media.thumbnail_url,
    edit_action_id: null,
    storyboard_item_id: firstString(intent.storyboard_item_id, intent.source_storyboard_item_id),
    broll_item_id: null,
    infographic_item_id: null,
    candidate_data: {
      worker_fulfillment: true,
      worker_review_status: asset?.review_status ?? null,
      worker_score: asset?.score ?? null,
      mismatch_reason: asset?.mismatch_reason ?? asset?.score?.rejection_reason ?? null,
      intent,
      provider: asset?.provider ?? null,
      provider_asset_id: asset?.provider_asset_id ?? null,
      taxonomy: asset?.taxonomy ?? null,
      medical_asset_taxonomy: asset?.metadata?.medical_asset_taxonomy ?? asset?.taxonomy ?? null,
      medical_source_class: asset?.metadata?.medical_source_class ?? asset?.source_type ?? null,
      source_type: asset?.source_type ?? null,
      url: media.url,
      source_url: media.url,
      media_url: media.url,
      preview_url: media.preview_url,
      thumbnail_url: media.thumbnail_url,
      duration_seconds: media.duration_seconds,
      width: media.width,
      height: media.height,
      license: asset?.license ?? null,
      provenance: asset?.provenance ?? null,
      metadata: asset?.metadata ?? null,
    },
  };
}

async function safeProjectRows(sb: any, table: string, projectId: string, order?: { column: string; ascending?: boolean }) {
  let query = sb.from(table).select("*").eq("project_id", projectId);
  if (order) query = query.order(order.column, { ascending: order.ascending ?? true });
  const { data, error } = await query;
  if (error) {
    console.warn(`AI worker package: failed to read ${table}`, error.message);
    return [];
  }
  return data ?? [];
}

export const fulfillProjectAssetsWithWorker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => WorkerFulfillmentInput.parse(i))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const userId = context.userId;
    const { data: providers, error: providerErr } = await sb
      .from("render_providers")
      .select("*")
      .eq("provider_type", "custom_worker")
      .order("is_default", { ascending: false })
      .limit(1);
    if (providerErr) throw new Error(providerErr.message);
    const provider = (providers ?? [])[0];
    const config: any = provider?.configuration && typeof provider.configuration === "object" && !Array.isArray(provider.configuration)
      ? provider.configuration
      : {};
    const workerUrl = firstString(config.worker_url, config.webhook_url);
    if (!workerUrl) throw new Error("Custom Worker provider must define worker_url before asset fulfillment.");
    if (!process.env.CUSTOM_WORKER_SECRET) throw new Error("CUSTOM_WORKER_SECRET is required to call the asset fulfillment worker.");

    const [
      project,
      transcripts,
      transcriptSegments,
      analysisVersions,
      storyboard,
      broll,
      infographics,
      editActions,
      layoutDecisions,
      timelineTracks,
      timelineItems,
      manifest,
      assets,
      assetCandidates,
    ] = await Promise.all([
      sb.from("projects").select("*").eq("id", data.projectId).maybeSingle(),
      safeProjectRows(sb, "transcripts", data.projectId),
      safeProjectRows(sb, "transcript_segments", data.projectId, { column: "segment_index" }),
      safeProjectRows(sb, "analysis_versions", data.projectId),
      safeProjectRows(sb, "storyboard_items", data.projectId, { column: "item_index" }),
      safeProjectRows(sb, "broll_items", data.projectId, { column: "item_index" }),
      safeProjectRows(sb, "infographic_items", data.projectId, { column: "item_index" }),
      safeProjectRows(sb, "edit_actions", data.projectId, { column: "start_time" }),
      safeProjectRows(sb, "layout_decisions", data.projectId),
      safeProjectRows(sb, "timeline_tracks", data.projectId, { column: "track_index" }),
      safeProjectRows(sb, "timeline_items", data.projectId, { column: "start_time" }),
      safeProjectRows(sb, "render_manifest", data.projectId, { column: "render_order" }),
      safeProjectRows(sb, "assets", data.projectId, { column: "created_at" }),
      safeProjectRows(sb, "asset_candidates", data.projectId, { column: "priority" }),
    ]);
    if (project.error || !project.data) throw new Error(project.error?.message ?? "Project not found");

    const { buildRenderSpec } = await import("./render/render-spec-builder.server");
    const renderSpec = await buildRenderSpec(sb, data.projectId, { quality: "preview" });
    const timelineActionByItem = new Map<string, string>();
    for (const item of timelineItems as any[]) {
      if (item.id && item.edit_action_id) timelineActionByItem.set(String(item.id), String(item.edit_action_id));
    }
    const actionIds = new Set((editActions as any[]).map((row) => String(row.id)));

    const packagePayload = {
      project_id: data.projectId,
      render_job_id: null,
      project_context: {
        id: project.data.id,
        title: project.data.title,
        duration_seconds: project.data.duration_seconds,
        specialty: (project.data as any).specialty ?? null,
        diagnosis_topic: (project.data as any).diagnosis_topic ?? null,
        audience: (project.data as any).audience ?? "adult patient education",
      },
      transcript: {
        transcripts,
        transcript_segments: transcriptSegments,
      },
      scene_plan: (analysisVersions as any[]).find((row) => row.task === "scene_plan") ?? {},
      storyboard,
      broll,
      infographics,
      editorial_decisions: editActions,
      layout_decisions: layoutDecisions,
      timeline: timelineItems,
      timeline_tracks: timelineTracks,
      manifest_v6: manifest,
      render_spec: renderSpec,
      existing_assets: assets,
      existing_candidates: assetCandidates,
      ai_config: selectAiConfigForWorker(),
      fulfillment_focus: data.candidateId
        ? {
            candidate_id: data.candidateId,
            prompt_override: data.promptOverride ?? null,
            force_generation: data.forceGeneration ?? true,
          }
        : null,
      provider_config: {
        pexels_configured: Boolean(process.env.PEXELS_API_KEY),
        pexels_api_key: process.env.PEXELS_API_KEY ?? null,
        pixabay_configured: Boolean(process.env.PIXABAY_API_KEY),
        pixabay_api_key: process.env.PIXABAY_API_KEY ?? null,
        heygen_hyperframes_enabled: process.env.HEYGEN_HYPERFRAMES_DISABLED !== "true",
      },
    };
    const body = JSON.stringify(packagePayload);
    const signature = await signWorkerBody(body);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(config.timeout_ms ?? 30000));
    let workerResponse: any;
    try {
      const res = await fetch(`${workerUrl.replace(/\/$/, "")}/fulfill-assets`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-render-signature": signature ?? "",
        },
        body,
        signal: controller.signal,
      });
      const text = await res.text();
      try {
        workerResponse = text ? JSON.parse(text) : {};
      } catch {
        workerResponse = { raw: text };
      }
      if (!res.ok) {
        throw new Error(`Asset fulfillment worker rejected request (${res.status}): ${workerResponse?.error ?? text}`);
      }
    } finally {
      clearTimeout(timer);
    }

    const buckets = [
      ...((workerResponse.fulfilled_assets ?? []) as any[]),
      ...((workerResponse.needs_manual_review ?? []) as any[]),
      ...((workerResponse.rejected_assets ?? []) as any[]),
    ];
    const now = new Date().toISOString();
    let inserted = 0;
    let autoApproved = 0;
    let rejected = 0;
    let needsReview = 0;
    for (const [index, asset] of buckets.entries()) {
      const candidateInsert: any = candidateInsertFromWorkerAsset(data.projectId, asset, 1000 + index);
      const itemId = String(asset?.item_id ?? asset?.intent?.item_id ?? "");
      const manifestMatch = matchWorkerAssetToManifest(asset, manifest as any[], timelineActionByItem);
      candidateInsert.edit_action_id =
        actionIds.has(itemId) ? itemId : timelineActionByItem.get(itemId) ?? manifestMatch?.edit_action_id ?? null;
      candidateInsert.scene_id = candidateInsert.scene_id ?? manifestMatch?.scene_id ?? null;
      candidateInsert.storyboard_item_id = candidateInsert.storyboard_item_id ?? manifestMatch?.storyboard_item_id ?? null;
      candidateInsert.candidate_data = {
        ...candidateInsert.candidate_data,
        source_render_manifest_id: manifestMatch?.id ?? null,
        matched_manifest_timeline_start: manifestMatch?.timeline_start ?? null,
        matched_manifest_timeline_end: manifestMatch?.timeline_end ?? null,
      };
      if (asset?.review_status === "rejected") {
        candidateInsert.status = "rejected";
        candidateInsert.review_note = asset?.mismatch_reason ?? asset?.score?.rejection_reason ?? "Rejected by AI worker relevance gate.";
        candidateInsert.reviewed_by = userId;
        candidateInsert.reviewed_at = now;
        rejected += 1;
      } else {
        candidateInsert.status = "searched";
        needsReview += asset?.review_status === "needs_review" ? 1 : 0;
      }
      const { data: candidate, error: insertErr } = await sb
        .from("asset_candidates")
        .insert(candidateInsert)
        .select("*")
        .single();
      if (insertErr || !candidate) throw new Error(insertErr?.message ?? "Failed to store worker asset candidate");
      inserted += 1;
      const media = candidateMediaFields(candidate);
      if (asset?.review_status === "auto_approved" && media.url) {
        await persistFulfilledAsset(sb, {
          candidate,
          userId,
          provider: asset.provider === "internal_generated" ? "internal" : asset.provider ?? "ai_worker",
          title: asset.title ?? candidate.title ?? "AI worker fulfilled asset",
          description: asset.description ?? candidate.description ?? null,
          source_url: media.url,
          preview_url: media.preview_url ?? media.url,
          thumbnail_url: media.thumbnail_url ?? media.preview_url ?? media.url,
          duration_seconds: media.duration_seconds,
          width: media.width,
          height: media.height,
          search_query: candidate.search_query,
          metadata: {
            result_id: asset.provider_asset_id ?? null,
            fulfillment: {
              provider: asset.provider,
              score: asset.score,
              taxonomy: asset.taxonomy,
              report_url: workerResponse.report_url ?? null,
            },
            license: asset.license ?? null,
            provenance: asset.provenance ?? null,
            ...(asset.metadata ?? {}),
          },
          review_note: "Auto-approved by AI worker high-confidence fulfillment.",
        });
        autoApproved += 1;
      }
    }
    if (inserted > 0) await rebuildProjectRenderContracts(sb, data.projectId);
    return {
      ok: true,
      inserted,
      autoApproved,
      needsReview,
      rejected,
      status: workerResponse.status,
      readiness: workerResponse.readiness ?? {},
      reportUrl: workerResponse.report_url ?? null,
      debugPaths: workerResponse.debug_paths ?? {},
    };
  });
export const listAssetReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ProjectIdInput.parse(i))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const storageSigner = supabaseAdmin as any;
    const [
      { data: project },
      { data: candidates },
      { data: assets },
      { data: projectAssets },
      { data: scenes },
      { data: timelineItems },
      { data: storyboardItems },
      { data: editActions },
      { data: transcriptSegments },
      { data: renderManifest },
    ] =
      await Promise.all([
        sb.from("projects").select("id,title,video_path,duration_seconds").eq("id", data.projectId).maybeSingle(),
        sb
          .from("asset_candidates")
          .select("*")
          .eq("project_id", data.projectId)
          .order("priority", { ascending: true }),
        sb
          .from("assets")
          .select("*")
          .eq("project_id", data.projectId)
          .order("created_at", { ascending: false }),
        sb.from("project_assets").select("*").eq("project_id", data.projectId),
        sb.from("scenes").select("id, scene_number, title").eq("project_id", data.projectId),
        sb.from("timeline_items").select("*").eq("project_id", data.projectId).order("start_time", { ascending: true }),
        sb.from("storyboard_items").select("*").eq("project_id", data.projectId).order("item_index", { ascending: true }),
        sb.from("edit_actions").select("*").eq("project_id", data.projectId),
        sb.from("transcript_segments").select("*").eq("project_id", data.projectId).order("start_time", { ascending: true }),
        sb.from("render_manifest").select("*").eq("project_id", data.projectId).order("timeline_start", { ascending: true }),
      ]);

    function parseSupabaseStorageUrl(value: unknown) {
      if (typeof value !== "string" || !value.includes("/storage/v1/object/")) return null;
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

    async function freshReviewAssetUrl(asset: any) {
      const metadata = plainObject(asset?.metadata);
      const upload = plainObject(metadata.upload);
      const storagePath = firstString(metadata.storage_path, metadata.storagePath, upload.path);
      const storageBucket = firstString(metadata.storage_bucket, metadata.storageBucket, upload.bucket, "videos");
      if (storagePath && storageBucket) {
        const { data: signed } = await storageSigner.storage.from(storageBucket).createSignedUrl(storagePath, 60 * 60 * 12);
        if (signed?.signedUrl) return { url: signed.signedUrl, bucket: storageBucket, path: storagePath };
      }
      const storedUrl = firstString(asset?.url, asset?.preview_url, asset?.thumbnail_url, metadata.url, metadata.source_url, metadata.preview_url, metadata.thumbnail_url);
      const parsed = parseSupabaseStorageUrl(storedUrl);
      if (parsed) {
        const { data: signed } = await storageSigner.storage.from(parsed.bucket).createSignedUrl(parsed.path, 60 * 60 * 12);
        if (signed?.signedUrl) return { url: signed.signedUrl, bucket: parsed.bucket, path: parsed.path };
      }
      return storedUrl ? { url: storedUrl, bucket: null, path: null } : null;
    }

    const signedStorageUrlCache = new Map<string, string>();
    async function freshSignedStorageUrl(value: string) {
      const parsed = parseSupabaseStorageUrl(value);
      if (!parsed) return value;
      const cacheKey = `${parsed.bucket}/${parsed.path}`;
      const cached = signedStorageUrlCache.get(cacheKey);
      if (cached) return cached;
      const { data: signed } = await storageSigner.storage.from(parsed.bucket).createSignedUrl(parsed.path, 60 * 60 * 12);
      if (!signed?.signedUrl) return value;
      signedStorageUrlCache.set(cacheKey, signed.signedUrl);
      return signed.signedUrl;
    }

    async function freshenStorageUrlsDeep(value: any): Promise<any> {
      if (typeof value === "string") {
        return value.includes("/storage/v1/object/") ? freshSignedStorageUrl(value) : value;
      }
      if (Array.isArray(value)) {
        return Promise.all(value.map((entry) => freshenStorageUrlsDeep(entry)));
      }
      if (!value || typeof value !== "object") return value;
      const entries = await Promise.all(
        Object.entries(value).map(async ([key, entry]) => [key, await freshenStorageUrlsDeep(entry)] as const),
      );
      return Object.fromEntries(entries);
    }

    const manifestAssetIds = new Set(
      ((renderManifest ?? []) as any[])
        .map((row) => (row.asset_id == null ? null : String(row.asset_id)))
        .filter(Boolean) as string[],
    );
    const assetsForReview = await Promise.all(
      (((assets ?? []) as any[])).map(async (asset) => {
        if (!manifestAssetIds.has(String(asset.id))) return asset;
        const fresh = await freshReviewAssetUrl(asset);
        if (!fresh?.url) return asset;
        return {
          ...asset,
          url: fresh.url,
          preview_url: fresh.url,
          thumbnail_url: fresh.url,
          metadata: fresh.bucket && fresh.path
            ? {
                ...plainObject(asset.metadata),
                storage_bucket: fresh.bucket,
                storage_path: fresh.path,
                url: fresh.url,
                source_url: fresh.url,
                media_url: fresh.url,
                preview_url: fresh.url,
                thumbnail_url: fresh.url,
                upload: {
                  ...plainObject(plainObject(asset.metadata).upload),
                  bucket: fresh.bucket,
                  path: fresh.path,
                },
              }
            : asset.metadata,
        };
      }),
    );

    const timelineByAction = new Map<string, any>();
    const timelineByStoryboard = new Map<string, any>();
    const timelineByAsset = new Map<string, any>();
    const timelineByScene = new Map<string, any[]>();
    for (const item of (timelineItems ?? []) as any[]) {
      if (item.edit_action_id) timelineByAction.set(String(item.edit_action_id), item);
      const itemMetadata = plainObject(item.metadata);
      if (itemMetadata.storyboard_item_id && !timelineByStoryboard.has(String(itemMetadata.storyboard_item_id))) {
        timelineByStoryboard.set(String(itemMetadata.storyboard_item_id), item);
      }
      if (item.asset_id) timelineByAsset.set(String(item.asset_id), item);
      if (item.scene_id) (timelineByScene.get(String(item.scene_id)) ?? timelineByScene.set(String(item.scene_id), []).get(String(item.scene_id))!).push(item);
    }
    const storyboardById = new Map<string, any>(((storyboardItems ?? []) as any[]).map((s) => [String(s.id), s]));
    const sceneById = new Map<string, any>(((scenes ?? []) as any[]).map((s) => [String(s.id), s]));
    const actionById = new Map<string, any>(((editActions ?? []) as any[]).map((a) => [String(a.id), a]));
    const assetById = new Map<string, any>(assetsForReview.map((asset) => [String(asset.id), asset]));
    const allManifestRows = ((renderManifest ?? []) as any[]);
    const manifestById = new Map<string, any>(allManifestRows.map((row) => [String(row.id), row]));
    const manifestByAction = new Map<string, any>();
    const manifestByStoryboard = new Map<string, any>();
    for (const row of allManifestRows) {
      if (row.edit_action_id && !manifestByAction.has(String(row.edit_action_id))) manifestByAction.set(String(row.edit_action_id), row);
      if (row.storyboard_item_id && !manifestByStoryboard.has(String(row.storyboard_item_id))) {
        manifestByStoryboard.set(String(row.storyboard_item_id), row);
      }
    }
    function textSignature(...values: unknown[]) {
      return values
        .map((value) => String(value ?? "").toLowerCase())
        .join(" ")
        .replace(/[_-]+/g, " ");
    }

    function visualConceptForText(text: string) {
      if (/biopsy|punch biopsy|tissue sample|pathology|specimen/.test(text)) return { key: "biopsy_workflow", label: "Oral punch biopsy / biopsy workflow visual" };
      if (/leukoplakia|erythroplakia|white patch|red patch/.test(text)) return { key: "leukoplakia_erythroplakia", label: "Leukoplakia / erythroplakia comparison visual" };
      if (/ulcer|non healing|non-healing|mouth sore|oral lesion/.test(text)) return { key: "oral_ulcer", label: "Oral ulcer clinical image or high-quality medical illustration" };
      if (/lymph|neck lump|neck node|cervical node|swelling/.test(text)) return { key: "cervical_lymph_node", label: "Cervical lymph node anatomy diagram" };
      if (/early detection|detected at an early stage|treatment[^.]{0,40}effective|outcomes[^.]{0,40}better|comparison infographic/.test(text)) return { key: "early_detection", label: "Early detection patient education visual" };
      if (/oral exam|examination|examining|screening|mouth opening|consult specialist|consultation/.test(text)) return { key: "oral_examination", label: "Oral examination visual" };
      if (/india|prevalence|common cancers|map/.test(text)) return { key: "india_prevalence", label: "India prevalence map/stat visual" };
      if (/tobacco|gutkha|mawa|smoking|chewing tobacco/.test(text)) return { key: "tobacco_gutkha_risk", label: "Tobacco / gutkha risk visual" };
      if (/alcohol|risk factor/.test(text)) return { key: "risk_factor_infographic", label: "Risk factor infographic" };
      if (/share|family|friends|cta|early diagnosis|save lives|contact/.test(text)) return { key: "cta_branding", label: "CTA branding/contact polish" };
      if (/lower third|surgical oncologist|doctor intro|credentials/.test(text)) return { key: "doctor_lower_third", label: "Doctor lower-third / intro graphic" };
      if (/broll|clinic|consultation|hospital|patient/.test(text)) return { key: "contextual_broll", label: "Optional contextual b-roll" };
      const words = text
        .replace(/[^a-z0-9]+/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 3)
        .slice(0, 5)
        .join("_");
      return { key: words || "medical_visual", label: "Medical visual asset" };
    }

    function candidateIntentText(c: any) {
      const dataObj = plainObject(c?.candidate_data);
      const intent = plainObject(dataObj.intent);
      return textSignature(
        c?.title,
        c?.search_query,
        c?.description,
        c?.asset_type,
        dataObj.action_type,
        dataObj.visual_concept,
        dataObj.required_asset_description,
        intent.visual_goal,
        intent.expected_visual,
        intent.original_instruction,
        Array.isArray(intent.search_queries) ? intent.search_queries.join(" ") : null,
      );
    }

    function assetIntentText(asset: any) {
      const metadata = asset?.metadata && typeof asset.metadata === "object" ? asset.metadata : {};
      return textSignature(
        asset?.title,
        asset?.description,
        asset?.asset_type,
        asset?.search_query,
        metadata.visual_concept,
        metadata.mapped_visual_intent,
        metadata.search_query,
        metadata.candidate_data?.search_query,
        metadata.candidate_data?.title,
        metadata.candidate_data?.description,
      );
    }

    function assetVisibleIntentText(asset: any) {
      const metadata = asset?.metadata && typeof asset.metadata === "object" ? asset.metadata : {};
      const candidateData = plainObject(metadata.candidate_data);
      return textSignature(
        asset?.title,
        asset?.description,
        asset?.asset_type,
        asset?.search_query,
        metadata.search_query,
        candidateData.search_query,
        candidateData.title,
        candidateData.description,
      );
    }

    function isSpecificConcept(key: string) {
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

    function assetHasUsableUrl(asset: any) {
      return Boolean(firstString(asset?.url, asset?.preview_url, asset?.thumbnail_url, asset?.metadata?.url, asset?.metadata?.source_url, asset?.metadata?.preview_url, asset?.metadata?.thumbnail_url));
    }

    function approvedAssetLookupKeys(asset: any) {
      const metadata = plainObject(asset?.metadata);
      const concept = visualConceptForText(assetIntentText(asset));
      const normalizedType = normalizeReviewAssetType(asset?.asset_type, assetIntentText(asset));
      const sceneId = firstString(asset?.scene_id, metadata.mapped_scene_id, metadata.scene_id);
      const timelineId = firstString(metadata.mapped_timeline_item_id, metadata.source_timeline_item_id, metadata.timeline_item_id);
      const storyboardId = firstString(metadata.mapped_storyboard_item_id, metadata.source_storyboard_item_id, metadata.storyboard_item_id);
      const manifestId = firstString(metadata.source_render_manifest_id, metadata.render_manifest_id);
      const keys = [
        timelineId ? `timeline:${timelineId}` : null,
        storyboardId ? `storyboard:${storyboardId}` : null,
        manifestId ? `manifest:${manifestId}` : null,
        sceneId ? `scene:${sceneId}:concept:${concept.key}:type:${normalizedType}` : null,
      ];
      return keys.filter(Boolean) as string[];
    }

    const approvedByStrictKey = new Map<string, any>();
    for (const asset of assetsForReview) {
      if (!["approved", "locked", "render_ready"].includes(String(asset.status))) continue;
      if (!assetHasUsableUrl(asset)) continue;
      for (const key of approvedAssetLookupKeys(asset)) {
        if (!approvedByStrictKey.has(key)) approvedByStrictKey.set(key, asset);
      }
    }

    function compatibleAssetForCandidate(candidate: any, asset: any, manifestRow: any | null, timeline: any | null, storyboard: any | null) {
      if (!asset) return { ok: false, reason: "No approved asset linked." };
      if (!["approved", "locked", "render_ready"].includes(String(asset.status))) return { ok: false, reason: "Asset is not approved." };
      if (!assetHasUsableUrl(asset)) return { ok: false, reason: "Approved asset has no usable URL." };
      const routing = taxonomyForCandidate(candidate);
      const professionalRisk = professionalRiskForApprovedAsset(asset, {
        requiredAssetType: normalizeReviewAssetType(candidate.asset_type ?? manifestRow?.asset_type, candidateIntentText(candidate)),
        taxonomy: routing.taxonomy,
        hasUsableUrl: true,
      });
      if (professionalRisk.blocks) return { ok: false, reason: professionalRisk.reason ?? "Approved asset is not professional-ready." };
      const cData = plainObject(candidate?.candidate_data);
      const aMeta = plainObject(asset?.metadata);
      const candidateTimelineId = firstString(cData.timeline_item_id, cData.mapped_timeline_item_id, cData.intent?.timeline_item_id, timeline?.id);
      const assetTimelineId = firstString(aMeta.mapped_timeline_item_id, aMeta.source_timeline_item_id);
      if (candidateTimelineId && assetTimelineId && candidateTimelineId !== assetTimelineId) {
        return { ok: false, reason: "Approved asset is mapped to a different timeline item." };
      }
      if (candidate?.storyboard_item_id && aMeta.mapped_storyboard_item_id && String(candidate.storyboard_item_id) !== String(aMeta.mapped_storyboard_item_id)) {
        return { ok: false, reason: "Approved asset is mapped to a different storyboard item." };
      }
      if (manifestRow?.asset_id && String(manifestRow.asset_id) !== String(asset.id)) {
        return { ok: false, reason: "Manifest currently points to a different asset." };
      }
      const sourceClass = sourceClassForAsset(asset);
      if (!isSourceAllowedForTaxonomy(routing.taxonomy, sourceClass)) {
        return { ok: false, reason: `Approved asset source ${sourceClass} is not allowed for ${routing.taxonomy}.` };
      }
      const candidateConcept = visualConceptForText(candidateIntentText(candidate));
      const assetConcept = visualConceptForText(assetIntentText(asset));
      const visibleAssetConcept = visualConceptForText(assetVisibleIntentText(asset));
      const explicitLink =
        Boolean(manifestRow?.asset_id && String(manifestRow.asset_id) === String(asset.id)) ||
        Boolean(candidate.linked_asset_id && String(candidate.linked_asset_id) === String(asset.id));
      if (candidateConcept.key !== visibleAssetConcept.key && isSpecificConcept(visibleAssetConcept.key)) {
        return { ok: false, reason: `Approved asset visible content is ${visibleAssetConcept.label}, not ${candidateConcept.label}.` };
      }
      const strongIntentMatch = candidateConcept.key === assetConcept.key && wordOverlapScore(candidateIntentText(candidate), assetIntentText(asset)) >= 0.28;
      if (!explicitLink && !strongIntentMatch) {
        return { ok: false, reason: `Approved asset intent is ${assetConcept.label}, not ${candidateConcept.label}.` };
      }
      if (explicitLink && candidateConcept.key !== assetConcept.key && wordOverlapScore(candidateIntentText(candidate), assetIntentText(asset)) < 0.18) {
        return { ok: false, reason: `Approved asset exists but does not satisfy this requirement (${assetConcept.label} vs ${candidateConcept.label}).` };
      }
      return { ok: true, reason: "Approved asset matches this requirement." };
    }

    function candidateTimelineContext(c: any) {
      const dataObj = plainObject(c.candidate_data);
      const intent = plainObject(dataObj.intent);
      const explicitTimelineId = firstString(dataObj.timeline_item_id, intent.timeline_item_id, intent.timeline_item_id, intent.item_id);
      const manifestRow =
        (dataObj.source_render_manifest_id ? manifestById.get(String(dataObj.source_render_manifest_id)) : null) ??
        (c.edit_action_id ? manifestByAction.get(String(c.edit_action_id)) : null) ??
        (c.storyboard_item_id ? manifestByStoryboard.get(String(c.storyboard_item_id)) : null) ??
        bestManifestRowForCandidate(c, allManifestRows) ??
        null;
      const timeline =
        (explicitTimelineId ? ((timelineItems ?? []) as any[]).find((it) => String(it.id) === explicitTimelineId) : null) ??
        (c.edit_action_id ? timelineByAction.get(String(c.edit_action_id)) : null) ??
        (c.linked_asset_id ? timelineByAsset.get(String(c.linked_asset_id)) : null) ??
        (c.scene_id ? (timelineByScene.get(String(c.scene_id)) ?? [])[0] : null) ??
        null;
      const storyboard =
        (c.storyboard_item_id ? storyboardById.get(String(c.storyboard_item_id)) : null) ??
        (timeline?.metadata?.storyboard_item_id ? storyboardById.get(String(timeline.metadata.storyboard_item_id)) : null) ??
        null;
      const scene = c.scene_id ? sceneById.get(String(c.scene_id)) : timeline?.scene_id ? sceneById.get(String(timeline.scene_id)) : null;
      const start = Number(timeline?.start_time ?? storyboard?.timeline_start ?? intent.time_range?.start ?? 0);
      const end = Number(timeline?.end_time ?? storyboard?.timeline_end ?? intent.time_range?.end ?? start);
      const narration = ((transcriptSegments ?? []) as any[])
        .filter((seg) => {
          const s = Number(seg.start_time ?? 0);
          const e = Number(seg.end_time ?? s);
          return e >= start && s <= end;
        })
        .map((seg) => seg.text ?? seg.content ?? "")
        .filter(Boolean)
        .join(" ")
        .slice(0, 320);
      const exactApproved = manifestRow?.asset_id ? assetById.get(String(manifestRow.asset_id)) ?? null : null;
      const candidateConcept = visualConceptForText(textSignature(candidateIntentText(c), narration, storyboard?.asset_prompt));
      const candidateNormalizedType = normalizeReviewAssetType(c.asset_type ?? manifestRow?.asset_type, candidateIntentText(c));
      const strictKeys = [
        timeline?.id ? `timeline:${timeline.id}` : null,
        storyboard?.id ? `storyboard:${storyboard.id}` : null,
        manifestRow?.id ? `manifest:${manifestRow.id}` : null,
        (c.scene_id ?? timeline?.scene_id ?? manifestRow?.scene_id)
          ? `scene:${c.scene_id ?? timeline?.scene_id ?? manifestRow?.scene_id}:concept:${candidateConcept.key}:type:${candidateNormalizedType}`
          : null,
      ].filter(Boolean) as string[];
      const looseApproved = strictKeys.map((key) => approvedByStrictKey.get(key)).find(Boolean) ?? null;
      const exactMatch = compatibleAssetForCandidate(c, exactApproved, manifestRow, timeline, storyboard);
      const looseMatch = compatibleAssetForCandidate(c, looseApproved, manifestRow, timeline, storyboard);
      const currentApproved = exactMatch.ok ? exactApproved : looseMatch.ok ? looseApproved : null;
      const mismatchAsset = !currentApproved && (exactApproved || looseApproved) ? (exactApproved ?? looseApproved) : null;
      const mismatchReason = !currentApproved && mismatchAsset ? (exactApproved ? exactMatch.reason : looseMatch.reason) : null;
      return {
        render_manifest: manifestRow
          ? {
              id: manifestRow.id,
              start: manifestRow.timeline_start,
              end: manifestRow.timeline_end,
              layout_name: manifestRow.layout_name,
              action_type: manifestRow.action_type,
              asset_type: manifestRow.asset_type,
              asset_id: manifestRow.asset_id,
            }
          : null,
        timeline_item: timeline
          ? {
              id: timeline.id,
              start_time: timeline.start_time,
              end_time: timeline.end_time,
              duration: timeline.duration,
              layout: timeline.layout,
              asset_type: timeline.asset_type,
              title: timeline.title,
            }
          : null,
        storyboard_item: storyboard
          ? {
              id: storyboard.id,
              item_index: storyboard.item_index,
              visual_type: storyboard.visual_type,
              screen_layout: storyboard.screen_layout,
              asset_prompt: storyboard.asset_prompt,
            }
          : null,
        scene: scene ? { id: scene.id, scene_number: scene.scene_number, title: scene.title } : null,
        narration_excerpt: narration || firstString(intent.narration_context, c.description),
        current_approved_asset: currentApproved
          ? {
              id: currentApproved.id,
              title: currentApproved.title,
              url: firstString(currentApproved.url, currentApproved.preview_url, currentApproved.thumbnail_url),
              thumbnail_url: currentApproved.thumbnail_url,
              source_domain: sourceDomainFromUrl(firstString(currentApproved.url, currentApproved.preview_url, currentApproved.thumbnail_url)),
              status: currentApproved.status,
            }
          : null,
        approved_asset_mismatch: mismatchAsset
          ? {
              id: mismatchAsset.id,
              title: mismatchAsset.title,
              reason: mismatchReason ?? "Approved asset exists but does not satisfy this requirement.",
            }
          : null,
      };
    }

    function enrichCandidate(c: any) {
      const media = candidateMediaFields(c);
      const quality = qualityGradeForCandidate(c);
      const routing = taxonomyForCandidate(c);
      const score = workerScore(c);
      const source = candidateSource(c);
      const license = licenseInfo(c);
      const tier = confidenceTier(c);
      const dataObj = plainObject(c.candidate_data);
      return {
        ...c,
        render_classification: renderClassification(c),
        has_usable_url: Boolean(media.url || media.preview_url || media.thumbnail_url),
        source_url: source.source_url,
        source_domain: source.source_domain,
        preview_url: media.preview_url,
        thumbnail_url: media.thumbnail_url,
        duration_seconds: media.duration_seconds,
        width: media.width,
        height: media.height,
        license_status: license.license_status,
        usage_recommendation: license.usage_recommendation,
        overall_asset_score: candidateOverallScore(c),
        intent_match_score: Number(score.intent_match_score ?? 0) || null,
        medical_relevance_score: Number(score.medical_relevance_score ?? 0) || null,
        source_safety_score: Number(score.source_safety_score ?? 0) || null,
        confidence_tier: tier.tier,
        confidence_label: tier.label,
        bulk_eligible: tier.bulk_eligible,
        confidence_reason: tier.reason,
        is_clinical: isClinicalCandidate(c),
        preferred: Boolean(dataObj.preferred),
        locked: String(c.status) === "locked",
        selection_reason: firstString(dataObj.selection_reason, dataObj.score_reason, score.score_reason, dataObj.mismatch_reason),
        rejection_reason: rejectionReason(c),
        audit_count: Array.isArray(dataObj.approval_audit) ? dataObj.approval_audit.length : 0,
        replacement_history_count: Array.isArray(dataObj.replacement_history) ? dataObj.replacement_history.length : 0,
        quality_grade: quality.grade,
        quality_score: quality.score,
        quality_reason: quality.reason,
        medical_asset_taxonomy: routing.taxonomy,
        routing_status: routing.status,
        routing_reason: routing.reason,
        review_context: candidateTimelineContext(c),
      };
    }

    const grouped: Record<string, any[]> = {};
    const compactCandidates = ((candidates ?? []) as any[]).map(compactReviewCandidate);
    const reviewCandidates = buildReviewCandidatePool(compactCandidates);
    const enrichedCandidates = reviewCandidates.map(enrichCandidate);
    for (const c of enrichedCandidates) {
      const role = roleFor(c.asset_type);
      (grouped[role] ??= []).push({ ...c, role });
    }

    function previewForCandidate(candidate: any) {
      const url = firstString(candidate.thumbnail_url, candidate.preview_url, candidate.source_url);
      if (url) return { url, reason: null };
      const classification = String(candidate.render_classification ?? "").toLowerCase();
      if (classification.includes("placeholder")) return { url: null, reason: "placeholder_plan" };
      if (candidate.rejection_reason) return { url: null, reason: "rejected placeholder" };
      if (String(candidate.status).includes("rejected")) return { url: null, reason: "rejected candidate" };
      return { url: null, reason: "no source_url" };
    }

    const enrichedAssets = assetsForReview.map((asset) => {
      const quality = qualityGradeForAsset(asset);
      const metadata = asset.metadata && typeof asset.metadata === "object" ? asset.metadata : {};
      const url = firstString(asset.url, asset.preview_url, asset.thumbnail_url, metadata.url, metadata.source_url);
      return {
        ...asset,
        source_url: url,
        preview_url: firstString(asset.preview_url, asset.thumbnail_url, url),
        thumbnail_url: firstString(asset.thumbnail_url, asset.preview_url, url),
        quality_grade: quality.grade,
        quality_score: quality.score,
        quality_reason: quality.reason,
        medical_asset_taxonomy: metadata.medical_asset_taxonomy ?? metadata.taxonomy ?? null,
        medical_source_class: sourceClassForAsset(asset),
        normalized_asset_type: normalizeReviewAssetType(asset.asset_type, `${asset.title ?? ""} ${asset.description ?? ""} ${JSON.stringify(metadata)}`),
        layout_role: firstString(metadata.layout_role, metadata.layout_name, metadata.mapped_layout_name),
        timeline_item_id: firstString(metadata.timeline_item_id, metadata.mapped_timeline_item_id),
        requirement_id: firstString(metadata.requirement_id, metadata.asset_brief_id, metadata.from_candidate),
      };
    });

    const manifestRows = allManifestRows;
    function sceneKeyFor(parts: { sceneId?: unknown; sceneIndex?: unknown; start?: unknown; title?: unknown }) {
      if (parts.sceneId) return `scene:${parts.sceneId}`;
      if (parts.sceneIndex !== undefined && parts.sceneIndex !== null) return `index:${parts.sceneIndex}`;
      const start = Number(parts.start);
      if (Number.isFinite(start)) return `time:${Math.floor(start / 10)}`;
      return `project:${String(parts.title ?? "unknown").slice(0, 40)}`;
    }

    const sceneGroups = new Map<string, any>();
    function ensureSceneGroup(seed: any) {
      const key = sceneKeyFor(seed);
      const existing = sceneGroups.get(key);
      if (existing) return existing;
      const scene =
        seed.sceneId ? sceneById.get(String(seed.sceneId)) :
        seed.sceneIndex !== undefined ? ((scenes ?? []) as any[]).find((row) => Number(row.scene_number) === Number(seed.sceneIndex)) :
        null;
      const group = {
        sceneId: seed.sceneId ?? scene?.id ?? null,
        sceneIndex: seed.sceneIndex ?? scene?.scene_number ?? null,
        title: seed.title ?? scene?.title ?? `Scene ${seed.sceneIndex ?? "-"}`,
        start: Number.isFinite(Number(seed.start)) ? Number(seed.start) : null,
        end: Number.isFinite(Number(seed.end)) ? Number(seed.end) : null,
        narration: seed.narration ?? "",
        layoutTarget: seed.layoutTarget ?? null,
        requirements: [] as any[],
        candidates: [] as any[],
        approvedAssets: [] as any[],
        missingRequirements: [] as any[],
        manifestCoverage: { total: 0, ready: 0, missing: 0, missing_from_manifest: 0 },
        renderReady: false,
        warnings: [] as string[],
      };
      sceneGroups.set(key, group);
      return group;
    }

    for (const row of manifestRows) {
      const start = Number(row.timeline_start ?? 0);
      const end = Number(row.timeline_end ?? start);
      const group = ensureSceneGroup({
        sceneId: row.scene_id,
        sceneIndex: row.scene_number,
        start,
        end,
        title: row.scene_title,
        layoutTarget: row.layout_name,
      });
      group.start = group.start === null ? start : Math.min(group.start, start);
      group.end = group.end === null ? end : Math.max(group.end, end);
      group.layoutTarget = group.layoutTarget ?? row.layout_name ?? row.layout ?? null;
      group.manifestCoverage.total += 1;
      const rowReady = manifestRowRenderable(row);
      if (rowReady) group.manifestCoverage.ready += 1;
      else group.manifestCoverage.missing += 1;
      group.requirements.push({
        requirement_id: `manifest:${row.id}`,
        manifest_id: row.id,
        suggested_type: normalizeReviewAssetType(row.asset_type, `${row.action_type ?? ""} ${row.layout_name ?? ""}`),
        required_or_optional: String(row.priority ?? "").toLowerCase().includes("optional") ? "optional" : "required",
        status: rowReady ? "render_ready" : "missing",
        prompt: firstString(row.asset_prompt, row.asset_query, row.title, row.action_type),
        layout_target: row.layout_name ?? row.layout ?? null,
        start,
        end,
      });
    }

    for (const candidate of enrichedCandidates) {
      const ctx = candidate.review_context ?? {};
      const start = Number(ctx.render_manifest?.start ?? ctx.timeline_item?.start_time ?? 0);
      const end = Number(ctx.render_manifest?.end ?? ctx.timeline_item?.end_time ?? start);
      const group = ensureSceneGroup({
        sceneId: ctx.scene?.id ?? candidate.scene_id,
        sceneIndex: ctx.scene?.scene_number,
        start,
        end,
        title: ctx.scene?.title,
        narration: ctx.narration_excerpt,
        layoutTarget: ctx.render_manifest?.layout_name ?? ctx.timeline_item?.layout,
      });
      group.narration = group.narration || ctx.narration_excerpt || "";
      group.start = group.start === null ? start : Math.min(group.start, start);
      group.end = group.end === null ? end : Math.max(group.end, end);
      const preview = previewForCandidate(candidate);
      const normalizedType = normalizeReviewAssetType(candidate.asset_type, `${candidate.title ?? ""} ${candidate.search_query ?? ""} ${candidate.description ?? ""}`);
      const debugOnly =
        candidate.quality_grade === "F" ||
        String(candidate.status).includes("rejected") ||
        candidate.render_classification === "PLACEHOLDER_PLAN" ||
        (!candidate.has_usable_url && String(candidate.medical_source_class ?? "").includes("internal_template")) ||
        candidate.license_status === "unknown";
      group.candidates.push({
        ...candidate,
        normalized_asset_type: normalizedType,
        layout_role: normalizedType,
        preview_url: preview.url,
        preview_unavailable_reason: preview.reason,
        debug_only: debugOnly,
        auto_pick_safe: Boolean(candidate.has_usable_url && !debugOnly && candidate.overall_asset_score >= 80 && candidate.license_status !== "unknown"),
      });
    }

    for (const asset of enrichedAssets) {
      const metadata = plainObject(asset.metadata);
      const sceneId = asset.scene_id ?? metadata.mapped_scene_id ?? metadata.scene_id;
      const start = Number(metadata.start_time ?? 0);
      const end = Number(metadata.end_time ?? start);
      const group = ensureSceneGroup({
        sceneId,
        start,
        end,
        title: asset.title,
      });
      group.approvedAssets.push(asset);
    }

    function requiredAssetTypeFor(candidate: any) {
      if (candidate.medical_asset_taxonomy === "CLINICAL_IMAGE") return "clinical_image";
      if (candidate.medical_asset_taxonomy === "MEDICAL_ILLUSTRATION") return "medical_diagram";
      if (candidate.medical_asset_taxonomy === "CONTEXTUAL_BROLL") return "contextual_broll";
      if (String(candidate.asset_type ?? "").includes("video")) return "contextual_broll";
      return "infographic_or_diagram";
    }

    function timelineFitFor(candidate: any, currentApproved: any) {
      const timeline = candidate.review_context?.timeline_item;
      const manifest = candidate.review_context?.render_manifest;
      if (!timeline && !manifest) return { status: "missing_from_timeline", reason: "No timeline or manifest item is mapped." };
      if (candidate.review_context?.approved_asset_mismatch) return { status: "wrong_asset_mapped", reason: candidate.review_context.approved_asset_mismatch.reason };
      if (!manifest) return { status: "missing_from_manifest", reason: "Timeline item exists but Manifest does not include this requirement." };
      if (!currentApproved) return { status: "missing_asset", reason: "No matching approved asset is linked." };
      if (!manifest.asset_id || String(manifest.asset_id) !== String(currentApproved.id)) {
        return { status: "present_in_manifest_but_wrong_asset", reason: "Manifest is not pointing at the matching approved asset." };
      }
      const start = Number(manifest.start ?? timeline?.start_time ?? 0);
      const end = Number(manifest.end ?? timeline?.end_time ?? start);
      if (Number.isFinite(start) && Number.isFinite(end) && end <= start) return { status: "ends_too_early", reason: "Asset has no visible duration." };
      if (timeline?.layout && manifest.layout_name && String(timeline.layout) !== String(manifest.layout_name)) {
        return { status: "wrong_layout", reason: `Timeline layout is ${timeline.layout}, Manifest layout is ${manifest.layout_name}.` };
      }
      return { status: "renderspec_ok", reason: "Timeline, Manifest, and approved asset mapping are aligned." };
    }

    function aiPromptForRequirement(args: {
      conceptLabel: string;
      narration: string | null;
      layoutName: string | null;
      requiredAssetType: string;
      duration: number | null;
      doctorVisible: string;
    }) {
      const layout = args.layoutName ?? "16:9 educational layout";
      const dimension = args.requiredAssetType === "contextual_broll" ? "1920x1080 video or 16:9 still" : "1920x1080 PNG/WebP";
      return {
        prompt_for_ai_generation: [
          `Create a professional medical education visual for a healthcare video.`,
          `Required visual: ${args.conceptLabel}.`,
          args.narration ? `Narration context: "${args.narration}".` : null,
          `Asset type: ${args.requiredAssetType}.`,
          `Layout target: ${layout}.`,
          `Use a clean clinical style, patient-education friendly, accurate anatomy, restrained hospital palette, high resolution.`,
          args.doctorVisible === "visible" ? "Leave safe space for the doctor/presenter video." : "This may occupy the full frame if needed.",
          `Duration target: ${args.duration ?? "-"} seconds.`,
          `Do not invent exact medical statistics or labels unless they are present in the narration or storyboard.`,
        ].filter(Boolean).join(" "),
        external_generation_prompt: [
          `Professional medical visual, ${args.conceptLabel}.`,
          args.narration ? `Use only this approved context: ${args.narration}` : null,
          `Format: ${dimension}, ${layout}.`,
          `No fake facts. No extra statistics. Suitable for adult patient education.`,
        ].filter(Boolean).join(" "),
        negative_prompt: "No cartoon style, no childish illustration, no emoji icons, no distorted anatomy, no fake labels, no unrelated dental clinic stock, no children unless explicitly requested, no watermark, no misspelled text, no hallucinated statistics, no scary or gory imagery unless clinically appropriate.",
        recommended_dimensions: dimension,
        recommended_aspect_ratio: "16:9",
      };
    }

    function manifestIntentText(row: any, scene: any, action: any, storyboard: any) {
      return textSignature(
        row?.asset_query,
        row?.title,
        row?.asset_type,
        row?.action_type,
        row?.layout_name,
        row?.rationale,
        scene?.title,
        action?.asset_query,
        action?.action_type,
        storyboard?.asset_prompt,
        storyboard?.visual_description,
      );
    }

    function reviewCandidateBucketKey(candidate: any) {
      const dataObj = plainObject(candidate.candidate_data);
      const text = candidateIntentText(candidate);
      const concept = visualConceptForText(text);
      const normalizedType = normalizeReviewAssetType(candidate.asset_type, text);
      const scope =
        firstString(
          dataObj.source_render_manifest_id ? `manifest:${dataObj.source_render_manifest_id}` : null,
          candidate.edit_action_id ? `action:${candidate.edit_action_id}` : null,
          candidate.storyboard_item_id ? `storyboard:${candidate.storyboard_item_id}` : null,
          candidate.scene_id ? `scene:${candidate.scene_id}` : null,
        ) ?? "project";
      return `${scope}|${concept.key}|${normalizedType}`;
    }

    function reviewCandidateRank(candidate: any) {
      const status = String(candidate.status ?? "");
      const statusRank =
        status === "approved" || status === "locked" ? 0 :
        status === "preferred" ? 1 :
        status === "searched" ? 2 :
        status === "pending" ? 3 :
        status.includes("rejected") ? 8 :
        5;
      return {
        statusRank,
        mediaRank: hasUsableMediaUrl(candidate) ? 0 : 1,
        score: candidateOverallScore(candidate),
        priority: Number(candidate.priority ?? 9999),
        createdAt: Date.parse(String(candidate.created_at ?? "")) || 0,
      };
    }

    function compareReviewCandidates(a: any, b: any) {
      const ar = reviewCandidateRank(a);
      const br = reviewCandidateRank(b);
      if (ar.statusRank !== br.statusRank) return ar.statusRank - br.statusRank;
      if (ar.mediaRank !== br.mediaRank) return ar.mediaRank - br.mediaRank;
      if (ar.score !== br.score) return br.score - ar.score;
      if (ar.priority !== br.priority) return ar.priority - br.priority;
      return br.createdAt - ar.createdAt;
    }

    function buildReviewCandidatePool(rows: any[]) {
      const selected = new Map<string, any>();
      const buckets = new Map<string, any[]>();
      for (const candidate of rows) {
        const status = String(candidate.status ?? "");
        if (status === "approved" || status === "locked" || status === "preferred") {
          selected.set(String(candidate.id), candidate);
        }
        const key = reviewCandidateBucketKey(candidate);
        const bucket = buckets.get(key) ?? [];
        bucket.push(candidate);
        buckets.set(key, bucket);
      }
      for (const bucket of buckets.values()) {
        const sorted = bucket.sort(compareReviewCandidates);
        const visible = sorted.filter((candidate) => !String(candidate.status ?? "").includes("rejected")).slice(0, 8);
        const debug = sorted.filter((candidate) => String(candidate.status ?? "").includes("rejected")).slice(0, 2);
        for (const candidate of [...visible, ...debug]) selected.set(String(candidate.id), candidate);
      }
      return Array.from(selected.values()).sort(compareReviewCandidates);
    }

    function timelineForManifestRow(row: any) {
      const byAction = row.edit_action_id ? timelineByAction.get(String(row.edit_action_id)) : null;
      if (byAction) return byAction;
      const byStoryboard = row.storyboard_item_id ? timelineByStoryboard.get(String(row.storyboard_item_id)) : null;
      if (byStoryboard) return byStoryboard;
      return ((timelineItems ?? []) as any[]).find((item) => {
        const sameStoryboard =
          row.storyboard_item_id &&
          plainObject(item.metadata).storyboard_item_id &&
          String(row.storyboard_item_id) === String(plainObject(item.metadata).storyboard_item_id);
        const sameTime =
          Math.abs(Number(item.start_time ?? 0) - Number(row.timeline_start ?? 0)) < 0.1 &&
          Math.abs(Number(item.end_time ?? 0) - Number(row.timeline_end ?? 0)) < 0.1;
        const compatibleType = !row.asset_type || !item.asset_type || String(item.asset_type) === String(row.asset_type);
        return Boolean(sameStoryboard || (sameTime && compatibleType));
      }) ?? null;
    }

    function candidatesForManifestRow(row: any, conceptKey: string, rowTextValue: string) {
      return enrichedCandidates
        .filter((candidate: any) => {
          const best = bestManifestRowForCandidate(candidate, manifestRows);
          if (best?.id && String(best.id) === String(row.id)) return true;
          const sameScene = !candidate.scene_id || !row.scene_id || String(candidate.scene_id) === String(row.scene_id);
          if (!sameScene) return false;
          const candidateConcept = visualConceptForText(candidateIntentText(candidate));
          return candidateConcept.key === conceptKey && wordOverlapScore(candidateIntentText(candidate), rowTextValue) >= 0.25;
        })
        .sort((a: any, b: any) => {
          const approved = Number(["approved", "locked"].includes(String(b.status))) - Number(["approved", "locked"].includes(String(a.status)));
          if (approved) return approved;
          const usable = Number(b.has_usable_url) - Number(a.has_usable_url);
          if (usable) return usable;
          return Number(b.overall_asset_score ?? 0) - Number(a.overall_asset_score ?? 0);
        });
    }

    function manifestRequirementForRow(row: any) {
      const scene = row.scene_id ? sceneById.get(String(row.scene_id)) : null;
      const action = row.edit_action_id ? actionById.get(String(row.edit_action_id)) : null;
      const storyboard = row.storyboard_item_id ? storyboardById.get(String(row.storyboard_item_id)) : null;
      const timeline = timelineForManifestRow(row);
      const start = Number(row.timeline_start ?? timeline?.start_time ?? 0);
      const end = Number(row.timeline_end ?? timeline?.end_time ?? start);
      const narration = ((transcriptSegments ?? []) as any[])
        .filter((seg) => {
          const s = Number(seg.start_time ?? 0);
          const e = Number(seg.end_time ?? s);
          return e >= start && s <= end;
        })
        .map((seg) => seg.text ?? seg.content ?? "")
        .filter(Boolean)
        .join(" ")
        .slice(0, 360);
      const rowTextValue = manifestIntentText(row, scene, action, storyboard);
      const concept = visualConceptForText(rowTextValue);
      const requiredAssetType = normalizeReviewAssetType(row.asset_type, rowTextValue);
      const requiredOrOptional = concept.key === "contextual_broll" || concept.key === "doctor_lower_third" ? "optional" : "required";
      const asset = row.asset_id ? assetById.get(String(row.asset_id)) ?? null : null;
      const candidateMatches = candidatesForManifestRow(row, concept.key, rowTextValue);
      const primaryCandidate = candidateMatches[0] ?? null;
      const hasUrl = asset ? assetHasUsableUrl(asset) : false;
      const professionalRisk = asset
        ? professionalRiskForApprovedAsset(asset, {
            requiredAssetType,
            taxonomy: plainObject(asset.metadata).medical_asset_taxonomy ?? plainObject(asset.metadata).taxonomy,
            hasUsableUrl: hasUrl,
          })
        : { blocks: true, reason: "No approved asset is mapped." };
      const assetConcept = asset ? visualConceptForText(assetIntentText(asset)) : null;
      const visibleAssetConcept = asset ? visualConceptForText(assetVisibleIntentText(asset)) : null;
      const visibleConceptMismatch = Boolean(visibleAssetConcept && concept.key !== visibleAssetConcept.key && isSpecificConcept(visibleAssetConcept.key));
      const conceptMismatch = Boolean(assetConcept && concept.key !== assetConcept.key && (wordOverlapScore(rowTextValue, assetIntentText(asset)) < 0.28 || visibleConceptMismatch));
      const approvedStatus = asset ? ["approved", "locked", "render_ready"].includes(String(asset.status)) : false;
      const presenterResolved = requiredAssetType === "presenter_video" && Boolean(project?.video_path);
      const validApproved = Boolean(
        presenterResolved ||
          (asset && row.asset_id && String(row.asset_id) === String(asset.id) && approvedStatus && hasUrl && !conceptMismatch && !visibleConceptMismatch && !professionalRisk.blocks),
      );
      const notRenderableReason =
        !asset ? "Manifest does not point to an approved asset." :
        !hasUrl ? "Mapped asset has no media URL." :
        professionalRisk.reason ?? "Mapped asset is not professional/render-ready.";
      const currentStatus =
        validApproved ? "resolved" :
        asset && (visibleConceptMismatch || conceptMismatch) ? "approved_asset_mismatch" :
        asset && !hasUrl ? "missing_asset_url" :
        asset && professionalRisk.blocks ? "non_professional_asset" :
        "missing_required";
      const timelineFit = (() => {
        if (!timeline && !presenterResolved) return { status: "missing_from_timeline", reason: "No timeline item matched this manifest row." };
        if (Number.isFinite(start) && Number.isFinite(end) && end <= start) return { status: "ends_too_early", reason: "Asset has no visible duration." };
        if (timeline?.layout && row.layout_name && String(timeline.layout) !== String(row.layout_name)) {
          return { status: "wrong_layout", reason: `Timeline layout is ${timeline.layout}, Manifest layout is ${row.layout_name}.` };
        }
        if (validApproved) return { status: "renderspec_ok", reason: "Timeline, Manifest, and approved asset mapping are aligned." };
        if (!row.asset_id) return { status: "missing_asset", reason: "Manifest does not point to an approved asset." };
        return {
          status: "wrong_asset_mapped",
          reason: visibleConceptMismatch
            ? `Mapped asset visible content is ${visibleAssetConcept?.label}, not ${concept.label}.`
            : conceptMismatch
              ? `Mapped asset is ${assetConcept?.label}, not ${concept.label}.`
              : notRenderableReason,
        };
      })();
      const prompt = aiPromptForRequirement({
        conceptLabel: concept.label,
        narration: narration || null,
        layoutName: row.layout_name ?? timeline?.layout ?? null,
        requiredAssetType,
        duration: Number.isFinite(end - start) && end > start ? end - start : null,
        doctorVisible: String(row.layout_name ?? timeline?.layout ?? "").includes("doctor") || String(row.layout_name ?? "").includes("pip") ? "visible" : "unknown",
      });
      return {
        requirement_id: `req_${String(row.scene_id ?? "project").slice(0, 8)}_${String(row.id).slice(0, 8)}_${concept.key}_${requiredAssetType}`.replace(/[^a-zA-Z0-9_:-]+/g, "_"),
        project_id: data.projectId,
        scene_id: row.scene_id ?? null,
        scene_title: scene?.title ?? row.scene_title ?? null,
        scene_number: scene?.scene_number ?? row.scene_number ?? null,
        timeline_item_id: timeline?.id ?? null,
        storyboard_item_id: row.storyboard_item_id ?? null,
        editorial_action_id: row.edit_action_id ?? null,
        source_render_manifest_id: row.id,
        primary_candidate_id: primaryCandidate?.id ?? null,
        candidate_ids: candidateMatches.map((candidate: any) => candidate.id).slice(0, 25),
        visual_intent: concept.label,
        narration_excerpt: narration || null,
        start_time: Number.isFinite(start) ? start : null,
        end_time: Number.isFinite(end) ? end : null,
        duration: Number.isFinite(end - start) && end > start ? end - start : null,
        required_asset_type: requiredAssetType,
        required_or_optional: requiredOrOptional,
        clinical_priority: ["clinical_image", "medical_diagram"].includes(requiredAssetType) ? "high" : "medium",
        editorial_priority: requiredOrOptional === "required" ? "high" : "optional",
        current_status: currentStatus,
        failure_reason:
          validApproved
            ? timelineFit.reason
            : timelineFit.reason ?? professionalRisk.reason ?? "Upload or approve a matching real asset.",
        suggested_resolution:
          currentStatus === "resolved"
            ? "Ready for professional render."
            : currentStatus === "approved_asset_mismatch"
              ? "Remap or replace the approved asset with one that matches this exact requirement."
              : requiredAssetType === "clinical_image"
                ? "Search trusted/open-license clinical imagery or upload a reviewed non-identifiable clinical image."
                : "Generate or upload a professional medical visual for this exact requirement.",
        ...prompt,
        layout_name: row.layout_name ?? timeline?.layout ?? null,
        doctor_visibility: String(row.layout_name ?? timeline?.layout ?? "").includes("doctor") || String(row.layout_name ?? "").includes("pip") ? "visible" : "not_required_or_unknown",
        timeline_fit_status: timelineFit.status,
        matched_approved_asset_id: presenterResolved ? "source:presenter" : validApproved ? asset?.id ?? null : null,
        mismatch_reason:
          currentStatus === "approved_asset_mismatch"
            ? timelineFit.reason
            : null,
        approved_asset_mismatch:
          currentStatus === "approved_asset_mismatch" && asset
            ? {
                id: asset.id,
                title: asset.title,
                reason: timelineFit.reason,
              }
            : null,
      };
    }

    const statusRank: Record<string, number> = {
      approved_asset_mismatch: 0,
      non_professional_asset: 1,
      unusable_asset_url: 2,
      missing_asset_url: 3,
      missing_required: 4,
      needs_review: 5,
      resolved: 9,
    };
    const assetTodoList = manifestRows
      .map(manifestRequirementForRow)
      .sort((a, b) => {
        const req = Number(b.required_or_optional === "required") - Number(a.required_or_optional === "required");
        if (req) return req;
        const sr = (statusRank[a.current_status] ?? 5) - (statusRank[b.current_status] ?? 5);
        if (sr) return sr;
        return Number(a.start_time ?? 0) - Number(b.start_time ?? 0);
      });
    for (const todo of assetTodoList) {
      const group = ensureSceneGroup({
        sceneId: todo.scene_id,
        sceneIndex: todo.scene_number,
        start: todo.start_time,
        end: todo.end_time,
        title: todo.scene_title,
        narration: todo.narration_excerpt,
        layoutTarget: todo.layout_name,
      });
      group.requirements.push({
        requirement_id: todo.requirement_id,
        primary_candidate_id: todo.primary_candidate_id,
        suggested_type: normalizeReviewAssetType(todo.required_asset_type, todo.visual_intent),
        required_or_optional: todo.required_or_optional,
        status: todo.current_status,
        prompt: todo.prompt_for_ai_generation,
        external_generation_prompt: todo.external_generation_prompt,
        negative_prompt: todo.negative_prompt,
        layout_target: todo.layout_name,
        start: todo.start_time,
        end: todo.end_time,
        timeline_fit_status: todo.timeline_fit_status,
        failure_reason: todo.failure_reason,
      });
      if (todo.current_status !== "resolved" && todo.required_or_optional === "required") {
        group.missingRequirements.push({
          requirement_id: todo.requirement_id,
          visual_intent: todo.visual_intent,
          status: todo.current_status,
          reason: todo.failure_reason,
          primary_candidate_id: todo.primary_candidate_id,
        });
      }
    }
    const sceneAssetGroups = Array.from(sceneGroups.values()).map((group) => {
      const uniqueWarnings = Array.from(new Set(group.warnings));
      const uniqueRequirements = Array.from(
        new Map(group.requirements.map((req: any) => [req.requirement_id, req])).values(),
      );
      const visibleCandidates = group.candidates.filter((candidate: any) => !candidate.debug_only);
      const debugCandidates = group.candidates.filter((candidate: any) => candidate.debug_only);
      const renderReady =
        group.missingRequirements.length === 0 &&
        group.manifestCoverage.missing === 0 &&
        group.manifestCoverage.missing_from_manifest === 0 &&
        group.approvedAssets.some((asset: any) => Boolean(asset.source_url || asset.preview_url || asset.thumbnail_url));
      return {
        ...group,
        requirements: uniqueRequirements,
        candidates: visibleCandidates,
        debugCandidates,
        missingRequirements: group.missingRequirements,
        manifestCoverage: group.manifestCoverage,
        renderReady,
        warnings: uniqueWarnings,
        scenePrompt: [
          `Create or select professional medical video assets for ${group.title}.`,
          group.narration ? `Narration context: "${group.narration}"` : null,
          group.layoutTarget ? `Layout target: ${group.layoutTarget}.` : null,
          group.start !== null && group.end !== null ? `Duration window: ${Number(group.end - group.start).toFixed(1)} seconds.` : null,
          "Use adult patient education style, preserve presenter safe space, and do not invent facts or statistics.",
        ].filter(Boolean).join(" "),
      };
    }).sort((a, b) => Number(a.start ?? 999999) - Number(b.start ?? 999999));
    const requiredTodos = assetTodoList.filter((t) => t.required_or_optional === "required");
    const unresolvedRequiredTodos = requiredTodos.filter((t) => t.current_status !== "resolved");
    const mismatchTodos = assetTodoList.filter(
      (t) =>
        ["approved_asset_mismatch", "non_professional_asset"].includes(String(t.current_status)) ||
        String(t.timeline_fit_status) === "wrong_asset_mapped",
    );
    const requiredTimingProblems = requiredTodos.filter((t) => !["renderspec_ok", "missing_asset"].includes(String(t.timeline_fit_status)));
    const assetTodoSummary = {
      required_total: requiredTodos.length,
      required_resolved: requiredTodos.filter((t) => t.current_status === "resolved").length,
      required_missing: requiredTodos.filter((t) => t.current_status === "missing_required").length,
      required_mismatch: mismatchTodos.length,
      timing_problems: assetTodoList.filter((t) => !["renderspec_ok", "missing_asset"].includes(String(t.timeline_fit_status))).length,
      required_timing_problems: requiredTimingProblems.length,
      optional_enhancements: assetTodoList.filter((t) => t.required_or_optional === "optional").length,
      professional_ready: unresolvedRequiredTodos.length === 0 && mismatchTodos.length === 0 && requiredTimingProblems.length === 0,
      top_blockers: [...unresolvedRequiredTodos, ...mismatchTodos, ...requiredTimingProblems]
        .filter((todo, index, rows) => rows.findIndex((row) => row.requirement_id === todo.requirement_id) === index)
        .slice(0, 6),
    };

    const reviewPayload = {
      providerStatus: (() => {
        try {
          const configured = {
            pexels: Boolean(process.env.PEXELS_API_KEY),
            pixabay: Boolean(process.env.PIXABAY_API_KEY),
            unsplash: Boolean(process.env.UNSPLASH_ACCESS_KEY),
          };
          return {
            configured,
            anyConfigured: Object.values(configured).some(Boolean),
            message: Object.values(configured).some(Boolean)
              ? "Asset provider configured"
              : "No asset provider configured. Add Pexels/Pixabay key or upload assets manually.",
          };
        } catch {
          return {
            configured: { pexels: false, pixabay: false, unsplash: false },
            anyConfigured: false,
            message: "No asset provider configured. Add Pexels/Pixabay key or upload assets manually.",
          };
        }
      })(),
      candidates: enrichedCandidates,
      assetTodoList,
      assetTodoSummary,
      sceneAssetGroups,
      assets: enrichedAssets,
      projectAssets: projectAssets ?? [],
      scenes: scenes ?? [],
      grouped,
      rawCandidateTotal: (candidates ?? []).length,
      reviewCandidateTotal: reviewCandidates.length,
    };
    return reviewPayload;
  });

const ReviewInput = z.object({
  candidateId: z.string(),
  action: z.enum(["accept", "reject", "replace", "lock", "unlock", "preferred", "mark_missing"]),
  note: z.string().optional(),
  replacementQuery: z.string().optional(),
});
const SceneAssetActionInput = z.object({
  projectId: z.string(),
  sceneId: z.string().nullable().optional(),
  sceneIndex: z.number().nullable().optional(),
  candidateIds: z.array(z.string()).min(1),
  repairLayout: z.boolean().optional(),
});
const SceneManifestRepairInput = z.object({
  projectId: z.string(),
  sceneId: z.string().nullable().optional(),
  sceneIndex: z.number().nullable().optional(),
});

const FulfillInput = z.object({ candidateId: z.string() });
const SearchAssetInput = z.object({
  candidateId: z.string(),
  provider: z.enum(["any", "pexels", "pixabay", "unsplash", "internal"]).default("any"),
});
const FulfillmentResultInput = z.object({
  provider: z.string(),
  result_id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  source_url: z.string(),
  preview_url: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  duration_seconds: z.number().nullable().optional(),
  attribution: z.record(z.string(), z.unknown()).optional(),
  license: z.record(z.string(), z.unknown()).optional(),
});
const ApproveFulfillmentInput = z.object({
  candidateId: z.string(),
  result: FulfillmentResultInput,
});
const AssetUploadUrlInput = z.object({
  candidateId: z.string(),
  filename: z.string(),
  contentType: z.string().optional(),
});
const ApproveUploadedAssetInput = z.object({
  candidateId: z.string(),
  path: z.string(),
  filename: z.string(),
  contentType: z.string().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  duration_seconds: z.number().nullable().optional(),
  specialty: z.string().optional(),
  diagnosis_topic: z.string().optional(),
  anatomy: z.string().optional(),
  visual_concept: z.string().optional(),
  sensitivity_level: z.enum(["safe", "mild clinical", "graphic"]).optional(),
  provenance_notes: z.string().optional(),
});
const ApproveManualUrlInput = z.object({
  candidateId: z.string(),
  source_url: z.string().url(),
  title: z.string().optional(),
  description: z.string().optional(),
  thumbnail_url: z.string().url().optional().or(z.literal("")),
  preview_url: z.string().url().optional().or(z.literal("")),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  duration_seconds: z.number().nullable().optional(),
  attribution: z.string().optional(),
  specialty: z.string().optional(),
  diagnosis_topic: z.string().optional(),
  anatomy: z.string().optional(),
  visual_concept: z.string().optional(),
  sensitivity_level: z.enum(["safe", "mild clinical", "graphic"]).optional(),
  provenance_notes: z.string().optional(),
});

function candidateContext(candidate: any) {
  const data = candidate?.candidate_data && typeof candidate.candidate_data === "object" ? candidate.candidate_data : {};
  return {
    title: candidate?.title ?? null,
    description: candidate?.description ?? null,
    search_query: candidate?.search_query ?? null,
    asset_type: candidate?.asset_type ?? null,
    ...data,
  };
}

async function rebuildProjectRenderContracts(sb: any, projectId: string) {
  try {
    const { buildRenderManifestForProject } = await import("./render/timeline-builder.server");
    await buildRenderManifestForProject(sb, projectId);
  } catch (e) {
    console.warn("manifest rebuild after asset change failed", e);
  }
}

function normalizedWords(value: unknown): Set<string> {
  return new Set(
    String(value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3),
  );
}

function wordOverlapScore(a: unknown, b: unknown): number {
  const left = normalizedWords(a);
  const right = normalizedWords(b);
  if (left.size === 0 || right.size === 0) return 0;
  let hits = 0;
  for (const word of left) if (right.has(word)) hits += 1;
  return hits / Math.max(1, Math.min(left.size, right.size));
}

function candidateMatchText(candidate: any): string {
  const data = plainObject(candidate?.candidate_data);
  const intent = plainObject(data.intent);
  return [
    candidate?.title,
    candidate?.search_query,
    candidate?.description,
    intent.visual_goal,
    intent.expected_visual,
    intent.original_instruction,
    Array.isArray(intent.search_queries) ? intent.search_queries.join(" ") : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function rowMatchText(row: any): string {
  return [row?.asset_query, row?.action_type, row?.asset_type, row?.layout_name, row?.rationale, normalizeReviewAssetType(row?.asset_type, `${row?.action_type ?? ""} ${row?.layout_name ?? ""}`)]
    .filter(Boolean)
    .join(" ");
}

function bestManifestRowForCandidate(candidate: any, manifestRows: any[]): any | null {
  const data = plainObject(candidate?.candidate_data);
  const intent = plainObject(data.intent);
  const explicitIds = new Set(
    [
      data.render_manifest_id,
      data.source_render_manifest_id,
      data.timeline_item_id,
      intent.render_manifest_id,
      intent.timeline_item_id,
      intent.item_id,
      candidate?.edit_action_id,
      candidate?.storyboard_item_id,
    ]
      .map((value) => (value == null ? null : String(value)))
      .filter(Boolean) as string[],
  );
  const exact = manifestRows.find((row) =>
    [row.id, row.edit_action_id, row.storyboard_item_id].some((value) => value && explicitIds.has(String(value))),
  );
  if (exact) return exact;
  if (manifestRows.length === 1) return manifestRows[0];

  const candidateText = candidateMatchText(candidate);
  let best: any | null = null;
  let bestScore = 0;
  for (const row of manifestRows) {
    const compatibleScene = !candidate?.scene_id || !row.scene_id || String(candidate.scene_id) === String(row.scene_id);
    const compatibleStoryboard =
      !candidate?.storyboard_item_id ||
      !row.storyboard_item_id ||
      String(candidate.storyboard_item_id) === String(row.storyboard_item_id);
    const base = wordOverlapScore(candidateText, rowMatchText(row));
    const score = base + (compatibleScene ? 0.08 : 0) + (compatibleStoryboard ? 0.08 : 0);
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return bestScore >= 0.32 ? best : null;
}

async function linkApprovedAssetToManifest(
  sb: any,
  candidate: any,
  assetId: string | null,
  sourceUrl?: string | null,
) {
  if (!assetId) return { linked: false, reason: "missing asset id" };
  const { data: manifestRows, error } = await sb
    .from("render_manifest")
    .select("*")
    .eq("project_id", candidate.project_id)
    .order("render_order", { ascending: true });
  if (error) {
    console.warn("manifest lookup for approved asset failed", error.message);
    return { linked: false, reason: error.message };
  }
  const row = bestManifestRowForCandidate(candidate, (manifestRows ?? []) as any[]);
  if (!row) return { linked: false, reason: "no manifest row matched candidate" };
  const media = candidateMediaFields(candidate);
  const url = firstString(sourceUrl, media.url, media.preview_url, media.thumbnail_url);
  const { error: updateErr } = await sb
    .from("render_manifest")
    .update({
      asset_id: assetId,
      asset_url: url,
      asset_source: "review_approved",
      status: "ready",
    })
    .eq("id", row.id);
  if (updateErr) {
    console.warn("manifest update for approved asset failed", updateErr.message);
    return { linked: false, reason: updateErr.message };
  }
  return { linked: true, manifest_id: row.id, timeline_start: row.timeline_start, timeline_end: row.timeline_end };
}

function matchWorkerAssetToManifest(asset: any, manifestRows: any[], timelineActionByItem: Map<string, string>) {
  const itemId = firstString(asset?.item_id, asset?.intent?.item_id, asset?.intent?.timeline_item_id);
  const pseudoCandidate = {
    title: asset?.title ?? null,
    search_query: firstString(asset?.title, asset?.description, asset?.intent?.expected_visual, asset?.intent?.original_instruction),
    description: asset?.description ?? asset?.intent?.original_instruction ?? null,
    scene_id: asset?.intent?.source_scene_id ?? null,
    storyboard_item_id: asset?.intent?.storyboard_item_id ?? null,
    edit_action_id: itemId ? timelineActionByItem.get(itemId) ?? null : null,
    candidate_data: {
      intent: asset?.intent ?? {},
      timeline_item_id: itemId,
    },
  };
  return bestManifestRowForCandidate(pseudoCandidate, manifestRows);
}

async function persistFulfilledAsset(sb: any, args: {
  candidate: any;
  userId: string;
  provider: string;
  title: string;
  description?: string | null;
  source_url: string;
  preview_url?: string | null;
  thumbnail_url?: string | null;
  duration_seconds?: number | null;
  width?: number | null;
  height?: number | null;
  search_query?: string | null;
  metadata: Record<string, unknown>;
  review_note: string;
}) {
  const now = new Date().toISOString();
  const routing = taxonomyForCandidate(args.candidate);
  const sourceClass = sourceClassForAsset({
    source: args.provider,
    source_type:
      args.provider === "manual_upload"
        ? "upload"
        : args.provider === "manual_url"
          ? "manual"
          : args.provider === "internal"
            ? "generated"
            : args.provider,
    url: args.source_url,
    metadata: args.metadata,
  });
  if (!isSourceAllowedForTaxonomy(routing.taxonomy, sourceClass)) {
    throw new Error(`${routing.taxonomy} cannot be fulfilled from ${args.provider}. ${routing.reason}`);
  }
  const taxonomyQuality = qualityForTaxonomy(routing.taxonomy, sourceClass);
  const { data: manifestRows } = await sb
    .from("render_manifest")
    .select("*")
    .eq("project_id", args.candidate.project_id)
    .order("render_order", { ascending: true });
  const manifestMatch = bestManifestRowForCandidate(args.candidate, (manifestRows ?? []) as any[]);
  const candidateData = plainObject(args.candidate.candidate_data);
  const candidateIntent = plainObject(candidateData.intent);
  let mappedTimelineItemId = firstString(candidateData.timeline_item_id, candidateIntent.timeline_item_id);
  if (!mappedTimelineItemId && manifestMatch) {
    if (manifestMatch.edit_action_id) {
      const { data: timelineMatch } = await sb
        .from("timeline_items")
        .select("id")
        .eq("project_id", args.candidate.project_id)
        .eq("edit_action_id", manifestMatch.edit_action_id)
        .maybeSingle();
      mappedTimelineItemId = timelineMatch?.id ?? null;
    }
    if (!mappedTimelineItemId) {
      const { data: timelineRows } = await sb
        .from("timeline_items")
        .select("id,start_time,end_time,asset_type,scene_id")
        .eq("project_id", args.candidate.project_id)
        .eq("asset_type", manifestMatch.asset_type);
      const start = Number(manifestMatch.timeline_start);
      const end = Number(manifestMatch.timeline_end);
      const match = ((timelineRows ?? []) as any[]).find((row) => {
        const sameScene = !manifestMatch.scene_id || !row.scene_id || String(row.scene_id) === String(manifestMatch.scene_id);
        return sameScene && Math.abs(Number(row.start_time) - start) < 0.05 && Math.abs(Number(row.end_time) - end) < 0.05;
      });
      mappedTimelineItemId = match?.id ?? null;
    }
  }
  const manifestMapping = {
    source_render_manifest_id: manifestMatch?.id ?? null,
    mapped_scene_id: args.candidate.scene_id ?? manifestMatch?.scene_id ?? null,
    mapped_timeline_item_id: mappedTimelineItemId ?? null,
    mapped_storyboard_item_id: args.candidate.storyboard_item_id ?? manifestMatch?.storyboard_item_id ?? null,
    start_time: manifestMatch?.timeline_start ?? null,
    end_time: manifestMatch?.timeline_end ?? null,
  };
  const normalizedAssetType = normalizeReviewAssetType(args.candidate.asset_type, `${args.title ?? ""} ${args.description ?? ""}`);
  const providerSourceType =
    args.provider === "manual_upload"
      ? "upload"
      : args.provider === "manual_url"
        ? "manual"
        : assetSourceTypeFromProvider(args.provider, args.provider === "internal" ? "generated" : "manual");
  const { data: asset, error: assetErr } = await sb.from("assets").insert({
    project_id: args.candidate.project_id,
    scene_id: args.candidate.scene_id,
    asset_type: dbCompatibleAssetType(args.candidate.asset_type, `${args.title ?? ""} ${args.description ?? ""}`),
    source_type: providerSourceType,
    source: args.provider,
    status: "approved",
    title: args.title,
    description: args.description ?? args.candidate.description ?? null,
    url: args.source_url,
    preview_url: args.preview_url ?? args.source_url,
    thumbnail_url: args.thumbnail_url ?? args.preview_url ?? args.source_url,
    duration_seconds: args.duration_seconds ?? null,
    width: args.width ?? null,
    height: args.height ?? null,
    search_query: args.search_query ?? args.candidate.search_query ?? null,
    metadata: {
      classification: "REAL_RENDERABLE_MEDIA",
      medical_asset_taxonomy: routing.taxonomy,
      medical_source_class: sourceClass,
      approval_status: "approved",
      normalized_asset_type: normalizedAssetType,
      original_asset_type: args.candidate.asset_type ?? null,
      layout_role: normalizedAssetType,
      approved_by: args.userId,
      approved_at: now,
      asset_status: args.provider === "manual_upload" || args.provider === "manual_url" ? "manual_upload" : sourceClass,
      routing_status: routing.status,
      routing_reason: routing.reason,
      license_status: args.provider === "manual_upload" ? "user_provided" : undefined,
      usage_recommendation: args.provider === "manual_upload" ? "review_required" : undefined,
      quality_grade: taxonomyQuality.grade,
      quality_score: taxonomyQuality.score,
      quality_reason: taxonomyQuality.reason,
      original_candidate_data: args.candidate.candidate_data ?? null,
      ...args.metadata,
      ...manifestMapping,
    },
    reviewed_by: args.userId,
    reviewed_at: now,
    review_note: args.review_note,
  }).select("id").single();
  if (assetErr || !asset) throw new Error(assetErr?.message ?? "Failed to persist fulfilled asset");

  const role = ROLE_FOR_TYPE[args.candidate.asset_type] ?? "Other";
  await sb.from("project_assets").upsert(
    {
      project_id: args.candidate.project_id,
      asset_id: asset.id,
      role,
      status: "approved",
      notes: args.review_note,
    },
    { onConflict: "project_id,asset_id,role" },
  );
  await sb.from("asset_candidates").update({
    status: "approved",
    linked_asset_id: asset.id,
    thumbnail_url: args.thumbnail_url ?? args.preview_url ?? args.source_url,
    candidate_data: {
      ...(args.candidate.candidate_data ?? {}),
      render_ready: true,
      classification: "REAL_RENDERABLE_MEDIA",
      medical_asset_taxonomy: routing.taxonomy,
      medical_source_class: sourceClass,
      approval_status: "approved",
      asset_status: args.provider === "manual_upload" || args.provider === "manual_url" ? "manual_upload" : sourceClass,
      routing_status: routing.status,
      routing_reason: routing.reason,
      license_status: args.provider === "manual_upload" ? "user_provided" : undefined,
      usage_recommendation: args.provider === "manual_upload" ? "review_required" : undefined,
      quality_grade: taxonomyQuality.grade,
      quality_score: taxonomyQuality.score,
      provider: args.provider,
      result_id: args.metadata.result_id ?? null,
      url: args.source_url,
      source_url: args.source_url,
      media_url: args.source_url,
      preview_url: args.preview_url ?? args.source_url,
      thumbnail_url: args.thumbnail_url ?? args.preview_url ?? args.source_url,
      duration_seconds: args.duration_seconds ?? null,
      width: args.width ?? null,
      height: args.height ?? null,
      ...manifestMapping,
      attribution: args.metadata.fulfillment ?? args.metadata.manual_url ?? args.metadata.upload ?? null,
      license: args.metadata.license ?? null,
      fulfilled_asset_id: asset.id,
    },
    reviewed_by: args.userId,
    reviewed_at: now,
    review_note: args.review_note,
  }).eq("id", args.candidate.id);

  await rebuildProjectRenderContracts(sb, args.candidate.project_id);
  await linkApprovedAssetToManifest(sb, args.candidate, asset.id, args.source_url);
  return asset;
}

export async function reviewAssetCandidateWithClient(
  sb: any,
  userId: string,
  data: z.infer<typeof ReviewInput>,
) {
    const { data: cand, error } = await sb
      .from("asset_candidates")
      .select("*")
      .eq("id", data.candidateId)
      .maybeSingle();
    if (error || !cand) {
      console.warn("reviewAssetCandidate: candidate not found", {
        candidateId: data.candidateId,
        error: error?.message,
      });
      return {
        ok: false as const,
        status: "not_found",
        assetId: null,
        error: "Candidate not found",
      };
    }

    const now = new Date().toISOString();
    let nextStatus: string = cand.status;
    let linkedAssetId: string | null = cand.linked_asset_id ?? null;
    const routing = taxonomyForCandidate(cand);
    const sourceClass = hasUsableMediaUrl(cand)
      ? candidateRenderSourceClass(cand, "manual_url")
      : "placeholder";
    const taxonomyQuality = qualityForTaxonomy(routing.taxonomy, sourceClass as any);
    const mediaForAudit = candidateMediaFields(cand);
    let nextCandidateData = appendReviewAudit(cand, {
      action: data.action,
      by: userId,
      at: now,
      note: data.note ?? null,
      previous_status: cand.status,
      replacement_query: data.replacementQuery ?? null,
      score: candidateOverallScore(cand),
      confidence_tier: confidenceTier(cand).tier,
      source_url: mediaForAudit.url ?? mediaForAudit.preview_url ?? mediaForAudit.thumbnail_url ?? null,
    });

    if (data.action === "reject") {
      nextStatus = "rejected";
      nextCandidateData = {
        ...nextCandidateData,
        rejected_by: userId,
        rejected_at: now,
        rejection_reason: data.note ?? rejectionReason(cand, "Rejected during asset review."),
      };
    } else if (data.action === "mark_missing") {
      nextStatus = "needs_asset";
      if (linkedAssetId) {
        await sb
          .from("assets")
          .update({
            status: "needs_asset",
            review_note: data.note ?? "Marked missing: upload or approve a real asset before professional render.",
          })
          .eq("id", linkedAssetId);
      }
      nextCandidateData = {
        ...nextCandidateData,
        render_ready: false,
        professional_ready: false,
        classification: "PLACEHOLDER_DO_NOT_RENDER_BY_DEFAULT",
        render_classification: "PLACEHOLDER_DO_NOT_RENDER_BY_DEFAULT",
        asset_status: "missing_required",
        selected_asset_status: "missing_required",
        medical_asset_taxonomy: routing.taxonomy,
        medical_source_class: "placeholder",
        routing_status: routing.taxonomy === "CLINICAL_IMAGE" ? "needs_curated_asset" : "needs_manual_upload",
        routing_reason: routing.reason,
        required_action: "Upload or approve a real medical asset.",
        missing_reason: data.note ?? "Marked missing during asset review.",
      };
    } else if (data.action === "lock") {
      nextStatus = "locked";
      if (hasUsableMediaUrl(cand) && !linkedAssetId) {
        const query = cand.search_query;
        const media = candidateMediaFields(cand);
        const normalizedAssetType = normalizeReviewAssetType(cand.asset_type, `${cand.title ?? ""} ${cand.description ?? ""}`);
        const { data: assetRow, error: aErr } = await sb
          .from("assets")
          .insert({
            project_id: cand.project_id,
            scene_id: cand.scene_id,
            asset_type: dbCompatibleAssetType(cand.asset_type, `${cand.title ?? ""} ${cand.description ?? ""}`),
            source_type: "manual",
            source: "review",
            status: "locked",
            title: cand.title ?? cand.search_query?.slice(0, 80) ?? "Locked asset",
            description: cand.description ?? null,
            url: media.url,
            thumbnail_url: media.thumbnail_url,
            preview_url: media.preview_url,
            duration_seconds: media.duration_seconds,
            width: media.width,
            height: media.height,
            search_query: query,
            metadata: {
              from_candidate: cand.id,
              review_action: data.action,
              classification: renderClassification(cand),
              medical_asset_taxonomy: routing.taxonomy,
              medical_source_class: sourceClass,
              normalized_asset_type: normalizedAssetType,
              original_asset_type: cand.asset_type ?? null,
              layout_role: normalizedAssetType,
              routing_status: routing.status,
              routing_reason: routing.reason,
              quality_grade: taxonomyQuality.grade,
              quality_score: taxonomyQuality.score,
              quality_reason: taxonomyQuality.reason,
              locked: true,
              ...media.metadata,
            },
            reviewed_by: userId,
            reviewed_at: now,
            review_note: candidateReviewNote(cand, data.note ?? "Locked during asset review."),
          })
          .select("id")
          .single();
        if (aErr || !assetRow) throw new Error(aErr?.message ?? "Failed to create locked asset");
        linkedAssetId = assetRow.id;
        const role = ROLE_FOR_TYPE[cand.asset_type] ?? "Other";
        await sb.from("project_assets").upsert(
          {
            project_id: cand.project_id,
            asset_id: assetRow.id,
            role,
            status: "approved",
            notes: candidateReviewNote(cand, data.note ?? "Locked during asset review."),
          },
          { onConflict: "project_id,asset_id,role" },
        );
      } else if (linkedAssetId) {
        await sb.from("assets").update({ status: "locked", reviewed_by: userId, reviewed_at: now }).eq("id", linkedAssetId);
      }
      nextCandidateData = {
        ...nextCandidateData,
        render_ready: hasUsableMediaUrl(cand),
        classification: renderClassification(cand),
        medical_asset_taxonomy: routing.taxonomy,
        medical_source_class: sourceClass,
        fulfilled_asset_id: linkedAssetId,
        locked_by: userId,
        locked_at: now,
      };
    } else if (data.action === "unlock") {
      nextStatus = linkedAssetId && hasUsableMediaUrl(cand) ? "approved" : "searched";
      if (linkedAssetId) {
        await sb.from("assets").update({ status: nextStatus === "approved" ? "approved" : "needs_asset" }).eq("id", linkedAssetId);
      }
      nextCandidateData = {
        ...nextCandidateData,
        unlocked_by: userId,
        unlocked_at: now,
      };
    } else if (data.action === "preferred") {
      nextStatus = cand.status;
      nextCandidateData = {
        ...nextCandidateData,
        preferred: true,
        preferred_by: userId,
        preferred_at: now,
        preferred_reason: data.note ?? null,
      };
    } else if (data.action === "accept" || data.action === "replace") {
      const query =
        data.action === "replace" && data.replacementQuery
          ? data.replacementQuery
          : cand.search_query;
      const media = candidateMediaFields(cand);
      const assetStatus = approvedStatusForCandidate(cand);
      const normalizedAssetType = normalizeReviewAssetType(cand.asset_type, `${cand.title ?? ""} ${cand.description ?? ""}`);
      const reviewSource = assetSourceForReviewCandidate(cand, "review");
      const reviewSourceType = assetSourceTypeFromProvider(reviewSource, "manual");
      // Create or reuse an asset for this candidate
      const { data: assetRow, error: aErr } = await sb
        .from("assets")
        .insert({
          project_id: cand.project_id,
          scene_id: cand.scene_id,
          asset_type: dbCompatibleAssetType(cand.asset_type, `${cand.title ?? ""} ${cand.description ?? ""}`),
          source_type: reviewSourceType,
          source: reviewSource,
          status: assetStatus,
          title: cand.title ?? cand.search_query?.slice(0, 80) ?? "Approved asset",
          description: cand.description ?? null,
          url: media.url,
          thumbnail_url: media.thumbnail_url ?? media.preview_url ?? media.url,
          preview_url: media.preview_url ?? media.url,
          duration_seconds: media.duration_seconds,
          width: media.width,
          height: media.height,
          search_query: query,
          metadata: {
            from_candidate: cand.id,
            review_action: data.action,
            classification: renderClassification(cand),
            medical_asset_taxonomy: routing.taxonomy,
            medical_source_class: sourceClass,
            normalized_asset_type: normalizedAssetType,
            original_asset_type: cand.asset_type ?? null,
            layout_role: normalizedAssetType,
            routing_status: hasUsableMediaUrl(cand) ? routing.status : (routing.taxonomy === "CLINICAL_IMAGE" ? "needs_curated_asset" : routing.status),
            routing_reason: routing.reason,
            approval_source: reviewSource,
            approval_source_type: reviewSourceType,
            quality_grade: taxonomyQuality.grade,
            quality_score: taxonomyQuality.score,
            quality_reason: taxonomyQuality.reason,
            ...media.metadata,
          },
          reviewed_by: userId,
          reviewed_at: now,
          review_note: candidateReviewNote(cand, data.note ?? null),
        })
        .select("id")
        .single();
      if (aErr || !assetRow) throw new Error(aErr?.message ?? "Failed to create asset");
      linkedAssetId = assetRow.id;
      nextStatus = hasUsableMediaUrl(cand)
        ? data.action === "replace" ? "replaced" : "approved"
        : "approved";
      nextCandidateData = {
        ...nextCandidateData,
        render_ready: hasUsableMediaUrl(cand),
        classification: renderClassification(cand),
        medical_asset_taxonomy: routing.taxonomy,
        medical_source_class: sourceClass,
        routing_status: routing.status,
        url: media.url,
        source_url: media.url,
        media_url: media.url,
        preview_url: media.preview_url,
        thumbnail_url: media.thumbnail_url,
        duration_seconds: media.duration_seconds,
        width: media.width,
        height: media.height,
        fulfilled_asset_id: linkedAssetId,
        approved_by: userId,
        approved_at: now,
        approval_reason: data.note ?? confidenceTier(cand).reason,
        ...(data.action === "replace"
          ? {
              replacement_history: [
                ...(Array.isArray(plainObject(cand.candidate_data).replacement_history)
                  ? plainObject(cand.candidate_data).replacement_history
                  : []),
                {
                  by: userId,
                  at: now,
                  previous_query: cand.search_query,
                  replacement_query: query,
                  replacement_asset_id: linkedAssetId,
                },
              ],
            }
          : {}),
        ...(media.metadata ?? {}),
      };

      // Register in project_assets registry under the role
      const role = ROLE_FOR_TYPE[cand.asset_type] ?? "Other";
      await sb.from("project_assets").upsert(
        {
          project_id: cand.project_id,
          asset_id: assetRow.id,
          role,
          status: hasUsableMediaUrl(cand) ? "approved" : "pending",
          notes: candidateReviewNote(cand, data.note ?? null),
        },
        { onConflict: "project_id,asset_id,role" },
      );
    }

    await sb
      .from("asset_candidates")
      .update({
        status: nextStatus,
        reviewed_by: userId,
        reviewed_at: now,
        review_note: candidateReviewNote(cand, data.note ?? null),
        linked_asset_id: linkedAssetId,
        thumbnail_url: mediaForAudit.thumbnail_url ?? cand.thumbnail_url,
        candidate_data: nextCandidateData,
        ...(data.action === "replace" && data.replacementQuery
          ? { search_query: data.replacementQuery }
          : {}),
      })
      .eq("id", cand.id);

    // After any approval/lock change, rebuild the manifest so approved assets
    // are referenced by render_manifest rows.
    if (data.action === "accept" || data.action === "replace" || data.action === "lock" || data.action === "unlock" || data.action === "mark_missing") {
      try {
        const { buildRenderManifestForProject } = await import("./render/timeline-builder.server");
        await buildRenderManifestForProject(sb, cand.project_id);
        if ((data.action === "accept" || data.action === "replace" || data.action === "lock") && linkedAssetId) {
          await linkApprovedAssetToManifest(sb, {
            ...cand,
            candidate_data: nextCandidateData,
            linked_asset_id: linkedAssetId,
            search_query: data.action === "replace" && data.replacementQuery ? data.replacementQuery : cand.search_query,
          }, linkedAssetId, firstString(mediaForAudit.url, mediaForAudit.preview_url, mediaForAudit.thumbnail_url));
        }
      } catch (e) {
        console.warn("manifest rebuild after review failed", e);
      }
    }

    return { ok: true, status: nextStatus, assetId: linkedAssetId };
}

export const reviewAssetCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ReviewInput.parse(i))
  .handler(async ({ context, data }) => {
    return reviewAssetCandidateWithClient(context.supabase, context.userId, data);
  });

async function reconcileSceneManifestCoverageWithClient(
  sb: any,
  userId: string,
  input: z.infer<typeof SceneManifestRepairInput>,
) {
  const { buildRenderManifestForProject } = await import("./render/timeline-builder.server");
  await buildRenderManifestForProject(sb, input.projectId);
  let candidateQuery = sb
    .from("asset_candidates")
    .select("*")
    .eq("project_id", input.projectId)
    .not("linked_asset_id", "is", null);
  if (input.sceneId) candidateQuery = candidateQuery.eq("scene_id", input.sceneId);
  const { data: candidates, error } = await candidateQuery;
  if (error) throw new Error(error.message);
  let linked = 0;
  const warnings: string[] = [];
  for (const candidate of (candidates ?? []) as any[]) {
    const media = candidateMediaFields(candidate);
    const result = await linkApprovedAssetToManifest(
      sb,
      candidate,
      candidate.linked_asset_id,
      firstString(media.url, media.preview_url, media.thumbnail_url),
    );
    if (result.linked) linked += 1;
    else warnings.push(`${candidate.title ?? candidate.search_query ?? candidate.id}: ${result.reason}`);
  }
  // Do not rebuild again after linking; manifest rebuilds recreate rows and can
  // erase the asset_id/asset_url attachment we just repaired.
  return {
    ok: true,
    linked,
    warnings: Array.from(new Set(warnings)).slice(0, 10),
    repairedBy: userId,
  };
}

async function ensureSceneLayoutRepairManifestRows(
  sb: any,
  input: {
    projectId: string;
    sceneId?: string | null;
    sceneIndex?: number | null;
    assetIds: string[];
    layoutName: string;
  },
) {
  const assetIds = Array.from(new Set(input.assetIds.filter(Boolean)));
  if (assetIds.length === 0) return { linked: 0, inserted: 0, updated: 0, warnings: [] as string[] };

  const { data: assets, error: assetError } = await sb
    .from("assets")
    .select("*")
    .eq("project_id", input.projectId)
    .in("id", assetIds);
  if (assetError) return { linked: 0, inserted: 0, updated: 0, warnings: [assetError.message] };

  let manifestQuery = sb
    .from("render_manifest")
    .select("*")
    .eq("project_id", input.projectId)
    .order("render_order", { ascending: true });
  if (input.sceneId) manifestQuery = manifestQuery.eq("scene_id", input.sceneId);
  const { data: rows, error: manifestError } = await manifestQuery;
  if (manifestError) return { linked: 0, inserted: 0, updated: 0, warnings: [manifestError.message] };

  const manifestRows = ((rows ?? []) as any[]);
  const base = manifestRows[0];
  if (!base) return { linked: 0, inserted: 0, updated: 0, warnings: ["No manifest row exists for this scene."] };

  let inserted = 0;
  let updated = 0;
  const warnings: string[] = [];
  const rowByAsset = new Map(
    manifestRows
      .filter((row) => row.asset_id)
      .map((row) => [String(row.asset_id), row]),
  );
  const reusableRows = manifestRows.filter((row) => !row.asset_id);

  for (const [index, assetId] of assetIds.entries()) {
    const asset = ((assets ?? []) as any[]).find((row) => String(row.id) === String(assetId));
    const metadata = plainObject(asset?.metadata);
    const sourceUrl = firstString(asset?.url, asset?.preview_url, asset?.thumbnail_url, metadata.url, metadata.source_url, metadata.preview_url, metadata.thumbnail_url);
    if (!asset || !sourceUrl) {
      warnings.push(`${assetId}: approved asset has no renderable URL.`);
      continue;
    }
    const rowPatch = {
      asset_id: asset.id,
      asset_url: sourceUrl,
      asset_source: "review_approved",
      status: "ready",
      asset_type: firstString(metadata.normalized_asset_type, metadata.layout_role, asset.asset_type, base.asset_type) ?? "infographic",
      asset_query: firstString(asset.title, asset.description, base.asset_query) ?? "Approved scene asset",
      layout_name: input.layoutName ?? base.layout_name,
      layer: Number(base.layer ?? base.render_order ?? 0) + index + 1,
      render_order: Number(base.render_order ?? 0) + index + 1,
      priority: Number(base.priority ?? 0) + index + 1,
    };

    const existing = rowByAsset.get(String(asset.id));
    if (existing) {
      const { error } = await sb.from("render_manifest").update(rowPatch).eq("id", existing.id);
      if (error) warnings.push(`${asset.id}: ${error.message}`);
      else updated += 1;
      continue;
    }

    const reusable = reusableRows.shift();
    if (reusable) {
      const { error } = await sb.from("render_manifest").update(rowPatch).eq("id", reusable.id);
      if (error) warnings.push(`${asset.id}: ${error.message}`);
      else updated += 1;
      continue;
    }

    const insertRow = {
      project_id: input.projectId,
      scene_id: input.sceneId ?? base.scene_id ?? null,
      storyboard_item_id: base.storyboard_item_id ?? null,
      edit_action_id: base.edit_action_id ?? null,
      manifest_version: base.manifest_version ?? 6,
      compiled_graphic_id: null,
      layout_id: base.layout_id ?? null,
      timeline_start: Number(base.timeline_start ?? 0),
      timeline_end: Number(base.timeline_end ?? base.timeline_start ?? 0),
      transition: base.transition ?? "cut",
      caption_style: base.caption_style ?? "default",
      doctor_visibility: base.doctor_visibility ?? null,
      doctor_size: base.doctor_size ?? null,
      attention_focus: base.attention_focus ?? null,
      rationale: "Added by scene-level multi-asset layout repair.",
      ...rowPatch,
    };
    const { error } = await sb.from("render_manifest").insert(insertRow);
    if (error) warnings.push(`${asset.id}: ${error.message}`);
    else inserted += 1;
  }

  return {
    linked: updated + inserted,
    inserted,
    updated,
    warnings: Array.from(new Set(warnings)).slice(0, 10),
  };
}

export const reconcileSceneManifestCoverage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SceneManifestRepairInput.parse(i))
  .handler(async ({ context, data }) => {
    return reconcileSceneManifestCoverageWithClient(context.supabase, context.userId, data);
  });

export const approveSceneAssetCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SceneAssetActionInput.parse(i))
  .handler(async ({ context, data }) => {
    const approved: Array<{ candidateId: string; assetId: string | null; status: string }> = [];
    const failed: Array<{ candidateId: string; error: string }> = [];
    for (const candidateId of data.candidateIds) {
      try {
        const result = await reviewAssetCandidateWithClient(context.supabase, context.userId, {
          candidateId,
          action: "accept",
          note: data.repairLayout
            ? "Approved as part of scene-level multi-asset layout repair."
            : "Approved as part of scene-level review.",
        });
        if (result.ok) approved.push({ candidateId, assetId: result.assetId, status: result.status });
        else failed.push({ candidateId, error: result.error ?? result.status ?? "approval failed" });
      } catch (error) {
        failed.push({ candidateId, error: error instanceof Error ? error.message : String(error) });
      }
    }

    let layoutRepair: any = null;
    if (data.repairLayout && approved.length > 0) {
      const approvedAssetIds = approved
        .map((row) => row.assetId)
        .filter((assetId): assetId is string => typeof assetId === "string" && assetId.length > 0);
      const { data: assets } = await context.supabase
        .from("assets")
        .select("*")
        .eq("project_id", data.projectId)
        .in("id", approvedAssetIds);
      const visualAssets = ((assets ?? []) as any[]).filter((asset) => !String(asset.asset_type ?? "").includes("caption"));
      const layoutName = visualAssets.length > 1 ? "doctor_with_infographic" : "full_screen_broll";
      const timelinePatch = {
        layout_repair: {
          requested_by: context.userId,
          requested_at: new Date().toISOString(),
          scene_id: data.sceneId ?? null,
          scene_index: data.sceneIndex ?? null,
          approved_asset_ids: approved.map((row) => row.assetId).filter(Boolean),
          layout_name: layoutName,
          rules: [
            "Do not cover presenter face.",
            "Lower thirds stay in bottom safe area.",
            "Infographics/callouts prefer left or right safe area.",
            "Avoid stacking text on text.",
          ],
        },
      };
      for (const asset of visualAssets) {
        await context.supabase
          .from("assets")
          .update({
            metadata: {
              ...(asset.metadata ?? {}),
              ...timelinePatch,
              layout_role: normalizeReviewAssetType(asset.asset_type, `${asset.title ?? ""} ${asset.description ?? ""}`),
            },
          })
          .eq("id", asset.id);
      }
      layoutRepair = {
        layout_name: layoutName,
        approved_asset_count: visualAssets.length,
        safe_space_compliance: "metadata recorded for worker/layout composer",
        transition_suggestion: "fade",
      };
    }

    const reconcile = await reconcileSceneManifestCoverageWithClient(context.supabase, context.userId, {
      projectId: data.projectId,
      sceneId: data.sceneId ?? null,
      sceneIndex: data.sceneIndex ?? null,
    });
    const multiAssetManifest =
      data.repairLayout && approved.length > 1
        ? await ensureSceneLayoutRepairManifestRows(context.supabase, {
            projectId: data.projectId,
            sceneId: data.sceneId ?? null,
            sceneIndex: data.sceneIndex ?? null,
            assetIds: approved.map((row) => row.assetId).filter((assetId): assetId is string => Boolean(assetId)),
            layoutName: layoutRepair?.layout_name ?? "doctor_with_infographic",
          })
        : null;
    return { ok: failed.length === 0, approved, failed, layoutRepair, reconcile, multiAssetManifest };
  });

export const fulfillAssetCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => FulfillInput.parse(i))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const { fulfillmentStatus, searchFulfillmentAsset } = await import("./assets/fulfillment.server");
    const status = fulfillmentStatus();
    if (!status.configured) return { ok: false as const, reason: status.message, providerStatus: status };
    const { data: cand, error } = await sb.from("asset_candidates").select("*").eq("id", data.candidateId).maybeSingle();
    if (error || !cand) return { ok: false as const, reason: "Candidate not found", providerStatus: status };
    const query = firstString(cand.search_query, cand.title, cand.description);
    if (!query) return { ok: false as const, reason: "Candidate has no search query", providerStatus: status };
    const found = await searchFulfillmentAsset(cand.asset_type, query);
    if (!found) {
      await sb.from("asset_candidates").update({ status: "searched", review_note: "No provider result found for this candidate." }).eq("id", cand.id);
      return { ok: false as const, reason: "No provider result found", providerStatus: status };
    }
    const asset = await persistFulfilledAsset(sb, {
      candidate: cand,
      userId: context.userId,
      provider: found.provider,
      title: found.title || cand.title || query.slice(0, 80),
      description: found.description ?? cand.description ?? null,
      source_url: found.source_url,
      preview_url: found.preview_url,
      thumbnail_url: found.thumbnail_url,
      duration_seconds: found.duration_seconds,
      width: found.width,
      height: found.height,
      search_query: query,
      metadata: { fulfillment: found.attribution, license: found.license, result_id: found.result_id },
      review_note: "Fulfilled from configured asset provider.",
    });
    return { ok: true as const, assetId: asset.id, provider: found.provider };
  });

export const searchAssetCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SearchAssetInput.parse(i))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const { searchFulfillmentAssets } = await import("./assets/fulfillment.server");
    const { data: cand, error } = await sb.from("asset_candidates").select("*").eq("id", data.candidateId).maybeSingle();
    if (error || !cand) return { ok: false as const, reason: "Candidate not found", results: [], warnings: [] };
    const query = firstString(cand.search_query, cand.title, cand.description);
    if (!query) return { ok: false as const, reason: "Candidate has no search query", results: [], warnings: [] };
    const out = await searchFulfillmentAssets({
      assetType: cand.asset_type,
      query,
      provider: data.provider,
      perPage: 8,
      context: candidateContext(cand),
    });
    return {
      ok: out.results.length > 0,
      candidate: JSON.parse(JSON.stringify(cand)),
      query,
      status: JSON.parse(JSON.stringify(out.status)),
      results: JSON.parse(JSON.stringify(out.results)),
      warnings: out.warnings ?? [],
    };
  });

export const approveAssetSearchResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ApproveFulfillmentInput.parse(i))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const { data: cand, error } = await sb.from("asset_candidates").select("*").eq("id", data.candidateId).maybeSingle();
    if (error || !cand) return { ok: false as const, reason: "Candidate not found" };
    const result = data.result;
    const asset = await persistFulfilledAsset(sb, {
      candidate: cand,
      userId: context.userId,
      provider: result.provider,
      title: result.title || cand.title || cand.search_query?.slice(0, 80) || "Fulfilled asset",
      description: result.description ?? cand.description ?? null,
      source_url: result.source_url,
      preview_url: result.preview_url ?? result.source_url,
      thumbnail_url: result.thumbnail_url ?? result.preview_url ?? result.source_url,
      duration_seconds: result.duration_seconds ?? null,
      width: result.width ?? null,
      height: result.height ?? null,
      search_query: cand.search_query,
      metadata: {
        fulfillment: result.attribution ?? {},
        license: result.license ?? {},
        result_id: result.result_id,
      },
      review_note: `Approved selected ${result.provider} result.`,
    });
    return { ok: true as const, assetId: asset.id };
  });

export const createAssetUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => AssetUploadUrlInput.parse(i))
  .handler(async ({ context, data }) => {
    const { data: cand, error } = await context.supabase
      .from("asset_candidates")
      .select("id, project_id")
      .eq("id", data.candidateId)
      .maybeSingle();
    if (error || !cand) throw new Error("Candidate not found");
    const ext = data.filename.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") || "bin";
    const path = `${context.userId}/assets/${cand.project_id}/${crypto.randomUUID()}.${ext}`;
    const { data: signed, error: signErr } = await context.supabase.storage
      .from("videos")
      .createSignedUploadUrl(path);
    if (signErr) throw new Error(signErr.message);
    return { bucket: "videos", path, token: signed.token, signedUrl: signed.signedUrl };
  });

export const approveUploadedAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ApproveUploadedAssetInput.parse(i))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const { data: cand, error } = await sb.from("asset_candidates").select("*").eq("id", data.candidateId).maybeSingle();
    if (error || !cand) return { ok: false as const, reason: "Candidate not found" };
    const { data: signed, error: signErr } = await sb.storage.from("videos").createSignedUrl(data.path, 60 * 60 * 12);
    if (signErr || !signed?.signedUrl) throw new Error(signErr?.message ?? "Could not sign uploaded asset");
    const candData = plainObject(cand.candidate_data);
    const candIntent = plainObject(candData.intent);
    const asset = await persistFulfilledAsset(sb, {
      candidate: cand,
      userId: context.userId,
      provider: "manual_upload",
      title: cand.title ?? data.filename,
      description: cand.description ?? `Manual upload: ${data.filename}`,
      source_url: signed.signedUrl,
      preview_url: signed.signedUrl,
      thumbnail_url: signed.signedUrl,
      duration_seconds: data.duration_seconds ?? null,
      width: data.width ?? null,
      height: data.height ?? null,
      search_query: cand.search_query,
      metadata: {
        upload: {
          bucket: "videos",
          path: data.path,
          filename: data.filename,
          content_type: data.contentType ?? null,
          source: "manual_upload",
          uploaded_by: context.userId,
          uploaded_at: new Date().toISOString(),
        },
        source: "manual_upload",
        license_status: "user_provided",
        usage_recommendation: "review_required",
        approval_status: "approved",
        mapped_scene_id: cand.scene_id ?? null,
        mapped_timeline_item_id: candData.timeline_item_id ?? candIntent.timeline_item_id ?? null,
        mapped_storyboard_item_id: cand.storyboard_item_id ?? candData.storyboard_item_id ?? null,
        start_time: candData.timeline_start ?? candData.start_time ?? plainObject(candIntent.time_range).start ?? null,
        end_time: candData.timeline_end ?? candData.end_time ?? plainObject(candIntent.time_range).end ?? null,
        curated_metadata: {
          specialty: data.specialty?.trim() || "Head & Neck",
          diagnosis_topic: data.diagnosis_topic?.trim() || "Oral cancer",
          anatomy: data.anatomy?.trim() || null,
          visual_concept: data.visual_concept?.trim() || cand.asset_type || null,
          sensitivity_level: data.sensitivity_level ?? "safe",
          provenance_notes: data.provenance_notes?.trim() || null,
          reusable_across_projects: true,
        },
      },
      review_note: "Fulfilled by manual upload.",
    });
    return { ok: true as const, assetId: asset.id };
  });

export const approveManualAssetUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ApproveManualUrlInput.parse(i))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const { data: cand, error } = await sb.from("asset_candidates").select("*").eq("id", data.candidateId).maybeSingle();
    if (error || !cand) return { ok: false as const, reason: "Candidate not found" };
    const asset = await persistFulfilledAsset(sb, {
      candidate: cand,
      userId: context.userId,
      provider: "manual_url",
      title: data.title?.trim() || cand.title || cand.search_query?.slice(0, 80) || "Manual asset URL",
      description: data.description?.trim() || cand.description || null,
      source_url: data.source_url,
      preview_url: data.preview_url || data.source_url,
      thumbnail_url: data.thumbnail_url || data.preview_url || data.source_url,
      duration_seconds: data.duration_seconds ?? null,
      width: data.width ?? null,
      height: data.height ?? null,
      search_query: cand.search_query,
      metadata: {
        manual_url: {
          source_url: data.source_url,
          attribution: data.attribution?.trim() || null,
        },
        curated_metadata: {
          specialty: data.specialty?.trim() || "Head & Neck",
          diagnosis_topic: data.diagnosis_topic?.trim() || "Oral cancer",
          anatomy: data.anatomy?.trim() || null,
          visual_concept: data.visual_concept?.trim() || cand.asset_type || null,
          sensitivity_level: data.sensitivity_level ?? "safe",
          provenance_notes: data.provenance_notes?.trim() || data.attribution?.trim() || null,
          reusable_across_projects: true,
        },
        license: {
          type: "manual_user_supplied",
          requires_review: true,
        },
      },
      review_note: "Fulfilled by manually supplied media URL.",
    });
    return { ok: true as const, assetId: asset.id };
  });

/** Bulk-accept every pending/searched candidate for a project. */
export const acceptAllPendingCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ProjectIdInput.parse(i))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const userId = context.userId;
    const { data: cands, error } = await sb
      .from("asset_candidates")
      .select("*")
      .eq("project_id", data.projectId)
      .in("status", ["pending", "searched"]);
    if (error) throw new Error(error.message);
    const now = new Date().toISOString();
    let accepted = 0;
    let placeholders = 0;
    const approvedPairs: Array<{ candidate: any; assetId: string; sourceUrl: string | null }> = [];
    for (const cand of (cands ?? []) as any[]) {
      const media = candidateMediaFields(cand);
      if (!hasUsableMediaUrl(cand)) {
        await sb
          .from("asset_candidates")
          .update({
            status: "searched",
            reviewed_by: userId,
            reviewed_at: now,
            review_note: "Needs asset: candidate is a text plan without a renderable media URL.",
          })
          .eq("id", cand.id);
        placeholders += 1;
        continue;
      }
      const normalizedAssetType = normalizeReviewAssetType(cand.asset_type, `${cand.title ?? ""} ${cand.description ?? ""}`);
      const reviewSource = assetSourceForReviewCandidate(cand, "bulk-accept");
      const reviewSourceType = assetSourceTypeFromProvider(reviewSource, "manual");
      const { data: assetRow, error: aErr } = await sb
        .from("assets")
        .insert({
          project_id: cand.project_id,
          scene_id: cand.scene_id,
          asset_type: dbCompatibleAssetType(cand.asset_type, `${cand.title ?? ""} ${cand.description ?? ""}`),
          source_type: reviewSourceType,
          source: reviewSource,
          status: "approved",
          title: cand.title ?? cand.search_query?.slice(0, 80) ?? "Approved asset",
          description: cand.description ?? null,
          url: media.url,
          thumbnail_url: media.thumbnail_url ?? media.preview_url ?? media.url,
          preview_url: media.preview_url ?? media.url,
          duration_seconds: media.duration_seconds,
          width: media.width,
          height: media.height,
          search_query: cand.search_query,
          metadata: {
            from_candidate: cand.id,
            review_action: "accept_renderable_only",
            classification: "REAL_RENDERABLE_MEDIA",
            normalized_asset_type: normalizedAssetType,
            original_asset_type: cand.asset_type ?? null,
            layout_role: normalizedAssetType,
            approval_source: reviewSource,
            approval_source_type: reviewSourceType,
            ...media.metadata,
          },
          reviewed_by: userId,
          reviewed_at: now,
        })
        .select("id")
        .single();
      if (aErr || !assetRow) continue;
      const role = ROLE_FOR_TYPE[cand.asset_type] ?? "Other";
      await sb.from("project_assets").upsert(
        {
          project_id: cand.project_id,
          asset_id: assetRow.id,
          role,
          status: "approved",
          notes: null,
        },
        { onConflict: "project_id,asset_id,role" },
      );
      await sb
        .from("asset_candidates")
        .update({
          status: "approved",
          reviewed_by: userId,
          reviewed_at: now,
          linked_asset_id: assetRow.id,
          thumbnail_url: media.thumbnail_url ?? media.preview_url ?? media.url ?? cand.thumbnail_url,
          candidate_data: {
            ...appendReviewAudit(cand, {
              action: "bulk_accept",
              by: userId,
              at: now,
              previous_status: cand.status,
              note: "Bulk-accepted renderable candidate.",
            }),
            render_ready: true,
            fulfilled_asset_id: assetRow.id,
            approved_by: userId,
            approved_at: now,
            approval_reason: "Bulk-accepted renderable candidate.",
            approval_source: reviewSource,
            approval_source_type: reviewSourceType,
            url: media.url,
            source_url: media.url,
            media_url: media.url,
            preview_url: media.preview_url,
            thumbnail_url: media.thumbnail_url ?? media.preview_url ?? media.url,
            duration_seconds: media.duration_seconds,
            width: media.width,
            height: media.height,
          },
        })
        .eq("id", cand.id);
      approvedPairs.push({ candidate: cand, assetId: assetRow.id, sourceUrl: media.url });
      accepted += 1;
    }
    if (accepted > 0) {
      try {
        const { buildRenderManifestForProject } = await import("./render/timeline-builder.server");
        const { ensureApprovedAssetsForEditActions } = await import("./assets/asset-linker.server");
        await ensureApprovedAssetsForEditActions(sb, data.projectId, userId, {
          createMissing: false,
        });
        await buildRenderManifestForProject(sb, data.projectId);
        for (const pair of approvedPairs) {
          await linkApprovedAssetToManifest(sb, pair.candidate, pair.assetId, pair.sourceUrl);
        }
      } catch (e) {
        console.warn("manifest rebuild after bulk accept failed", e);
      }
    }
    return { ok: true, accepted, placeholders };
  });

export async function approveHighConfidenceCandidatesWithClient(sb: any, userId: string, projectId: string) {
    const { data: cands, error } = await sb
      .from("asset_candidates")
      .select("*")
      .eq("project_id", projectId)
      .in("status", ["pending", "searched"]);
    if (error) throw new Error(error.message);
    const now = new Date().toISOString();
    let accepted = 0;
    let skipped = 0;
    const approvedPairs: Array<{ candidate: any; assetId: string; sourceUrl: string | null }> = [];
    for (const cand of (cands ?? []) as any[]) {
      const tier = confidenceTier(cand);
      if (!tier.bulk_eligible || !hasUsableMediaUrl(cand)) {
        skipped += 1;
        continue;
      }
      const media = candidateMediaFields(cand);
      const routing = taxonomyForCandidate(cand);
      const sourceClass = candidateRenderSourceClass(cand, "manual_url");
      const taxonomyQuality = qualityForTaxonomy(routing.taxonomy, sourceClass as any);
      const normalizedAssetType = normalizeReviewAssetType(cand.asset_type, `${cand.title ?? ""} ${cand.description ?? ""}`);
      const reviewSource = assetSourceForReviewCandidate(cand, "bulk-high-confidence");
      const reviewSourceType = assetSourceTypeFromProvider(reviewSource, "manual");
      const { data: assetRow, error: aErr } = await sb
        .from("assets")
        .insert({
          project_id: cand.project_id,
          scene_id: cand.scene_id,
          asset_type: dbCompatibleAssetType(cand.asset_type, `${cand.title ?? ""} ${cand.description ?? ""}`),
          source_type: reviewSourceType,
          source: reviewSource,
          status: "approved",
          title: cand.title ?? cand.search_query?.slice(0, 80) ?? "Approved asset",
          description: cand.description ?? null,
          url: media.url,
          thumbnail_url: media.thumbnail_url ?? media.preview_url ?? media.url,
          preview_url: media.preview_url ?? media.url,
          duration_seconds: media.duration_seconds,
          width: media.width,
          height: media.height,
          search_query: cand.search_query,
          metadata: {
            from_candidate: cand.id,
            review_action: "approve_high_confidence",
            classification: renderClassification(cand),
            medical_asset_taxonomy: routing.taxonomy,
            medical_source_class: sourceClass,
            normalized_asset_type: normalizedAssetType,
            original_asset_type: cand.asset_type ?? null,
            layout_role: normalizedAssetType,
            routing_status: routing.status,
            routing_reason: routing.reason,
            quality_grade: taxonomyQuality.grade,
            quality_score: taxonomyQuality.score,
            quality_reason: taxonomyQuality.reason,
            confidence_tier: tier.tier,
            confidence_reason: tier.reason,
            approval_source: reviewSource,
            approval_source_type: reviewSourceType,
            ...media.metadata,
          },
          reviewed_by: userId,
          reviewed_at: now,
          review_note: "Bulk-approved high-confidence, non-clinical, safe-license candidate.",
        })
        .select("id")
        .single();
      if (aErr || !assetRow) {
        skipped += 1;
        continue;
      }
      const role = ROLE_FOR_TYPE[cand.asset_type] ?? "Other";
      await sb.from("project_assets").upsert(
        {
          project_id: cand.project_id,
          asset_id: assetRow.id,
          role,
          status: "approved",
          notes: "Bulk-approved high-confidence review candidate.",
        },
        { onConflict: "project_id,asset_id,role" },
      );
      const nextCandidateData = {
        ...appendReviewAudit(cand, {
          action: "approve_high_confidence",
          by: userId,
          at: now,
          previous_status: cand.status,
          score: candidateOverallScore(cand),
          confidence_tier: tier.tier,
        }),
        render_ready: true,
        fulfilled_asset_id: assetRow.id,
        approved_by: userId,
        approved_at: now,
        approval_reason: "Bulk-approved high-confidence, non-clinical, safe-license candidate.",
        url: media.url,
        source_url: media.url,
        media_url: media.url,
        preview_url: media.preview_url,
        thumbnail_url: media.thumbnail_url,
        duration_seconds: media.duration_seconds,
        width: media.width,
        height: media.height,
        approval_source: reviewSource,
        approval_source_type: reviewSourceType,
      };
      await sb
        .from("asset_candidates")
        .update({
          status: "approved",
          reviewed_by: userId,
          reviewed_at: now,
          review_note: "Bulk-approved high-confidence, non-clinical, safe-license candidate.",
          linked_asset_id: assetRow.id,
          thumbnail_url: media.thumbnail_url ?? cand.thumbnail_url,
          candidate_data: nextCandidateData,
        })
        .eq("id", cand.id);
      approvedPairs.push({ candidate: cand, assetId: assetRow.id, sourceUrl: media.url });
      accepted += 1;
    }
    if (accepted > 0) {
      try {
        const { buildRenderManifestForProject } = await import("./render/timeline-builder.server");
        const { ensureApprovedAssetsForEditActions } = await import("./assets/asset-linker.server");
        await ensureApprovedAssetsForEditActions(sb, projectId, userId, { createMissing: false });
        await buildRenderManifestForProject(sb, projectId);
        for (const pair of approvedPairs) {
          await linkApprovedAssetToManifest(sb, pair.candidate, pair.assetId, pair.sourceUrl);
        }
      } catch (e) {
        console.warn("manifest rebuild after high-confidence approval failed", e);
      }
    }
    return { ok: true, accepted, skipped };
}

export const approveHighConfidenceCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ProjectIdInput.parse(i))
  .handler(async ({ context, data }) => {
    return approveHighConfidenceCandidatesWithClient(context.supabase, context.userId, data.projectId);
  });

export async function rejectLowConfidenceCandidatesWithClient(sb: any, userId: string, projectId: string) {
    const { data: cands, error } = await sb
      .from("asset_candidates")
      .select("*")
      .eq("project_id", projectId)
      .in("status", ["pending", "searched"]);
    if (error) throw new Error(error.message);
    const now = new Date().toISOString();
    let rejected = 0;
    let skipped = 0;
    for (const cand of (cands ?? []) as any[]) {
      const license = licenseInfo(cand);
      const score = candidateOverallScore(cand);
      const shouldReject =
        score < 70 ||
        ["restricted", "unsafe"].includes(license.license_status) ||
        license.usage_recommendation === "do_not_use";
      if (!shouldReject) {
        skipped += 1;
        continue;
      }
      const reason =
        rejectionReason(cand) ??
        (score < 70
          ? `Low confidence score ${score}.`
          : `License/usage status is ${license.license_status}/${license.usage_recommendation}.`);
      const nextCandidateData = {
        ...appendReviewAudit(cand, {
          action: "reject_low_confidence",
          by: userId,
          at: now,
          previous_status: cand.status,
          score,
          license_status: license.license_status,
          usage_recommendation: license.usage_recommendation,
        }),
        rejected_by: userId,
        rejected_at: now,
        rejection_reason: reason,
      };
      await sb
        .from("asset_candidates")
        .update({
          status: "rejected",
          reviewed_by: userId,
          reviewed_at: now,
          review_note: reason,
          candidate_data: nextCandidateData,
        })
        .eq("id", cand.id);
      rejected += 1;
    }
    return { ok: true, rejected, skipped };
}

export const rejectLowConfidenceCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ProjectIdInput.parse(i))
  .handler(async ({ context, data }) => {
    return rejectLowConfidenceCandidatesWithClient(context.supabase, context.userId, data.projectId);
  });

export async function exportAssetReviewArtifactsForProject(sb: any, projectId: string) {
    const [
      { data: candidates },
      { data: assets },
      { data: manifest },
      { data: scenes },
      { data: latestOutputs },
      { data: latestJobs },
    ] = await Promise.all([
      sb
        .from("asset_candidates")
        .select("*")
        .eq("project_id", projectId)
        .order("reviewed_at", { ascending: false, nullsFirst: false }),
      sb.from("assets").select("*").eq("project_id", projectId).order("created_at", { ascending: false }),
      sb.from("render_manifest").select("*").eq("project_id", projectId).order("timeline_start", { ascending: true }),
      sb.from("scenes").select("id, scene_number, title").eq("project_id", projectId),
      sb
        .from("render_outputs")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1),
      sb
        .from("render_jobs")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    const sceneById = new Map(((scenes ?? []) as any[]).map((scene) => [String(scene.id), scene]));
    const assetById = new Map(((assets ?? []) as any[]).map((asset) => [String(asset.id), asset]));
    const candidateByAssetId = new Map(
      ((candidates ?? []) as any[])
        .filter((candidate) => candidate.linked_asset_id)
        .map((candidate) => [String(candidate.linked_asset_id), candidate]),
    );
    const reviewAuditEntriesForExport = (candidate: any) => {
      const existing = Array.isArray(candidate.candidate_data?.approval_audit)
        ? candidate.candidate_data.approval_audit
        : [];
      if (existing.length > 0) return existing;
      if (!candidate.reviewed_at && !["approved", "rejected", "locked"].includes(String(candidate.status))) return [];
      return [
        {
          action:
            candidate.status === "rejected"
              ? "legacy_reject"
              : candidate.status === "locked"
                ? "legacy_lock"
                : "legacy_approve",
          by: candidate.reviewed_by ?? candidate.candidate_data?.approved_by ?? candidate.candidate_data?.rejected_by ?? null,
          at: candidate.reviewed_at ?? candidate.candidate_data?.approved_at ?? candidate.candidate_data?.rejected_at ?? null,
          previous_status: null,
          status: candidate.status,
          reason:
            candidate.candidate_data?.approval_reason ??
            candidate.candidate_data?.rejection_reason ??
            candidate.review_note ??
            null,
          source: "export_backfill",
        },
      ];
    };
    const approvalAudit = ((candidates ?? []) as any[]).map((candidate) => ({
      candidate_id: candidate.id,
      status: candidate.status,
      asset_type: candidate.asset_type,
      title: candidate.title,
      search_query: candidate.search_query,
      linked_asset_id: candidate.linked_asset_id,
      reviewed_by: candidate.reviewed_by,
      reviewed_at: candidate.reviewed_at,
      approval_reason: candidate.candidate_data?.approval_reason ?? (candidate.status === "approved" ? candidate.review_note : null),
      rejection_reason: candidate.candidate_data?.rejection_reason ?? (candidate.status === "rejected" ? candidate.review_note : null),
      approval_audit: reviewAuditEntriesForExport(candidate),
    }));
    const replacementHistory = ((candidates ?? []) as any[]).flatMap((candidate) =>
      (candidate.candidate_data?.replacement_history ?? []).map((entry: any) => ({
        candidate_id: candidate.id,
        ...entry,
      })),
    );
    const approvedAssetMap = ((manifest ?? []) as any[])
      .filter((row) => row.asset_id)
      .map((row) => {
        const asset = row.asset_id ? assetById.get(String(row.asset_id)) : null;
        const candidate = row.asset_id ? candidateByAssetId.get(String(row.asset_id)) : null;
        return {
          manifest_id: row.id,
          scene: row.scene_id ? sceneById.get(String(row.scene_id)) ?? null : null,
          start: row.timeline_start,
          end: row.timeline_end,
          layout_name: row.layout_name,
          action_type: row.action_type,
          asset_type: row.asset_type,
          asset_id: row.asset_id,
          asset_title: asset?.title ?? null,
          source_url: firstString(asset?.url, asset?.preview_url, asset?.thumbnail_url, row.asset_url),
          source_domain: sourceDomainFromUrl(firstString(asset?.url, asset?.preview_url, asset?.thumbnail_url, row.asset_url)),
          license_status:
            asset?.metadata?.license_status ??
            asset?.metadata?.candidate_data?.license_status ??
            asset?.metadata?.license?.status ??
            asset?.metadata?.license?.type ??
            "unknown",
          score:
            asset?.metadata?.overall_asset_score ??
            asset?.metadata?.candidate_data?.worker_score?.overall_asset_score ??
            asset?.metadata?.quality_score ??
            null,
          approval_reason:
            asset?.metadata?.approval_reason ??
            asset?.review_note ??
            candidate?.candidate_data?.approval_reason ??
            candidate?.review_note ??
            null,
        };
      });
    const sceneAssetMatrix = ((manifest ?? []) as any[]).map((row) => ({
      scene: row.scene_id ? sceneById.get(String(row.scene_id)) ?? null : null,
      start: row.timeline_start,
      end: row.timeline_end,
      layout_name: row.layout_name,
      action_type: row.action_type,
      asset_type: row.asset_type,
      asset_id: row.asset_id,
      render_ready: manifestRowRenderable(row),
    }));
    const renderQualityReport = {
      project_id: projectId,
      render_job_id: latestJobs?.[0]?.id ?? null,
      provider_job_id: latestJobs?.[0]?.provider_job_id ?? null,
      output_url: latestOutputs?.[0]?.file_url ?? null,
      output_file_size: latestOutputs?.[0]?.file_size ?? null,
      output_duration_seconds: latestOutputs?.[0]?.duration_seconds ?? null,
      generated_at: new Date().toISOString(),
      scenes: approvedAssetMap.map((entry) => ({
        scene: entry.scene,
        time_range: { start: entry.start, end: entry.end },
        approved_asset: {
          id: entry.asset_id,
          title: entry.asset_title,
          source_url: entry.source_url,
          source_domain: entry.source_domain,
          license_status: entry.license_status,
          score: entry.score,
        },
        reason_selected: entry.approval_reason,
        editorial_match: entry.score == null ? "review_required" : entry.score >= 85 ? "strong" : "needs_review",
        visual_quality_assessment: entry.score == null ? "Unknown; reviewer should inspect." : entry.score >= 85 ? "High quality candidate." : "Acceptable but should be reviewed.",
        medical_relevance_assessment: entry.score == null ? "Unknown; reviewer should inspect." : entry.score >= 85 ? "Strong medical relevance." : "Moderate medical relevance.",
      })),
    };
    const assetRequirementMatrix = ((candidates ?? []) as any[]).map((candidate) => {
      const data = plainObject(candidate.candidate_data);
      const linkedAsset = candidate.linked_asset_id ? assetById.get(String(candidate.linked_asset_id)) : null;
      const taxonomy = data.medical_asset_taxonomy ?? taxonomyForCandidate(candidate).taxonomy;
      const sourceClass = linkedAsset ? sourceClassForAsset(linkedAsset) : data.medical_source_class ?? "placeholder";
      const hasLinkedAssetUrl = Boolean(linkedAsset && firstString(linkedAsset.url, linkedAsset.preview_url, linkedAsset.thumbnail_url, linkedAsset.metadata?.url, linkedAsset.metadata?.source_url, linkedAsset.metadata?.preview_url, linkedAsset.metadata?.thumbnail_url));
      const professionalRisk = linkedAsset
        ? professionalRiskForApprovedAsset(linkedAsset, {
            requiredAssetType: candidate.asset_type,
            taxonomy,
            hasUsableUrl: hasLinkedAssetUrl,
          })
        : { blocks: true, reason: "No approved asset linked." };
      const status = data.asset_status ?? data.selected_asset_status ?? (
        candidate.status === "needs_asset" || data.classification === "PLACEHOLDER_DO_NOT_RENDER_BY_DEFAULT"
          ? "missing_required"
          : linkedAsset?.source === "manual_upload" || linkedAsset?.source_type === "upload"
            ? "manual_upload"
            : linkedAsset
              ? sourceClass
              : "missing_required"
      );
      const professionalReady =
        hasLinkedAssetUrl &&
        status !== "missing_required" &&
        data.classification !== "PLACEHOLDER_DO_NOT_RENDER_BY_DEFAULT" &&
        !(["CLINICAL_IMAGE", "MEDICAL_ILLUSTRATION"].includes(String(taxonomy)) && ["internal_template", "internal_svg_library", "placeholder"].includes(String(sourceClass))) &&
        !professionalRisk.blocks;
      return {
        candidate_id: candidate.id,
        scene: candidate.scene_id ? sceneById.get(String(candidate.scene_id)) ?? null : null,
        search_query: candidate.search_query,
        title: candidate.title,
        asset_type: candidate.asset_type,
        required_asset_class: taxonomy,
        selected_asset_id: candidate.linked_asset_id ?? null,
        selected_asset_status: status,
        professional_ready: professionalReady,
        reason: professionalReady ? "Approved real/renderable asset is linked." : professionalRisk.reason ?? data.routing_reason ?? candidate.review_note ?? "Real asset required.",
        required_action: professionalReady ? null : data.required_action ?? "Upload or approve a real medical asset.",
      };
    });
    const failedAssetRequirements = assetRequirementMatrix.filter((row) => !row.professional_ready);
    const manualUploadAudit = ((assets ?? []) as any[])
      .filter((asset) => String(asset.source ?? asset.source_type ?? "").includes("manual") || String(asset.source_type ?? "") === "upload")
      .map((asset) => ({
        asset_id: asset.id,
        title: asset.title,
        asset_type: asset.asset_type,
        source: asset.source ?? asset.source_type,
        url_present: Boolean(firstString(asset.url, asset.preview_url, asset.thumbnail_url)),
        uploaded_by: asset.metadata?.upload?.uploaded_by ?? asset.reviewed_by ?? null,
        uploaded_at: asset.metadata?.upload?.uploaded_at ?? asset.reviewed_at ?? null,
        mapped_scene_id: asset.metadata?.mapped_scene_id ?? asset.scene_id ?? null,
        mapped_timeline_item_id: asset.metadata?.mapped_timeline_item_id ?? null,
        mapped_storyboard_item_id: asset.metadata?.mapped_storyboard_item_id ?? null,
        license_status: asset.metadata?.license_status ?? "user_provided",
      }));
    const professionalReadinessReport = {
      project_id: projectId,
      professional_ready: failedAssetRequirements.length === 0,
      failed_count: failedAssetRequirements.length,
      mismatch_count: failedAssetRequirements.filter((row) => row.selected_asset_id).length,
      failed_asset_requirements: failedAssetRequirements,
    };
    const cartoonRejectionReport = assetRequirementMatrix
      .filter((row) => String(row.reason).match(/internal|template|placeholder|cartoon|generated/i))
      .map((row) => ({
        ...row,
        policy: "Internal cartoon/template clinical or anatomy substitutes are not final professional assets unless explicitly selected by the user.",
      }));
    const manualUploadGuidance = failedAssetRequirements.map((row) => ({
      candidate_id: row.candidate_id,
      required_asset_description: row.reason,
      why_current_asset_failed: row.reason,
      recommended_search_terms: [],
      manual_upload_guidance: row.required_action,
      minimum_acceptance_criteria: "Upload a licensed/user-provided real clinical image, high-quality medical illustration, anatomy diagram, or professional infographic matching the scene intent.",
    }));
    const conceptForExport = (row: any) => {
      const text = `${row.title ?? ""} ${row.search_query ?? ""} ${row.reason ?? ""} ${row.scene?.title ?? ""}`.toLowerCase();
      if (/biopsy|tissue sample|pathology|specimen/.test(text)) return { key: "biopsy_workflow", label: "Oral punch biopsy / biopsy workflow visual" };
      if (/leukoplakia|erythroplakia|white patch|red patch/.test(text)) return { key: "leukoplakia_erythroplakia", label: "Leukoplakia / erythroplakia comparison visual" };
      if (/ulcer|non healing|non-healing|mouth sore|oral lesion/.test(text)) return { key: "oral_ulcer", label: "Oral ulcer clinical image or high-quality medical illustration" };
      if (/lymph|neck lump|neck node|cervical node|swelling/.test(text)) return { key: "cervical_lymph_node", label: "Cervical lymph node anatomy diagram" };
      if (/early detection|detected at an early stage|treatment[^.]{0,40}effective|outcomes[^.]{0,40}better|comparison infographic/.test(text)) return { key: "early_detection", label: "Early detection patient education visual" };
      if (/oral exam|examination|examining|screening|mouth opening|consult specialist|consultation/.test(text)) return { key: "oral_examination", label: "Oral examination visual" };
      if (/india|prevalence|common cancers|map/.test(text)) return { key: "india_prevalence", label: "India prevalence map/stat visual" };
      if (/tobacco|gutkha|mawa|smoking|chewing tobacco/.test(text)) return { key: "tobacco_gutkha_risk", label: "Tobacco / gutkha risk visual" };
      if (/share|family|friends|cta|early diagnosis|save lives|contact/.test(text)) return { key: "cta_branding", label: "CTA branding/contact polish" };
      if (/broll|clinic|consultation|hospital|patient/.test(text)) return { key: "contextual_broll", label: "Optional contextual b-roll" };
      return { key: String(row.required_asset_class ?? "medical_visual").toLowerCase(), label: `${row.required_asset_class ?? "Medical"} visual` };
    };
    const todoMap = new Map<string, any>();
    for (const row of assetRequirementMatrix) {
      const concept = conceptForExport(row);
      const optional = concept.key === "contextual_broll";
      const key = `${optional ? "optional" : "required"}:${concept.key}:${row.required_asset_class}`;
      const existing = todoMap.get(key);
      if (!existing) {
        const requiredType = String(row.required_asset_class ?? "INFOGRAPHIC_CARD").toLowerCase();
        const prompt = `Create a professional medical education visual for a healthcare video. Required visual: ${concept.label}. Asset type: ${requiredType}. Use only Studio-approved narration/storyboard facts. Clean clinical style, patient-education friendly, accurate anatomy, no cartoon style, no fake statistics, no watermark. 16:9 high-resolution output.`;
        todoMap.set(key, {
          requirement_id: `req_${concept.key}_${requiredType}`,
          project_id: projectId,
          scene_id: row.scene?.id ?? null,
          scene_title: row.scene?.title ?? null,
          visual_intent: concept.label,
          required_asset_type: requiredType,
          required_or_optional: optional ? "optional" : "required",
          current_status: row.professional_ready ? "resolved" : row.selected_asset_status === "missing_required" ? "missing_required" : "needs_review",
          failure_reason: row.reason,
          suggested_resolution: row.required_action ?? "Upload or approve a real medical asset.",
          prompt_for_ai_generation: prompt,
          external_generation_prompt: prompt,
          negative_prompt: "No cartoon style, no childish illustration, no distorted anatomy, no fake labels, no unrelated dental clinic stock, no watermark, no text errors, no hallucinated statistics.",
          recommended_dimensions: "1920x1080",
          recommended_aspect_ratio: "16:9",
          timeline_fit_status: row.professional_ready ? "renderspec_ok" : "missing_asset",
          matched_approved_asset_id: row.selected_asset_id ?? null,
          mismatch_reason: row.professional_ready ? null : row.reason,
          candidate_ids: [row.candidate_id],
        });
      } else {
        existing.candidate_ids.push(row.candidate_id);
        if (!row.professional_ready) existing.current_status = existing.current_status === "resolved" ? "needs_review" : existing.current_status;
      }
    }
    const canonicalAssetRequirements = Array.from(todoMap.values());
    const requiredTodos = canonicalAssetRequirements.filter((row) => row.required_or_optional === "required");
    const assetTodoListMd = [
      `# Asset To-Do List`,
      ``,
      `Project: ${projectId}`,
      ``,
      ...canonicalAssetRequirements.map((row) => [
        `## ${row.visual_intent}`,
        `- Status: ${row.current_status}`,
        `- Required: ${row.required_or_optional}`,
        `- Type: ${row.required_asset_type}`,
        `- Scene: ${row.scene_title ?? "-"}`,
        `- Action: ${row.suggested_resolution}`,
        `- Prompt: ${row.external_generation_prompt}`,
      ].join("\n")),
    ].join("\n\n");
    const approvedAssetMismatchReport = assetRequirementMatrix
      .filter((row) => !row.professional_ready && row.selected_asset_id)
      .map((row) => ({
        candidate_id: row.candidate_id,
        selected_asset_id: row.selected_asset_id,
        reason: row.reason,
        required_action: row.required_action,
      }));
    const assetTimelineFitReport = canonicalAssetRequirements.map((row) => ({
      requirement_id: row.requirement_id,
      visual_intent: row.visual_intent,
      required_or_optional: row.required_or_optional,
      timeline_fit_status: row.timeline_fit_status,
      matched_approved_asset_id: row.matched_approved_asset_id,
      mismatch_reason: row.mismatch_reason,
    }));
    const requiredTimingProblems = assetTimelineFitReport.filter(
      (row) => row.required_or_optional === "required" && row.timeline_fit_status !== "renderspec_ok" && row.timeline_fit_status !== "missing_asset",
    );
    const optionalTimingProblems = assetTimelineFitReport.filter(
      (row) => row.required_or_optional === "optional" && row.timeline_fit_status !== "renderspec_ok" && row.timeline_fit_status !== "missing_asset",
    );
    const professionalReadinessSummary = {
      required_assets_total: requiredTodos.length,
      required_assets_resolved: requiredTodos.filter((row) => row.current_status === "resolved").length,
      required_assets_missing: requiredTodos.filter((row) => row.current_status === "missing_required").length,
      required_assets_with_mismatch: approvedAssetMismatchReport.length,
      required_assets_with_timing_problems: requiredTimingProblems.length,
      optional_assets_with_timing_problems: optionalTimingProblems.length,
      optional_enhancements: canonicalAssetRequirements.filter((row) => row.required_or_optional === "optional").length,
      professional_ready:
        requiredTodos.every((row) => row.current_status === "resolved") &&
        approvedAssetMismatchReport.length === 0 &&
        requiredTimingProblems.length === 0,
      top_blockers: [
        ...requiredTodos.filter((row) => row.current_status !== "resolved"),
        ...canonicalAssetRequirements.filter((row) => row.mismatch_reason),
        ...requiredTimingProblems,
      ].slice(0, 8),
    };

    const [{ mkdir, writeFile }, path] = await Promise.all([import("fs/promises"), import("path")]);
    const baseDir = path.join(process.cwd(), "data", "review-artifacts", projectId);
    await mkdir(baseDir, { recursive: true });
    const files = {
      "approval_audit.json": approvalAudit,
      "replacement_history.json": replacementHistory,
      "approved_asset_map.json": approvedAssetMap,
      "scene_asset_matrix.json": sceneAssetMatrix,
      "render_quality_report.json": renderQualityReport,
      "asset_requirement_matrix.json": assetRequirementMatrix,
      "placeholder_audit.json": failedAssetRequirements,
      "manual_upload_audit.json": manualUploadAudit,
      "professional_readiness_report.json": professionalReadinessReport,
      "failed_asset_requirements.json": failedAssetRequirements,
      "render_gating_report.json": professionalReadinessReport,
      "cartoon_rejection_report.json": cartoonRejectionReport,
      "manual_upload_guidance.json": manualUploadGuidance,
      "asset_requirement_triage_report.json": professionalReadinessSummary,
      "asset_todo_list.json": canonicalAssetRequirements,
      "asset_todo_list.md": assetTodoListMd,
      "canonical_asset_requirements.json": canonicalAssetRequirements,
      "approved_asset_mismatch_report.json": approvedAssetMismatchReport,
      "asset_timeline_fit_report.json": assetTimelineFitReport,
      "asset_generation_prompts.json": canonicalAssetRequirements.map((row) => ({
        requirement_id: row.requirement_id,
        visual_intent: row.visual_intent,
        prompt_for_ai_generation: row.prompt_for_ai_generation,
        external_generation_prompt: row.external_generation_prompt,
        negative_prompt: row.negative_prompt,
      })),
      "external_generation_prompts.md": canonicalAssetRequirements.map((row) => `## ${row.visual_intent}\n\n${row.external_generation_prompt}\n\nNegative prompt: ${row.negative_prompt}`).join("\n\n"),
      "single_asset_generation_audit.json": [],
      "human_loop_completion_report.json": {
        project_id: projectId,
        manual_uploads: manualUploadAudit.length,
        requirements_total: canonicalAssetRequirements.length,
        requirements_resolved: canonicalAssetRequirements.filter((row) => row.current_status === "resolved").length,
      },
      "professional_readiness_summary.json": professionalReadinessSummary,
    };
    const written: string[] = [];
    for (const [filename, payload] of Object.entries(files)) {
      const filePath = path.join(baseDir, filename);
      await writeFile(filePath, filename.endsWith(".md") && typeof payload === "string" ? payload : JSON.stringify(payload, null, 2), "utf8");
      written.push(filePath);
    }
    return { ok: true, directory: baseDir, files: written };
}

export const exportAssetReviewArtifacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ProjectIdInput.parse(i))
  .handler(async ({ context, data }) => {
    return exportAssetReviewArtifactsForProject(context.supabase, data.projectId);
  });

/** Project readiness score. 7 weighted gates; each scored 0..1. */
export const getProjectReadiness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ProjectIdInput.parse(i))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const pid = data.projectId;
    const [tx, sp, sb_, ed, ld, ac, rm, ti, assetRows, graphicsRows] = await Promise.all([
      sb
        .from("transcripts")
        .select("project_id", { count: "exact", head: true })
        .eq("project_id", pid),
      sb
        .from("analysis_versions")
        .select("id", { count: "exact", head: true })
        .eq("project_id", pid)
        .eq("task", "scene_plan"),
      sb
        .from("analysis_versions")
        .select("id", { count: "exact", head: true })
        .eq("project_id", pid)
        .eq("task", "visual_storyboard"),
      sb
        .from("analysis_versions")
        .select("id", { count: "exact", head: true })
        .eq("project_id", pid)
        .eq("task", "editorial_decisions"),
      sb
        .from("layout_decisions")
        .select("id", { count: "exact", head: true })
        .eq("project_id", pid),
      sb.from("asset_candidates").select("id, status", { count: "exact" }).eq("project_id", pid),
      sb.from("render_manifest").select("id", { count: "exact", head: true }).eq("project_id", pid),
      sb.from("timeline_items").select("id", { count: "exact", head: true }).eq("project_id", pid),
      sb.from("assets").select("*").eq("project_id", pid),
      sb.from("compiled_graphics").select("*").eq("project_id", pid),
    ]);
    const totalCand = ac.data?.length ?? 0;
    const approvedCand = (ac.data ?? []).filter(
      (r: any) => r.status === "approved" || r.status === "locked" || r.status === "replaced",
    ).length;
    const renderableAssetCount = ((assetRows.data ?? []) as any[]).filter(
      (a) => ["approved", "locked", "render_ready"].includes(String(a.status)) && firstString(a.url, a.preview_url, a.thumbnail_url, a.metadata?.url, a.metadata?.source_url, a.metadata?.preview_url, a.metadata?.thumbnail_url),
    ).length;
    const placeholderAssetCount = ((assetRows.data ?? []) as any[]).filter(
      (a) => ["approved_placeholder", "needs_asset", "placeholder_plan"].includes(String(a.status)) || a.metadata?.classification === "PLACEHOLDER_PLAN",
    ).length;
    const compiledGraphicCount = graphicsRows.data?.length ?? 0;
    const assetsScore = totalCand === 0
      ? 0
      : Math.min(1, (renderableAssetCount + compiledGraphicCount) / Math.max(1, totalCand));
    const [{ data: manifestRows }, { data: sceneRows }] = await Promise.all([
      sb
        .from("render_manifest")
        .select("id, scene_id, asset_id, asset_type, asset_source, compiled_graphic_id, status, timeline_start, timeline_end")
        .eq("project_id", pid),
      sb.from("scenes").select("id, scene_number, title").eq("project_id", pid),
    ]);
    const renderableAssets = ((assetRows.data ?? []) as any[]).filter(
      (a) => ["approved", "locked", "render_ready"].includes(String(a.status)) && firstString(a.url, a.preview_url, a.thumbnail_url, a.metadata?.url, a.metadata?.source_url, a.metadata?.preview_url, a.metadata?.thumbnail_url),
    );
    const assetQuality = renderableAssets.map(qualityGradeForAsset);
    const avgAssetQuality = assetQuality.length > 0
      ? assetQuality.reduce((sum, q) => sum + q.score, 0) / assetQuality.length
      : 0;
    const qualityCounts = assetQuality.reduce<Record<string, number>>((acc, q) => {
      acc[q.grade] = (acc[q.grade] ?? 0) + 1;
      return acc;
    }, {});
    const manifest = (manifestRows ?? []) as any[];
    const scenes = (sceneRows ?? []) as any[];
    const renderableVisualRows = manifest.filter((r) => r.asset_id || r.compiled_graphic_id || String(r.asset_source ?? "") === "compiled_graphic");
    const visualCoverageScore = manifest.length > 0 ? renderableVisualRows.length / manifest.length : 0;
    const infographicRows = manifest.filter((r) => String(r.asset_type ?? "").includes("infographic") || String(r.asset_type ?? "").includes("diagram") || r.compiled_graphic_id);
    const richGraphics = ((graphicsRows.data ?? []) as any[]).filter((g) => {
      const spec = g.spec && typeof g.spec === "object" ? g.spec : {};
      return Boolean(spec.editorial_realization?.template_kind && spec.editorial_realization?.quality_grade);
    });
    const infographicQualityScore = infographicRows.length === 0
      ? (compiledGraphicCount > 0 ? 0.8 : 0.4)
      : Math.min(1, richGraphics.length / Math.max(1, infographicRows.length));
    const clinicalEvidenceAssets = renderableAssets.filter((a) => {
      const type = String(a.asset_type ?? "").toLowerCase();
      const source = String(a.source_type ?? a.source ?? "").toLowerCase();
      return type.includes("clinical") || type.includes("diagram") || source === "upload" || source === "manual" || source === "generated";
    });
    const clinicalEvidenceScore = renderableAssets.length === 0
      ? 0
      : Math.min(1, clinicalEvidenceAssets.length / Math.max(1, renderableAssets.length));
    const sourceAwareQuality = renderableAssets.map((asset) => {
      const metadata = asset.metadata && typeof asset.metadata === "object" ? asset.metadata : {};
      const taxonomy = metadata.medical_asset_taxonomy ?? metadata.taxonomy ?? classifyMedicalAssetRequest({
        assetType: asset.asset_type,
        query: asset.search_query,
        title: asset.title,
        description: asset.description,
      }).taxonomy;
      return qualityForTaxonomy(taxonomy as any, sourceClassForAsset(asset));
    });
    const medicalVisualReadiness = sourceAwareQuality.length > 0
      ? Math.round(sourceAwareQuality.reduce((sum, q) => sum + q.score, 0) / sourceAwareQuality.length)
      : 0;
    const assetCoverage = Math.round(visualCoverageScore * 100);
    const sceneReadiness = scenes.map((scene: any) => {
      const rows = manifest.filter((r) => r.scene_id === scene.id);
      const covered = rows.filter((r) => r.asset_id || r.compiled_graphic_id || String(r.asset_source ?? "") === "compiled_graphic").length;
      const graphicRows = rows.filter((r) => String(r.asset_type ?? "").includes("infographic") || String(r.asset_type ?? "").includes("diagram") || r.compiled_graphic_id);
      const score = rows.length === 0 ? 0 : Math.round(((covered / rows.length) * 0.65 + (graphicRows.length > 0 ? 0.35 : 0.15)) * 100);
      return {
        scene_id: scene.id,
        scene_number: scene.scene_number,
        title: scene.title,
        visual_coverage: rows.length === 0 ? 0 : Math.round((covered / rows.length) * 100),
        infographic_quality: graphicRows.length > 0 ? Math.round(infographicQualityScore * 100) : 0,
        score: Math.min(100, score),
      };
    });
    const editorialGates = [
      { key: "visual_coverage", label: "Visual coverage", score: visualCoverageScore, weight: 0.35 },
      { key: "asset_quality", label: "Asset quality", score: avgAssetQuality / 100, weight: 0.25 },
      { key: "infographic_quality", label: "Infographic quality", score: infographicQualityScore, weight: 0.25 },
      { key: "clinical_evidence", label: "Clinical evidence quality", score: clinicalEvidenceScore, weight: 0.15 },
    ];
    const editorialReadiness = Math.round(editorialGates.reduce((sum, g) => sum + g.score * g.weight, 0) * 100);

    // Layout gate: explicit layout_decisions rows OR layouts baked into the
    // render manifest / timeline (these are produced downstream from layout
    // planning, so their presence implies layout is satisfied).
    let layoutScore = (ld.count ?? 0) > 0 ? 1 : 0;
    if (layoutScore === 0 && ((rm.count ?? 0) > 0 || (ti.count ?? 0) > 0)) {
      layoutScore = 1;
    }

    // Timeline validity gate
    let timelineScore = 0;
    let timelineBlockers: string[] = [];
    if ((ti.count ?? 0) > 0) {
      try {
        const { validateTimelineForProject } = await import("./timeline/timeline-composer.server");
        const v = await validateTimelineForProject(sb, pid);
        timelineScore = v.valid ? 1 : 0.5;
        timelineBlockers = v.issues
          .filter((i: any) => i.level === "error")
          .map((i: any) => i.message);
      } catch {
        timelineScore = 0.5;
      }
    }

    const gates = [
      { key: "transcript", label: "Transcript", weight: 0.08, score: (tx.count ?? 0) > 0 ? 1 : 0 },
      { key: "scene_plan", label: "Scene Plan", weight: 0.12, score: (sp.count ?? 0) > 0 ? 1 : 0 },
      { key: "storyboard", label: "Storyboard", weight: 0.12, score: (sb_.count ?? 0) > 0 ? 1 : 0 },
      { key: "editorial", label: "Editorial", weight: 0.12, score: (ed.count ?? 0) > 0 ? 1 : 0 },
      { key: "layout", label: "Layout", weight: 0.08, score: layoutScore },
      { key: "assets", label: "Renderable visuals", weight: 0.18, score: assetsScore },
      { key: "timeline", label: "Timeline valid", weight: 0.18, score: timelineScore },
      {
        key: "manifest",
        label: "Render Manifest",
        weight: 0.12,
        score: (rm.count ?? 0) > 0 ? 1 : 0,
      },
    ];
    const pct = Math.round(gates.reduce((s, g) => s + g.weight * g.score, 0) * 100);
    const professionalReadinessScore = Math.round(pct * 0.4 + editorialReadiness * 0.3 + medicalVisualReadiness * 0.3);
    type BlockerAction =
      | { kind: "task"; task: string; label: string }
      | { kind: "timeline"; label: string }
      | { kind: "manifest"; label: string }
      | { kind: "approve_assets"; label: string }
      | { kind: "navigate"; tab: string; label: string };
    const blockerActions: { id: string; message: string; fix?: BlockerAction }[] = [];
    if ((tx.count ?? 0) === 0)
      blockerActions.push({
        id: "transcript",
        message: "Transcript missing",
        fix: { kind: "navigate", tab: "transcript", label: "Open transcript" },
      });
    if ((sp.count ?? 0) === 0 && (tx.count ?? 0) > 0)
      blockerActions.push({
        id: "scene_plan",
        message: "Scene plan missing",
        fix: { kind: "task", task: "scene_plan", label: "Generate scene plan" },
      });
    if ((ed.count ?? 0) === 0)
      blockerActions.push({
        id: "editorial",
        message: "Editorial decisions missing",
        fix: { kind: "task", task: "editorial_decisions", label: "Generate editorial" },
      });
    if (totalCand > 0 && renderableAssetCount === 0 && compiledGraphicCount === 0)
      blockerActions.push({
        id: "assets",
        message: "No renderable media or compiled graphics available yet",
        fix: { kind: "approve_assets", label: "Approve renderable only" },
      });
    if ((ti.count ?? 0) === 0)
      blockerActions.push({
        id: "timeline",
        message: "Timeline not composed",
        fix: { kind: "timeline", label: "Compose timeline" },
      });
    if ((rm.count ?? 0) === 0)
      blockerActions.push({
        id: "manifest",
        message: "Render manifest not generated",
        fix: { kind: "manifest", label: "Build manifest" },
      });
    for (const tb of timelineBlockers.slice(0, 3)) {
      blockerActions.push({
        id: `tl_${tb.slice(0, 20)}`,
        message: tb,
        fix: { kind: "timeline", label: "Recompose timeline" },
      });
    }
    const blockers = blockerActions.map((b) => b.message);
    return {
      percent: pct,
      technicalReadiness: pct,
      assetCoverage,
      medicalVisualReadiness,
      editorialReadiness,
      professionalReadinessScore,
      editorialGates,
      sceneReadiness,
      assetQuality: {
        average: Math.round(avgAssetQuality),
        counts: qualityCounts,
        grades: assetQuality,
      },
      gates,
      approvedAssets: approvedCand,
      totalCandidates: totalCand,
      renderableAssets: renderableAssetCount,
      placeholderAssets: placeholderAssetCount,
      compiledGraphics: compiledGraphicCount,
      professionalReadiness:
        professionalReadinessScore >= 85 && placeholderAssetCount === 0
          ? "PROFESSIONALLY_READY"
          : professionalReadinessScore >= 70
            ? "EDITORIAL_REVIEW_RECOMMENDED"
            : placeholderAssetCount > 0 ? "NEEDS_ASSETS" : "NEEDS_REVIEW",
      readyForRender: pct >= 80 && blockers.length === 0,
      blockers,
      blockerActions,
    };
  });

/** Dashboard-wide asset/readiness summary across the user's projects. */
export const getAssetDashboardSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const userId = context.userId;
    const { data: projects } = await sb.from("projects").select("id").eq("user_id", userId);
    const ids = (projects ?? []).map((p: any) => p.id);
    if (ids.length === 0) {
      return { readyForRender: 0, pendingReview: 0, approved: 0, avgReadiness: 0, projectCount: 0 };
    }
    const [cands, manifests] = await Promise.all([
      sb.from("asset_candidates").select("project_id, status").in("project_id", ids),
      sb.from("render_manifest").select("project_id").in("project_id", ids),
    ]);
    const candByProject: Record<string, { total: number; approved: number }> = {};
    let pending = 0,
      approved = 0;
    for (const c of (cands.data ?? []) as any[]) {
      const e = (candByProject[c.project_id] ??= { total: 0, approved: 0 });
      e.total += 1;
      if (c.status === "pending" || c.status === "searched") pending += 1;
      if (c.status === "approved" || c.status === "locked" || c.status === "replaced") {
        approved += 1;
        e.approved += 1;
      }
    }
    const manifestByProject = new Set((manifests.data ?? []).map((m: any) => m.project_id));
    let readyCount = 0;
    let totalPct = 0;
    for (const pid of ids) {
      const e = candByProject[pid] ?? { total: 0, approved: 0 };
      const assetRatio = e.total === 0 ? 0 : e.approved / e.total;
      const manifestOk = manifestByProject.has(pid) ? 1 : 0;
      // simple proxy: assets 60% + manifest 40%
      const pct = Math.round((assetRatio * 0.6 + manifestOk * 0.4) * 100);
      totalPct += pct;
      if (pct >= 80) readyCount += 1;
    }
    return {
      readyForRender: readyCount,
      pendingReview: pending,
      approved,
      avgReadiness: ids.length === 0 ? 0 : Math.round(totalPct / ids.length),
      projectCount: ids.length,
    };
  });
