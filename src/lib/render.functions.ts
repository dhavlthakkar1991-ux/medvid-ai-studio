import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({ projectId: z.string() });

export const getCanonicalProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const [scenes, storyboard, broll, manifest, segments, candidates, assets, instructions] = await Promise.all([
      sb.from("scenes").select("*").eq("project_id", data.projectId).order("scene_number", { ascending: true }),
      sb.from("storyboard_items").select("*").eq("project_id", data.projectId).order("item_index", { ascending: true }),
      sb.from("broll_items").select("*").eq("project_id", data.projectId).order("item_index", { ascending: true }),
      sb.from("render_manifest").select("*").eq("project_id", data.projectId).order("render_order", { ascending: true }),
      sb.from("transcript_segments").select("*").eq("project_id", data.projectId).order("segment_index", { ascending: true }),
      sb.from("asset_candidates").select("*").eq("project_id", data.projectId).order("priority", { ascending: true }),
      sb.from("assets").select("*").eq("project_id", data.projectId).order("created_at", { ascending: true }),
      sb.from("timeline_instructions").select("*").eq("project_id", data.projectId).order("render_order", { ascending: true }),
    ]);
    return {
      scenes: scenes.data ?? [],
      storyboardItems: storyboard.data ?? [],
      brollItems: broll.data ?? [],
      manifest: manifest.data ?? [],
      transcriptSegments: segments.data ?? [],
      assetCandidates: candidates.data ?? [],
      assets: assets.data ?? [],
      timelineInstructions: instructions.data ?? [],
    };
  });

export const rebuildRenderManifest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ context, data }) => {
    const { generateAssetCandidatesForProject } = await import("./assets/asset-matcher.server");
    const { compileTimelineForProject } = await import("./render/timeline-compiler.server");
    const { buildRenderManifestForProject } = await import("./render/timeline-builder.server");
    await generateAssetCandidatesForProject(context.supabase, data.projectId);
    await compileTimelineForProject(context.supabase, data.projectId);
    return buildRenderManifestForProject(context.supabase, data.projectId);
  });

export const validateTimeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ context, data }) => {
    const { validateTimelineForProject } = await import("./render/timeline-compiler.server");
    return validateTimelineForProject(context.supabase, data.projectId);
  });

export const exportRenderManifestJson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const [{ data: project }, { data: manifest }, { data: assets }] = await Promise.all([
      sb.from("projects").select("id, title, duration_seconds").eq("id", data.projectId).maybeSingle(),
      sb.from("render_manifest").select("*").eq("project_id", data.projectId).order("render_order", { ascending: true }),
      sb.from("assets").select("id, url, thumbnail_url, asset_type, source_type").eq("project_id", data.projectId),
    ]);
    const assetById = new Map<string, any>((assets ?? []).map((a: any) => [a.id, a]));
    return {
      project_id: project?.id ?? data.projectId,
      title: project?.title ?? "",
      duration_seconds: project?.duration_seconds ?? null,
      timeline: ((manifest ?? []) as any[]).map((m) => {
        const asset = m.asset_id ? assetById.get(m.asset_id) : null;
        return {
          render_order: m.render_order,
          scene_id: m.scene_id,
          storyboard_item_id: m.storyboard_item_id,
          asset_id: m.asset_id,
          asset_type: m.asset_type,
          asset_source: m.asset_source,
          asset_url: asset?.url ?? m.asset_url ?? null,
          start: Number(m.timeline_start) || 0,
          end: Number(m.timeline_end) || 0,
          transition: m.transition ?? "cut",
          status: m.status,
          caption_style: m.caption_style,
          query: m.asset_query,
        };
      }),
    };
  });