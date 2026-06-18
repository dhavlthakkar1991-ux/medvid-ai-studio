import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({ projectId: z.string() });

export const getProjectTimeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    // Lazy compose on first read so legacy projects light up.
    const { composeTimelineForProject, validateTimelineForProject } = await import("./timeline/timeline-composer.server");
    const [{ count: itemCount }, { data: project }] = await Promise.all([
      sb.from("timeline_items").select("id", { count: "exact", head: true }).eq("project_id", data.projectId),
      sb.from("projects").select("duration_seconds").eq("id", data.projectId).maybeSingle(),
    ]);
    if ((itemCount ?? 0) === 0) {
      try { await composeTimelineForProject(sb, data.projectId); } catch (e) { console.warn(e); }
    }
    const [{ data: tracks }, { data: items }, validation] = await Promise.all([
      sb.from("timeline_tracks").select("*").eq("project_id", data.projectId).order("track_index", { ascending: true }),
      sb.from("timeline_items").select("*").eq("project_id", data.projectId).order("start_time", { ascending: true }),
      validateTimelineForProject(sb, data.projectId),
    ]);
    return {
      tracks: tracks ?? [],
      items: items ?? [],
      duration: Number((project as any)?.duration_seconds) || 0,
      validation,
    };
  });

export const recomposeTimeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const { composeTimelineForProject, validateTimelineForProject } = await import("./timeline/timeline-composer.server");
    const { buildRenderManifestForProject } = await import("./render/timeline-builder.server");
    const composeResult = await composeTimelineForProject(sb, data.projectId);
    const validation = await validateTimelineForProject(sb, data.projectId);
    await buildRenderManifestForProject(sb, data.projectId);
    return { ...composeResult, validation };
  });