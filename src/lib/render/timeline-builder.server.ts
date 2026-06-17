// Server-only: build the canonical render_manifest from scenes + storyboard_items + broll_items.

type SupabaseLike = any;

export async function buildRenderManifestForProject(
  supabase: SupabaseLike,
  projectId: string,
) {
  const [{ data: scenes }, { data: storyboard }, { data: broll }] = await Promise.all([
    supabase.from("scenes").select("*").eq("project_id", projectId).order("scene_number", { ascending: true }),
    supabase.from("storyboard_items").select("*").eq("project_id", projectId).order("item_index", { ascending: true }),
    supabase.from("broll_items").select("*").eq("project_id", projectId).order("item_index", { ascending: true }),
  ]);

  type Entry = {
    scene_id: string | null;
    storyboard_item_id: string | null;
    timeline_start: number;
    timeline_end: number;
    asset_type: string;
    asset_source: string;
    asset_query: string;
    asset_url: string | null;
    caption_style: string;
    status: string;
  };

  const entries: Entry[] = [];

  for (const it of (storyboard ?? []) as any[]) {
    entries.push({
      scene_id: it.scene_id ?? null,
      storyboard_item_id: it.id,
      timeline_start: Number(it.timeline_start) || 0,
      timeline_end: Number(it.timeline_end) || 0,
      asset_type: it.visual_type || "storyboard",
      asset_source: "ai_generated",
      asset_query: it.asset_prompt || "",
      asset_url: it.asset_url ?? null,
      caption_style: it.screen_layout || "Full",
      status: it.asset_status || "pending",
    });
  }

  for (const it of (broll ?? []) as any[]) {
    entries.push({
      scene_id: it.scene_id ?? null,
      storyboard_item_id: null,
      timeline_start: Number(it.recommended_start) || 0,
      timeline_end: Number(it.recommended_end) || 0,
      asset_type: "broll",
      asset_source: "stock",
      asset_query: it.search_prompt || it.keyword || "",
      asset_url: it.asset_url ?? null,
      caption_style: "",
      status: it.asset_status || "pending",
    });
  }

  entries.sort((a, b) => a.timeline_start - b.timeline_start);

  const rows = entries.map((e, i) => ({
    project_id: projectId,
    render_order: i,
    ...e,
  }));

  await supabase.from("render_manifest").delete().eq("project_id", projectId);
  if (rows.length > 0) await supabase.from("render_manifest").insert(rows);
  return { count: rows.length };
}