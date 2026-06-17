import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({ projectId: z.string() });

export const getCanonicalProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const [scenes, storyboard, broll, manifest, segments] = await Promise.all([
      sb.from("scenes").select("*").eq("project_id", data.projectId).order("scene_number", { ascending: true }),
      sb.from("storyboard_items").select("*").eq("project_id", data.projectId).order("item_index", { ascending: true }),
      sb.from("broll_items").select("*").eq("project_id", data.projectId).order("item_index", { ascending: true }),
      sb.from("render_manifest").select("*").eq("project_id", data.projectId).order("render_order", { ascending: true }),
      sb.from("transcript_segments").select("*").eq("project_id", data.projectId).order("segment_index", { ascending: true }),
    ]);
    return {
      scenes: scenes.data ?? [],
      storyboardItems: storyboard.data ?? [],
      brollItems: broll.data ?? [],
      manifest: manifest.data ?? [],
      transcriptSegments: segments.data ?? [],
    };
  });

export const rebuildRenderManifest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ context, data }) => {
    const { buildRenderManifestForProject } = await import("./render/timeline-builder.server");
    return buildRenderManifestForProject(context.supabase, data.projectId);
  });