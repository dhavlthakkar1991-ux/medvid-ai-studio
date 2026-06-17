// Server-only: project AI JSON outputs into the canonical relational tables.
// Imported only from server runtime (job-runner.server.ts, analysis-runner.server.ts).

type SupabaseLike = any;

function mmssToSeconds(s: unknown): number {
  if (typeof s === "number" && Number.isFinite(s)) return s;
  if (typeof s !== "string") return 0;
  const trimmed = s.trim();
  if (!trimmed) return 0;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const parts = trimmed.split(":").map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

async function loadScenes(supabase: SupabaseLike, projectId: string) {
  const { data } = await supabase
    .from("scenes")
    .select("id, scene_number, start_time, end_time, duration, title")
    .eq("project_id", projectId)
    .order("scene_number", { ascending: true });
  return (data ?? []) as Array<{ id: string; scene_number: number; start_time: number; end_time: number; duration: number; title: string }>;
}

function resolveSceneByNumberOrTime(
  scenes: Awaited<ReturnType<typeof loadScenes>>,
  sceneNumber: number | undefined,
  tSeconds: number,
) {
  if (sceneNumber) {
    const match = scenes.find((s) => s.scene_number === sceneNumber);
    if (match) return match;
  }
  // Otherwise pick scene whose time window contains tSeconds
  const inside = scenes.find((s) => tSeconds >= s.start_time && tSeconds <= s.end_time);
  if (inside) return inside;
  // Fallback: closest scene
  let best = scenes[0];
  let bestDist = best ? Math.abs(tSeconds - best.start_time) : Infinity;
  for (const s of scenes) {
    const d = Math.abs(tSeconds - s.start_time);
    if (d < bestDist) { best = s; bestDist = d; }
  }
  return best;
}

export async function normalizeScenePlan(
  supabase: SupabaseLike,
  projectId: string,
  data: any,
  projectDuration: number,
) {
  const items: any[] = Array.isArray(data?.scene_plan) ? data.scene_plan : [];
  if (items.length === 0) return;

  // Order scenes by AI-supplied scene_number (or t as a tiebreaker). Timestamps
  // from the AI are advisory — final timing is derived from transcript segments.
  const enriched = items.map((it, i) => {
    const t = mmssToSeconds(it.t);
    return {
      idx: i,
      scene_number: Number(it.scene_number ?? i + 1),
      title: String(it.title ?? it.kind ?? `Scene ${i + 1}`),
      narration_text: String(it.narration_text ?? ""),
      objective: String(it.objective ?? it.prompt ?? ""),
      t,
    };
  }).sort((a, b) => (a.scene_number - b.scene_number) || (a.t - b.t));

  // Derive scene timing from transcript segments — no AI-estimated timestamps.
  const { data: segs } = await supabase
    .from("transcript_segments")
    .select("id, start_time, end_time, segment_index")
    .eq("project_id", projectId)
    .order("segment_index", { ascending: true });
  const segments: Array<{ start_time: number; end_time: number }> = Array.isArray(segs) ? segs : [];

  const N = enriched.length;
  const total =
    projectDuration > 0
      ? projectDuration
      : segments.length > 0
      ? segments[segments.length - 1].end_time
      : enriched[enriched.length - 1]?.t ?? N * 30;

  const rows = enriched.map((s, i) => {
    let start: number;
    let end: number;
    if (segments.length > 0) {
      // Distribute transcript segments evenly across the scenes.
      const startIdx = Math.floor((i * segments.length) / N);
      const endIdxExclusive = Math.max(startIdx + 1, Math.floor(((i + 1) * segments.length) / N));
      const slice = segments.slice(startIdx, endIdxExclusive);
      start = slice[0]?.start_time ?? 0;
      end = slice[slice.length - 1]?.end_time ?? start;
    } else {
      // No transcript segmentation available — split the duration evenly.
      start = (i / N) * total;
      end = ((i + 1) / N) * total;
    }
    if (end <= start) end = start + Math.max(1, total / Math.max(1, N));
    const duration = Math.max(0, end - start);
    return {
      project_id: projectId,
      scene_number: s.scene_number,
      title: s.title,
      start_time: start,
      end_time: end,
      duration,
      narration_text: s.narration_text,
      objective: s.objective,
    };
  });

  // Replace all scenes for this project (deterministic regeneration).
  await supabase.from("scenes").delete().eq("project_id", projectId);
  if (rows.length === 0) return;
  const { data: inserted } = await supabase.from("scenes").insert(rows).select("id, start_time, end_time");

  // Build scene_transcript_map by overlapping times
  if (Array.isArray(inserted) && inserted.length > 0) {
    const { data: segs } = await supabase
      .from("transcript_segments")
      .select("id, start_time, end_time")
      .eq("project_id", projectId);
    if (Array.isArray(segs) && segs.length > 0) {
      const links: Array<{ scene_id: string; transcript_segment_id: string }> = [];
      for (const scene of inserted as any[]) {
        for (const seg of segs as any[]) {
          const overlap = seg.start_time < scene.end_time && seg.end_time > scene.start_time;
          if (overlap) links.push({ scene_id: scene.id, transcript_segment_id: seg.id });
        }
      }
      if (links.length > 0) {
        await supabase.from("scene_transcript_map").upsert(links, { onConflict: "scene_id,transcript_segment_id" });
      }
    }
  }
}

export async function normalizeStoryboard(
  supabase: SupabaseLike,
  projectId: string,
  data: any,
) {
  const items: any[] = Array.isArray(data?.visual_storyboard) ? data.visual_storyboard : [];
  if (items.length === 0) return;
  const scenes = await loadScenes(supabase, projectId);

  // Group by resolved scene_id
  const groups = new Map<string | null, Array<{ raw: any; t: number }>>();
  for (const raw of items) {
    const t = mmssToSeconds(raw.time);
    const scene = scenes.length > 0 ? resolveSceneByNumberOrTime(scenes, raw.scene_number, t) : undefined;
    const key = scene?.id ?? null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ raw, t });
  }

  const rows: any[] = [];
  let globalIdx = 0;
  for (const [sceneId, list] of groups) {
    const scene = scenes.find((s) => s.id === sceneId);
    list.sort((a, b) => a.t - b.t);

    // Transcript-derived durations: distribute scene window across items
    // proportional to LLM duration hints (clamped to scene window).
    const llmHints = list.map(({ raw }) => Math.max(1, Number(raw.duration_seconds) || 1));
    const llmTotal = llmHints.reduce((a, b) => a + b, 0);
    const windowStart = scene?.start_time ?? list[0]?.t ?? 0;
    const windowEnd = scene?.end_time ?? (windowStart + llmTotal);
    const windowDur = Math.max(1, windowEnd - windowStart);

    let cursor = windowStart;
    list.forEach(({ raw }, i) => {
      const share = scene ? (llmHints[i] / llmTotal) * windowDur : llmHints[i];
      const start = cursor;
      const end = i === list.length - 1 && scene ? windowEnd : cursor + share;
      cursor = end;
      rows.push({
        project_id: projectId,
        scene_id: sceneId,
        item_index: globalIdx++,
        visual_type: String(raw.visual_type ?? ""),
        asset_prompt: String(raw.asset_prompt ?? ""),
        animation: String(raw.animation ?? ""),
        priority: String(raw.priority ?? "medium"),
        screen_layout: String(raw.screen_layout ?? "Full"),
        duration_seconds: Math.max(0, end - start),
        timeline_start: start,
        timeline_end: end,
        asset_status: "pending",
      });
    });
  }

  await supabase.from("storyboard_items").delete().eq("project_id", projectId);
  if (rows.length > 0) await supabase.from("storyboard_items").insert(rows);
}

export async function normalizeBroll(supabase: SupabaseLike, projectId: string, data: any) {
  const items: any[] = Array.isArray(data?.broll) ? data.broll : [];
  if (items.length === 0) return;
  const scenes = await loadScenes(supabase, projectId);
  const rows = items.map((raw, i) => {
    const t = mmssToSeconds(raw.recommended_start || raw.t);
    const scene = scenes.length > 0 ? resolveSceneByNumberOrTime(scenes, raw.scene_number, t) : undefined;
    const recStart = mmssToSeconds(raw.recommended_start || raw.t);
    const recEnd =
      mmssToSeconds(raw.recommended_end) || (scene ? Math.min(scene.end_time, recStart + 5) : recStart + 5);
    return {
      project_id: projectId,
      scene_id: scene?.id ?? null,
      item_index: i,
      keyword:
        String(raw.keyword || (Array.isArray(raw.keywords) ? raw.keywords[0] : "") || "").slice(0, 200),
      search_prompt: String(raw.search_prompt || raw.asset_prompt || raw.prompt || ""),
      placement_reason: String(raw.placement_reason || raw.prompt || ""),
      recommended_start: recStart,
      recommended_end: recEnd,
      asset_status: "pending",
    };
  });
  await supabase.from("broll_items").delete().eq("project_id", projectId);
  if (rows.length > 0) await supabase.from("broll_items").insert(rows);
}

export async function normalizeInfographics(supabase: SupabaseLike, projectId: string, data: any) {
  const items: any[] = Array.isArray(data?.infographics) ? data.infographics : [];
  if (items.length === 0) return;
  const scenes = await loadScenes(supabase, projectId);
  const rows = items.map((raw, i) => {
    const t = mmssToSeconds(raw.t);
    const scene = scenes.length > 0 ? resolveSceneByNumberOrTime(scenes, undefined, t) : undefined;
    return {
      project_id: projectId,
      scene_id: scene?.id ?? null,
      item_index: i,
      t: String(raw.t ?? ""),
      type: String(raw.type ?? ""),
      title: String(raw.title ?? ""),
      bullets: Array.isArray(raw.bullets) ? raw.bullets : [],
      asset_prompt: String(raw.asset_prompt ?? ""),
      asset_status: "pending",
    };
  });
  await supabase.from("infographic_items").delete().eq("project_id", projectId);
  if (rows.length > 0) await supabase.from("infographic_items").insert(rows);
}

export async function normalizeThumbnails(supabase: SupabaseLike, projectId: string, data: any) {
  const items: any[] = Array.isArray(data?.thumbnails) ? data.thumbnails : [];
  if (items.length === 0) return;
  const rows = items.map((raw, i) => ({
    project_id: projectId,
    item_index: i,
    concept: String(raw.concept ?? ""),
    layout: String(raw.layout ?? ""),
    text: String(raw.text ?? ""),
    palette: Array.isArray(raw.palette) ? raw.palette : [],
    asset_prompt: String(raw.asset_prompt ?? ""),
    asset_status: "pending",
  }));
  await supabase.from("thumbnail_items").delete().eq("project_id", projectId);
  if (rows.length > 0) await supabase.from("thumbnail_items").insert(rows);
}

export async function normalizeTaskOutput(
  supabase: SupabaseLike,
  projectId: string,
  task: string,
  data: any,
  projectDuration: number,
) {
  if (task === "scene_plan") return normalizeScenePlan(supabase, projectId, data, projectDuration);
  if (task === "visual_storyboard") return normalizeStoryboard(supabase, projectId, data);
  if (task === "broll") return normalizeBroll(supabase, projectId, data);
  if (task === "infographics") return normalizeInfographics(supabase, projectId, data);
  if (task === "thumbnails") return normalizeThumbnails(supabase, projectId, data);
  if (task === "editorial_decisions") return normalizeEditorialDecisions(supabase, projectId, data);
}

/* ============= Editorial decisions → edit_actions ============= */
export async function normalizeEditorialDecisions(
  supabase: SupabaseLike,
  projectId: string,
  data: any,
) {
  const items = Array.isArray(data?.edit_actions) ? data.edit_actions : [];
  if (items.length === 0) return;

  const [scenes, layouts, transitions] = await Promise.all([
    loadScenes(supabase, projectId),
    supabase.from("layout_templates").select("id, name"),
    supabase.from("transition_templates").select("id, name"),
  ]);
  const layoutByName = new Map<string, string>(((layouts.data ?? []) as any[]).map((r) => [r.name, r.id]));
  const transitionByName = new Map<string, string>(((transitions.data ?? []) as any[]).map((r) => [r.name, r.id]));

  const rows = items.map((raw: any) => {
    const start = Number(raw.start_time) || 0;
    const end = Number(raw.end_time) || start;
    const scene = resolveSceneByNumberOrTime(scenes, Number(raw.scene_number) || undefined, start);
    return {
      project_id: projectId,
      scene_id: scene?.id ?? null,
      storyboard_item_id: null,
      action_type: String(raw.action_type || "show_callout"),
      start_time: start,
      end_time: end,
      duration: Math.max(0, end - start),
      layer: Number.isFinite(Number(raw.layer)) ? Number(raw.layer) : 1,
      priority: Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : 5,
      layout_id: layoutByName.get(String(raw.layout || "full_screen")) ?? layoutByName.get("full_screen") ?? null,
      transition_in_id: transitionByName.get(String(raw.transition_in || "fade")) ?? transitionByName.get("fade") ?? null,
      transition_out_id: transitionByName.get(String(raw.transition_out || "fade")) ?? transitionByName.get("fade") ?? null,
      asset_query: String(raw.asset_query || ""),
      source: "ai",
      parameters: { reason: raw.reason ?? "" },
    };
  });

  // Replace AI-sourced rows; preserve backfill until first AI run, then drop them.
  await supabase.from("edit_actions").delete().eq("project_id", projectId);
  if (rows.length > 0) await supabase.from("edit_actions").insert(rows);
}

/* ============= Transcript segmentation ============= */

/** Split full_text into sentence-ish segments and project word timings onto them. */
export async function writeTranscriptSegments(
  supabase: SupabaseLike,
  projectId: string,
  fullText: string,
  words: Array<{ word: string; start: number; end: number }>,
  totalDuration: number,
) {
  await supabase.from("transcript_segments").delete().eq("project_id", projectId);
  if (!fullText?.trim()) return;

  // Sentence-ish split
  const sentences = fullText
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const hasTimings = Array.isArray(words) && words.length > 0;
  const fallbackTotal = totalDuration > 0 ? totalDuration : (hasTimings ? words[words.length - 1].end : sentences.length * 4);

  let wordCursor = 0;
  const rows = sentences.map((text, i) => {
    const wc = text.split(/\s+/).filter(Boolean).length;
    let start = 0, end = 0;
    if (hasTimings && wordCursor < words.length) {
      const sliceEnd = Math.min(words.length, wordCursor + wc);
      start = words[wordCursor]?.start ?? 0;
      end = words[sliceEnd - 1]?.end ?? start;
      wordCursor = sliceEnd;
    } else {
      start = (i / sentences.length) * fallbackTotal;
      end = ((i + 1) / sentences.length) * fallbackTotal;
    }
    return {
      project_id: projectId,
      segment_index: i,
      start_time: start,
      end_time: end,
      duration: Math.max(0, end - start),
      text,
      word_count: wc,
    };
  });

  if (rows.length > 0) await supabase.from("transcript_segments").insert(rows);
}