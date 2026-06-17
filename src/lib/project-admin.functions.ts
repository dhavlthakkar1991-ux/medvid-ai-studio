import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ResetStage = z.enum([
  "transcript",
  "scene_plan",
  "storyboard",
  "editorial_decisions",
  "complete",
]);

export type ResetStage = z.infer<typeof ResetStage>;

// Tables, in deletion order (children first). Each list is additive.
// `editorial_decisions` reset: just edit_actions + render_manifest + the editorial_decisions analysis version row.
// `storyboard`: also wipes storyboard_items, broll_items, infographic_items, render_jobs, timeline_instructions.
// `scene_plan`: also wipes scenes (which cascades scene_assets / scene_transcript_map) + thumbnails/assets/asset_candidates + scene-stage analysis versions.
// `transcript`/`complete`: also wipes transcripts + transcript_segments + pipeline_runs + task_executions + jobs + usage_logs + ALL analysis_versions.

const STAGE_ANALYSIS_TASKS: Record<ResetStage, string[] | "all"> = {
  editorial_decisions: ["editorial_decisions"],
  storyboard: ["visual_storyboard", "broll", "infographics", "editorial_decisions"],
  scene_plan: [
    "scene_plan",
    "chapters",
    "visual_storyboard",
    "broll",
    "infographics",
    "thumbnails",
    "seo",
    "shorts",
    "editorial_decisions",
  ],
  transcript: "all",
  complete: "all",
};

async function logAudit(
  supabase: any,
  userId: string,
  projectId: string,
  actionType: "project_reset" | "project_delete",
  payload: Record<string, unknown>,
) {
  await supabase.from("audit_log").insert({
    user_id: userId,
    project_id: projectId,
    action_type: actionType,
    payload,
  });
}

async function assertOwner(supabase: any, projectId: string, userId: string) {
  const { data, error } = await supabase
    .from("projects")
    .select("id, user_id, video_path")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.user_id !== userId) throw new Error("Project not found");
  return data as { id: string; user_id: string; video_path: string | null };
}

export const resetProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ projectId: z.string(), stage: ResetStage }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertOwner(context.supabase, data.projectId, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const pid = data.projectId;
    const stage = data.stage;

    // Always-deleted leaves for every stage at/above editorial:
    await supabaseAdmin.from("edit_actions").delete().eq("project_id", pid);
    await supabaseAdmin.from("render_manifest").delete().eq("project_id", pid);

    if (stage !== "editorial_decisions") {
      await supabaseAdmin.from("timeline_instructions").delete().eq("project_id", pid);
      await supabaseAdmin.from("render_jobs").delete().eq("project_id", pid);
      await supabaseAdmin.from("storyboard_items").delete().eq("project_id", pid);
      await supabaseAdmin.from("broll_items").delete().eq("project_id", pid);
      await supabaseAdmin.from("infographic_items").delete().eq("project_id", pid);
    }

    if (stage === "scene_plan" || stage === "transcript" || stage === "complete") {
      await supabaseAdmin.from("thumbnail_items").delete().eq("project_id", pid);
      // scene_assets + scene_transcript_map cascade via scenes
      const { data: sceneRows } = await supabaseAdmin
        .from("scenes")
        .select("id")
        .eq("project_id", pid);
      const sceneIds = (sceneRows ?? []).map((r: any) => r.id);
      if (sceneIds.length > 0) {
        await supabaseAdmin.from("scene_assets").delete().in("scene_id", sceneIds);
        await supabaseAdmin.from("scene_transcript_map").delete().in("scene_id", sceneIds);
      }
      await supabaseAdmin.from("scenes").delete().eq("project_id", pid);
      await supabaseAdmin.from("asset_candidates").delete().eq("project_id", pid);
      await supabaseAdmin.from("assets").delete().eq("project_id", pid);
    }

    if (stage === "transcript" || stage === "complete") {
      // Delete transcripts and observability for a full reset.
      // (transcript stage = "delete everything generated AFTER transcript", so keep transcripts.)
    }

    if (stage === "complete") {
      const { data: tx } = await supabaseAdmin
        .from("transcripts")
        .select("id")
        .eq("project_id", pid);
      const txIds = (tx ?? []).map((r: any) => r.id);
      if (txIds.length > 0) {
        await supabaseAdmin.from("transcript_segments").delete().in("transcript_id", txIds);
      }
      await supabaseAdmin.from("transcripts").delete().eq("project_id", pid);
    }

    if (stage === "transcript" || stage === "complete") {
      await supabaseAdmin.from("task_executions").delete().eq("project_id", pid);
      await supabaseAdmin.from("pipeline_runs").delete().eq("project_id", pid);
      await supabaseAdmin.from("jobs").delete().eq("project_id", pid);
      await supabaseAdmin.from("usage_logs").delete().eq("project_id", pid);
    }

    // analysis_versions: filter by stage's task list
    const tasks = STAGE_ANALYSIS_TASKS[stage];
    if (tasks === "all") {
      await supabaseAdmin.from("analysis_versions").delete().eq("project_id", pid);
    } else {
      await supabaseAdmin
        .from("analysis_versions")
        .delete()
        .eq("project_id", pid)
        .in("task", tasks);
    }

    // Reset status to "uploaded" for complete/transcript so pipeline can re-run cleanly.
    const newStatus = stage === "complete" || stage === "transcript" ? "uploaded" : "processing";
    await supabaseAdmin
      .from("projects")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", pid);

    await logAudit(supabaseAdmin, context.userId, pid, "project_reset", { stage });
    return { ok: true, stage };
  });

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ projectId: z.string(), confirm: z.literal("DELETE") }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const project = await assertOwner(context.supabase, data.projectId, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const pid = data.projectId;

    // Wipe all derived data first (mirror complete reset, but also remove uploaded video).
    const { data: tx } = await supabaseAdmin.from("transcripts").select("id").eq("project_id", pid);
    const txIds = (tx ?? []).map((r: any) => r.id);
    if (txIds.length > 0) {
      await supabaseAdmin.from("transcript_segments").delete().in("transcript_id", txIds);
    }
    const { data: sceneRows } = await supabaseAdmin.from("scenes").select("id").eq("project_id", pid);
    const sceneIds = (sceneRows ?? []).map((r: any) => r.id);
    if (sceneIds.length > 0) {
      await supabaseAdmin.from("scene_assets").delete().in("scene_id", sceneIds);
      await supabaseAdmin.from("scene_transcript_map").delete().in("scene_id", sceneIds);
    }

    const admin = supabaseAdmin as any;
    for (const t of [
      "edit_actions",
      "render_manifest",
      "timeline_instructions",
      "render_jobs",
      "storyboard_items",
      "broll_items",
      "infographic_items",
      "thumbnail_items",
      "scenes",
      "asset_candidates",
      "assets",
      "transcripts",
      "task_executions",
      "pipeline_runs",
      "jobs",
      "usage_logs",
      "analysis_versions",
      "project_context",
    ]) {
      await admin.from(t).delete().eq("project_id", pid);
    }

    // Delete uploaded video from storage.
    if (project.video_path) {
      try {
        await supabaseAdmin.storage.from("videos").remove([project.video_path]);
      } catch {
        // best-effort
      }
    }

    // Audit BEFORE deleting the project row (project_id FK is nullable, so still works after, but safer).
    await logAudit(supabaseAdmin, context.userId, pid, "project_delete", {
      title_at_delete: null,
      video_path: project.video_path,
    });

    await supabaseAdmin.from("projects").delete().eq("id", pid);
    return { ok: true };
  });