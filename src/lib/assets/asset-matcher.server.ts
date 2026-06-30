import { ACTION_TO_ASSET_TYPE } from "./asset-linker.server";

// Server-only: convert normalized storyboard_items into asset_candidates.
// Codex handoff-oriented: every candidate row carries the Studio visual intent
// that the asset-pack export turns into ImageGen/HyperFrames production prompts.

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

function codexToolForAssetType(assetType: string): "imagegen" | "hyperframes" {
  const type = String(assetType ?? "").toLowerCase();
  return type.includes("broll") || type.includes("video") ? "hyperframes" : "imagegen";
}

const DEFAULT_CODEX_NEGATIVE_PROMPT =
  "No watermark. No SVG or vector-only final asset. No fake medical facts, fake statistics, extra labels, cartoon style, distorted anatomy, unrelated dental stock, or text errors.";

function buildCodexGenerationPrompt(args: {
  assetType: string;
  title: string;
  visualIntent: string;
  description?: string | null;
  source: string;
  actionType?: string | null;
}) {
  const tool = codexToolForAssetType(args.assetType);
  const common = [
    "Studio is the director. Use only the visual intent and approved project context supplied here.",
    `Visual intent: ${args.visualIntent || args.title || args.assetType}.`,
    args.description ? `Scene/context: ${args.description}.` : null,
    args.actionType ? `Action/layout intent: ${args.actionType}.` : null,
    "Medical education style: professional, clean, patient-friendly, accurate, restrained.",
    "Do not invent medical facts, labels, statistics, diagnoses, or warnings beyond the prompt.",
  ].filter(Boolean);

  if (tool === "hyperframes") {
    return [
      "Create a short 16:9 professional medical education b-roll/supporting visual as an MP4 using HyperFrames.",
      ...common,
      "Output: 1920x1080 MP4, no watermark, no stock placeholder slate, suitable for use as timed b-roll in the Studio render timeline.",
    ].join("\n");
  }

  return [
    "Use case: scientific-educational",
    "Asset type: MedVideo Studio raster asset for a 16:9 healthcare education video",
    `Primary request: ${args.visualIntent || args.title || args.assetType}`,
    "Style/medium: polished medical education raster image or infographic, not SVG",
    "Composition/framing: 16:9 layout with safe margins for video overlays",
    ...common,
    "Constraints: final output must be PNG, WebP, or JPG; no SVG; no watermark; no fake facts.",
  ].join("\n");
}

function codexCandidateData(args: {
  source: string;
  assetType: string;
  title: string;
  query: string;
  description?: string | null;
  visualType?: string | null;
  actionType?: string | null;
  storyboardItemId?: string | null;
  brollItemId?: string | null;
  infographicItemId?: string | null;
}) {
  const tool = codexToolForAssetType(args.assetType);
  const generationPrompt = buildCodexGenerationPrompt({
    assetType: args.assetType,
    title: args.title,
    visualIntent: args.query,
    description: args.description,
    source: args.source,
    actionType: args.actionType,
  });
  return {
    source: args.source,
    visual_type: args.visualType ?? null,
    action_type: args.actionType ?? null,
    storyboard_item_id: args.storyboardItemId ?? null,
    broll_item_id: args.brollItemId ?? null,
    infographic_item_id: args.infographicItemId ?? null,
    codex_creative_workflow: true,
    codex_tool: tool,
    generation_prompt: generationPrompt,
    negative_prompt: DEFAULT_CODEX_NEGATIVE_PROMPT,
    render_ready: false,
    approval_required: true,
    no_worker_svg: true,
    no_worker_ffmpeg: true,
    output_contract: {
      allowed_formats: tool === "hyperframes" ? ["mp4"] : ["png", "webp", "jpg"],
      disallowed_formats: ["svg"],
      preferred_size: tool === "hyperframes" ? "1920x1080 MP4" : "1920x1080 raster image",
    },
  };
}

/** Regenerate asset_candidates for every storyboard item + broll item of a project. */
export async function generateAssetCandidatesForProject(
  supabase: SupabaseLike,
  projectId: string,
) {
  const [{ data: storyboard }, { data: broll }, { data: infographics }, { data: editActions }] = await Promise.all([
    supabase
      .from("storyboard_items")
      .select("id, project_id, scene_id, visual_type, asset_prompt")
      .eq("project_id", projectId),
    supabase
      .from("broll_items")
      .select("id, project_id, scene_id, keyword, search_prompt")
      .eq("project_id", projectId),
    supabase
      .from("infographic_items")
      .select("id, project_id, scene_id, title, asset_prompt, bullets")
      .eq("project_id", projectId),
    supabase
      .from("edit_actions")
      .select("id, project_id, scene_id, action_type, asset_query, reason")
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
        provider: "codex_asset_pack",
        status: "pending",
        title: String(it.visual_type ?? "Storyboard"),
        description: String(it.asset_prompt ?? "").slice(0, 240),
        candidate_data: codexCandidateData({
          source: "storyboard",
          assetType: asset_type,
          title: String(it.visual_type ?? "Storyboard"),
          query: q,
          description: String(it.asset_prompt ?? "").slice(0, 240),
          visualType: it.visual_type,
          storyboardItemId: it.id,
        }),
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
        asset_type: "broll_video",
        search_query: q,
        priority: i + 1,
        provider: "codex_asset_pack",
        status: "pending",
        broll_item_id: it.id,
        title: String(it.keyword ?? "B-roll"),
        description: String(it.search_prompt ?? "").slice(0, 240),
        candidate_data: codexCandidateData({
          source: "broll",
          assetType: "broll_video",
          title: String(it.keyword ?? "B-roll"),
          query: q,
          description: String(it.search_prompt ?? "").slice(0, 240),
          brollItemId: it.id,
        }),
      });
    });
  }

  for (const it of (infographics ?? []) as any[]) {
    const variants = buildQueryVariants(
      String(it.asset_prompt ?? it.title ?? ""),
      String(it.title ?? ""),
      "infographic",
    );
    variants.forEach((q, i) => {
      rows.push({
        project_id: projectId,
        scene_id: it.scene_id ?? null,
        storyboard_item_id: null,
        asset_type: "infographic",
        search_query: q,
        priority: i + 1,
        provider: "codex_asset_pack",
        status: "pending",
        infographic_item_id: it.id,
        title: String(it.title ?? "Infographic"),
        description: String(it.asset_prompt ?? "").slice(0, 240),
        candidate_data: codexCandidateData({
          source: "infographic",
          assetType: "infographic",
          title: String(it.title ?? "Infographic"),
          query: q,
          description: String(it.asset_prompt ?? "").slice(0, 240),
          infographicItemId: it.id,
        }),
      });
    });
  }

  for (const ea of (editActions ?? []) as any[]) {
    const at = ACTION_TO_ASSET_TYPE[String(ea.action_type ?? "")];
    if (!at) continue;
    const q = String(ea.asset_query ?? "").trim();
    if (!q) continue;
    rows.push({
      project_id: projectId,
      scene_id: ea.scene_id ?? null,
      storyboard_item_id: null,
      asset_type: at,
      search_query: q.slice(0, 160),
      priority: 1,
      provider: "codex_asset_pack",
      status: "pending",
      edit_action_id: ea.id,
      title: String(ea.action_type ?? ""),
      description: String(ea.reason ?? "").slice(0, 240),
      candidate_data: codexCandidateData({
        source: "edit_action",
        assetType: at,
        title: String(ea.action_type ?? ""),
        query: q.slice(0, 160),
        description: String(ea.reason ?? "").slice(0, 240),
        actionType: ea.action_type,
      }),
    });
  }

  await supabase.from("asset_candidates").delete().eq("project_id", projectId);
  if (rows.length > 0) await supabase.from("asset_candidates").insert(rows);
  return { count: rows.length };
}
