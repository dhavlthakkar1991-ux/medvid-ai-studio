import { z } from "zod";

const normalizeToken = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const VisualTypeSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = normalizeToken(value);
  if (normalized.includes("infographic")) return "Medical Infographic";
  if (normalized.includes("anatomy") || normalized.includes("diagram") || normalized.includes("chart") || normalized.includes("graph")) return "Diagram";
  if (normalized.includes("b_roll") || normalized.includes("broll") || normalized.includes("speaker") || normalized.includes("talking_head")) return "B-Roll";
  if (normalized.includes("chapter")) return "Chapter Card";
  if (normalized.includes("callout") || normalized.includes("text_overlay") || normalized.includes("overlay") || normalized.includes("lower_third") || normalized.includes("title_card") || normalized.includes("quote")) return "Callout";
  if (normalized.includes("split")) return "Split Screen";
  return "Callout";
}, z.enum(["Medical Infographic", "B-Roll", "Diagram", "Chapter Card", "Callout", "Split Screen"]));

const ScreenLayoutSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = normalizeToken(value);
  if (normalized.includes("two_thirds") || normalized.includes("split")) return "Split Screen";
  if (normalized.includes("pip") || normalized.includes("picture_in_picture")) return "PiP";
  if (normalized.includes("lower_third") || normalized.includes("text_on_background") || normalized.includes("overlay") || normalized.includes("caption") || normalized.includes("banner")) return "Lower Third";
  if (normalized.includes("full") || normalized.includes("speaker") || normalized.includes("infographic") || normalized.includes("anatomy")) return "Full";
  return "Full";
}, z.enum(["Full", "Split Screen", "PiP", "Lower Third"]));

const AnimationSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = normalizeToken(value);
  if (normalized.includes("zoom")) return "Zoom";
  if (normalized.includes("fade") || normalized.includes("reveal") || normalized.includes("highlight") || normalized.includes("pulse") || normalized.includes("emphasize") || normalized.includes("flash") || normalized.includes("glow")) return "Fade";
  if (normalized.includes("slide") || normalized.includes("wipe") || normalized.includes("pan")) return "Slide In Right";
  if (normalized.includes("none") || normalized.includes("static")) return "None";
  return "Fade";
}, z.enum(["Slide In Right", "Fade", "Zoom", "None"]));

const PrioritySchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = normalizeToken(value);
  if (normalized.includes("critical") || normalized.includes("urgent") || normalized.includes("max")) return "maximum";
  if (normalized.includes("high")) return "high";
  if (normalized.includes("med")) return "medium";
  if (normalized.includes("low")) return "low";
  return value;
}, z.enum(["low", "medium", "high", "maximum"]));

export const ChaptersSchema = z.object({
  chapters: z.array(z.object({
    title: z.string(),
    start: z.string().describe("mm:ss"),
    end: z.string().describe("mm:ss"),
  })),
});

export const ScenePlanSchema = z.object({
  scene_plan: z.array(z.object({
    t: z.string().describe("mm:ss"),
    kind: z.string(),
    title: z.string(),
    prompt: z.string().optional().default(""),
    scene_number: z.coerce.number().optional(),
    start_seconds: z.coerce.number().optional(),
    end_seconds: z.coerce.number().optional(),
    narration_text: z.string().optional().default(""),
    objective: z.string().optional().default(""),
  }).transform((s) => {
    // Gemini occasionally omits narration_text/objective on a single scene.
    // Backfill from neighboring fields so the whole plan isn't rejected.
    const title = s.title || s.kind || "Scene";
    const narration = (s.narration_text && s.narration_text.trim()) || title;
    const objective = (s.objective && s.objective.trim()) || `Cover: ${title}`;
    return { ...s, narration_text: narration, objective };
  })),
});

export const VisualStoryboardSchema = z.object({
  visual_storyboard: z.array(z.object({
    time: z.string(),
    visual_type: VisualTypeSchema,
    title: z.string(),
    screen_layout: ScreenLayoutSchema,
    asset_prompt: z.string(),
    animation: AnimationSchema,
    priority: PrioritySchema,
    duration_seconds: z.coerce.number(),
    scene_number: z.coerce.number().optional(),
  })),
});

export const BrollSchema = z.object({
  broll: z.array(z.object({
    scene_number: z.coerce.number(),
    keyword: z.string().min(1),
    search_prompt: z.string().min(1),
    placement_reason: z.string().min(1),
    recommended_start: z.string().min(1).describe("mm:ss"),
    recommended_end: z.string().min(1).describe("mm:ss"),
  })),
});

export const InfographicsSchema = z.object({
  infographics: z.array(z.object({
    t: z.string(),
    type: z.string(),
    title: z.string(),
    bullets: z.array(z.string()),
    asset_prompt: z.string(),
  })),
});

export const ThumbnailsSchema = z.object({
  thumbnails: z.array(z.object({
    concept: z.string(),
    layout: z.string(),
    text: z.string(),
    palette: z.array(z.string()),
    asset_prompt: z.string(),
  })),
});

export const SeoSchema = z.object({
  seo: z.object({
    titles: z.array(z.string()),
    description: z.string(),
    tags: z.array(z.string()),
    chapters_text: z.string(),
    pinned_comment: z.string(),
  }),
});

export const ShortsSchema = z.object({
  shorts: z.array(z.object({
    start: z.string(),
    end: z.string(),
    hook: z.string(),
    caption: z.string(),
    asset_prompt: z.string(),
  })),
});

const ACTION_TYPES = [
  "show_broll",
  "show_infographic",
  "show_text_overlay",
  "show_callout",
  "show_lower_third",
  "picture_in_picture",
  "split_screen",
  "zoom_crop",
  "ken_burns",
  "highlight_keyword",
  "kinetic_typography",
  "show_statistic",
  "show_medical_diagram",
  "show_clinical_image",
  "show_thumbnail_frame",
  "show_transition",
  "show_logo",
  "show_cta",
] as const;

const ActionTypeSchema = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const n = v.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return (ACTION_TYPES as readonly string[]).includes(n) ? n : "show_callout";
}, z.enum(ACTION_TYPES));

const TimeSecondsSchema = z.preprocess((value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (value == null) return undefined;
  if (typeof value !== "string") return undefined;
  const s = value.trim();
  if (!s) return undefined;
  if (/^nan$/i.test(s)) return undefined;
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  }
  // mm:ss or hh:mm:ss
  const parts = s.split(":").map((p) => p.trim());
  if (parts.length >= 2 && parts.length <= 3 && parts.every((p) => /^\d+(\.\d+)?$/.test(p))) {
    let secs = 0;
    for (const p of parts) secs = secs * 60 + Number(p);
    return Number.isFinite(secs) ? secs : undefined;
  }
  return undefined;
}, z.number().optional());

export const EditorialDecisionsSchema = z.object({
  edit_actions: z.array(
    z.object({
      scene_number: z.coerce.number().optional(),
      action_type: ActionTypeSchema,
      start_time: TimeSecondsSchema,
      end_time: TimeSecondsSchema,
      layer: z.coerce.number().int().min(0).max(7).default(1),
      priority: z.coerce.number().int().min(1).max(10).default(5),
      layout: z.string().optional().default("full_screen"),
      transition_in: z.string().optional().default("fade"),
      transition_out: z.string().optional().default("fade"),
      asset_query: z.string().optional().default(""),
      reason: z.string().optional().default(""),
    }).transform((it) => {
      const start = typeof it.start_time === "number" ? it.start_time : NaN;
      let end = typeof it.end_time === "number" ? it.end_time : NaN;
      if (!Number.isFinite(end) || end <= start) end = Number.isFinite(start) ? start + 2 : NaN;
      return { ...it, start_time: start, end_time: end };
    })
  ).transform((arr) => arr.filter((it) => Number.isFinite(it.start_time) && Number.isFinite(it.end_time))),
});

export const TaskSchemas = {
  chapters: ChaptersSchema,
  scene_plan: ScenePlanSchema,
  visual_storyboard: VisualStoryboardSchema,
  broll: BrollSchema,
  infographics: InfographicsSchema,
  thumbnails: ThumbnailsSchema,
  seo: SeoSchema,
  shorts: ShortsSchema,
  editorial_decisions: EditorialDecisionsSchema,
} as const;

export type TaskKey = keyof typeof TaskSchemas;
