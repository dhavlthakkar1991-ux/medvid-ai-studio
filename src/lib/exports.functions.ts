import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

function pad(n: number) { return n.toString().padStart(2, "0"); }
function fmtSrt(s: number) {
  const ms = Math.round((s % 1) * 1000);
  const sec = Math.floor(s) % 60;
  const min = Math.floor(s / 60) % 60;
  const hr = Math.floor(s / 3600);
  return `${pad(hr)}:${pad(min)}:${pad(sec)},${ms.toString().padStart(3, "0")}`;
}

export const getExportBundle = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ projectId: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const [proj, ctx, tx, vers] = await Promise.all([
      context.supabase.from("projects").select("*").eq("id", data.projectId).single(),
      context.supabase.from("project_context").select("*").eq("project_id", data.projectId).maybeSingle(),
      context.supabase.from("transcripts").select("*").eq("project_id", data.projectId).maybeSingle(),
      context.supabase.from("analysis_versions").select("*").eq("project_id", data.projectId).order("created_at", { ascending: false }),
    ]);
    if (proj.error) throw new Error(proj.error.message);

    // Latest per task
    const latest: Record<string, any> = {};
    for (const v of vers.data ?? []) {
      if (!latest[v.task]) latest[v.task] = v;
    }

    // Build SRT from words
    const words: Array<{ word: string; start: number; end: number }> = (tx.data?.words as any) ?? [];
    let srt = "";
    if (words.length > 0) {
      const CHUNK = 7;
      let idx = 1;
      for (let i = 0; i < words.length; i += CHUNK) {
        const grp = words.slice(i, i + CHUNK);
        const start = grp[0].start;
        const end = grp[grp.length - 1].end;
        srt += `${idx}\n${fmtSrt(start)} --> ${fmtSrt(end)}\n${grp.map(w => w.word).join(" ").trim()}\n\n`;
        idx++;
      }
    }

    return {
      project: proj.data,
      context: ctx.data,
      transcript: tx.data,
      analyses: latest,
      srt,
    };
  });

/**
 * Production Package — every artifact a downstream editor, doctor, or agency
 * needs to produce the final video, even if no render has run yet.
 *
 * Returns a flat object of file_name → string contents. The client zips and
 * downloads it; we keep PDF rendering on the client too (jspdf in the
 * browser) so the Workers runtime never has to spawn anything.
 */
const PkgInput = z.object({ projectId: z.string().uuid() });
export const getProductionPackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => PkgInput.parse(i))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const projectId = data.projectId;
    const [
      proj, ctx, tx, vers,
      scenes, storyboard, broll, infographics, thumbnails,
      editActions, layoutDecisions,
      tracks, items, manifest, compiled, assets,
    ] = await Promise.all([
      sb.from("projects").select("*").eq("id", projectId).single(),
      sb.from("project_context").select("*").eq("project_id", projectId).maybeSingle(),
      sb.from("transcripts").select("*").eq("project_id", projectId).maybeSingle(),
      sb.from("analysis_versions").select("*").eq("project_id", projectId).order("created_at", { ascending: false }),
      sb.from("scenes").select("*").eq("project_id", projectId).order("scene_number", { ascending: true }),
      sb.from("storyboard_items").select("*").eq("project_id", projectId).order("item_index", { ascending: true }),
      sb.from("broll_items").select("*").eq("project_id", projectId).order("item_index", { ascending: true }),
      sb.from("infographic_items").select("*").eq("project_id", projectId).order("item_index", { ascending: true }),
      sb.from("thumbnail_items").select("*").eq("project_id", projectId).order("item_index", { ascending: true }),
      sb.from("edit_actions").select("*").eq("project_id", projectId).order("start_time", { ascending: true }),
      sb.from("layout_decisions").select("*").eq("project_id", projectId),
      sb.from("timeline_tracks").select("*").eq("project_id", projectId).order("track_index", { ascending: true }),
      sb.from("timeline_items").select("*").eq("project_id", projectId).order("start_time", { ascending: true }),
      sb.from("render_manifest").select("*").eq("project_id", projectId).order("render_order", { ascending: true }),
      sb.from("compiled_graphics").select("*").eq("project_id", projectId),
      sb.from("assets").select("*").eq("project_id", projectId),
    ]);
    if (proj.error) throw new Error(proj.error.message);

    const latest: Record<string, any> = {};
    for (const v of vers.data ?? []) if (!latest[v.task]) latest[v.task] = v.payload;

    const project = proj.data;
    const generatedAt = new Date().toISOString();

    const pkg = {
      "manifest.json": {
        package_version: 1,
        generated_at: generatedAt,
        project: {
          id: project.id, title: project.title, topic: project.topic,
          duration_seconds: project.duration_seconds, status: project.status,
        },
        contents: [
          "transcript.json", "scene_plan.json", "storyboard.json", "broll.json",
          "infographics.json", "editorial_decisions.json", "layout_decisions.json",
          "timeline.json", "manifest_v6.json", "seo_package.json", "shorts.json",
          "assets.json", "compiled_graphics.json", "captions.srt",
          "project_summary.pdf", "timeline.csv",
        ],
      },
      "project.json": project,
      "project_context.json": ctx.data ?? null,
      "transcript.json": tx.data ?? null,
      "scene_plan.json": latest.scene_plan ?? scenes.data ?? [],
      "storyboard.json": latest.visual_storyboard ?? storyboard.data ?? [],
      "broll.json": latest.broll ?? broll.data ?? [],
      "infographics.json": latest.infographics ?? infographics.data ?? [],
      "thumbnails.json": latest.thumbnails ?? thumbnails.data ?? [],
      "editorial_decisions.json": editActions.data ?? [],
      "layout_decisions.json": layoutDecisions.data ?? [],
      "timeline.json": {
        tracks: tracks.data ?? [],
        items: items.data ?? [],
      },
      "manifest_v6.json": {
        version: 6,
        project_id: projectId,
        rows: manifest.data ?? [],
      },
      "compiled_graphics.json": compiled.data ?? [],
      "assets.json": assets.data ?? [],
      "seo_package.json": latest.seo ?? null,
      "shorts.json": latest.shorts ?? null,
    };

    // SRT captions, same generator as getExportBundle.
    const words: Array<{ word: string; start: number; end: number }> = (tx.data?.words as any) ?? [];
    let srt = "";
    if (words.length > 0) {
      const CHUNK = 7; let idx = 1;
      for (let i = 0; i < words.length; i += CHUNK) {
        const grp = words.slice(i, i + CHUNK);
        srt += `${idx}\n${fmtSrt(grp[0].start)} --> ${fmtSrt(grp[grp.length - 1].end)}\n${grp.map((w) => w.word).join(" ").trim()}\n\n`;
        idx++;
      }
    }

    // Timeline CSV (Manifest V6 ordering).
    const rows = (manifest.data ?? []) as any[];
    const escapeCsv = (v: any) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csvHeader = [
      "render_order","scene_id","storyboard_item_id","asset_id","asset_type",
      "asset_source","timeline_start","timeline_end","duration","transition","status",
    ];
    const csvLines = [csvHeader.join(",")];
    for (const r of rows) {
      const dur = Math.max(0, Number(r.timeline_end ?? 0) - Number(r.timeline_start ?? 0));
      csvLines.push([
        r.render_order, r.scene_id, r.storyboard_item_id, r.asset_id, r.asset_type,
        r.asset_source, r.timeline_start, r.timeline_end, dur.toFixed(3), r.transition, r.status,
      ].map(escapeCsv).join(","));
    }

    return {
      generatedAt,
      project: { id: project.id, title: project.title, topic: project.topic, duration_seconds: project.duration_seconds },
      jsonFiles: pkg,
      srt,
      timelineCsv: csvLines.join("\n"),
    };
  });
