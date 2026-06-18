// Server-only: build a true multi-track timeline from editorial decisions,
// layout decisions, and approved assets. The timeline becomes the authoritative
// source for Render Manifest V5.

type SupabaseLike = any;

export const TRACK_KINDS = [
  "presenter_video",
  "broll",
  "clinical_images",
  "medical_diagrams",
  "infographics",
  "text_overlays",
  "captions",
  "cta",
] as const;
export type TrackKind = (typeof TRACK_KINDS)[number];

const TRACK_LABEL: Record<TrackKind, string> = {
  presenter_video: "Presenter Video",
  broll: "B-roll",
  clinical_images: "Clinical Images",
  medical_diagrams: "Medical Diagrams",
  infographics: "Infographics",
  text_overlays: "Text Overlays",
  captions: "Captions",
  cta: "CTA",
};

const TRACK_COLOR: Record<TrackKind, string> = {
  presenter_video: "#0ea5e9",
  broll: "#22c55e",
  clinical_images: "#f97316",
  medical_diagrams: "#ef4444",
  infographics: "#a855f7",
  text_overlays: "#eab308",
  captions: "#94a3b8",
  cta: "#ec4899",
};

const TRACK_INDEX: Record<TrackKind, number> = {
  presenter_video: 1,
  broll: 2,
  clinical_images: 3,
  medical_diagrams: 4,
  infographics: 5,
  text_overlays: 6,
  captions: 7,
  cta: 8,
};

/** Editorial action_type → timeline track kind. */
const ACTION_TO_TRACK: Record<string, TrackKind> = {
  show_broll: "broll",
  show_clinical_image: "clinical_images",
  show_medical_diagram: "medical_diagrams",
  show_infographic: "infographics",
  show_lower_third: "text_overlays",
  show_text_overlay: "text_overlays",
  show_callout: "text_overlays",
  kinetic_typography: "text_overlays",
  highlight_keyword: "text_overlays",
  show_statistic: "text_overlays",
  show_cta: "cta",
  show_thumbnail_frame: "cta",
  show_logo: "cta",
};

/** Ensure the 8 standard tracks exist for this project; return id-by-kind map. */
async function ensureTracks(supabase: SupabaseLike, projectId: string): Promise<Record<string, string>> {
  const { data: existing } = await supabase
    .from("timeline_tracks").select("id, kind").eq("project_id", projectId);
  const byKind = new Map<string, string>(((existing ?? []) as any[]).map((r) => [r.kind, r.id]));
  const toInsert: any[] = [];
  for (const kind of TRACK_KINDS) {
    if (!byKind.has(kind)) {
      toInsert.push({
        project_id: projectId,
        kind,
        name: TRACK_LABEL[kind],
        track_index: TRACK_INDEX[kind],
        color: TRACK_COLOR[kind],
      });
    }
  }
  if (toInsert.length > 0) {
    const { data: inserted } = await supabase
      .from("timeline_tracks").insert(toInsert).select("id, kind");
    for (const r of (inserted ?? []) as any[]) byKind.set(r.kind, r.id);
  }
  return Object.fromEntries(byKind);
}

export async function composeTimelineForProject(supabase: SupabaseLike, projectId: string) {
  const trackByKind = await ensureTracks(supabase, projectId);

  const [{ data: project }, { data: editActions }, { data: layouts }, { data: candidates }, { data: assets }] = await Promise.all([
    supabase.from("projects").select("duration_seconds").eq("id", projectId).maybeSingle(),
    supabase.from("edit_actions").select("*").eq("project_id", projectId).order("start_time", { ascending: true }),
    supabase.from("layout_decisions").select("*").eq("project_id", projectId),
    supabase.from("asset_candidates").select("id, edit_action_id, status, linked_asset_id").eq("project_id", projectId),
    supabase.from("assets").select("id, asset_type, status").eq("project_id", projectId).in("status", ["approved", "locked"]),
  ]);

  const layoutByAction = new Map<string, any>();
  for (const l of (layouts ?? []) as any[]) if (l.action_id) layoutByAction.set(l.action_id, l);
  const assetById = new Map<string, any>(((assets ?? []) as any[]).map((a) => [a.id, a]));
  const approvedAssetByAction = new Map<string, string>();
  for (const c of (candidates ?? []) as any[]) {
    if (!c.edit_action_id || !c.linked_asset_id) continue;
    if (c.status !== "approved" && c.status !== "locked" && c.status !== "replaced") continue;
    if (assetById.has(c.linked_asset_id)) approvedAssetByAction.set(c.edit_action_id, c.linked_asset_id);
  }

  const duration = Number(project?.duration_seconds) || 0;

  const items: any[] = [];

  // 1) Presenter video as a single full-duration clip on track 1.
  if (duration > 0) {
    items.push({
      project_id: projectId,
      track_id: trackByKind.presenter_video,
      asset_id: null,
      edit_action_id: null,
      scene_id: null,
      asset_type: "presenter_video",
      title: "Presenter (talking head)",
      start_time: 0,
      end_time: duration,
      duration,
      layout: "full_screen",
      z_index: 0,
      transition_in: "cut",
      transition_out: "cut",
      source_task: "video",
      status: "approved",
      metadata: {},
    });
  }

  // 2) One item per editorial action on the appropriate track.
  for (const ea of (editActions ?? []) as any[]) {
    const action = String(ea.action_type ?? "");
    const kind = ACTION_TO_TRACK[action];
    if (!kind) continue;
    const trackId = trackByKind[kind];
    if (!trackId) continue;
    const start = Number(ea.start_time) || 0;
    const end = Number(ea.end_time) || 0;
    if (end <= start) continue;
    const ld = layoutByAction.get(ea.id);
    const approvedAssetId = approvedAssetByAction.get(ea.id) ?? null;
    items.push({
      project_id: projectId,
      track_id: trackId,
      asset_id: approvedAssetId,
      edit_action_id: ea.id,
      scene_id: ea.scene_id ?? null,
      asset_type: action,
      title: ea.asset_query ? String(ea.asset_query).slice(0, 80) : action,
      start_time: start,
      end_time: end,
      duration: end - start,
      layout: ld?.layout_name ?? ea.layout ?? null,
      z_index: typeof ea.layer === "number" ? ea.layer : TRACK_INDEX[kind],
      transition_in: ea.transition_in ?? "cut",
      transition_out: ea.transition_out ?? "cut",
      source_task: "editorial_decisions",
      status: approvedAssetId
        ? "approved"
        : (kind === "text_overlays" || kind === "cta" || kind === "captions" ? "pending" : "missing_asset"),
      metadata: { reason: ea.reason ?? null, priority: ea.priority ?? null },
    });
  }

  // Wipe and re-insert atomically.
  await supabase.from("timeline_items").delete().eq("project_id", projectId);
  if (items.length > 0) await supabase.from("timeline_items").insert(items);

  return { trackCount: TRACK_KINDS.length, itemCount: items.length };
}

export type TimelineIssue = {
  level: "error" | "warning";
  code: string;
  message: string;
  item_id?: string;
  track_kind?: string;
};

export async function validateTimelineForProject(supabase: SupabaseLike, projectId: string) {
  const [{ data: tracks }, { data: items }, { data: project }] = await Promise.all([
    supabase.from("timeline_tracks").select("*").eq("project_id", projectId),
    supabase.from("timeline_items").select("*").eq("project_id", projectId).order("start_time", { ascending: true }),
    supabase.from("projects").select("duration_seconds").eq("id", projectId).maybeSingle(),
  ]);
  const duration = Number(project?.duration_seconds) || 0;
  const trackById = new Map<string, any>(((tracks ?? []) as any[]).map((t) => [t.id, t]));
  const issues: TimelineIssue[] = [];

  const byTrack: Record<string, any[]> = {};
  for (const it of (items ?? []) as any[]) {
    (byTrack[it.track_id] ??= []).push(it);
    if (Number(it.end_time) <= Number(it.start_time)) {
      issues.push({
        level: "error", code: "negative_or_zero_duration",
        message: `${it.asset_type} item has duration ≤ 0 (${it.start_time}s → ${it.end_time}s)`,
        item_id: it.id, track_kind: trackById.get(it.track_id)?.kind,
      });
    }
    if (it.status === "missing_asset") {
      issues.push({
        level: "warning", code: "missing_asset",
        message: `${it.asset_type} at ${Number(it.start_time).toFixed(1)}s has no approved asset`,
        item_id: it.id, track_kind: trackById.get(it.track_id)?.kind,
      });
    }
    if (duration > 0 && Number(it.end_time) > duration + 0.5) {
      issues.push({
        level: "warning", code: "exceeds_duration",
        message: `Item ends at ${Number(it.end_time).toFixed(1)}s past video duration ${duration.toFixed(1)}s`,
        item_id: it.id, track_kind: trackById.get(it.track_id)?.kind,
      });
    }
    if (!it.edit_action_id && it.source_task === "editorial_decisions") {
      issues.push({
        level: "warning", code: "orphaned_action",
        message: `Item has no linked editorial action`, item_id: it.id,
      });
    }
  }
  // Per-track overlap detection (overlaps within a track are usually errors;
  // presenter video is exempt because it sits underneath everything else).
  for (const [trackId, list] of Object.entries(byTrack)) {
    const kind = trackById.get(trackId)?.kind;
    if (kind === "presenter_video") continue;
    const sorted = [...list].sort((a, b) => Number(a.start_time) - Number(b.start_time));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1], cur = sorted[i];
      if (Number(cur.start_time) < Number(prev.end_time) - 0.01) {
        issues.push({
          level: "error", code: "track_overlap",
          message: `${kind} overlap: ${Number(prev.start_time).toFixed(1)}-${Number(prev.end_time).toFixed(1)}s vs ${Number(cur.start_time).toFixed(1)}-${Number(cur.end_time).toFixed(1)}s`,
          item_id: cur.id, track_kind: kind,
        });
      }
    }
  }
  // Empty tracks (warning only)
  for (const t of (tracks ?? []) as any[]) {
    if (t.kind === "presenter_video" || t.kind === "captions") continue;
    if (!byTrack[t.id] || byTrack[t.id].length === 0) {
      issues.push({
        level: "warning", code: "empty_track",
        message: `${t.name} track has no items`, track_kind: t.kind,
      });
    }
  }
  const errors = issues.filter((i) => i.level === "error");
  return { valid: errors.length === 0, issues, errorCount: errors.length, warningCount: issues.length - errors.length };
}