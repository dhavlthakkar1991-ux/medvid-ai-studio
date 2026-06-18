import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({ projectId: z.string() });
const AddCtaInput = z.object({
  projectId: z.string(),
  text: z.string().min(1).max(300),
  durationSeconds: z.number().min(1).max(30).optional(),
});

export const getProjectTimeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    // Lazy compose on first read so legacy projects light up.
    const { composeTimelineForProject, validateTimelineForProject } = await import("./timeline/timeline-composer.server");
    const [{ count: itemCount }, { data: project }] = await Promise.all([
      sb.from("timeline_items").select("id", { count: "exact", head: true }).eq("project_id", data.projectId),
      sb.from("projects").select("duration_seconds").eq("id", data.projectId).maybeSingle(),
    ]);
    if ((itemCount ?? 0) === 0) {
      try { await composeTimelineForProject(sb, data.projectId); } catch (e) { console.warn(e); }
    }
    const [{ data: tracks }, { data: items }, validation] = await Promise.all([
      sb.from("timeline_tracks").select("*").eq("project_id", data.projectId).order("track_index", { ascending: true }),
      sb.from("timeline_items").select("*").eq("project_id", data.projectId).order("start_time", { ascending: true }),
      validateTimelineForProject(sb, data.projectId),
    ]);
    return {
      tracks: tracks ?? [],
      items: items ?? [],
      duration: Number((project as any)?.duration_seconds) || 0,
      validation,
    };
  });

export const recomposeTimeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const { composeTimelineForProject, validateTimelineForProject } = await import("./timeline/timeline-composer.server");
    const { buildRenderManifestForProject } = await import("./render/timeline-builder.server");
    const { ensureApprovedAssetsForEditActions } = await import("./assets/asset-linker.server");
    const linked = await ensureApprovedAssetsForEditActions(sb, data.projectId, context.userId, { createMissing: true });
    const composeResult = await composeTimelineForProject(sb, data.projectId);
    const validation = await validateTimelineForProject(sb, data.projectId);
    await buildRenderManifestForProject(sb, data.projectId);
    return { ...composeResult, linked, validation };
  });

/**
 * AI-assisted repair for timeline composer issues.
 * Strategy:
 *  1. Auto-repair edit_actions rows:
 *     - clamp start/end to [0, duration]
 *     - drop rows with end <= start
 *     - resolve per-(layer) overlaps by trimming the later row's start
 *     - drop rows whose layer/action_type can't be placed on a track
 *  2. Recompose the timeline and validate.
 *  3. If errors remain (or editorial is empty / too sparse), regenerate
 *     editorial_decisions via the LLM, then recompose again.
 */
export const aiFixTimelineIssues = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const pid = data.projectId;
    const { composeTimelineForProject, validateTimelineForProject } = await import("./timeline/timeline-composer.server");
    const { buildRenderManifestForProject } = await import("./render/timeline-builder.server");
    const { ensureApprovedAssetsForEditActions } = await import("./assets/asset-linker.server");

    const fixesApplied: string[] = [];

    const { data: project } = await sb.from("projects").select("duration_seconds").eq("id", pid).maybeSingle();
    const duration = Number((project as any)?.duration_seconds) || 0;

    // 1) Deterministic repair on edit_actions
    const { data: actions } = await sb.from("edit_actions").select("*").eq("project_id", pid);
    const rows = ((actions ?? []) as any[]).map((r) => ({ ...r }));
    let droppedZero = 0, clamped = 0;
    for (const r of rows) {
      let s = Number(r.start_time) || 0;
      let e = Number(r.end_time) || 0;
      if (duration > 0) {
        if (s < 0) { s = 0; clamped++; }
        if (e > duration) { e = duration; clamped++; }
      }
      r.start_time = s;
      r.end_time = e;
    }
    const usable = rows.filter((r) => Number(r.end_time) > Number(r.start_time));
    droppedZero = rows.length - usable.length;

    // Resolve overlaps per layer by trimming later items' start (or dropping if no room)
    const byLayer: Record<string, any[]> = {};
    for (const r of usable) (byLayer[String(r.layer ?? 0)] ??= []).push(r);
    let overlapsFixed = 0;
    const kept: any[] = [];
    for (const list of Object.values(byLayer)) {
      list.sort((a, b) => Number(a.start_time) - Number(b.start_time));
      let prevEnd = -Infinity;
      for (const r of list) {
        if (Number(r.start_time) < prevEnd - 0.01) {
          r.start_time = prevEnd;
          overlapsFixed++;
        }
        if (Number(r.end_time) - Number(r.start_time) < 0.25) continue; // too short after trim
        kept.push(r);
        prevEnd = Number(r.end_time);
      }
    }

    if (clamped > 0) fixesApplied.push(`Clamped ${clamped} time(s) to video duration`);
    if (droppedZero > 0) fixesApplied.push(`Dropped ${droppedZero} zero-duration action(s)`);
    if (overlapsFixed > 0) fixesApplied.push(`Trimmed ${overlapsFixed} overlapping action(s)`);
    if (rows.length - kept.length - droppedZero > 0) {
      fixesApplied.push(`Removed ${rows.length - kept.length - droppedZero} too-short action(s)`);
    }

    // Persist repairs if any
    if (clamped + droppedZero + overlapsFixed > 0 || kept.length !== rows.length) {
      await sb.from("edit_actions").delete().eq("project_id", pid);
      if (kept.length > 0) {
        const insertable = kept.map((r) => {
          const { id, created_at, updated_at, ...rest } = r;
          return rest;
        });
        await sb.from("edit_actions").insert(insertable);
      }
    }

    const assetRepair = await ensureApprovedAssetsForEditActions(sb, pid, context.userId, { createMissing: true });
    if (assetRepair.linked > 0) fixesApplied.push(`Linked approved assets to ${assetRepair.linked} visual action(s)`);
    if (assetRepair.createdAssets > 0) fixesApplied.push(`Created ${assetRepair.createdAssets} approved placeholder asset(s)`);
    if (assetRepair.createdCandidates > 0) fixesApplied.push(`Created ${assetRepair.createdCandidates} action-linked candidate(s)`);

    // 2) Recompose + validate
    await composeTimelineForProject(sb, pid);
    let validation = await validateTimelineForProject(sb, pid);

    // 3) If errors remain or no actions exist, ask the LLM to regenerate editorial
    const needsRegen = validation.errorCount > 0 || kept.length === 0;
    if (needsRegen) {
      try {
        const { runTaskForProject } = await import("./analysis-runner.server");
        await runTaskForProject(sb, context.userId, pid, "editorial_decisions");
        fixesApplied.push("Regenerated editorial decisions via AI");
        await composeTimelineForProject(sb, pid);
        validation = await validateTimelineForProject(sb, pid);
      } catch (e: any) {
        fixesApplied.push(`AI regeneration failed: ${e?.message ?? "unknown"}`);
      }
    }

    await buildRenderManifestForProject(sb, pid);

    return {
      ok: validation.errorCount === 0,
      fixesApplied,
      validation,
    };
  });

/**
 * User-driven fix for an empty CTA track: append a CTA timeline item at the
 * end of the video with the provided text, then rebuild the manifest.
 */
export const addCtaToTimeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => AddCtaInput.parse(i))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const pid = data.projectId;
    const dur = data.durationSeconds ?? 4;

    const [{ data: project }, { data: existingCtas }] = await Promise.all([
      sb.from("projects").select("duration_seconds").eq("id", pid).maybeSingle(),
      sb
        .from("edit_actions")
        .select("id")
        .eq("project_id", pid)
        .in("action_type", ["show_cta", "show_thumbnail_frame", "show_logo"])
        .limit(1),
    ]);
    const total = Number((project as any)?.duration_seconds) || 0;
    if (total <= 0) throw new Error("Project duration unknown — recompose timeline first.");

    const end = total;
    const start = Math.max(0, end - dur);
    const ctaAction = {
      project_id: pid,
      action_type: "show_cta",
      start_time: start,
      end_time: end,
      duration: end - start,
      layer: 6,
      priority: 10,
      asset_query: data.text.slice(0, 300),
      source: "user_fix",
      metadata: { cta_text: data.text, added_via: "validation_fix" },
      parameters: { cta_text: data.text, added_via: "validation_fix" },
    };

    const existingId = Array.isArray(existingCtas) ? existingCtas[0]?.id : null;
    const { error: actionErr } = existingId
      ? await sb.from("edit_actions").update(ctaAction).eq("id", existingId).eq("project_id", pid)
      : await sb.from("edit_actions").insert(ctaAction);
    if (actionErr) throw new Error(actionErr.message);

    const { composeTimelineForProject, validateTimelineForProject } = await import("./timeline/timeline-composer.server");
    await composeTimelineForProject(sb, pid);

    try {
      const { buildRenderManifestForProject } = await import("./render/timeline-builder.server");
      await buildRenderManifestForProject(sb, pid);
    } catch (e) {
      console.warn("manifest rebuild after CTA add failed", e);
    }

    const validation = await validateTimelineForProject(sb, pid);
    return { ok: validation.errorCount === 0, validation };
  });