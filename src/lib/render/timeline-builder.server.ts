// Server-only: build the canonical render_manifest from scenes + storyboard_items + broll_items.
// Render Manifest V2: each row also carries asset_id and transition so the future
// FFmpeg renderer can consume render_manifest as its sole input contract.

type SupabaseLike = any;

export async function buildRenderManifestForProject(
  supabase: SupabaseLike,
  projectId: string,
) {
  // Manifest V5: timeline_items become the authoritative source. If a timeline
  // exists, derive every manifest row directly from it. Fall back to the legacy
  // editorial-driven build (V3/V4) when no timeline has been composed yet.
  try {
    const { composeTimelineForProject } = await import("../timeline/timeline-composer.server");
    await composeTimelineForProject(supabase, projectId);
  } catch (e) {
    console.warn("timeline compose before manifest failed", e);
  }
  const { data: tItems } = await supabase
    .from("timeline_items").select("*, timeline_tracks!inner(kind, track_index, name)")
    .eq("project_id", projectId)
    .order("start_time", { ascending: true });
  if (Array.isArray(tItems) && tItems.length > 0) {
    const { data: project } = await supabase.from("projects").select("duration_seconds").eq("id", projectId).maybeSingle();
    const { data: assets } = await supabase.from("assets").select("id, url").eq("project_id", projectId);
    const assetUrlById = new Map<string, string | null>(((assets ?? []) as any[]).map((a) => [a.id, a.url ?? null]));
    const rows = (tItems as any[]).map((it, i) => ({
      project_id: projectId,
      render_order: i,
      scene_id: it.scene_id ?? null,
      storyboard_item_id: null,
      asset_id: it.asset_id ?? null,
      edit_action_id: it.edit_action_id ?? null,
      layout_id: null,
      transition_in_id: null,
      transition_out_id: null,
      layer: it.timeline_tracks?.track_index ?? null,
      action_type: it.asset_type ?? null,
      priority: it.z_index ?? 5,
      transition: it.transition_in ?? "cut",
      timeline_start: Number(it.start_time) || 0,
      timeline_end: Number(it.end_time) || 0,
      asset_type: it.asset_type || "",
      asset_source: it.asset_id ? "approved_asset" : "timeline_pending",
      asset_query: it.title ?? "",
      asset_url: it.asset_id ? (assetUrlById.get(it.asset_id) ?? null) : null,
      caption_style: "Full",
      status: it.status === "approved" || it.status === "locked" ? "approved" : it.status,
      layout_name: it.layout ?? null,
      doctor_visibility: null,
      doctor_size: null,
      attention_focus: null,
      rationale: typeof it.metadata === "object" && it.metadata ? (it.metadata as any).reason ?? null : null,
    }));
    await supabase.from("render_manifest").delete().eq("project_id", projectId);
    if (rows.length > 0) await supabase.from("render_manifest").insert(rows);
    const duration = Number(project?.duration_seconds) || rows.reduce((m, r) => Math.max(m, r.timeline_end), 0);
    let coveredEnd = -1, coveredStart = -1, covered = 0;
    const intervals = rows
      .map((r) => [r.timeline_start, r.timeline_end] as [number, number])
      .filter(([s, e]) => e > s)
      .sort((a, b) => a[0] - b[0]);
    for (const [s, e] of intervals) {
      if (s > coveredEnd) { if (coveredEnd > coveredStart) covered += coveredEnd - coveredStart; coveredStart = s; coveredEnd = e; }
      else coveredEnd = Math.max(coveredEnd, e);
    }
    if (coveredEnd > coveredStart) covered += coveredEnd - coveredStart;
    return { count: rows.length, editorialCoverage: duration > 0 ? covered / duration : 0, editorialActionCount: rows.length, source: "timeline" };
  }

  const [{ data: scenes }, { data: storyboard }, { data: broll }, { data: infographics }, { data: instructions }, { data: editActions }, { data: layoutDecisions }, { data: project }, { data: approvedAssets }, { data: candidates }] = await Promise.all([
    supabase.from("scenes").select("*").eq("project_id", projectId).order("scene_number", { ascending: true }),
    supabase.from("storyboard_items").select("*").eq("project_id", projectId).order("item_index", { ascending: true }),
    supabase.from("broll_items").select("*").eq("project_id", projectId).order("item_index", { ascending: true }),
    supabase.from("infographic_items").select("*").eq("project_id", projectId).order("item_index", { ascending: true }),
    supabase.from("timeline_instructions").select("*").eq("project_id", projectId).order("render_order", { ascending: true }),
    supabase.from("edit_actions").select("*").eq("project_id", projectId).order("start_time", { ascending: true }),
    supabase.from("layout_decisions").select("*").eq("project_id", projectId),
    supabase.from("projects").select("duration_seconds").eq("id", projectId).maybeSingle(),
    supabase.from("assets").select("id, asset_type, scene_id, search_query, status, url").eq("project_id", projectId).in("status", ["approved", "locked"]),
    supabase.from("asset_candidates").select("id, edit_action_id, status, linked_asset_id").eq("project_id", projectId),
  ]);

  // Build lookup: edit_action_id -> approved asset_id (via candidates)
  const approvedByAction = new Map<string, { assetId: string; url: string | null }>();
  const assetById = new Map<string, any>(((approvedAssets ?? []) as any[]).map((a) => [a.id, a]));
  for (const c of (candidates ?? []) as any[]) {
    if (!c.edit_action_id || !c.linked_asset_id) continue;
    if (c.status !== "approved" && c.status !== "locked" && c.status !== "replaced") continue;
    const a = assetById.get(c.linked_asset_id);
    if (a) approvedByAction.set(c.edit_action_id, { assetId: a.id, url: a.url ?? null });
  }

  type Entry = {
    scene_id: string | null;
    storyboard_item_id: string | null;
    asset_id: string | null;
    edit_action_id: string | null;
    layout_id: string | null;
    transition_in_id: string | null;
    transition_out_id: string | null;
    layer: number | null;
    action_type: string | null;
    priority: number | null;
    transition: string;
    timeline_start: number;
    timeline_end: number;
    asset_type: string;
    asset_source: string;
    asset_query: string;
    asset_url: string | null;
    caption_style: string;
    status: string;
    layout_name: string | null;
    doctor_visibility: string | null;
    doctor_size: string | null;
    attention_focus: string | null;
    rationale: string | null;
  };

  const entries: Entry[] = [];

  // Manifest V3: Editorial Decisions are authoritative. Build manifest from
  // edit_actions first, then enrich (never overwrite) with storyboard/broll/
  // infographics on supplementary layers so editorial actions like
  // show_lower_third / kinetic_typography / highlight_keyword survive.
  const eas = Array.isArray(editActions) ? (editActions as any[]) : [];
  const layoutByActionId = new Map<string, any>();
  for (const ld of (layoutDecisions ?? []) as any[]) {
    if (ld.action_id) layoutByActionId.set(ld.action_id as string, ld);
  }
  const { defaultLayoutForAction } = await import("../layout/layout-runner.server");
  if (eas.length > 0) {
    for (const ea of eas) {
      const ld = layoutByActionId.get(ea.id) || defaultLayoutForAction(ea.action_type || "");
      const approved = approvedByAction.get(ea.id);
      entries.push({
        scene_id: ea.scene_id ?? null,
        storyboard_item_id: ea.storyboard_item_id ?? null,
        asset_id: approved?.assetId ?? null,
        edit_action_id: ea.id,
        layout_id: ea.layout_id ?? null,
        transition_in_id: ea.transition_in_id ?? null,
        transition_out_id: ea.transition_out_id ?? null,
        layer: typeof ea.layer === "number" ? ea.layer : null,
        action_type: ea.action_type ?? null,
        priority: typeof ea.priority === "number" ? ea.priority : 5,
        transition: "fade",
        timeline_start: Number(ea.start_time) || 0,
        timeline_end: Number(ea.end_time) || 0,
        asset_type: ea.action_type || "edit_action",
        asset_source: approved ? "approved_asset" : (ea.source === "ai" ? "ai_editorial" : "backfill"),
        asset_query: ea.asset_query || "",
        asset_url: approved?.url ?? null,
        caption_style: "Full",
        status: approved ? "approved" : "pending",
        layout_name: ld.layout_name ?? null,
        doctor_visibility: ld.doctor_visibility ?? null,
        doctor_size: ld.doctor_size ?? null,
        attention_focus: ld.attention_focus ?? null,
        rationale: ld.rationale ?? null,
      });
    }

    // Enrichment: add storyboard/broll/infographics on their own layers if no
    // edit_action already covers that layer at that time window. Editorial
    // actions are never overwritten.
    const hasOverlap = (layer: number, s: number, e: number) =>
      entries.some((x) => x.layer === layer && x.timeline_start < e && x.timeline_end > s);

    for (const it of (broll ?? []) as any[]) {
      const s = Number(it.recommended_start) || 0;
      const e = Number(it.recommended_end) || s + 3;
      if (e <= s) continue;
      if (hasOverlap(1, s, e)) continue;
      entries.push({
        scene_id: it.scene_id ?? null, storyboard_item_id: null, asset_id: null,
        edit_action_id: null, layout_id: null, transition_in_id: null, transition_out_id: null,
        layer: 1, action_type: "show_broll", priority: 4, transition: "cut",
        timeline_start: s, timeline_end: e,
        asset_type: "show_broll", asset_source: "enrichment_broll",
        asset_query: it.search_prompt || it.keyword || "", asset_url: null,
        caption_style: "", status: "pending",
        layout_name: "doctor_with_broll", doctor_visibility: "reduced",
        doctor_size: "30%", attention_focus: "broll",
        rationale: "Enrichment: b-roll without explicit editorial decision.",
      });
    }
    for (const it of (infographics ?? []) as any[]) {
      const s = Number(it.timeline_start) || 0;
      const e = Number(it.timeline_end) || s + 5;
      if (e <= s) continue;
      if (hasOverlap(2, s, e)) continue;
      entries.push({
        scene_id: it.scene_id ?? null, storyboard_item_id: null, asset_id: null,
        edit_action_id: null, layout_id: null, transition_in_id: null, transition_out_id: null,
        layer: 2, action_type: "show_infographic", priority: 5, transition: "fade",
        timeline_start: s, timeline_end: e,
        asset_type: "show_infographic", asset_source: "enrichment_infographic",
        asset_query: it.asset_prompt || it.title || "", asset_url: null,
        caption_style: "Full", status: "pending",
        layout_name: "doctor_with_infographic", doctor_visibility: "visible",
        doctor_size: "30%", attention_focus: "infographic",
        rationale: "Enrichment: infographic placed beside doctor.",
      });
    }
  } else if (Array.isArray(instructions) && instructions.length > 0) {
    const storyboardById = new Map<string, any>(((storyboard ?? []) as any[]).map((s) => [s.id, s]));
    for (const ins of instructions as any[]) {
      const sb = ins.storyboard_item_id ? storyboardById.get(ins.storyboard_item_id) : null;
      entries.push({
        scene_id: ins.scene_id ?? null,
        storyboard_item_id: ins.storyboard_item_id ?? null,
        asset_id: ins.asset_id ?? null,
        edit_action_id: null,
        layout_id: null,
        transition_in_id: null,
        transition_out_id: null,
        layer: typeof ins.layer === "number" ? ins.layer : null,
        action_type: null,
        priority: 5,
        transition: ins.transition || "cut",
        timeline_start: Number(ins.timeline_start) || 0,
        timeline_end: Number(ins.timeline_end) || 0,
        asset_type: sb?.visual_type || (ins.layer === 1 ? "broll" : "storyboard"),
        asset_source: ins.asset_id ? "registry" : (ins.layer === 1 ? "stock" : "ai_generated"),
        asset_query: sb?.asset_prompt || "",
        asset_url: sb?.asset_url ?? null,
        caption_style: sb?.screen_layout || "Full",
        status: sb?.asset_status || "pending",
        layout_name: null, doctor_visibility: null, doctor_size: null,
        attention_focus: null, rationale: null,
      });
    }
  } else {
    for (const it of (storyboard ?? []) as any[]) {
      entries.push({
        scene_id: it.scene_id ?? null,
        storyboard_item_id: it.id,
        asset_id: null,
        edit_action_id: null,
        layout_id: null,
        transition_in_id: null,
        transition_out_id: null,
        layer: 0,
        action_type: null,
        priority: 5,
        transition: "fade",
        timeline_start: Number(it.timeline_start) || 0,
        timeline_end: Number(it.timeline_end) || 0,
        asset_type: it.visual_type || "storyboard",
        asset_source: "ai_generated",
        asset_query: it.asset_prompt || "",
        asset_url: it.asset_url ?? null,
        caption_style: it.screen_layout || "Full",
        status: it.asset_status || "pending",
        layout_name: null, doctor_visibility: null, doctor_size: null,
        attention_focus: null, rationale: null,
      });
    }
    for (const it of (broll ?? []) as any[]) {
      entries.push({
        scene_id: it.scene_id ?? null,
        storyboard_item_id: null,
        asset_id: null,
        edit_action_id: null,
        layout_id: null,
        transition_in_id: null,
        transition_out_id: null,
        layer: 1,
        action_type: null,
        priority: 4,
        transition: "cut",
        timeline_start: Number(it.recommended_start) || 0,
        timeline_end: Number(it.recommended_end) || 0,
        asset_type: "broll",
        asset_source: "stock",
        asset_query: it.search_prompt || it.keyword || "",
        asset_url: it.asset_url ?? null,
        caption_style: "",
        status: it.asset_status || "pending",
        layout_name: null, doctor_visibility: null, doctor_size: null,
        attention_focus: null, rationale: null,
      });
    }
  }

  entries.sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0) || a.timeline_start - b.timeline_start);

  const rows = entries.map((e, i) => ({
    project_id: projectId,
    render_order: i,
    ...e,
  }));

  await supabase.from("render_manifest").delete().eq("project_id", projectId);
  if (rows.length > 0) await supabase.from("render_manifest").insert(rows);

  // Editorial coverage = fraction of project duration covered by editorial actions.
  const duration = Number(project?.duration_seconds) || rows.reduce((m, r) => Math.max(m, r.timeline_end), 0);
  let editorialCovered = 0;
  if (eas.length > 0 && duration > 0) {
    const intervals = eas
      .map((a: any) => [Number(a.start_time) || 0, Number(a.end_time) || 0] as [number, number])
      .filter(([s, e]) => e > s)
      .sort((a, b) => a[0] - b[0]);
    let curS = -1, curE = -1;
    for (const [s, e] of intervals) {
      if (s > curE) { if (curE > curS) editorialCovered += curE - curS; curS = s; curE = e; }
      else curE = Math.max(curE, e);
    }
    if (curE > curS) editorialCovered += curE - curS;
  }
  const coverage = duration > 0 ? editorialCovered / duration : 0;
  return { count: rows.length, editorialCoverage: coverage, editorialActionCount: eas.length };
}