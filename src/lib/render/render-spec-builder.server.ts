/**
 * Manifest V6 → RenderSpec transformer.
 *
 * Reads the project's authoritative editorial sources (render_manifest,
 * timeline_items/tracks, assets, compiled_graphics, projects) and emits a
 * provider-agnostic RenderSpec. This is the ONLY place that knows how to
 * read Manifest V6. Provider transformers consume the RenderSpec only.
 */
import {
  DEFAULT_CANVAS_FULL,
  DEFAULT_CANVAS_PREVIEW,
  RENDER_SPEC_VERSION,
  type RenderAsset,
  type RenderAssetKind,
  type RenderCaption,
  type RenderGraphic,
  type RenderItem,
  type RenderLayout,
  type RenderSpec,
  type RenderTrack,
  type RenderTrackKind,
  type RenderTransition,
} from "./render-spec";
import { classifyMedicalAssetRequest, sourceClassForAsset } from "../assets/medical-asset-taxonomy.server";

type Sb = any;

const VALID_LAYOUTS: RenderLayout[] = [
  "full_screen",
  "full_screen_broll",
  "full_screen_cta",
  "full_screen_doctor",
  "pip_left",
  "pip_right",
  "split_screen",
  "doctor_with_infographic",
  "doctor_with_clinical_image",
  "doctor_with_broll",
  "doctor_with_callout",
  "doctor_with_lower_third",
  "lower_third",
  "show_lower_third",
  "show_text_overlay",
  "show_callout",
  "show_cta",
  "kinetic_typography",
  "highlight_keyword",
  "top_bottom",
  "picture_in_picture",
  "overlay",
];
const VALID_TRANSITIONS: RenderTransition[] = ["cut", "fade", "dissolve", "slide"];

function normLayout(v: unknown): RenderLayout {
  const value = String(v ?? "").trim();
  return (value || "full_screen") as RenderLayout;
}
function normTransition(v: unknown): RenderTransition {
  return (VALID_TRANSITIONS as string[]).includes(String(v)) ? (v as RenderTransition) : "cut";
}

function normTrackKind(v: unknown): RenderTrackKind {
  switch (String(v ?? "")) {
    case "presenter":
    case "presenter_video":
      return "presenter";
    case "broll":
      return "broll";
    case "clinical_images":
    case "medical_diagrams":
    case "infographics":
    case "graphic":
    case "graphics":
      return "graphics";
    case "captions":
    case "caption":
      return "captions";
    case "audio":
      return "audio";
    case "text_overlays":
    case "cta":
    case "overlay":
      return "overlay";
    default:
      return "overlay";
  }
}

function normAssetKind(v: unknown): RenderAssetKind {
  switch (String(v ?? "")) {
    case "video":
    case "broll":
    case "broll_video":
    case "stock_video":
    case "presenter_video":
      return "video";
    case "image":
    case "clinical_image":
    case "medical_diagram":
    case "diagram":
    case "infographic":
    case "thumbnail":
    case "overlay":
    case "logo":
    case "icon":
      return "image";
    case "audio":
      return "audio";
    case "graphic":
      return "graphic";
    case "caption":
      return "caption";
    case "cta":
      return "cta";
    case "text":
      return "text";
    default:
      return "image";
  }
}

function normalizedLicenseStatus(metadata: any): string | null {
  const raw = String(
    metadata?.license_status ??
      metadata?.candidate_data?.license_status ??
      metadata?.license?.license_status ??
      metadata?.license?.status ??
      metadata?.license?.type ??
      "",
  );
  const provider = String(
    metadata?.provider ??
      metadata?.license?.provider ??
      metadata?.candidate_data?.provider ??
      "",
  ).toLowerCase();
  if (/^(pexels|pixabay)_license$/i.test(raw) || ["pexels", "pixabay"].includes(provider)) {
    return "known_open";
  }
  return raw || null;
}

function normalizedUsageRecommendation(metadata: any, licenseStatus: string | null): string | null {
  const raw =
    metadata?.usage_recommendation ??
    metadata?.candidate_data?.usage_recommendation ??
    metadata?.license?.usage_recommendation ??
    null;
  if (raw) return raw;
  return licenseStatus && ["known_open", "public_domain", "attribution_required"].includes(licenseStatus)
    ? "safe_to_use"
    : null;
}

function kindFromMediaHints(asset: any, sourceUrl?: string | null): RenderAssetKind {
  const upload = asset?.metadata?.upload && typeof asset.metadata.upload === "object" ? asset.metadata.upload : {};
  const contentType = String(asset?.mime_type ?? asset?.content_type ?? upload.content_type ?? "").toLowerCase();
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";

  const urlOrName = String(
    sourceUrl ??
      asset?.url ??
      asset?.preview_url ??
      asset?.thumbnail_url ??
      upload.filename ??
      upload.path ??
      "",
  ).toLowerCase();
  if (/\.(png|jpe?g|webp|gif)(\?|#|$)/.test(urlOrName)) return "image";
  if (/\.(mp4|mov|m4v|webm|avi|mkv)(\?|#|$)/.test(urlOrName)) return "video";
  if (/\.(mp3|wav|m4a|aac|ogg)(\?|#|$)/.test(urlOrName)) return "audio";

  return normAssetKind(asset?.asset_type);
}

function trackIdForKind(specTracks: RenderTrack[], kind: RenderTrackKind, fallback: string) {
  return specTracks.find((t) => t.kind === kind)?.id ?? fallback;
}

function rowTrackId(row: any, specTracks: RenderTrack[], fallback: string) {
  const type = String(row.asset_type ?? row.action_type ?? "");
  if (type === "presenter_video") return trackIdForKind(specTracks, "presenter", fallback);
  if (type === "caption") return trackIdForKind(specTracks, "captions", fallback);
  if (type.includes("broll")) return trackIdForKind(specTracks, "broll", fallback);
  if (isTextAction(type) || type.includes("cta")) return trackIdForKind(specTracks, "overlay", fallback);
  if (
    type.startsWith("show_") ||
    type.includes("graphic") ||
    type.includes("infographic") ||
    type.includes("diagram")
  ) {
    return trackIdForKind(specTracks, "graphics", fallback);
  }
  return fallback;
}

function isTextAction(type: string) {
  return [
    "show_lower_third",
    "show_text_overlay",
    "show_callout",
    "kinetic_typography",
    "highlight_keyword",
    "show_statistic",
    "lower_third",
    "text_overlay",
  ].includes(type);
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function layoutFields(row: any) {
  const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const layoutName = firstString(row?.layout_name, row?.layout, row?.layout_type, meta.layout_name, meta.layout, meta.layout_type);
  return {
    layout: normLayout(layoutName),
    layout_name: firstString(row?.layout_name, meta.layout_name, layoutName),
    layout_type: firstString(row?.layout_type, meta.layout_type),
  };
}

function trackForId(specTracks: RenderTrack[], id: string | null | undefined) {
  return specTracks.find((track) => track.id === String(id ?? "")) ?? null;
}

const RENDER_METADATA_KEYS = [
  "x",
  "y",
  "width",
  "height",
  "anchor",
  "position",
  "margin",
  "padding",
  "safe_area",
  "doctor_position",
  "asset_position",
  "text_position",
  "overlay_position",
  "scale",
  "fit",
  "object_fit",
  "aspect_mode",
  "crop",
  "opacity",
  "z_index",
  "track_index",
  "priority",
  "duration",
  "duration_seconds",
  "source_start",
  "source_end",
  "source_in",
  "source_out",
  "trim_start",
  "trim_end",
  "transition",
  "transition_type",
  "transition_in",
  "transition_out",
  "transition_in_type",
  "transition_out_type",
  "fade_in",
  "fade_out",
  "transition_duration",
  "text",
  "title",
  "subtitle",
  "body",
  "font_size",
  "font_weight",
  "alignment",
  "text_align",
  "background",
  "background_opacity",
  "color",
  "style",
  "lower_third_variant",
  "layout_name",
  "layout",
  "layout_type",
  "action_type",
  "original_action_type",
  "asset_type",
  "asset_kind",
  "track_kind",
  "track_type",
] as const;

const RENDER_METADATA_GROUPS = [
  "positioning",
  "position",
  "box",
  "rect",
  "sizing",
  "layering",
  "timing",
  "transitions",
  "transition",
  "text_style",
  "text",
  "graphics",
  "style",
] as const;

function plainRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function assignKnownMetadata(target: Record<string, unknown>, source: Record<string, unknown>) {
  for (const key of RENDER_METADATA_KEYS) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== "") target[key] = value;
  }
}

function collectRenderMetadata(row: any, base: Record<string, unknown> = {}) {
  const collected: Record<string, unknown> = { ...base };
  const metadata = plainRecord(row?.metadata);
  assignKnownMetadata(collected, row ?? {});
  assignKnownMetadata(collected, metadata);
  for (const group of RENDER_METADATA_GROUPS) {
    const grouped = plainRecord(metadata[group]);
    assignKnownMetadata(collected, grouped);
    if (Object.keys(grouped).length > 0) collected[group] = grouped;
  }
  if (Object.keys(metadata).length > 0) collected.source_metadata = metadata;
  return collected;
}

function optionalNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function itemMetadataFields(meta: Record<string, unknown>): Partial<RenderItem> {
  return {
    x: (meta.x as any) ?? null,
    y: (meta.y as any) ?? null,
    width: (meta.width as any) ?? null,
    height: (meta.height as any) ?? null,
    anchor: firstString(meta.anchor),
    position: firstString(meta.position),
    margin: (meta.margin as any) ?? null,
    padding: (meta.padding as any) ?? null,
    safe_area: meta.safe_area ?? null,
    doctor_position: firstString(meta.doctor_position),
    asset_position: firstString(meta.asset_position),
    text_position: firstString(meta.text_position),
    overlay_position: firstString(meta.overlay_position),
    scale: (meta.scale as any) ?? null,
    fit: firstString(meta.fit),
    object_fit: firstString(meta.object_fit),
    aspect_mode: firstString(meta.aspect_mode),
    crop: meta.crop ?? null,
    opacity: (meta.opacity as any) ?? null,
    z_index: optionalNumber(meta.z_index),
    track_index: optionalNumber(meta.track_index),
    priority: optionalNumber(meta.priority),
    duration: optionalNumber(meta.duration_seconds ?? meta.duration),
    source_start: optionalNumber(meta.source_start ?? meta.source_in),
    source_end: optionalNumber(meta.source_end ?? meta.source_out),
    trim_start: optionalNumber(meta.trim_start),
    trim_end: optionalNumber(meta.trim_end),
    transition: firstString(meta.transition),
    transition_type: firstString(meta.transition_type),
    transition_duration: optionalNumber(meta.transition_duration),
    transition_in_type: firstString(meta.transition_in_type ?? meta.transition_in),
    transition_out_type: firstString(meta.transition_out_type ?? meta.transition_out),
    fade_in: (meta.fade_in as any) ?? null,
    fade_out: (meta.fade_out as any) ?? null,
    text: firstString(meta.text),
    title: firstString(meta.title),
    subtitle: firstString(meta.subtitle),
    body: firstString(meta.body),
    font_size: (meta.font_size as any) ?? null,
    font_weight: (meta.font_weight as any) ?? null,
    alignment: firstString(meta.alignment),
    text_align: firstString(meta.text_align),
    background: firstString(meta.background),
    background_opacity: (meta.background_opacity as any) ?? null,
    color: firstString(meta.color),
    style: meta.style ?? null,
    lower_third_variant: firstString(meta.lower_third_variant),
  };
}

async function createPresenterSignedUrl(sb: Sb, videoPath: string | null | undefined) {
  if (!videoPath) return null;
  try {
    const { data, error } = await sb.storage.from("videos").createSignedUrl(videoPath, 60 * 60);
    if (error) {
      console.warn("RenderSpec presenter signed URL failed", error);
      return null;
    }
    return data?.signedUrl ?? null;
  } catch (e) {
    console.warn("RenderSpec presenter signed URL failed", e);
    return null;
  }
}

export async function buildRenderSpec(
  sb: Sb,
  projectId: string,
  opts: { quality?: "preview" | "full" } = {},
): Promise<RenderSpec> {
  const quality = opts.quality ?? "full";
  const [
    { data: project },
    { data: manifestRows },
    { data: assetRows },
    { data: compiledGraphics },
    { data: tracks },
    { data: timelineItems },
  ] = await Promise.all([
    sb
      .from("projects")
      .select("id, title, duration_seconds, video_path")
      .eq("id", projectId)
      .maybeSingle(),
    sb
      .from("render_manifest")
      .select("*")
      .eq("project_id", projectId)
      .order("render_order", { ascending: true }),
    sb.from("assets").select("*").eq("project_id", projectId),
    sb.from("compiled_graphics").select("*").eq("project_id", projectId),
    sb
      .from("timeline_tracks")
      .select("*")
      .eq("project_id", projectId)
      .order("track_index", { ascending: true }),
    sb
      .from("timeline_items")
      .select("*")
      .eq("project_id", projectId)
      .order("start_time", { ascending: true }),
  ]);

  const assetById = new Map<string, any>((assetRows ?? []).map((a: any) => [a.id, a]));
  const cgById = new Map<string, any>((compiledGraphics ?? []).map((g: any) => [g.id, g]));

  // Canvas
  const canvasBase = quality === "preview" ? DEFAULT_CANVAS_PREVIEW : DEFAULT_CANVAS_FULL;
  const canvas = { ...canvasBase, duration_seconds: Number(project?.duration_seconds) || 0 };

  // Tracks
  const specTracks: RenderTrack[] = (tracks ?? []).map((t: any) => ({
    id: String(t.id),
    kind: normTrackKind(t.track_kind ?? t.kind),
    z_index: Number(t.z_index ?? t.track_index ?? 0),
    label: t.label ?? t.name ?? undefined,
  }));
  // Ensure at least a default track exists so single-track manifests render.
  if (specTracks.length === 0) {
    specTracks.push({ id: "default", kind: "presenter", z_index: 0, label: "default" });
  }
  const defaultTrackId = specTracks[0].id;

  // Assets (referenced from manifest)
  const specAssets: RenderAsset[] = [];
  const seenAsset = new Set<string>();
function pushAsset(a: RenderAsset) {
    if (seenAsset.has(a.id)) return;
    seenAsset.add(a.id);
    specAssets.push(a);
  }

  async function assetSourceUrl(a: any): Promise<string | null> {
    const upload = a?.metadata?.upload && typeof a.metadata.upload === "object" ? a.metadata.upload : null;
    const storagePath = firstString(
      a?.metadata?.storage_path,
      a?.metadata?.storagePath,
      upload?.path,
    );
    const storageBucket = firstString(
      a?.metadata?.storage_bucket,
      a?.metadata?.storageBucket,
      upload?.bucket,
      "videos",
    );
    if (storagePath && storageBucket) {
      try {
        const { data, error } = await sb.storage.from(storageBucket).createSignedUrl(storagePath, 60 * 60 * 12);
        if (!error && data?.signedUrl) return data.signedUrl;
      } catch (e) {
        console.warn("RenderSpec asset signed URL failed", a?.id, e);
      }
    }
    return firstString(
      a?.url,
      a?.source_url,
      a?.media_url,
      a?.preview_url,
      a?.thumbnail_url,
      a?.metadata?.url,
      a?.metadata?.source_url,
      a?.metadata?.media_url,
      a?.metadata?.preview_url,
      a?.metadata?.thumbnail_url,
    );
  }

  function taxonomyMetaFor(row: any, source: "asset" | "graphic" | "url" | "presenter" | "text", asset?: any) {
    if (source === "presenter") {
      return { medical_asset_taxonomy: "CONTEXTUAL_BROLL", medical_source_class: "manual_upload", render_classification: "REAL_RENDERABLE_MEDIA" };
    }
    if (source === "text") {
      return { medical_asset_taxonomy: "INFOGRAPHIC_CARD", medical_source_class: "internal_template", render_classification: "INLINE_TEXT_OVERLAY" };
    }
    const metadata = asset?.metadata && typeof asset.metadata === "object" ? asset.metadata : {};
    const routing = classifyMedicalAssetRequest({
      assetType: asset?.asset_type ?? row?.asset_type,
      query: row?.asset_query ?? asset?.search_query ?? asset?.description,
      actionType: row?.action_type,
      title: asset?.title ?? row?.title,
      description: asset?.description ?? row?.description,
    });
    const sourceClass =
      source === "graphic" ? "internal_template" :
      source === "url" ? "manual_url" :
      sourceClassForAsset(asset);
    const declaredSourceClass = metadata.medical_source_class ?? sourceClass;
    const normalizedSourceClass =
      declaredSourceClass === "internal_generated" ? "internal_template" : declaredSourceClass;
    const declaredTaxonomy = metadata.medical_asset_taxonomy ?? metadata.taxonomy;
    const rawTaxonomy = declaredTaxonomy ?? routing.taxonomy;
    const normalizedTaxonomy =
      rawTaxonomy === "CLINICAL_IMAGE" && (sourceClass === "internal_template" || sourceClass === "internal_svg_library")
        ? "MEDICAL_ILLUSTRATION"
        : rawTaxonomy;
    const licenseStatus = normalizedLicenseStatus(metadata);
    return {
      medical_asset_taxonomy: normalizedTaxonomy,
      medical_source_class: normalizedSourceClass,
      approval_status: asset?.status ?? metadata.approval_status ?? null,
      approved_by: asset?.reviewed_by ?? metadata.approved_by ?? metadata.candidate_data?.approved_by ?? null,
      approved_at: asset?.reviewed_at ?? metadata.approved_at ?? metadata.candidate_data?.approved_at ?? null,
      approval_reason: asset?.review_note ?? metadata.approval_reason ?? metadata.candidate_data?.approval_reason ?? null,
      source_domain: metadata.source_domain ?? metadata.candidate_data?.source_domain ?? null,
      license_status: licenseStatus,
      usage_recommendation: normalizedUsageRecommendation(metadata, licenseStatus),
      overall_asset_score:
        metadata.overall_asset_score ??
        metadata.candidate_data?.worker_score?.overall_asset_score ??
        metadata.candidate_data?.score?.overall_asset_score ??
        metadata.quality_score ??
        null,
      intent_match_score: metadata.candidate_data?.worker_score?.intent_match_score ?? null,
      medical_relevance_score: metadata.candidate_data?.worker_score?.medical_relevance_score ?? null,
      routing_status:
        rawTaxonomy === "CLINICAL_IMAGE" && normalizedTaxonomy === "MEDICAL_ILLUSTRATION"
          ? "codex_asset_pack_required"
          : metadata.routing_status ?? (declaredTaxonomy ? "metadata_declared" : routing.status),
      routing_reason:
        rawTaxonomy === "CLINICAL_IMAGE" && normalizedTaxonomy === "MEDICAL_ILLUSTRATION"
          ? "Internal generated disease visual is not final clinical media; provide a Codex/manual raster asset for approval."
          : metadata.routing_reason ?? (declaredTaxonomy ? "Using reviewed asset taxonomy metadata." : routing.reason),
      render_classification:
        source === "graphic" ? "COMPILED_GRAPHIC" :
        source === "url" ? "REAL_RENDERABLE_MEDIA" :
        metadata.classification ?? "REAL_RENDERABLE_MEDIA",
      quality_grade: metadata.quality_grade ?? metadata.attribution?.quality_grade ?? null,
      quality_score: metadata.quality_score ?? null,
    };
  }

  function pushGraphicAsset(graphicId: string, row?: any) {
    const g = cgById.get(graphicId);
    pushAsset({
      id: `graphic:${graphicId}`,
      kind: "graphic",
      source_url: g?.preview_url ?? g?.thumbnail_url ?? null,
      inline:
        g?.template_name || g?.graphic_type
          ? { style: { template: g.template_name ?? g.graphic_type } }
          : undefined,
      meta: taxonomyMetaFor(row ?? g, "graphic", g),
    });
  }

  const presenterAssetId = "source:presenter";
  const presenterUrl = await createPresenterSignedUrl(sb, project?.video_path);
  if (project?.video_path) {
    pushAsset({
      id: presenterAssetId,
      kind: "video",
      source_url: presenterUrl,
      duration_seconds: canvas.duration_seconds || undefined,
      inline: { style: { source: "projects.video_path", storage_path: project.video_path } },
      meta: taxonomyMetaFor({ asset_type: "presenter_video" }, "presenter"),
    });
  }

  // Graphics
  const specGraphics: RenderGraphic[] = (compiledGraphics ?? []).map((g: any) => ({
    id: String(g.id),
    compiled_graphic_id: String(g.id),
    template: g.template_name ?? g.graphic_type ?? null,
    preview_url: g.preview_url ?? g.thumbnail_url ?? null,
    payload: (g.specification ?? g.payload ?? {}) as Record<string, unknown>,
  }));

  // Items + captions
  const items: RenderItem[] = [];
  const captions: RenderCaption[] = [];

  for (const row of (manifestRows ?? []) as any[]) {
    const start = Number(row.timeline_start) || 0;
    const end = Number(row.timeline_end) || start;
    const rowMeta = plainRecord(row.metadata);
    const rowActionType = firstString(row.action_type, row.original_action_type, rowMeta.action_type, rowMeta.original_action_type, row.asset_type);
    const rowAssetType = firstString(row.asset_type, row.action_type);
    const rowLayouts = layoutFields(row);

    // Caption rows feed a separate stream rather than a regular asset item.
    if (row.asset_type === "caption") {
      captions.push({
        id: String(row.id),
        start_time: start,
        end_time: end,
        text: String(row.caption_text ?? row.asset_query ?? "").trim(),
        style: row.caption_style ?? "default",
      });
      continue;
    }

    // Resolve asset id (real asset OR compiled graphic).
    let assetId: string | null = null;
    let rawAssetId: string | null = row.asset_id ?? null;
    let assetKind: RenderAssetKind | null = null;
    let assetType: string | null = rowAssetType;
    if (row.asset_type === "presenter_video" && project?.video_path) {
      assetId = presenterAssetId;
      assetKind = "video";
      assetType = "presenter_video";
    } else if (row.asset_id && assetById.has(row.asset_id)) {
      const a = assetById.get(row.asset_id);
      const sourceUrl = await assetSourceUrl(a);
      if (!sourceUrl) continue;
      assetId = `asset:${a.id}`;
      rawAssetId = a.id;
      assetKind = kindFromMediaHints(a, sourceUrl);
      assetType = a.asset_type ?? rowAssetType;
      pushAsset({
        id: assetId,
        kind: assetKind,
        source_url: sourceUrl,
        mime_type: a.mime_type ?? undefined,
        duration_seconds: a.duration_seconds ?? undefined,
        intrinsic_width: a.width ?? undefined,
        intrinsic_height: a.height ?? undefined,
        meta: taxonomyMetaFor(row, "asset", a),
      });
    } else if (row.compiled_graphic_id && cgById.has(row.compiled_graphic_id)) {
      assetId = `graphic:${row.compiled_graphic_id}`;
      rawAssetId = row.compiled_graphic_id;
      assetKind = "graphic";
      assetType = rowAssetType ?? "graphic";
      pushGraphicAsset(String(row.compiled_graphic_id), row);
    } else if (row.asset_url) {
      // Loose URL (b-roll / stock) — synthesize a stable asset id.
      assetId = `url:${row.id}`;
      assetKind = normAssetKind(row.asset_type);
      assetType = rowAssetType;
      pushAsset({
        id: assetId,
        kind: assetKind,
        source_url: String(row.asset_url),
        meta: taxonomyMetaFor(row, "url"),
      });
    } else if (rowActionType && (isTextAction(rowActionType) || rowActionType.includes("cta"))) {
      assetId = `text:${row.id}`;
      assetKind = rowActionType.includes("cta") ? "cta" : "text";
      assetType = rowAssetType ?? rowActionType;
      pushAsset({
        id: assetId,
        kind: assetKind,
        source_url: null,
        inline: {
          text: String(row.caption_text ?? row.asset_query ?? row.rationale ?? rowActionType).trim(),
          style: {
            action_type: rowActionType,
            layout_name: rowLayouts.layout_name,
            caption_style: row.caption_style ?? null,
          },
        },
        meta: taxonomyMetaFor(row, "text"),
      });
    } else {
      // Skip: nothing renderable.
      continue;
    }

    const trackId = rowTrackId(row, specTracks, defaultTrackId);
    const track = trackForId(specTracks, trackId);
    const assetMeta = specAssets.find((a) => a.id === assetId)?.meta ?? {};
    const linkedAsset = rawAssetId ? assetById.get(rawAssetId) : null;
    const linkedAssetMeta = plainRecord(linkedAsset?.metadata);
    const sourceTimelineItemId = firstString(
      row.timeline_item_id,
      rowMeta.source_timeline_item_id,
      rowMeta.mapped_timeline_item_id,
      linkedAssetMeta.source_timeline_item_id,
      linkedAssetMeta.mapped_timeline_item_id,
    );
    const renderMeta = collectRenderMetadata(row, {
      layout_name: rowLayouts.layout_name,
      layout: row.layout ?? rowLayouts.layout,
      layout_type: rowLayouts.layout_type,
      action_type: rowActionType,
      original_action_type: firstString(row.original_action_type, rowMeta.original_action_type, row.action_type),
      asset_type: rowAssetType,
      asset_kind: assetKind,
      source_asset_id: rawAssetId,
      source_render_manifest_id: String(row.id),
      source_timeline_item_id: sourceTimelineItemId,
      track_kind: track?.kind ?? null,
      track_type: track?.label ?? null,
      track_index: track?.z_index ?? null,
      scene_id: row.scene_id ?? null,
      storyboard_item_id: row.storyboard_item_id ?? null,
      edit_action_id: row.edit_action_id ?? null,
      asset_source: row.asset_source ?? null,
      medical_asset_taxonomy: assetMeta.medical_asset_taxonomy ?? null,
      medical_source_class: assetMeta.medical_source_class ?? null,
      render_classification: assetMeta.render_classification ?? null,
      routing_status: assetMeta.routing_status ?? null,
      routing_reason: assetMeta.routing_reason ?? null,
      z_index: Number(row.z_index ?? row.layer ?? row.priority ?? 0),
      render_order: Number(row.render_order ?? 0),
      priority: optionalNumber(row.priority),
      transition: row.transition ?? null,
      transition_in: row.transition ?? null,
      caption_style: row.caption_style ?? null,
      doctor_visibility: row.doctor_visibility ?? null,
      doctor_size: row.doctor_size ?? null,
      attention_focus: row.attention_focus ?? null,
      rationale: row.rationale ?? null,
      text: row.caption_text ?? row.asset_query ?? null,
      title: row.title ?? null,
      duration: end - start,
    });

    items.push({
      id: String(row.id),
      track_id: trackId,
      asset_id: assetId,
      start_time: start,
      end_time: end,
      layout: rowLayouts.layout,
      layout_name: rowLayouts.layout_name,
      layout_type: rowLayouts.layout_type,
      action_type: rowActionType,
      original_action_type: firstString(row.original_action_type, rowMeta.original_action_type, row.action_type),
      item_type: rowAssetType,
      item_kind: row.asset_source ?? null,
      source_timeline_item_id: sourceTimelineItemId,
      source_render_manifest_id: String(row.id),
      source_asset_id: rawAssetId,
      track_kind: track?.kind ?? null,
      track_type: track?.label ?? null,
      asset_kind: assetKind,
      asset_type: assetType,
      ...itemMetadataFields(renderMeta),
      transition_in: normTransition(row.transition ?? "cut"),
      transition_out: "cut",
      meta: renderMeta,
    });
  }

  // Also fold in timeline_items only when render_manifest has not been built yet.
  // Manifest V6 rows use their own ids, so comparing ids would duplicate every
  // timeline item once a manifest exists.
  const manifestItemIds = new Set(items.map((i) => i.id));
  for (const ti of ((manifestRows ?? []).length === 0 ? (timelineItems ?? []) : []) as any[]) {
    const key = String(ti.id);
    if (manifestItemIds.has(key)) continue;
    const tiMeta = plainRecord(ti.metadata);
    const tiActionType = firstString(ti.action_type, ti.original_action_type, tiMeta.action_type, tiMeta.original_action_type, ti.asset_type);
    if (
      !ti.asset_id &&
      !ti.compiled_graphic_id &&
      ti.asset_type !== "presenter_video" &&
      !(tiActionType && (isTextAction(tiActionType) || tiActionType.includes("cta")))
    ) continue;
    const start = Number(ti.start_time) || 0;
    const end = Number(ti.end_time) || start;
    const tiAssetType = firstString(ti.asset_type, ti.action_type);
    const tiLayouts = layoutFields(ti);
    let assetId: string | null = null;
    let rawAssetId: string | null = ti.asset_id ?? null;
    let assetKind: RenderAssetKind | null = null;
    let assetType: string | null = tiAssetType;
    if (ti.asset_type === "presenter_video" && project?.video_path) {
      assetId = presenterAssetId;
      assetKind = "video";
      assetType = "presenter_video";
    } else if (ti.asset_id && assetById.has(ti.asset_id)) {
      const a = assetById.get(ti.asset_id);
      const sourceUrl = await assetSourceUrl(a);
      if (!sourceUrl) continue;
      assetId = `asset:${a.id}`;
      rawAssetId = a.id;
      assetKind = kindFromMediaHints(a, sourceUrl);
      assetType = a.asset_type ?? tiAssetType;
      pushAsset({
        id: assetId,
        kind: assetKind,
        source_url: sourceUrl,
        mime_type: a.mime_type ?? undefined,
        duration_seconds: a.duration_seconds ?? undefined,
        intrinsic_width: a.width ?? undefined,
        intrinsic_height: a.height ?? undefined,
        meta: taxonomyMetaFor(ti, "asset", a),
      });
    } else if (ti.compiled_graphic_id && cgById.has(ti.compiled_graphic_id)) {
      assetId = `graphic:${ti.compiled_graphic_id}`;
      rawAssetId = ti.compiled_graphic_id;
      assetKind = "graphic";
      assetType = tiAssetType ?? "graphic";
      pushGraphicAsset(String(ti.compiled_graphic_id), ti);
    } else if (tiActionType && (isTextAction(tiActionType) || tiActionType.includes("cta"))) {
      assetId = `text:${ti.id}`;
      assetKind = tiActionType.includes("cta") ? "cta" : "text";
      assetType = tiAssetType ?? tiActionType;
      pushAsset({
        id: assetId,
        kind: assetKind,
        source_url: null,
        inline: {
          text: String(ti.title ?? ti.asset_query ?? tiActionType).trim(),
          style: { action_type: tiActionType, layout_name: tiLayouts.layout_name },
        },
        meta: taxonomyMetaFor(ti, "text"),
      });
    }
    if (!assetId) continue;
    const trackId = ti.track_id ? String(ti.track_id) : defaultTrackId;
    const track = trackForId(specTracks, trackId);
    const assetMeta = specAssets.find((a) => a.id === assetId)?.meta ?? {};
    const renderMeta = collectRenderMetadata(ti, {
      layout_name: tiLayouts.layout_name,
      layout: ti.layout ?? tiLayouts.layout,
      layout_type: tiLayouts.layout_type,
      action_type: tiActionType,
      original_action_type: firstString(ti.original_action_type, tiMeta.original_action_type, ti.action_type),
      asset_type: tiAssetType,
      asset_kind: assetKind,
      source_asset_id: rawAssetId,
      source_timeline_item_id: key,
      track_kind: track?.kind ?? null,
      track_type: track?.label ?? null,
      track_index: track?.z_index ?? null,
      medical_asset_taxonomy: assetMeta.medical_asset_taxonomy ?? null,
      medical_source_class: assetMeta.medical_source_class ?? null,
      render_classification: assetMeta.render_classification ?? null,
      routing_status: assetMeta.routing_status ?? null,
      routing_reason: assetMeta.routing_reason ?? null,
      z_index: Number(ti.z_index ?? ti.layer ?? 0),
      priority: optionalNumber(tiMeta.priority),
      transition_in: ti.transition_in ?? null,
      transition_out: ti.transition_out ?? null,
      text: ti.title ?? tiMeta.text ?? null,
      title: ti.title ?? tiMeta.title ?? null,
      duration: Number(ti.duration ?? end - start),
    });
    items.push({
      id: key,
      track_id: trackId,
      asset_id: assetId,
      start_time: start,
      end_time: end,
      layout: tiLayouts.layout,
      layout_name: tiLayouts.layout_name,
      layout_type: tiLayouts.layout_type,
      action_type: tiActionType,
      original_action_type: firstString(ti.original_action_type, tiMeta.original_action_type, ti.action_type),
      item_type: tiAssetType,
      item_kind: ti.source_task ?? null,
      source_timeline_item_id: key,
      source_render_manifest_id: null,
      source_asset_id: rawAssetId,
      track_kind: track?.kind ?? null,
      track_type: track?.label ?? null,
      asset_kind: assetKind,
      asset_type: assetType,
      ...itemMetadataFields(renderMeta),
      transition_in: normTransition(ti.transition_in ?? "cut"),
      transition_out: normTransition(ti.transition_out ?? "cut"),
      meta: renderMeta,
    });
  }

  items.sort((a, b) => a.start_time - b.start_time);

  return {
    spec_version: RENDER_SPEC_VERSION,
    project_id: projectId,
    source_manifest_version: 6,
    canvas,
    tracks: specTracks,
    assets: specAssets,
    items,
    graphics: specGraphics,
    captions,
    metadata: {
      title: project?.title ?? null,
      generated_at: new Date().toISOString(),
      notes: [],
    },
  };
}
