export const TASKS = [
  "full",
  "chapters",
  "scene_plan",
  "visual_storyboard",
  "broll",
  "infographics",
  "thumbnails",
  "seo",
  "shorts",
] as const;
export type Task = (typeof TASKS)[number];

export const LLM_PROVIDERS = ["lovable", "openai", "gemini", "openrouter", "anthropic", "groq", "deepseek"] as const;
export type LLMProviderId = (typeof LLM_PROVIDERS)[number];

export const TRANSCRIPTION_PROVIDERS = ["openai", "groq", "assemblyai", "deepgram"] as const;
export type TranscriptionProviderId = (typeof TRANSCRIPTION_PROVIDERS)[number];

/** Default model per task — user/project can override these in settings. */
export const TASK_DEFAULT_MODELS: Record<Exclude<Task, "full">, string> = {
  chapters: "google/gemini-2.5-pro",
  scene_plan: "openai/gpt-5",
  visual_storyboard: "openai/gpt-5",
  broll: "google/gemini-2.5-pro",
  infographics: "google/gemini-2.5-pro",
  thumbnails: "google/gemini-2.5-flash",
  seo: "openai/gpt-5",
  shorts: "google/gemini-2.5-flash",
};

export const BUDGET_MODEL = "google/gemini-2.5-flash";

export type Usage = { inputTokens: number; outputTokens: number };
