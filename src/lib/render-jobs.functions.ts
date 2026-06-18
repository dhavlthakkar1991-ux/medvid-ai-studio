import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Render Job Orchestration API.
 *
 * This module defines the *contracts* for queuing, advancing and reading
 * render jobs. A real FFmpeg engine can later replace `advanceMockRender`
 * without changing any other call site.
 *
 *  createRenderJob()        → enqueue a render
 *  validateRenderReadiness()→ pre-flight checks before queueing
 *  getRenderStatus()        → latest job + auto-tick of mock lifecycle
 *  listRenderOutputs()      → finished artifacts for a project
 *  cancelRenderJob()        → mark a queued/in-flight job cancelled
 *  getRenderDashboardSummary() → cross-project metrics for dashboard cards
 */

const ProjectIdInput = z.object({ projectId: z.string().uuid() });
const CreateInput = z.object({
  projectId: z.string().uuid(),
  renderType: z.enum(["preview", "full"]).default("preview"),
});
const CancelInput = z.object({ jobId: z.string().uuid() });

const PREVIEW_MS = { prepare: 2000, render: 8000 };   // ~10s mock preview
const FULL_MS    = { prepare: 4000, render: 18000 };  // ~22s mock full

type Sb = any;

/** Pre-flight gate: timeline valid, manifest exists, duration known, assets ok. */
export async function computeRenderReadiness(sb: Sb, projectId: string) {
  const [{ data: project }, manifestRes, timelineRes, candRes] = await Promise.all([
    sb.from("projects").select("id, duration_seconds").eq("id", projectId).maybeSingle(),
    sb.from("render_manifest").select("id", { count: "exact", head: true }).eq("project_id", projectId),
    sb.from("timeline_items").select("id", { count: "exact", head: true }).eq("project_id", projectId),
    sb.from("asset_candidates").select("status").eq("project_id", projectId),
  ]);
  const manifestCount = manifestRes.count ?? 0;
  const timelineCount = timelineRes.count ?? 0;
  const cand = (candRes.data ?? []) as Array<{ status: string }>;
  const total = cand.length;
  const approved = cand.filter((c) => ["approved", "locked", "replaced"].includes(c.status)).length;
  const duration = Number(project?.duration_seconds) || 0;

  let timelineValid = false;
  const timelineIssues: string[] = [];
  if (timelineCount > 0) {
    try {
      const { validateTimelineForProject } = await import("./timeline/timeline-composer.server");
      const v = await validateTimelineForProject(sb, projectId);
      timelineValid = v.valid;
      timelineIssues.push(...v.issues.filter((i: any) => i.level === "error").map((i: any) => i.message));
    } catch (e: any) {
      timelineIssues.push(e?.message ?? "timeline validation failed");
    }
  }

  const blockers: string[] = [];
  if (timelineCount === 0) blockers.push("Timeline not composed");
  else if (!timelineValid) blockers.push("Timeline has critical errors");
  if (manifestCount === 0) blockers.push("Render manifest missing");
  if (duration <= 0) blockers.push("Project duration unknown");
  if (total > 0 && approved === 0) blockers.push("No assets approved");
  blockers.push(...timelineIssues.slice(0, 3));

  return {
    ok: blockers.length === 0,
    blockers,
    checks: {
      timelineValid,
      manifestExists: manifestCount > 0,
      durationKnown: duration > 0,
      assetsApproved: total === 0 || approved > 0,
      totalCandidates: total,
      approvedCandidates: approved,
      durationSeconds: duration,
    },
  };
}

/** Compute next status/progress for a mock render based on elapsed time. */
function computeMockState(job: any): { status: string; progress: number; completedAt: string | null; outputDue: boolean } {
  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    return { status: job.status, progress: job.progress_percent ?? 0, completedAt: job.completed_at, outputDue: false };
  }
  const started = job.started_at ? new Date(job.started_at).getTime() : null;
  if (!started) return { status: "queued", progress: 0, completedAt: null, outputDue: false };
  const elapsed = Date.now() - started;
  const plan = job.render_type === "full" ? FULL_MS : PREVIEW_MS;
  const total = plan.prepare + plan.render;
  if (elapsed < plan.prepare) {
    return { status: "preparing", progress: Math.round((elapsed / plan.prepare) * 15), completedAt: null, outputDue: false };
  }
  if (elapsed < total) {
    const renderProgress = (elapsed - plan.prepare) / plan.render;
    return { status: "rendering", progress: 15 + Math.round(renderProgress * 80), completedAt: null, outputDue: false };
  }
  return { status: "completed", progress: 100, completedAt: new Date().toISOString(), outputDue: true };
}

async function persistMockTick(sb: Sb, job: any) {
  const next = computeMockState(job);
  if (next.status === job.status && next.progress === (job.progress_percent ?? 0)) return job;
  const patch: any = { status: next.status, progress_percent: next.progress };
  if (next.completedAt) patch.completed_at = next.completedAt;
  const { data: updated } = await sb.from("render_jobs").update(patch).eq("id", job.id).select("*").maybeSingle();
  if (next.outputDue) {
    // emit a single placeholder output row
    const { data: existing } = await sb.from("render_outputs").select("id").eq("render_job_id", job.id).limit(1);
    if (!existing || existing.length === 0) {
      const isPreview = job.render_type !== "full";
      const [{ data: project }] = await Promise.all([
        sb.from("projects").select("duration_seconds").eq("id", job.project_id).maybeSingle(),
      ]);
      await sb.from("render_outputs").insert({
        render_job_id: job.id,
        project_id: job.project_id,
        output_type: isPreview ? "preview" : "landscape",
        file_url: `mock://renders/${job.id}.mp4`,
        thumbnail_url: null,
        duration_seconds: Number(project?.duration_seconds) || 0,
        resolution: isPreview ? "640x360" : "1920x1080",
        file_size: isPreview ? 4_000_000 : 80_000_000,
      });
    }
  }
  return updated ?? job;
}

export const validateRenderReadiness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ProjectIdInput.parse(i))
  .handler(async ({ context, data }) => computeRenderReadiness(context.supabase, data.projectId));

export const createRenderJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CreateInput.parse(i))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const readiness = await computeRenderReadiness(sb, data.projectId);
    if (!readiness.ok) {
      return { ok: false as const, blockers: readiness.blockers, job: null };
    }
    // Refuse to enqueue if another job is already in-flight.
    const { data: existing } = await sb
      .from("render_jobs").select("id, status")
      .eq("project_id", data.projectId)
      .in("status", ["queued", "preparing", "rendering"])
      .limit(1);
    if (existing && existing.length > 0) {
      return { ok: false as const, blockers: ["A render is already in flight for this project."], job: existing[0] };
    }
    const { data: manifest } = await sb
      .from("render_manifest").select("id").eq("project_id", data.projectId).limit(1);
    const { data: job, error } = await sb
      .from("render_jobs")
      .insert({
        project_id: data.projectId,
        status: "queued",
        render_type: data.renderType,
        progress_percent: 0,
        manifest_version: manifest && manifest.length > 0 ? 5 : null,
        requested_by: context.userId,
        started_at: new Date().toISOString(), // mock: start immediately
        provider: "mock",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true as const, blockers: [], job };
  });

export const getRenderStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ProjectIdInput.parse(i))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const { data: jobs } = await sb
      .from("render_jobs").select("*")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false })
      .limit(20);
    const list = (jobs ?? []) as any[];
    // Auto-tick the latest in-flight job (mock renderer).
    let latest = list[0] ?? null;
    if (latest && ["queued", "preparing", "rendering"].includes(latest.status)) {
      latest = await persistMockTick(sb, latest);
      list[0] = latest;
    }
    return { latest, history: list };
  });

export const cancelRenderJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CancelInput.parse(i))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const { data: job, error } = await sb
      .from("render_jobs")
      .update({ status: "cancelled", completed_at: new Date().toISOString(), error_message: "Cancelled by user" })
      .eq("id", data.jobId)
      .in("status", ["queued", "preparing", "rendering"])
      .select("*").maybeSingle();
    if (error) throw new Error(error.message);
    return { ok: true, job };
  });

export const listRenderOutputs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ProjectIdInput.parse(i))
  .handler(async ({ context, data }) => {
    const { data: outputs } = await context.supabase
      .from("render_outputs").select("*")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false });
    return { outputs: outputs ?? [] };
  });

export const getRenderDashboardSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const { data: projects } = await sb.from("projects").select("id").eq("user_id", context.userId);
    const ids = (projects ?? []).map((p: any) => p.id);
    if (ids.length === 0) {
      return { queued: 0, completed: 0, failed: 0, avgRenderSeconds: 0 };
    }
    const { data: jobs } = await sb
      .from("render_jobs")
      .select("status, started_at, completed_at")
      .in("project_id", ids);
    const rows = (jobs ?? []) as any[];
    const queued = rows.filter((j) => ["queued", "preparing", "rendering"].includes(j.status)).length;
    const completed = rows.filter((j) => j.status === "completed").length;
    const failed = rows.filter((j) => j.status === "failed").length;
    const durations = rows
      .filter((j) => j.status === "completed" && j.started_at && j.completed_at)
      .map((j) => (new Date(j.completed_at).getTime() - new Date(j.started_at).getTime()) / 1000);
    const avgRenderSeconds = durations.length === 0 ? 0 : Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
    return { queued, completed, failed, avgRenderSeconds };
  });