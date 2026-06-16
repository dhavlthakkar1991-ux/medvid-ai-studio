import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
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

    // Fire the background runner. Build an absolute URL from the inbound request.
    const req = getRequest();
    const url = new URL(req!.url);
    const runnerUrl = `${url.origin}/api/jobs/run/${job.id}`;
    void fetch(runnerUrl, { method: "POST" }).catch(() => {});
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
