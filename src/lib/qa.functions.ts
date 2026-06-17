import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({ projectId: z.string() });

export const getPipelineHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const [{ data: runs }, { data: executions }, { data: editActions }, { data: layoutDecisions }, { data: project }] = await Promise.all([
      sb
      .from("pipeline_runs")
      .select("*")
      .eq("project_id", data.projectId)
      .order("started_at", { ascending: false })
      .limit(5),
      sb
      .from("task_executions")
      .select("*")
      .eq("project_id", data.projectId)
      .order("started_at", { ascending: false })
      .limit(200),
      sb.from("edit_actions").select("action_type, start_time, end_time, source").eq("project_id", data.projectId),
      sb.from("layout_decisions").select("layout_name, doctor_visibility, doctor_size, attention_focus, start_time, end_time").eq("project_id", data.projectId),
      sb.from("projects").select("duration_seconds").eq("id", data.projectId).maybeSingle(),
    ]);
    const latestRunId = runs?.[0]?.id ?? null;
    // Keep only the latest execution per task name (executions are already ordered desc).
    const latestByTask = new Map<string, any>();
    for (const ex of executions ?? []) {
      if (!latestByTask.has(ex.task_name)) latestByTask.set(ex.task_name, ex);
    }

    // Editorial coverage: union of edit_action intervals / project duration.
    const eas = (editActions ?? []) as Array<{ action_type: string; start_time: number; end_time: number; source: string }>;
    const duration = Number(project?.duration_seconds) || 0;
    let covered = 0;
    if (eas.length > 0) {
      const intervals = eas
        .map((a) => [Number(a.start_time) || 0, Number(a.end_time) || 0] as [number, number])
        .filter(([s, e]) => e > s)
        .sort((a, b) => a[0] - b[0]);
      let curS = -1, curE = -1;
      for (const [s, e] of intervals) {
        if (s > curE) { if (curE > curS) covered += curE - curS; curS = s; curE = e; }
        else curE = Math.max(curE, e);
      }
      if (curE > curS) covered += curE - curS;
    }
    const ACTION_GROUPS: Record<string, string> = {
      show_lower_third: "Lower Thirds",
      kinetic_typography: "Kinetic Typography",
      highlight_keyword: "Keyword Highlights",
      show_medical_diagram: "Medical Diagrams",
      show_clinical_image: "Medical Diagrams",
      show_broll: "B-roll",
      show_infographic: "Infographics",
      show_statistic: "Infographics",
      show_cta: "CTA",
      show_thumbnail_frame: "CTA",
    };
    const summary: Record<string, number> = {
      "Lower Thirds": 0, "Kinetic Typography": 0, "Keyword Highlights": 0,
      "Medical Diagrams": 0, "B-roll": 0, "Infographics": 0, "CTA": 0,
    };
    for (const a of eas) {
      const g = ACTION_GROUPS[a.action_type];
      if (g) summary[g] = (summary[g] ?? 0) + 1;
    }
    const aiCount = eas.filter((a) => a.source === "ai").length;

    // Presence + layout-diversity metrics from layout_decisions.
    const lds = (layoutDecisions ?? []) as Array<{ layout_name: string; doctor_visibility: string; doctor_size: string; attention_focus: string; start_time: number; end_time: number }>;
    const sumDur = (filterFn: (l: typeof lds[number]) => boolean) =>
      lds.filter(filterFn).reduce((s, l) => s + Math.max(0, Number(l.end_time) - Number(l.start_time)), 0);
    const totalLdDur = sumDur(() => true);
    const visibleDur = sumDur((l) => l.doctor_visibility === "visible" || l.doctor_visibility === "reduced");
    const layoutCounts: Record<string, number> = {};
    for (const l of lds) layoutCounts[l.layout_name] = (layoutCounts[l.layout_name] ?? 0) + 1;
    const totalLd = lds.length || 1;
    const pct = (n: number) => (totalLd > 0 ? n / totalLd : 0);
    const fullScreenN = lds.filter((l) => l.layout_name.startsWith("full_screen")).length;
    const pipN = lds.filter((l) => l.layout_name.includes("pip") || l.layout_name.includes("picture_in_picture") || l.layout_name === "doctor_with_clinical_image" || l.layout_name === "doctor_with_infographic" || l.layout_name === "doctor_with_broll").length;
    const splitN = lds.filter((l) => l.layout_name === "split_screen" || l.layout_name === "top_bottom").length;
    const infographicN = lds.filter((l) => l.attention_focus === "infographic").length;
    const clinicalN = lds.filter((l) => l.attention_focus === "clinical_image" || l.attention_focus === "diagram").length;
    const distinctLayouts = Object.keys(layoutCounts).length;

    return {
      latestRun: runs?.[0] ?? null,
      recentRuns: runs ?? [],
      latestRunId,
      taskExecutions: Array.from(latestByTask.values()),
      editorial: {
        durationSeconds: duration,
        coveredSeconds: covered,
        coverage: duration > 0 ? covered / duration : 0,
        actionCount: eas.length,
        aiCount,
        backfillCount: eas.length - aiCount,
        actionTypeSummary: summary,
      },
      presence: {
        totalLayoutDecisions: lds.length,
        doctorPresencePct: totalLdDur > 0 ? visibleDur / totalLdDur : 0,
        distinctLayouts,
        layoutDiversityPct: Math.min(1, distinctLayouts / 8),
        fullScreenPct: pct(fullScreenN),
        pipPct: pct(pipN),
        splitScreenPct: pct(splitN),
        infographicPct: pct(infographicN),
        clinicalImagePct: pct(clinicalN),
        layoutCounts,
      },
    };
  });