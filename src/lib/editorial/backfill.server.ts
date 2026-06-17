// Server-only: derives edit_actions from existing storyboard_items, broll_items,
// and infographic_items so legacy projects light up the new AI Editing System
// without re-running AI. Idempotent — caller guards on edit_actions count == 0.

type SupabaseLike = any;

const ACTION_LAYOUT: Record<string, string> = {
  show_broll: "full_screen",
  show_infographic: "full_screen",
  show_callout: "doctor_with_callout",
  show_text_overlay: "doctor_with_callout",
  show_lower_third: "doctor_with_callout",
  show_clinical_image: "picture_in_picture",
  picture_in_picture: "pip_right",
  split_screen: "split_screen",
  show_cta: "full_screen",
  show_thumbnail_frame: "full_screen",
};

const ACTION_LAYER: Record<string, number> = {
  show_broll: 1,
  show_infographic: 2,
  show_clinical_image: 2,
  show_callout: 3,
  show_text_overlay: 3,
  show_lower_third: 3,
  picture_in_picture: 5,
  split_screen: 5,
  show_cta: 6,
  show_thumbnail_frame: 6,
};

function visualTypeToAction(visualType: string | null | undefined): string {
  const v = (visualType || "").toLowerCase();
  if (v.includes("infographic")) return "show_infographic";
  if (v.includes("diagram")) return "show_infographic";
  if (v.includes("b-roll") || v.includes("broll")) return "show_broll";
  if (v.includes("split")) return "split_screen";
  if (v.includes("chapter")) return "show_text_overlay";
  return "show_callout";
}

async function loadTemplateMaps(supabase: SupabaseLike) {
  const [layouts, transitions] = await Promise.all([
    supabase.from("layout_templates").select("id, name"),
    supabase.from("transition_templates").select("id, name"),
  ]);
  const layoutByName = new Map<string, string>(((layouts.data ?? []) as any[]).map((r) => [r.name, r.id]));
  const transitionByName = new Map<string, string>(((transitions.data ?? []) as any[]).map((r) => [r.name, r.id]));
  return { layoutByName, transitionByName };
}

export async function backfillEditActionsForProject(supabase: SupabaseLike, projectId: string) {
  const [{ data: storyboard }, { data: broll }, { data: infographics }, maps] = await Promise.all([
    supabase.from("storyboard_items").select("*").eq("project_id", projectId).order("item_index", { ascending: true }),
    supabase.from("broll_items").select("*").eq("project_id", projectId).order("item_index", { ascending: true }),
    supabase.from("infographic_items").select("*").eq("project_id", projectId).order("item_index", { ascending: true }),
    loadTemplateMaps(supabase),
  ]);

  const fadeId = maps.transitionByName.get("fade") ?? null;
  const rows: any[] = [];

  for (const it of (storyboard ?? []) as any[]) {
    const action = visualTypeToAction(it.visual_type);
    const layoutName = ACTION_LAYOUT[action] ?? "full_screen";
    const start = Number(it.timeline_start) || 0;
    const end = Number(it.timeline_end) || start;
    rows.push({
      project_id: projectId,
      scene_id: it.scene_id ?? null,
      storyboard_item_id: it.id,
      action_type: action,
      start_time: start,
      end_time: end,
      duration: Math.max(0, end - start),
      layer: ACTION_LAYER[action] ?? 1,
      priority: 5,
      layout_id: maps.layoutByName.get(layoutName) ?? null,
      transition_in_id: fadeId,
      transition_out_id: fadeId,
      asset_query: it.asset_prompt ?? null,
      source: "backfill",
      parameters: { title: it.title, screen_layout: it.screen_layout },
    });
  }

  for (const it of (broll ?? []) as any[]) {
    const start = Number(it.recommended_start) || 0;
    const end = Number(it.recommended_end) || start + 3;
    rows.push({
      project_id: projectId,
      scene_id: it.scene_id ?? null,
      storyboard_item_id: null,
      action_type: "show_broll",
      start_time: start,
      end_time: end,
      duration: Math.max(0, end - start),
      layer: 1,
      priority: 4,
      layout_id: maps.layoutByName.get("full_screen") ?? null,
      transition_in_id: fadeId,
      transition_out_id: fadeId,
      asset_query: it.search_prompt || it.keyword || null,
      source: "backfill",
      parameters: { keyword: it.keyword, placement_reason: it.placement_reason },
    });
  }

  for (const it of (infographics ?? []) as any[]) {
    const start = Number(it.timeline_start) || 0;
    const end = Number(it.timeline_end) || start + 5;
    rows.push({
      project_id: projectId,
      scene_id: it.scene_id ?? null,
      storyboard_item_id: null,
      action_type: "show_infographic",
      start_time: start,
      end_time: end,
      duration: Math.max(0, end - start),
      layer: 2,
      priority: 6,
      layout_id: maps.layoutByName.get("full_screen") ?? null,
      transition_in_id: fadeId,
      transition_out_id: fadeId,
      asset_query: it.asset_prompt ?? null,
      source: "backfill",
      parameters: { title: it.title, bullets: it.bullets ?? [] },
    });
  }

  rows.sort((a, b) => a.start_time - b.start_time);

  await supabase.from("edit_actions").delete().eq("project_id", projectId).eq("source", "backfill");
  if (rows.length > 0) await supabase.from("edit_actions").insert(rows);
  return { count: rows.length };
}

export async function ensureEditActionsForProject(supabase: SupabaseLike, projectId: string) {
  const { count } = await supabase
    .from("edit_actions")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  if ((count ?? 0) > 0) return { count: count ?? 0, backfilled: false };
  const res = await backfillEditActionsForProject(supabase, projectId);
  return { count: res.count, backfilled: true };
}