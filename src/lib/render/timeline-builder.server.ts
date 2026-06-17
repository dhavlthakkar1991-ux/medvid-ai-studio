// Server-only: build the canonical render_manifest from scenes + storyboard_items + broll_items.
// Render Manifest V2: each row also carries asset_id and transition so the future
// FFmpeg renderer can consume render_manifest as its sole input contract.

type SupabaseLike = any;

export async function buildRenderManifestForProject(
  supabase: SupabaseLike,
  projectId: string,
) {
  const [{ data: scenes }, { data: storyboard }, { data: broll }, { data: instructions }] = await Promise.all([
    supabase.from("scenes").select("*").eq("project_id", projectId).order("scene_number", { ascending: true }),
    supabase.from("storyboard_items").select("*").eq("project_id", projectId).order("item_index", { ascending: true }),
    supabase.from("broll_items").select("*").eq("project_id", projectId).order("item_index", { ascending: true }),
    supabase.from("timeline_instructions").select("*").eq("project_id", projectId).order("render_order", { ascending: true }),
  ]);

  type Entry = {
    scene_id: string | null;
    storyboard_item_id: string | null;
    asset_id: string | null;
    transition: string;
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

  // Prefer timeline_instructions (deterministic compiler output) when present.
  if (Array.isArray(instructions) && instructions.length > 0) {
    const storyboardById = new Map<string, any>(((storyboard ?? []) as any[]).map((s) => [s.id, s]));
    for (const ins of instructions as any[]) {
      const sb = ins.storyboard_item_id ? storyboardById.get(ins.storyboard_item_id) : null;
      entries.push({
        scene_id: ins.scene_id ?? null,
        storyboard_item_id: ins.storyboard_item_id ?? null,
        asset_id: ins.asset_id ?? null,
        transition: ins.transition || "cut",
        timeline_start: Number(ins.timeline_start) || 0,
        timeline_end: Number(ins.timeline_end) || 0,
        asset_type: sb?.visual_type || (ins.layer === 1 ? "broll" : "storyboard"),
        asset_source: ins.asset_id ? "registry" : (ins.layer === 1 ? "stock" : "ai_generated"),
        asset_query: sb?.asset_prompt || "",
        asset_url: sb?.asset_url ?? null,
        caption_style: sb?.screen_layout || "Full",
        status: sb?.asset_status || "pending",
      });
    }
  } else {
    for (const it of (storyboard ?? []) as any[]) {
      entries.push({
        scene_id: it.scene_id ?? null,
        storyboard_item_id: it.id,
        asset_id: null,
        transition: "fade",
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
        asset_id: null,
        transition: "cut",
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