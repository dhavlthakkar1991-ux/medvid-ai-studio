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
  type RenderCaption,
  type RenderGraphic,
  type RenderItem,
  type RenderLayout,
  type RenderSpec,
  type RenderTrack,
  type RenderTransition,
} from "./render-spec";

type Sb = any;

const VALID_LAYOUTS: RenderLayout[] = [
  "full_screen", "pip_left", "pip_right", "split_screen", "doctor_with_infographic", "overlay",
];
const VALID_TRANSITIONS: RenderTransition[] = ["cut", "fade", "dissolve", "slide"];

function normLayout(v: unknown): RenderLayout {
  return (VALID_LAYOUTS as string[]).includes(String(v)) ? (v as RenderLayout) : "full_screen";
}
function normTransition(v: unknown): RenderTransition {
  return (VALID_TRANSITIONS as string[]).includes(String(v)) ? (v as RenderTransition) : "cut";
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
    sb.from("projects").select("id, title, duration_seconds").eq("id", projectId).maybeSingle(),
    sb.from("render_manifest").select("*").eq("project_id", projectId).order("render_order", { ascending: true }),
    sb.from("assets").select("*").eq("project_id", projectId),
    sb.from("compiled_graphics").select("*").eq("project_id", projectId),
    sb.from("timeline_tracks").select("*").eq("project_id", projectId).order("z_index", { ascending: true }),
    sb.from("timeline_items").select("*").eq("project_id", projectId).order("start_time", { ascending: true }),
  ]);

  const assetById = new Map<string, any>((assetRows ?? []).map((a: any) => [a.id, a]));
  const cgById = new Map<string, any>((compiledGraphics ?? []).map((g: any) => [g.id, g]));

  // Canvas
  const canvasBase = quality === "preview" ? DEFAULT_CANVAS_PREVIEW : DEFAULT_CANVAS_FULL;
  const canvas = { ...canvasBase, duration_seconds: Number(project?.duration_seconds) || 0 };

  // Tracks
  const specTracks: RenderTrack[] = (tracks ?? []).map((t: any) => ({
    id: String(t.id),
    kind: (t.track_kind ?? t.kind ?? "overlay") as any,
    z_index: Number(t.z_index ?? 0),
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

  function pushGraphicAsset(graphicId: string) {
    const g = cgById.get(graphicId);
    pushAsset({
      id: `graphic:${graphicId}`,
      kind: "graphic",
      source_url: g?.preview_url ?? g?.thumbnail_url ?? null,
      inline: g?.template_name || g?.graphic_type ? { style: { template: g.template_name ?? g.graphic_type } } : undefined,
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

    // Caption rows feed a separate stream rather than a regular asset item.
    if (row.asset_type === "caption" || row.caption_style) {
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
    if (row.asset_id && assetById.has(row.asset_id)) {
      const a = assetById.get(row.asset_id);
      assetId = `asset:${a.id}`;
      pushAsset({
        id: assetId,
        kind: (a.asset_type ?? "video") as any,
        source_url: a.url ?? null,
        mime_type: a.mime_type ?? undefined,
        duration_seconds: a.duration_seconds ?? undefined,
      });
    } else if (row.compiled_graphic_id && cgById.has(row.compiled_graphic_id)) {
      assetId = `graphic:${row.compiled_graphic_id}`;
      pushGraphicAsset(String(row.compiled_graphic_id));
    } else if (row.asset_url) {
      // Loose URL (b-roll / stock) — synthesize a stable asset id.
      assetId = `url:${row.id}`;
      pushAsset({
        id: assetId,
        kind: (row.asset_type ?? "video") as any,
        source_url: String(row.asset_url),
      });
    } else {
      // Skip: nothing renderable.
      continue;
    }

    items.push({
      id: String(row.id),
      track_id: defaultTrackId,
      asset_id: assetId,
      start_time: start,
      end_time: end,
      layout: normLayout(row.layout ?? row.layout_type),
      transition_in: normTransition(row.transition ?? "cut"),
      transition_out: "cut",
      meta: {
        scene_id: row.scene_id ?? null,
        storyboard_item_id: row.storyboard_item_id ?? null,
        asset_source: row.asset_source ?? null,
        z_index: Number(row.z_index ?? 0),
        render_order: Number(row.render_order ?? 0),
      },
    });
  }

  // Also fold in timeline_items that aren't in render_manifest (defensive).
  const manifestItemIds = new Set(items.map((i) => i.id));
  for (const ti of (timelineItems ?? []) as any[]) {
    const key = String(ti.id);
    if (manifestItemIds.has(key)) continue;
    if (!ti.asset_id && !ti.compiled_graphic_id) continue;
    const start = Number(ti.start_time) || 0;
    const end = Number(ti.end_time) || start;
    let assetId: string | null = null;
    if (ti.asset_id && assetById.has(ti.asset_id)) {
      const a = assetById.get(ti.asset_id);
      assetId = `asset:${a.id}`;
      pushAsset({ id: assetId, kind: (a.asset_type ?? "video") as any, source_url: a.url ?? null });
    } else if (ti.compiled_graphic_id && cgById.has(ti.compiled_graphic_id)) {
      assetId = `graphic:${ti.compiled_graphic_id}`;
      pushGraphicAsset(String(ti.compiled_graphic_id));
    }
    if (!assetId) continue;
    items.push({
      id: key,
      track_id: ti.track_id ? String(ti.track_id) : defaultTrackId,
      asset_id: assetId,
      start_time: start,
      end_time: end,
      layout: normLayout(ti.layout),
      transition_in: normTransition(ti.transition_in ?? "cut"),
      transition_out: normTransition(ti.transition_out ?? "cut"),
      meta: { z_index: Number(ti.z_index ?? 0) },
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
