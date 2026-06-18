import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const TaskInput = z.object({
  projectId: z.string(),
  task: z.enum(["chapters", "scene_plan", "visual_storyboard", "broll", "infographics", "thumbnails", "seo", "shorts", "editorial_decisions"]),
});

export const regenerateTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TaskInput.parse(input))
  .handler(async ({ context, data }) => {
    const { runTaskForProject } = await import("./analysis-runner.server");
    const res = await runTaskForProject(context.supabase, context.userId, data.projectId, data.task);
    return res;
  });

export const listVersions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ projectId: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { data: rows, error } = await context.supabase
      .from("analysis_versions")
      .select("*")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
