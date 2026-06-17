import { generateJSON } from "./ai/providers.server";
import { TaskSchemas, type TaskKey } from "./ai/schemas";
import { TASK_DEFAULT_MODELS, BUDGET_MODEL, type LLMProviderId } from "./ai/types";
import { buildContextPrompt } from "./ai/context.server";
import { estimateCost } from "./ai/pricing";
import { normalizeTaskOutput } from "./analysis/normalize.server";
import { buildRenderManifestForProject } from "./render/timeline-builder.server";

const PROVIDER_DEFAULT_MODEL: Record<LLMProviderId, string> = {
  lovable: "google/gemini-2.5-flash",
  gemini: "google/gemini-2.5-flash",
  openai: "openai/gpt-4o-mini",
  openrouter: "openai/gpt-4o-mini",
  anthropic: "anthropic/claude-3-5-sonnet-latest",
  groq: "llama-3.3-70b-versatile",
  deepseek: "deepseek-chat",
};

const PROVIDER_PREFIX: Record<LLMProviderId, string | null> = {
  lovable: null,
  openrouter: null,
  gemini: "google/",
  openai: "openai/",
  anthropic: "anthropic/",
  groq: null,
  deepseek: null,
};

function coerceModelForProvider(provider: LLMProviderId, model: string): string {
  const prefix = PROVIDER_PREFIX[provider];
  if (!prefix) return model;
  if (model.startsWith(prefix)) return model;
  // mismatched prefix (e.g. openai/gpt-5 on gemini) → fall back to provider default
  if (model.includes("/")) return PROVIDER_DEFAULT_MODEL[provider];
  return model;
}

const SYSTEM_BASE = `You are OncoVideo AI — an expert medical video producer assisting doctors and educators.
You produce strictly structured JSON. Never include markdown, prose, or explanations outside the schema.
All times are mm:ss strings. Keep medical content accurate, evidence-based, and patient-safe.`;

const TASK_PROMPTS: Record<TaskKey, string> = {
  chapters: `Segment the transcript into 4–8 educational chapters with mm:ss start/end timestamps inside the duration.`,
  scene_plan: `Plan 6–14 scenes (talking-head, infographic, b-roll, callout, chapter-card). Each: t (mm:ss), kind, title, prompt.`,
  visual_storyboard: `Produce a 8–20 step visual storyboard. Each step: time, visual_type, title, screen_layout, asset_prompt (vivid, image/video generation ready), animation, priority, duration_seconds. Tune to specialty and visual_density.`,
  broll: `Suggest 5–12 B-roll cutaways. Each: t, prompt (what to show), asset_prompt (cinematic generation-ready prompt), keywords.`,
  infographics: `Suggest 4–10 medical infographics aligned to the chapters. Each: t, type, title, bullets (3–6), asset_prompt.`,
  thumbnails: `Suggest 3 high-CTR thumbnail concepts. Each: concept, layout, text (≤6 words), palette (hex[]), asset_prompt.`,
  seo: `Produce SEO package for YouTube: 5 titles (≤70 chars), description (≤500 chars), 12–20 tags, chapters_text (HH:MM:SS lines), pinned_comment.`,
  shorts: `Pick 3–5 short clip ideas (15–60s windows). Each: start (mm:ss), end (mm:ss), hook (≤80 chars), caption, asset_prompt.`,
};

export async function runTaskForProject(
  supabase: any,
  userId: string,
  projectId: string,
  task: TaskKey,
) {
  // Load context + transcript + ai_settings + template
  const [{ data: project }, { data: ctx }, { data: tx }, { data: settings }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", projectId).single(),
    supabase.from("project_context").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.from("transcripts").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.from("ai_settings").select("*").eq("user_id", userId).maybeSingle(),
  ]);
  if (!project) throw new Error("Project not found");
  if (!tx || !tx.full_text) throw new Error("Transcript not ready yet.");

  let tpl: any = null;
  if (project.specialty_template_id) {
    const { data: t } = await supabase.from("specialty_templates").select("*").eq("id", project.specialty_template_id).maybeSingle();
    tpl = t;
  }

  const overrides = (settings?.model_overrides as Record<string, string>) ?? {};
  const provider = ((settings?.default_llm_provider as LLMProviderId) ?? "lovable");
  const budget = !!settings?.budget_mode;
  const rawModel = budget ? BUDGET_MODEL : (overrides[task] || TASK_DEFAULT_MODELS[task]);
  const model = coerceModelForProvider(provider, rawModel);
  const userKeys = (settings?.provider_keys as Record<string, string>) ?? {};

  const schema = TaskSchemas[task];
  const ctxPrompt = buildContextPrompt(ctx ?? null, tpl);
  const system = SYSTEM_BASE + "\n" + ctxPrompt;
  const prompt = `${TASK_PROMPTS[task]}\n\nDuration: ${project.duration_seconds ?? "unknown"}s\nTitle: ${project.title}\nTopic: ${project.topic ?? ""}\n\nTranscript:\n${(tx.full_text as string).slice(0, 18000)}`;

  let res = await generateJSON<any>(provider, userKeys, { model, system, prompt, schema });

  // B-roll hardening: never accept fewer than 5 items.
  if (task === "broll") {
    const count = Array.isArray(res.data?.broll) ? res.data.broll.length : 0;
    if (count < 5) {
      try {
        const retryPrompt =
          prompt +
          `\n\nIMPORTANT: Return AT LEAST 5 b-roll suggestions. Each item MUST include: scene_number (1-based), keyword, search_prompt, placement_reason, recommended_start (mm:ss), recommended_end (mm:ss).`;
        const retry = await generateJSON<any>(provider, userKeys, { model, system, prompt: retryPrompt, schema });
        if (Array.isArray(retry.data?.broll) && retry.data.broll.length > count) {
          res = {
            ...retry,
            usage: {
              inputTokens: res.usage.inputTokens + retry.usage.inputTokens,
              outputTokens: res.usage.outputTokens + retry.usage.outputTokens,
            },
          };
        }
      } catch (e) {
        console.warn("broll retry failed", e);
      }
    }
    const final = Array.isArray(res.data?.broll) ? res.data.broll : [];
    if (final.length < 5) {
      // Synthesize fallback items from scenes / project so we never persist an empty array.
      const { data: scenes } = await supabase
        .from("scenes")
        .select("scene_number, title, start_time, end_time, narration_text")
        .eq("project_id", projectId)
        .order("scene_number", { ascending: true });
      const base = (scenes ?? []) as Array<{ scene_number: number; title: string; start_time: number; end_time: number; narration_text: string }>;
      const seeds = base.length > 0 ? base : Array.from({ length: 5 }, (_, i) => ({
        scene_number: i + 1,
        title: `${project.topic ?? project.title} — segment ${i + 1}`,
        start_time: i * 10,
        end_time: i * 10 + 5,
        narration_text: "",
      }));
      const fmt = (s: number) => {
        const m = Math.floor(s / 60).toString().padStart(2, "0");
        const sec = Math.floor(s % 60).toString().padStart(2, "0");
        return `${m}:${sec}`;
      };
      const fallback = seeds.slice(0, Math.max(5, seeds.length)).map((s) => ({
        scene_number: s.scene_number,
        keyword: s.title,
        search_prompt: `Cinematic medical b-roll: ${s.title}`,
        placement_reason: `Cover narration: ${s.narration_text?.slice(0, 120) || s.title}`,
        recommended_start: fmt(s.start_time),
        recommended_end: fmt(s.end_time || s.start_time + 5),
      }));
      const merged = [...final, ...fallback].slice(0, Math.max(5, final.length + fallback.length));
      res = { ...res, data: { broll: merged.slice(0, Math.max(5, merged.length)) } };
    }
  }

  // Determine next version number
  const { data: prev } = await supabase
    .from("analysis_versions")
    .select("version")
    .eq("project_id", projectId)
    .eq("task", task)
    .order("version", { ascending: false })
    .limit(1);
  const nextVersion = (prev?.[0]?.version ?? 0) + 1;

  await supabase.from("analysis_versions").insert({
    project_id: projectId,
    task,
    version: nextVersion,
    provider: res.provider,
    model: res.model,
    models_used: { [task]: res.model },
    analysis_data: res.data,
  });

  // Project the JSON into the canonical relational tables.
  try {
    await normalizeTaskOutput(
      supabase,
      projectId,
      task,
      res.data,
      Number(project.duration_seconds) || 0,
    );
    // Rebuild render manifest whenever a contributing task changes.
    if (task === "scene_plan" || task === "visual_storyboard" || task === "broll") {
      await buildRenderManifestForProject(supabase, projectId);
    }
  } catch (e) {
    console.warn(`normalize/timeline build failed for ${task}`, e);
  }

  const cost = estimateCost(res.model, res.usage.inputTokens, res.usage.outputTokens);
  await supabase.from("usage_logs").insert({
    user_id: userId,
    project_id: projectId,
    provider: res.provider,
    model: res.model,
    task,
    input_tokens: res.usage.inputTokens,
    output_tokens: res.usage.outputTokens,
    estimated_cost: cost,
  });

  return { version: nextVersion, model: res.model, provider: res.provider, cost };
}

export const ALL_TASKS: TaskKey[] = [
  "chapters",
  "scene_plan",
  "visual_storyboard",
  "broll",
  "infographics",
  "thumbnails",
  "seo",
  "shorts",
];
