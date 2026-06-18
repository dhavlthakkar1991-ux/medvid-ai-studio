import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/jobs/run/$jobId")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const jobId = params.jobId;
        const { isValidJobRunnerToken } = await import("@/lib/job-runner-token.server");
        const token = new URL(request.url).searchParams.get("token");
        if (!(await isValidJobRunnerToken(jobId, token))) return new Response("unauthorized", { status: 401 });
        const { runAnalysisJob } = await import("@/lib/job-runner.server");
        const result = await runAnalysisJob(jobId);
        // Self-chain: if the job advanced a single step and is not yet in a
        // terminal state, fire-and-forget the next invocation server-side.
        // This replaces the old client-side auto-poller so the browser never
        // re-fires the pipeline by itself — the chain only starts when the
        // user explicitly clicks Start / Retry.
        try {
          const body = String(result.body ?? "");
          const advanced = body === "transcribed" || body.startsWith("task:") || body.startsWith("claimed:");
          if (advanced) {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { data: job } = await supabaseAdmin.from("jobs").select("state").eq("id", jobId).single();
            const terminal = new Set(["completed", "completed_with_warnings", "needs_review", "failed"]);
            if (job && !terminal.has(job.state)) {
              const url = new URL(request.url);
              fetch(url.toString(), { method: "POST" }).catch(() => undefined);
            }
          }
        } catch {}
        return new Response(result.body, { status: result.status });
      },
    },
  },
});
