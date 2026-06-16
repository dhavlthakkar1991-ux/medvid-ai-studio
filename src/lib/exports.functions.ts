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
