type SupabaseLike = any;

export const ACTION_TO_ASSET_TYPE: Record<string, string> = {
  show_clinical_image: "clinical_image",
  show_medical_diagram: "medical_diagram",
  show_broll: "broll_video",
  show_infographic: "infographic",
  show_thumbnail_frame: "icon",
  show_logo: "icon",
  show_cta: "icon",
};

const COMPATIBLE_ASSET_TYPES: Record<string, string[]> = {
  clinical_image: ["clinical_image", "image"],
  medical_diagram: ["medical_diagram", "diagram", "infographic", "image"],
  broll_video: ["broll_video", "broll", "video"],
  infographic: ["infographic", "medical_diagram", "diagram", "image"],
  icon: ["icon", "thumbnail", "overlay", "image"],
};

const ROLE_FOR_TYPE: Record<string, string> = {
  clinical_image: "Clinical Images",
  medical_diagram: "Medical Diagrams",
  diagram: "Medical Diagrams",
  broll_video: "B-roll",
  broll: "B-roll",
  infographic: "Infographics",
  icon: "Icons",
  thumbnail: "Icons",
  image: "Clinical Images",
  overlay: "Icons",
};

export function compatibleAssetTypesForAction(actionType: string): string[] {
  const target = ACTION_TO_ASSET_TYPE[actionType] ?? actionType;
  return COMPATIBLE_ASSET_TYPES[target] ?? [target];
}

export function roleForAssetType(assetType: string): string {
  return ROLE_FOR_TYPE[assetType] ?? "Other";
}

export async function ensureApprovedAssetsForEditActions(
  supabase: SupabaseLike,
  projectId: string,
  userId: string,
  options: { createMissing?: boolean; onlyMissing?: boolean } = {},
) {
  const createMissing = options.createMissing ?? false;
  const [{ data: editActions, error: eaErr }, { data: candidates, error: cErr }, { data: assets, error: aErr }] = await Promise.all([
    supabase
      .from("edit_actions")
      .select("id, project_id, scene_id, action_type, asset_query, reason, start_time, end_time")
      .eq("project_id", projectId)
      .order("start_time", { ascending: true }),
    supabase
      .from("asset_candidates")
      .select("*")
      .eq("project_id", projectId),
    supabase
      .from("assets")
      .select("*")
      .eq("project_id", projectId)
      .in("status", ["approved", "locked"]),
  ]);
  if (eaErr) throw new Error(eaErr.message);
  if (cErr) throw new Error(cErr.message);
  if (aErr) throw new Error(aErr.message);

  const candidateRows = ((candidates ?? []) as any[]).map((c) => ({ ...c }));
  const assetRows = ((assets ?? []) as any[]).map((a) => ({ ...a }));
  const approvedAssetIds = new Set(assetRows.map((a) => a.id));
  const candidatesByAction = new Map<string, any[]>();
  for (const c of candidateRows) {
    if (!c.edit_action_id) continue;
    const key = String(c.edit_action_id);
    const list = candidatesByAction.get(key) ?? [];
    list.push(c);
    candidatesByAction.set(key, list);
  }

  let linked = 0;
  let createdAssets = 0;
  let createdCandidates = 0;
  let updatedCandidates = 0;

  for (const ea of (editActions ?? []) as any[]) {
    const actionType = String(ea.action_type ?? "");
    const targetType = ACTION_TO_ASSET_TYPE[actionType];
    if (!targetType) continue;
    if (Number(ea.end_time) <= Number(ea.start_time)) continue;

    const existingLinked = (candidatesByAction.get(ea.id) ?? []).find(
      (c) => c.linked_asset_id && approvedAssetIds.has(c.linked_asset_id) && ["approved", "locked", "replaced"].includes(String(c.status)),
    );
    if (existingLinked) continue;

    const compatible = compatibleAssetTypesForAction(actionType);
    let asset = assetRows
      .filter((a) => compatible.includes(String(a.asset_type)))
      .filter((a) => !ea.scene_id || !a.scene_id || a.scene_id === ea.scene_id)
      .sort((a, b) => {
        const aExact = a.asset_type === targetType ? 1 : 0;
        const bExact = b.asset_type === targetType ? 1 : 0;
        const aScene = a.scene_id === ea.scene_id ? 1 : 0;
        const bScene = b.scene_id === ea.scene_id ? 1 : 0;
        return (bScene - aScene) || (bExact - aExact) || String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
      })[0];

    if (!asset && createMissing) {
      const now = new Date().toISOString();
      const { data: inserted, error } = await supabase
        .from("assets")
        .insert({
          project_id: projectId,
          scene_id: ea.scene_id ?? null,
          asset_type: targetType,
          source_type: "manual",
          source: "timeline-ai-fix",
          status: "approved",
          title: actionType,
          description: ea.reason ?? null,
          search_query: ea.asset_query ?? actionType,
          metadata: { from_edit_action: ea.id, repair: "missing_timeline_asset" },
          reviewed_by: userId,
          reviewed_at: now,
        })
        .select("*")
        .single();
      if (error || !inserted) throw new Error(error?.message ?? "Failed to create repair asset");
      asset = inserted;
      assetRows.push(asset);
      approvedAssetIds.add(asset.id);
      createdAssets += 1;
    }
    if (!asset) continue;

    const now = new Date().toISOString();
    const candidate = (candidatesByAction.get(ea.id) ?? [])[0];
    if (candidate) {
      const { error } = await supabase
        .from("asset_candidates")
        .update({
          status: "approved",
          linked_asset_id: asset.id,
          reviewed_by: userId,
          reviewed_at: now,
          review_note: "Linked by timeline repair",
        })
        .eq("id", candidate.id);
      if (error) throw new Error(error.message);
      updatedCandidates += 1;
    } else {
      const { data: insertedCandidate, error } = await supabase
        .from("asset_candidates")
        .insert({
          project_id: projectId,
          scene_id: ea.scene_id ?? null,
          storyboard_item_id: null,
          asset_type: targetType,
          search_query: String(ea.asset_query ?? actionType).slice(0, 160),
          priority: 1,
          provider: "any",
          status: "approved",
          edit_action_id: ea.id,
          title: actionType,
          description: String(ea.reason ?? "").slice(0, 240),
          candidate_data: { source: "edit_action", action_type: actionType, repair: true },
          reviewed_by: userId,
          reviewed_at: now,
          review_note: "Created by timeline repair",
          linked_asset_id: asset.id,
        })
        .select("*")
        .single();
      if (error || !insertedCandidate) throw new Error(error?.message ?? "Failed to create repair candidate");
      const list = candidatesByAction.get(ea.id) ?? [];
      list.push(insertedCandidate);
      candidatesByAction.set(ea.id, list);
      createdCandidates += 1;
    }

    const { error: paErr } = await supabase.from("project_assets").upsert({
      project_id: projectId,
      asset_id: asset.id,
      role: roleForAssetType(String(asset.asset_type ?? targetType)),
      status: "approved",
      notes: "Linked by timeline repair",
    }, { onConflict: "project_id,asset_id,role" });
    if (paErr) throw new Error(paErr.message);
    linked += 1;
  }

  return { linked, createdAssets, createdCandidates, updatedCandidates };
}