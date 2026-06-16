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

    // Fire-and-forget background trigger
    const req = (globalThis as any).Request ? null : null;
    const origin = process.env.SUPABASE_URL ? "" : "";
    void fetch(`${origin}/api/jobs/run/${job.id}`, { method: "POST" }).catch(() => {});
    return { jobId: job.id };
  });

export const getJobStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ jobId: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { data: j, error } = await context.supabase.from("jobs").select("*").eq("id", data.jobId).single();
    if (error) throw new Error(error.message);
    return j;
  });
