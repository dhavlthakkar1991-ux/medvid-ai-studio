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
        return new Response(result.body, { status: result.status });
      },
    },
  },
});
