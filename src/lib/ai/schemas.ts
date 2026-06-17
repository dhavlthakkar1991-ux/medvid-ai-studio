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
    prompt: z.string(),
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
  })),
});

export const BrollSchema = z.object({
  broll: z.array(z.object({
    t: z.string(),
    prompt: z.string(),
    asset_prompt: z.string(),
    keywords: z.array(z.string()),
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

export const TaskSchemas = {
  chapters: ChaptersSchema,
  scene_plan: ScenePlanSchema,
  visual_storyboard: VisualStoryboardSchema,
  broll: BrollSchema,
  infographics: InfographicsSchema,
  thumbnails: ThumbnailsSchema,
  seo: SeoSchema,
  shorts: ShortsSchema,
} as const;

export type TaskKey = keyof typeof TaskSchemas;
