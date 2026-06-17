import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({ projectId: z.string() });

export const getPipelineHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const { data: runs } = await sb
      .from("pipeline_runs")
      .select("*")
      .eq("project_id", data.projectId)
      .order("started_at", { ascending: false })
      .limit(5);
    const latestRunId = runs?.[0]?.id ?? null;
    const { data: executions } = await sb
      .from("task_executions")
      .select("*")
      .eq("project_id", data.projectId)
      .order("started_at", { ascending: false })
      .limit(200);
    // Keep only the latest execution per task name (executions are already ordered desc).
    const latestByTask = new Map<string, any>();
    for (const ex of executions ?? []) {
      if (!latestByTask.has(ex.task_name)) latestByTask.set(ex.task_name, ex);
    }
    return {
      latestRun: runs?.[0] ?? null,
      recentRuns: runs ?? [],
      latestRunId,
      taskExecutions: Array.from(latestByTask.values()),
    };
  });