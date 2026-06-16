import { generateJSON } from "./ai/providers.server";
import { TaskSchemas, type TaskKey } from "./ai/schemas";
import { TASK_DEFAULT_MODELS, BUDGET_MODEL, type LLMProviderId } from "./ai/types";
import { buildContextPrompt } from "./ai/context.server";
import { estimateCost } from "./ai/pricing";

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
  const model = budget ? BUDGET_MODEL : (overrides[task] || TASK_DEFAULT_MODELS[task]);
  const userKeys = (settings?.provider_keys as Record<string, string>) ?? {};

  const schema = TaskSchemas[task];
  const ctxPrompt = buildContextPrompt(ctx ?? null, tpl);
  const system = SYSTEM_BASE + "\n" + ctxPrompt;
  const prompt = `${TASK_PROMPTS[task]}\n\nDuration: ${project.duration_seconds ?? "unknown"}s\nTitle: ${project.title}\nTopic: ${project.topic ?? ""}\n\nTranscript:\n${(tx.full_text as string).slice(0, 18000)}`;

  const res = await generateJSON<any>(provider, userKeys, { model, system, prompt, schema });

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
