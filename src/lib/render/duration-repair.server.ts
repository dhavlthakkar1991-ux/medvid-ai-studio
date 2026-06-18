/**
 * Best-effort repair for projects.duration_seconds.
 *
 * Order of fallbacks:
 *   1. Existing projects.duration_seconds (kept if > 0)
 *   2. Last word end time in transcripts.words
 *   3. Max end_time across transcript_segments
 *   4. Sum of scene_plan scene durations (end - start) from analysis_versions
 *   5. Max end_time across timeline_items / edit_actions
 *   6. Word-count estimate from transcripts.full_text (~2.5 wps, min 15s)
 *
 * Always writes back when a positive duration is discovered.
 */
export async function repairProjectDuration(
  sb: any,
  projectId: string,
): Promise<{ duration: number; source: string; updated: boolean }> {
  const { data: project } = await sb
    .from("projects")
    .select("id, duration_seconds")
    .eq("id", projectId)
    .maybeSingle();
  const current = Number(project?.duration_seconds) || 0;
  if (current > 0) return { duration: current, source: "existing", updated: false };

  let duration = 0;
  let source = "none";

  // 2 + 6) transcripts
  const { data: tx } = await sb
    .from("transcripts")
    .select("words, full_text")
    .eq("project_id", projectId)
    .maybeSingle();
  if (tx) {
    const words = Array.isArray(tx.words) ? (tx.words as any[]) : [];
    if (words.length > 0) {
      const last = words[words.length - 1];
      const end = Number(last?.end ?? last?.end_time ?? last?.t1);
      if (Number.isFinite(end) && end > duration) { duration = end; source = "transcript_words"; }
    }
  }

  // 3) transcript_segments
  if (duration <= 0) {
    const { data: segs } = await sb
      .from("transcript_segments")
      .select("end_time")
      .eq("project_id", projectId)
      .order("end_time", { ascending: false })
      .limit(1);
    const v = Number((segs?.[0] as any)?.end_time);
    if (Number.isFinite(v) && v > duration) { duration = v; source = "transcript_segments"; }
  }

  // 4) scene_plan
  if (duration <= 0) {
    const { data: scenePlan } = await sb
      .from("analysis_versions")
      .select("analysis_data")
      .eq("project_id", projectId)
      .eq("task", "scene_plan")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const scenes = (scenePlan?.analysis_data as any)?.scenes ?? (scenePlan?.analysis_data as any)?.scene_plan ?? [];
    let maxEnd = 0;
    for (const s of Array.isArray(scenes) ? scenes : []) {
      const e = Number(s?.end_time ?? s?.end);
      if (Number.isFinite(e) && e > maxEnd) maxEnd = e;
    }
    if (maxEnd > 0) { duration = maxEnd; source = "scene_plan"; }
  }

  // 5) timeline_items / edit_actions
  if (duration <= 0) {
    const [{ data: tl }, { data: ea }] = await Promise.all([
      sb.from("timeline_items").select("end_time").eq("project_id", projectId).order("end_time", { ascending: false }).limit(1),
      sb.from("edit_actions").select("end_time").eq("project_id", projectId).order("end_time", { ascending: false }).limit(1),
    ]);
    const a = Number((tl?.[0] as any)?.end_time) || 0;
    const b = Number((ea?.[0] as any)?.end_time) || 0;
    const m = Math.max(a, b);
    if (m > 0) { duration = m; source = "timeline"; }
  }

  // 6) word-count estimate
  if (duration <= 0 && tx?.full_text) {
    const wc = String(tx.full_text).trim().split(/\s+/).filter(Boolean).length;
    if (wc > 0) { duration = Math.max(15, Math.round(wc / 2.5)); source = "word_count_estimate"; }
  }

  if (duration > 0) {
    duration = Math.round(duration * 1000) / 1000;
    await sb.from("projects").update({ duration_seconds: duration }).eq("id", projectId);
    return { duration, source, updated: true };
  }
  return { duration: 0, source: "none", updated: false };
}