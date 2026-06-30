import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({ projectId: z.string() });

export const getCanonicalProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    // Auto-backfill edit_actions on first read so legacy projects light up immediately.
    try {
      const { ensureEditActionsForProject } = await import("./editorial/backfill.server");
      const result = await ensureEditActionsForProject(sb, data.projectId);
      if (result.backfilled) {
        const { buildRenderManifestForProject } = await import("./render/timeline-builder.server");
        await buildRenderManifestForProject(sb, data.projectId);
      }
    } catch (e) {
      console.warn("edit_actions backfill failed", e);
    }

    const [scenes, storyboard, broll, manifest, segments, candidates, assets, instructions, editActions, layouts, transitions, layoutDecisions, project] = await Promise.all([
      sb.from("scenes").select("*").eq("project_id", data.projectId).order("scene_number", { ascending: true }),
      sb.from("storyboard_items").select("*").eq("project_id", data.projectId).order("item_index", { ascending: true }),
      sb.from("broll_items").select("*").eq("project_id", data.projectId).order("item_index", { ascending: true }),
      sb.from("render_manifest").select("*").eq("project_id", data.projectId).order("render_order", { ascending: true }),
      sb.from("transcript_segments").select("*").eq("project_id", data.projectId).order("segment_index", { ascending: true }),
      sb.from("asset_candidates").select("*").eq("project_id", data.projectId).order("priority", { ascending: true }),
      sb.from("assets").select("*").eq("project_id", data.projectId).order("created_at", { ascending: true }),
      sb.from("timeline_instructions").select("*").eq("project_id", data.projectId).order("render_order", { ascending: true }),
      sb.from("edit_actions").select("*").eq("project_id", data.projectId).order("start_time", { ascending: true }),
      sb.from("layout_templates").select("id, name"),
      sb.from("transition_templates").select("id, name"),
      sb.from("layout_decisions").select("*").eq("project_id", data.projectId),
      sb.from("projects").select("duration_seconds").eq("id", data.projectId).maybeSingle(),
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
      editActions: editActions.data ?? [],
      layoutTemplates: layouts.data ?? [],
      transitionTemplates: transitions.data ?? [],
      layoutDecisions: layoutDecisions.data ?? [],
      projectDuration: Number((project.data as any)?.duration_seconds) || 0,
      compiledGraphics: [],
    };
  });

export const rebuildRenderManifest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ context, data }) => {
    const { generateAssetCandidatesForProject } = await import("./assets/asset-matcher.server");
    const { compileTimelineForProject } = await import("./render/timeline-compiler.server");
    const { buildRenderManifestForProject } = await import("./render/timeline-builder.server");
    const { ensureEditActionsForProject } = await import("./editorial/backfill.server");
    const { runLayoutDecisionsForProject } = await import("./layout/layout-runner.server");
    await generateAssetCandidatesForProject(context.supabase, data.projectId);
    await compileTimelineForProject(context.supabase, data.projectId);
    await ensureEditActionsForProject(context.supabase, data.projectId);
    await runLayoutDecisionsForProject(context.supabase, context.userId, data.projectId);
    return buildRenderManifestForProject(context.supabase, data.projectId);
  });

export const regenerateEditorialDecisions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ context, data }) => {
    const { runTaskForProject } = await import("./analysis-runner.server");
    return runTaskForProject(context.supabase, context.userId, data.projectId, "editorial_decisions");
  });

export const regenerateLayoutDecisions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ context, data }) => {
    const { runLayoutDecisionsForProject } = await import("./layout/layout-runner.server");
    const { buildRenderManifestForProject } = await import("./render/timeline-builder.server");
    const { ensureEditActionsForProject } = await import("./editorial/backfill.server");
    const sb = context.supabase;
    const steps: string[] = [];

    // 1) If no edit_actions exist, try to backfill from storyboard/b-roll/editorial.
    let { count: eaCount } = await sb
      .from("edit_actions").select("id", { count: "exact", head: true })
      .eq("project_id", data.projectId);
    if (!eaCount || eaCount === 0) {
      try {
        await ensureEditActionsForProject(sb, data.projectId);
        const r = await sb.from("edit_actions").select("id", { count: "exact", head: true }).eq("project_id", data.projectId);
        eaCount = r.count ?? 0;
        if (eaCount > 0) steps.push(`Backfilled ${eaCount} edit action(s) from storyboard/b-roll`);
      } catch (e: any) {
        steps.push(`Backfill failed: ${e?.message ?? "unknown"}`);
      }
    }
    // 2) If still no edit_actions, run the editorial AI task to generate them.
    if (!eaCount || eaCount === 0) {
      try {
        const { runTaskForProject } = await import("./analysis-runner.server");
        await runTaskForProject(sb, context.userId, data.projectId, "editorial_decisions");
        await ensureEditActionsForProject(sb, data.projectId);
        const r = await sb.from("edit_actions").select("id", { count: "exact", head: true }).eq("project_id", data.projectId);
        eaCount = r.count ?? 0;
        steps.push(`Generated ${eaCount} edit action(s) via AI editorial`);
      } catch (e: any) {
        steps.push(`AI editorial generation failed: ${e?.message ?? "unknown"}`);
      }
    }
    if (!eaCount || eaCount === 0) {
      throw new Error(
        "Cannot generate layout decisions: no edit actions exist. Run the pipeline (transcript → scene plan → storyboard → editorial decisions) first.",
      );
    }

    // 3) Run layout decisions and rebuild manifest.
    const res = await runLayoutDecisionsForProject(sb, context.userId, data.projectId);
    await buildRenderManifestForProject(sb, data.projectId);
    steps.push(`Wrote ${res.count} layout decision(s) (${res.aiCount} AI, ${res.fallbackCount} fallback)`);
    return { ...res, steps };
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
