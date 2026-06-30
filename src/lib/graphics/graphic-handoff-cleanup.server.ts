// Server-only: graphic action handoff guard.
//
// The primary creative workflow no longer turns Studio graphic actions into
// SVG/data-url substitutes. Graphic actions remain editorial intent until a
// Codex ImageGen/HyperFrames asset pack result, manual upload, manual URL, or
// curated library asset is approved and mapped to the timeline.

type Sb = any;

export const GRAPHIC_ACTION_TYPES = [
  "show_lower_third",
  "show_callout",
  "kinetic_typography",
  "highlight_keyword",
  "show_text_overlay",
  "show_cta",
] as const;
export type GraphicActionType = (typeof GRAPHIC_ACTION_TYPES)[number];

export function isGraphicAction(t: string | null | undefined): t is GraphicActionType {
  return !!t && (GRAPHIC_ACTION_TYPES as readonly string[]).includes(t);
}

const CODEX_GRAPHIC_MESSAGE =
  "SVG graphic generation is disabled in the primary workflow. Generate a Codex asset-pack raster/video result and approve it before render.";

export async function clearLegacyCompiledGraphicsForProject(supabase: Sb, projectId: string) {
  const { data: editActions } = await supabase
    .from("edit_actions")
    .select("id, action_type")
    .eq("project_id", projectId);

  const graphicEAs = ((editActions ?? []) as any[]).filter((ea) => isGraphicAction(ea.action_type));
  const graphicActionIds = graphicEAs.map((ea) => ea.id).filter(Boolean);

  // Remove previously generated internal SVG rows so stale compiled graphics
  // cannot make a project look render-ready.
  const { error: deleteError } = await supabase
    .from("compiled_graphics")
    .delete()
    .eq("project_id", projectId);
  if (deleteError) console.warn("clear compiled graphics failed", projectId, deleteError.message);

  await supabase
    .from("timeline_items")
    .update({ compiled_graphic_id: null })
    .eq("project_id", projectId);

  if (graphicActionIds.length > 0) {
    await supabase
      .from("render_manifest")
      .update({ compiled_graphic_id: null, asset_source: "codex_asset_pack", status: "pending", manifest_version: 6 })
      .eq("project_id", projectId)
      .in("edit_action_id", graphicActionIds)
      .is("asset_id", null);

    await supabase
      .from("render_manifest")
      .update({ compiled_graphic_id: null, manifest_version: 6 })
      .eq("project_id", projectId)
      .in("edit_action_id", graphicActionIds)
      .not("asset_id", "is", null);
  }

  // Any manifest row that already has a real asset_id is still V6-renderable.
  await supabase
    .from("render_manifest")
    .update({ manifest_version: 6 })
    .eq("project_id", projectId)
    .not("asset_id", "is", null);

  const { count: virtualCount } = await supabase
    .from("render_manifest")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .is("asset_id", null)
    .is("compiled_graphic_id", null);

  return {
    clearedLegacyGraphics: true,
    graphicActions: graphicEAs.length,
    virtualItemsRemaining: virtualCount ?? 0,
    manifestVersion: 6,
    workflowMode: "codex_asset_pack",
    codexBriefsRequired: virtualCount ?? 0,
    disabledReason: CODEX_GRAPHIC_MESSAGE,
  };
}
