import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({
  projectId: z.string().uuid(),
  prompt: z.string().max(4000).optional(),
});

/**
 * End-to-end repair of render readiness.
 * Always runs:
 *   1. Backfill projects.duration_seconds from transcript / scene_plan / timeline.
 *   2. Auto-approve pending asset candidates (if any) and link them to edit_actions.
 *   3. AI-fix timeline issues (clamp/trim/recompose, regenerate editorial if needed).
 *   4. Rebuild render manifest.
 * If `prompt` is supplied, also runs aiModifyTaskOutput on editorial_decisions
 * with the user's instruction *before* the repair chain so the change propagates.
 */
export const aiFixRenderReadiness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const userId = context.userId;
    const pid = data.projectId;
    const steps: string[] = [];

    const { repairProjectDuration } = await import("./render/duration-repair.server");
    const { ensureApprovedAssetsForEditActions } = await import("./assets/asset-linker.server");
    const { composeTimelineForProject, validateTimelineForProject } = await import("./timeline/timeline-composer.server");
    const { buildRenderManifestForProject } = await import("./render/timeline-builder.server");
    const { computeRenderReadiness } = await import("./render-jobs.functions");

    // 0) Optional: apply user prompt to editorial_decisions first
    if (data.prompt && data.prompt.trim().length >= 3) {
      try {
        const { aiModifyTaskOutput } = await import("./ai-modify.functions");
        // call the raw handler via the same RPC to keep middleware semantics
        await (aiModifyTaskOutput as any)({ data: { projectId: pid, task: "editorial_decisions", prompt: data.prompt } });
        steps.push("Applied your instruction to editorial decisions");
      } catch (e: any) {
        steps.push(`AI prompt failed: ${e?.message ?? "unknown"}`);
      }
    }

    // 1) Duration
    const dur = await repairProjectDuration(sb, pid);
    if (dur.updated) steps.push(`Set project duration to ${dur.duration}s (from ${dur.source})`);
    else if (dur.duration > 0) steps.push(`Duration already known (${dur.duration}s)`);
    else steps.push("Could not infer duration — upload/transcribe video first");

    // 2) Approve pending candidates + link assets to edit_actions
    try {
      const { data: pending } = await sb
        .from("asset_candidates").select("id").eq("project_id", pid).eq("status", "pending");
      if (pending && pending.length > 0) {
        await sb.from("asset_candidates")
          .update({ status: "approved", approved_by: userId, approved_at: new Date().toISOString() })
          .eq("project_id", pid).eq("status", "pending");
        steps.push(`Approved ${pending.length} pending asset candidate(s)`);
      }
    } catch (e) { console.warn("auto-approve failed", e); }

    const link = await ensureApprovedAssetsForEditActions(sb, pid, userId, { createMissing: true });
    if (link.linked + link.createdAssets + link.createdCandidates > 0) {
      steps.push(`Linked ${link.linked} action(s), created ${link.createdAssets} placeholder asset(s), ${link.createdCandidates} candidate(s)`);
    }

    // 3) Recompose timeline (+ run aiFix if still broken)
    try { await composeTimelineForProject(sb, pid); } catch (e) { console.warn(e); }
    let validation = await validateTimelineForProject(sb, pid);
    if (validation.errorCount > 0) {
      try {
        const { aiFixTimelineIssues } = await import("./timeline.functions");
        const r: any = await (aiFixTimelineIssues as any)({ data: { projectId: pid } });
        validation = r?.validation ?? validation;
        steps.push(...(r?.fixesApplied ?? []));
      } catch (e: any) {
        steps.push(`Timeline AI-fix failed: ${e?.message ?? "unknown"}`);
      }
    } else {
      steps.push("Timeline recomposed and validated");
    }

    // 4) Manifest
    try {
      await buildRenderManifestForProject(sb, pid);
      steps.push("Render manifest rebuilt");
    } catch (e: any) {
      steps.push(`Manifest build failed: ${e?.message ?? "unknown"}`);
    }

    const readiness = await computeRenderReadiness(sb, pid);
    return { ok: readiness.ok, steps, readiness, validation };
  });