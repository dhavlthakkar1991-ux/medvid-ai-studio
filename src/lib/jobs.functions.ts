import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const startFullPipeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ projectId: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const terminal = new Set(["completed", "completed_with_warnings", "needs_review", "failed"]);
    const { data: project } = await context.supabase
      .from("projects")
      .select("status")
      .eq("id", data.projectId)
      .maybeSingle();
    const { data: active } = await context.supabase
      .from("jobs")
      .select("id")
      .eq("project_id", data.projectId)
      .in("state", ["queued", "transcribing", "analyzing"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (active?.id) {
      if (project?.status && terminal.has(project.status)) {
        await context.supabase.from("jobs").update({ state: project.status, progress: 100, error: null }).eq("id", active.id);
      } else {
      const { createJobRunnerToken } = await import("@/lib/job-runner-token.server");
      const token = await createJobRunnerToken(active.id);
      return { jobId: active.id, runnerUrl: `/api/public/jobs/run/${active.id}?token=${encodeURIComponent(token)}` };
      }
    }

    const { data: job, error } = await context.supabase
      .from("jobs")
      .insert({ project_id: data.projectId, kind: "full", state: "queued", progress: 0 })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const { createJobRunnerToken } = await import("@/lib/job-runner-token.server");
    const token = await createJobRunnerToken(job.id);

    const runnerUrl = `/api/public/jobs/run/${job.id}?token=${encodeURIComponent(token)}`;
    return { jobId: job.id, runnerUrl };
  });

export const runQueuedJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ jobId: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { data: job, error } = await context.supabase
      .from("jobs")
      .select("id, state, updated_at, project_id, projects!inner(user_id, status)")
      .eq("id", data.jobId)
      .single();
    if (error) throw new Error(error.message);
    const project = job.projects as unknown as { user_id: string; status?: string };
    if (project.user_id !== context.userId) throw new Error("Not authorized to run this job.");
    if (project.status && ["completed", "completed_with_warnings", "needs_review", "failed"].includes(project.status)) {
      await context.supabase.from("jobs").update({ state: project.status, progress: 100, error: null }).eq("id", job.id);
      return { ok: true };
    }
    // Job is finished — nothing to fire.
    if (["completed", "completed_with_warnings", "needs_review", "failed"].includes(job.state)) return { ok: true };
    // Otherwise (queued / failed / transcribing / analyzing): always issue a
    // runner URL so the client can advance the next pipeline step.

    const { createJobRunnerToken } = await import("@/lib/job-runner-token.server");
    const token = await createJobRunnerToken(job.id);
    const runnerUrl = `/api/public/jobs/run/${job.id}?token=${encodeURIComponent(token)}`;
    return { ok: true, runnerUrl };
  });

export const getJobStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ jobId: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { data: j, error } = await context.supabase.from("jobs").select("*").eq("id", data.jobId).single();
    if (error) throw new Error(error.message);
    return j;
  });

/**
 * Manually retry the most recent pipeline job for a project.
 *
 * - Marks any task_executions still in `running` state as failed (clears stale claims).
 * - Deletes `failed` task_executions in the active pipeline_run so they will be retried.
 * - Resets the job to a non-terminal state and re-fires the runner.
 */
export const retryPipeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ projectId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    // Authorize: project must belong to user.
    const { data: project, error: pErr } = await context.supabase
      .from("projects")
      .select("id, user_id")
      .eq("id", data.projectId)
      .single();
    if (pErr || !project) throw new Error(pErr?.message ?? "Project not found.");
    if (project.user_id !== context.userId) throw new Error("Not authorized.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Find most recent job for the project.
    const { data: jobs } = await supabaseAdmin
      .from("jobs")
      .select("id, state, kind")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false })
      .limit(1);
    let jobId = jobs?.[0]?.id as string | undefined;
    const jobState = jobs?.[0]?.state as string | undefined;

    // Clear stuck task_executions in the active pipeline_run.
    const { data: runs } = await supabaseAdmin
      .from("pipeline_runs")
      .select("id")
      .eq("project_id", data.projectId)
      .order("started_at", { ascending: false })
      .limit(1);
    const runId = runs?.[0]?.id as string | undefined;
    let clearedRunning = 0;
    let clearedFailed = 0;
    if (runId) {
      const { data: stuck } = await supabaseAdmin
        .from("task_executions")
        .select("id")
        .eq("pipeline_run_id", runId)
        .eq("status", "running");
      clearedRunning = stuck?.length ?? 0;
      if (clearedRunning > 0) {
        await supabaseAdmin
          .from("task_executions")
          .update({
            status: "failed",
            completed_at: new Date().toISOString(),
            error_message: "Manually retried — task was stuck in running state.",
          })
          .eq("pipeline_run_id", runId)
          .eq("status", "running");
      }
      const { data: failed } = await supabaseAdmin
        .from("task_executions")
        .select("id")
        .eq("pipeline_run_id", runId)
        .eq("status", "failed");
      clearedFailed = failed?.length ?? 0;
      if (clearedFailed > 0) {
        await supabaseAdmin
          .from("task_executions")
          .delete()
          .eq("pipeline_run_id", runId)
          .eq("status", "failed");
      }
    }

    // Reset / create the job so runQueuedJob will issue a runner URL.
    if (!jobId) {
      const { data: created, error: cErr } = await supabaseAdmin
        .from("jobs")
        .insert({ project_id: data.projectId, kind: "full", state: "queued", progress: 0 })
        .select("id")
        .single();
      if (cErr) throw new Error(cErr.message);
      jobId = created!.id;
    } else if (["completed", "completed_with_warnings", "needs_review", "failed"].includes(jobState ?? "")) {
      await supabaseAdmin
        .from("jobs")
        .update({ state: "queued", progress: Math.min(20, 20), error: null })
        .eq("id", jobId);
    } else {
      // Active state — clear error so progress can advance.
      await supabaseAdmin.from("jobs").update({ error: null }).eq("id", jobId);
    }

    const { createJobRunnerToken } = await import("@/lib/job-runner-token.server");
    const token = await createJobRunnerToken(jobId!);
    const runnerUrl = `/api/public/jobs/run/${jobId}?token=${encodeURIComponent(token)}`;
    return { ok: true, jobId, runnerUrl, clearedRunning, clearedFailed };
  });
