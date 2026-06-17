// Server-only: deterministic timeline compiler.
// Reads canonical scenes + storyboard_items + broll_items + scene_assets
// and writes timeline_instructions. This is the contract the future
// FFmpeg renderer will consume; storyboard JSON is never parsed there.

type SupabaseLike = any;

export async function compileTimelineForProject(
  supabase: SupabaseLike,
  projectId: string,
) {
  const { data: scenes } = await supabase
    .from("scenes")
    .select("*")
    .eq("project_id", projectId)
    .order("scene_number", { ascending: true });
  const sceneIds = ((scenes ?? []) as any[]).map((s) => s.id);
  const [{ data: storyboard }, { data: broll }, { data: sceneAssets }] = await Promise.all([
    supabase.from("storyboard_items").select("*").eq("project_id", projectId).order("item_index", { ascending: true }),
    supabase.from("broll_items").select("*").eq("project_id", projectId).order("item_index", { ascending: true }),
    sceneIds.length > 0
      ? supabase.from("scene_assets").select("scene_id, asset_id, is_primary, render_order").in("scene_id", sceneIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const primaryAssetByScene = new Map<string, string>();
  for (const sa of (sceneAssets ?? []) as any[]) {
    if (sa.is_primary) primaryAssetByScene.set(sa.scene_id, sa.asset_id);
  }

  type Row = {
    project_id: string;
    scene_id: string | null;
    asset_id: string | null;
    storyboard_item_id: string | null;
    timeline_start: number;
    timeline_end: number;
    duration: number;
    layer: number;
    transition: string;
    caption_enabled: boolean;
    render_order: number;
  };

  const rows: Row[] = [];
  let order = 0;

  // Layer 0: storyboard items (primary visuals along the scene timeline)
  for (const it of (storyboard ?? []) as any[]) {
    const start = Number(it.timeline_start) || 0;
    const end = Number(it.timeline_end) || start;
    rows.push({
      project_id: projectId,
      scene_id: it.scene_id ?? null,
      asset_id: it.scene_id ? primaryAssetByScene.get(it.scene_id) ?? null : null,
      storyboard_item_id: it.id,
      timeline_start: start,
      timeline_end: end,
      duration: Math.max(0, end - start),
      layer: 0,
      transition: "fade",
      caption_enabled: true,
      render_order: order++,
    });
  }

  // Layer 1: broll overlays
  for (const it of (broll ?? []) as any[]) {
    const start = Number(it.recommended_start) || 0;
    const end = Number(it.recommended_end) || start + 3;
    rows.push({
      project_id: projectId,
      scene_id: it.scene_id ?? null,
      asset_id: null,
      storyboard_item_id: null,
      timeline_start: start,
      timeline_end: end,
      duration: Math.max(0, end - start),
      layer: 1,
      transition: "cut",
      caption_enabled: false,
      render_order: order++,
    });
  }

  rows.sort((a, b) => a.layer - b.layer || a.timeline_start - b.timeline_start);
  rows.forEach((r, i) => (r.render_order = i));

  await supabase.from("timeline_instructions").delete().eq("project_id", projectId);
  if (rows.length > 0) await supabase.from("timeline_instructions").insert(rows);
  return { count: rows.length };
}

export interface TimelineValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  scene_id?: string;
}

export interface TimelineValidationReport {
  ok: boolean;
  duration_seconds: number;
  timeline_end: number;
  issues: TimelineValidationIssue[];
}

export async function validateTimelineForProject(
  supabase: SupabaseLike,
  projectId: string,
): Promise<TimelineValidationReport> {
  const [{ data: project }, { data: scenes }, { data: instructions }] = await Promise.all([
    supabase.from("projects").select("duration_seconds").eq("id", projectId).maybeSingle(),
    supabase.from("scenes").select("*").eq("project_id", projectId).order("start_time", { ascending: true }),
    supabase
      .from("timeline_instructions")
      .select("*")
      .eq("project_id", projectId)
      .order("render_order", { ascending: true }),
  ]);
  const sceneIds = ((scenes ?? []) as any[]).map((s: any) => s.id);
  const { data: sceneAssets } = sceneIds.length > 0
    ? await supabase.from("scene_assets").select("scene_id").in("scene_id", sceneIds)
    : { data: [] as any[] };

  const issues: TimelineValidationIssue[] = [];
  const sceneList = (scenes ?? []) as any[];
  const ins = (instructions ?? []) as any[];
  const projDuration = Number(project?.duration_seconds) || 0;
  const timelineEnd = ins.reduce((m, r) => Math.max(m, Number(r.timeline_end) || 0), 0);

  // Layer 0 gap / overlap checks
  const layer0 = ins.filter((r) => r.layer === 0).sort((a, b) => Number(a.timeline_start) - Number(b.timeline_start));
  for (let i = 1; i < layer0.length; i++) {
    const prev = layer0[i - 1];
    const cur = layer0[i];
    const gap = Number(cur.timeline_start) - Number(prev.timeline_end);
    if (gap > 0.5) issues.push({ severity: "warning", code: "timeline_gap", message: `Gap of ${gap.toFixed(2)}s between primary clips ${i - 1} and ${i}` });
    if (gap < -0.1) issues.push({ severity: "error", code: "timeline_overlap", message: `Overlap of ${Math.abs(gap).toFixed(2)}s between primary clips ${i - 1} and ${i}` });
  }

  // Scene asset coverage
  const scenesWithAssets = new Set((sceneAssets ?? []).map((r: any) => r.scene_id));
  for (const s of sceneList) {
    if (!scenesWithAssets.has(s.id)) {
      issues.push({ severity: "warning", code: "scene_missing_asset", message: `Scene ${s.scene_number} (${s.title}) has no approved asset`, scene_id: s.id });
    }
  }

  // Render order sequential
  for (let i = 0; i < ins.length; i++) {
    if (Number(ins[i].render_order) !== i) {
      issues.push({ severity: "error", code: "render_order_nonsequential", message: `render_order is not sequential at index ${i}` });
      break;
    }
  }

  // Total duration check
  if (projDuration > 0 && Math.abs(timelineEnd - projDuration) > 2) {
    issues.push({
      severity: "warning",
      code: "duration_mismatch",
      message: `Timeline ends at ${timelineEnd.toFixed(2)}s but project duration is ${projDuration.toFixed(2)}s`,
    });
  }

  return {
    ok: !issues.some((i) => i.severity === "error"),
    duration_seconds: projDuration,
    timeline_end: timelineEnd,
    issues,
  };
}