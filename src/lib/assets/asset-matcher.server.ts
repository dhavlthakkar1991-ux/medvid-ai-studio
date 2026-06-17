// Server-only: convert normalized storyboard_items into asset_candidates.
// Provider-independent: every candidate row carries `search_query` + `asset_type`
// that any AssetProvider implementation can consume.

type SupabaseLike = any;

const VISUAL_TYPE_TO_ASSET: Record<string, string> = {
  "B-Roll": "broll",
  "Medical Infographic": "infographic",
  "Diagram": "image",
  "Chapter Card": "overlay",
  "Callout": "overlay",
  "Split Screen": "image",
};

function mapAssetType(visualType: string): string {
  return VISUAL_TYPE_TO_ASSET[visualType] ?? "image";
}

/** Heuristic query variants for a single storyboard prompt. */
function buildQueryVariants(prompt: string, title: string, asset_type: string): string[] {
  const base = (prompt || title || "").replace(/\s+/g, " ").trim();
  if (!base) return [];
  const head = base.split(/[.,;]/)[0].slice(0, 120);
  const variants = new Set<string>();
  variants.add(head);
  if (asset_type === "broll") {
    variants.add(`${head} cinematic medical b-roll`);
    variants.add(`${head} hospital clinical footage`);
  } else if (asset_type === "infographic") {
    variants.add(`${head} medical infographic`);
    variants.add(`${head} clinical diagram illustration`);
  } else {
    variants.add(`${head} clinical illustration`);
    variants.add(`${head} medical photo`);
  }
  return Array.from(variants).slice(0, 3);
}

/** Regenerate asset_candidates for every storyboard item + broll item of a project. */
export async function generateAssetCandidatesForProject(
  supabase: SupabaseLike,
  projectId: string,
) {
  const [{ data: storyboard }, { data: broll }] = await Promise.all([
    supabase
      .from("storyboard_items")
      .select("id, project_id, scene_id, visual_type, asset_prompt")
      .eq("project_id", projectId),
    supabase
      .from("broll_items")
      .select("id, project_id, scene_id, keyword, search_prompt")
      .eq("project_id", projectId),
  ]);

  const rows: any[] = [];

  for (const it of (storyboard ?? []) as any[]) {
    const asset_type = mapAssetType(String(it.visual_type ?? ""));
    const variants = buildQueryVariants(String(it.asset_prompt ?? ""), String(it.visual_type ?? ""), asset_type);
    variants.forEach((q, i) => {
      rows.push({
        project_id: projectId,
        scene_id: it.scene_id ?? null,
        storyboard_item_id: it.id,
        asset_type,
        search_query: q,
        priority: i + 1,
        provider: "any",
        status: "pending",
        candidate_data: { source: "storyboard", visual_type: it.visual_type },
      });
    });
  }

  for (const it of (broll ?? []) as any[]) {
    const variants = buildQueryVariants(String(it.search_prompt ?? it.keyword ?? ""), String(it.keyword ?? ""), "broll");
    variants.forEach((q, i) => {
      rows.push({
        project_id: projectId,
        scene_id: it.scene_id ?? null,
        storyboard_item_id: null,
        asset_type: "broll",
        search_query: q,
        priority: i + 1,
        provider: "any",
        status: "pending",
        candidate_data: { source: "broll", broll_item_id: it.id },
      });
    });
  }

  await supabase.from("asset_candidates").delete().eq("project_id", projectId);
  if (rows.length > 0) await supabase.from("asset_candidates").insert(rows);
  return { count: rows.length };
}