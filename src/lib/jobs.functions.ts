import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const startFullPipeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ projectId: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
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
      .select("id, state, updated_at, project_id, projects!inner(user_id)")
      .eq("id", data.jobId)
      .single();
    if (error) throw new Error(error.message);
    const project = job.projects as unknown as { user_id: string };
    if (project.user_id !== context.userId) throw new Error("Not authorized to run this job.");
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
