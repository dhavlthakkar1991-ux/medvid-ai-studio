import { z } from "zod";

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
    visual_type: z.enum(["Medical Infographic", "B-Roll", "Diagram", "Chapter Card", "Callout", "Split Screen"]),
    title: z.string(),
    screen_layout: z.enum(["Full", "Split Screen", "PiP", "Lower Third"]),
    asset_prompt: z.string(),
    animation: z.enum(["Slide In Right", "Fade", "Zoom", "None"]),
    priority: z.enum(["low", "medium", "high", "maximum"]),
    duration_seconds: z.number(),
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
