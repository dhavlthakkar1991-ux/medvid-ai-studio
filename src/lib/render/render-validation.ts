/**
 * Pure RenderSpec validator.
 *
 * Runs after Manifest V6 → RenderSpec compilation, before any render is
 * submitted to a worker. Detects:
 *   - missing assets / missing source urls
 *   - missing graphics payloads
 *   - invalid timeline (zero-duration, overlap, out-of-bounds)
 *   - missing canvas / video metadata
 *   - orphan asset references
 *
 * No DB access — operates on a built RenderSpec only.
 */
import type { RenderItem, RenderSpec } from "./render-spec";
import { isSourceAllowedForTaxonomy } from "../assets/medical-asset-taxonomy.server";

export interface RenderValidationIssue {
  level: "error" | "warning" | "info";
  code: string;
  message: string;
  ref?: string;
}

export interface RenderValidationReport {
  ok: boolean;
  errorCount: number;
  warningCount: number;
  issues: RenderValidationIssue[];
  summary: {
    assets: { total: number; missingUrl: number; orphan: number; unused: number };
    graphics: { total: number; missingPayload: number };
    timeline: { items: number; overlaps: number; outOfBounds: number; gaps: number };
    canvas: { hasDuration: boolean; hasDimensions: boolean; hasFps: boolean };
    workerCompatible: boolean;
  };
}

function isSvgSourceUrl(value: string | null | undefined) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("data:image/svg+xml") || /\.svg(?:[?#].*)?$/.test(normalized);
}

export function validateRenderSpec(spec: RenderSpec): RenderValidationReport {
  const issues: RenderValidationIssue[] = [];
  const assetIds = new Set(spec.assets.map((a) => a.id));
  const usedAssetIds = new Set<string>();
  let orphan = 0;

  // Item → asset reference integrity
  for (const it of spec.items) {
    if (!it.asset_id) {
      orphan++;
      issues.push({ level: "error", code: "orphan_item", message: `Item ${it.id} has no asset_id`, ref: it.id });
    } else if (!assetIds.has(it.asset_id)) {
      orphan++;
      issues.push({ level: "error", code: "missing_asset", message: `Item ${it.id} references missing asset ${it.asset_id}`, ref: it.id });
    } else {
      usedAssetIds.add(it.asset_id);
    }
  }

  // Asset URL presence — graphics/text/caption may be inline, the rest must have a url.
  let missingUrl = 0;
  for (const a of spec.assets) {
    const inlineOk = a.kind === "graphic" || a.kind === "text" || a.kind === "caption" || a.kind === "cta";
    if (!inlineOk && !a.source_url) {
      missingUrl++;
      issues.push({ level: "error", code: "missing_asset_url", message: `Asset ${a.id} (${a.kind}) has no source_url`, ref: a.id });
    }
    if (isSvgSourceUrl(a.source_url)) {
      issues.push({
        level: "error",
        code: "svg_asset_not_supported",
        message: `Asset ${a.id} uses an SVG source. Generate or upload a PNG, WebP, JPG, or MP4 asset for the primary workflow.`,
        ref: a.id,
      });
    }
    const meta = a.meta ?? {};
    const classification = String(meta.render_classification ?? "");
    const routingStatus = String(meta.routing_status ?? "");
    if (classification === "PLACEHOLDER_PLAN" || routingStatus === "needs_manual_upload" || routingStatus === "needs_curated_asset") {
      issues.push({
        level: "error",
        code: "non_renderable_asset_taxonomy",
        message: `Asset ${a.id} is ${classification || routingStatus}; ${String(meta.routing_reason ?? "manual/curated asset required")}`,
        ref: a.id,
      });
    }
    const taxonomy = meta.medical_asset_taxonomy;
    const sourceClass = meta.medical_source_class;
    if (taxonomy && sourceClass && !isSourceAllowedForTaxonomy(taxonomy as any, sourceClass as any)) {
      issues.push({
        level: "error",
        code: "wrong_taxonomy_source",
        message: `Asset ${a.id} uses ${String(sourceClass)} for ${String(taxonomy)}`,
        ref: a.id,
      });
    }
  }

  // Unused assets (warning, not blocker)
  let unused = 0;
  for (const a of spec.assets) {
    if (!usedAssetIds.has(a.id) && a.kind !== "caption") {
      unused++;
      issues.push({ level: "warning", code: "unused_asset", message: `Asset ${a.id} is declared but never used`, ref: a.id });
    }
  }

  // Graphics payload integrity
  let missingGfx = 0;
  for (const g of spec.graphics) {
    const empty = !g.template && (!g.payload || Object.keys(g.payload).length === 0);
    if (empty) {
      missingGfx++;
      issues.push({ level: "error", code: "missing_graphic_payload", message: `Graphic ${g.id} has neither template nor payload`, ref: g.id });
    }
  }

  // Timeline validity
  let overlaps = 0;
  let outOfBounds = 0;
  const totalDur = spec.canvas.duration_seconds;
  const byTrack: Record<string, RenderItem[]> = {};
  for (const it of [...spec.items].sort((a, b) => a.start_time - b.start_time)) {
    (byTrack[it.track_id] ??= []).push(it);
  }
  for (const items of Object.values(byTrack)) {
    for (let i = 1; i < items.length; i++) {
      if (items[i].start_time < items[i - 1].end_time - 0.001) {
        overlaps++;
        issues.push({ level: "warning", code: "item_overlap", message: `Items overlap on track ${items[i].track_id}`, ref: items[i].id });
      }
    }
  }
  for (const it of spec.items) {
    if (it.end_time <= it.start_time) {
      outOfBounds++;
      issues.push({ level: "error", code: "invalid_time", message: `Item ${it.id} has end_time ≤ start_time`, ref: it.id });
    }
    if (totalDur > 0 && it.end_time > totalDur + 0.5) {
      outOfBounds++;
      issues.push({ level: "warning", code: "out_of_bounds", message: `Item ${it.id} extends past canvas duration (${totalDur.toFixed(1)}s)`, ref: it.id });
    }
  }

  // Gaps on the primary track (informational)
  let gaps = 0;
  const primary = byTrack[Object.keys(byTrack)[0]] ?? [];
  for (let i = 1; i < primary.length; i++) {
    if (primary[i].start_time - primary[i - 1].end_time > 0.5) gaps++;
  }

  // Canvas / video metadata
  const hasDuration = (spec.canvas.duration_seconds || 0) > 0;
  const hasDimensions = (spec.canvas.width || 0) > 0 && (spec.canvas.height || 0) > 0;
  const hasFps = (spec.canvas.fps || 0) > 0;
  if (!hasDuration) issues.push({ level: "error", code: "missing_metadata", message: "Canvas duration is zero" });
  if (!hasDimensions) issues.push({ level: "error", code: "missing_metadata", message: "Canvas width/height missing" });
  if (!hasFps) issues.push({ level: "error", code: "missing_metadata", message: "Canvas fps missing" });
  if (spec.items.length === 0) issues.push({ level: "error", code: "empty_timeline", message: "Timeline has no items" });

  const errorCount = issues.filter((i) => i.level === "error").length;
  const warningCount = issues.filter((i) => i.level === "warning").length;

  return {
    ok: errorCount === 0,
    errorCount,
    warningCount,
    issues,
    summary: {
      assets: { total: spec.assets.length, missingUrl, orphan, unused },
      graphics: { total: spec.graphics.length, missingPayload: missingGfx },
      timeline: { items: spec.items.length, overlaps, outOfBounds, gaps },
      canvas: { hasDuration, hasDimensions, hasFps },
      workerCompatible: errorCount === 0,
    },
  };
}

export function buildAssetManifest(spec: RenderSpec) {
  return {
    version: 1,
    project_id: spec.project_id,
    generated_at: new Date().toISOString(),
    assets: spec.assets.map((a) => ({
      id: a.id,
      kind: a.kind,
      source_url: a.source_url ?? null,
      mime_type: a.mime_type ?? null,
      duration_seconds: a.duration_seconds ?? null,
      intrinsic_width: a.intrinsic_width ?? null,
      intrinsic_height: a.intrinsic_height ?? null,
      inline: a.inline ?? null,
      meta: a.meta ?? null,
    })),
  };
}

export function buildGraphicsManifest(spec: RenderSpec) {
  return {
    version: 1,
    project_id: spec.project_id,
    generated_at: new Date().toISOString(),
    graphics: spec.graphics.map((g) => ({
      id: g.id,
      compiled_graphic_id: g.compiled_graphic_id,
      template: g.template,
      preview_url: g.preview_url,
      payload: g.payload,
    })),
  };
}

export function buildWorkerHandoff(spec: RenderSpec, validation: RenderValidationReport) {
  return {
    version: 1,
    spec_version: spec.spec_version,
    project_id: spec.project_id,
    target_runtime: "hyperframes-or-remotion",
    repo_hint: "medvideo-render-worker",
    canvas: spec.canvas,
    tracks: spec.tracks,
    items: spec.items,
    captions: spec.captions,
    asset_count: spec.assets.length,
    graphic_count: spec.graphics.length,
    validation: {
      ok: validation.ok,
      workerCompatible: validation.summary.workerCompatible,
      errorCount: validation.errorCount,
      warningCount: validation.warningCount,
    },
    generated_at: new Date().toISOString(),
    instructions: [
      "Resolve each asset by id from asset_manifest.json (fetch source_url).",
      "Compose tracks in z_index order. Use canvas.{width,height,fps,duration_seconds}.",
      "Apply per-item layout, text, captions, and transitions from RenderSpec.",
      "Render the final MP4 through the worker's HyperFrames/Remotion primary workflow.",
    ],
  };
}
