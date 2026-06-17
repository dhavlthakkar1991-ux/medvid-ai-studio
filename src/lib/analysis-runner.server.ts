import { generateJSON } from "./ai/providers.server";
import { TaskSchemas, type TaskKey } from "./ai/schemas";
import { TASK_DEFAULT_MODELS, BUDGET_MODEL, type LLMProviderId } from "./ai/types";
import { buildContextPrompt } from "./ai/context.server";
import { estimateCost } from "./ai/pricing";
import { normalizeTaskOutput } from "./analysis/normalize.server";
import { buildRenderManifestForProject } from "./render/timeline-builder.server";
import { generateAssetCandidatesForProject } from "./assets/asset-matcher.server";
import { compileTimelineForProject } from "./render/timeline-compiler.server";
import { validateTaskOutput, type TaskValidatorKey, type ValidationResult } from "./qa/validators";
import { FALLBACK_PROMPTS } from "./qa/fallback-prompts.server";
import { fallbackScenePlan, fallbackBroll, fallbackVisualStoryboard, fallbackEditorialDecisions, fallbackSeo } from "./qa/fallback-generators.server";

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
  scene_plan: `Plan 6–14 scenes (talking-head, infographic, b-roll, callout, chapter-card). Each scene MUST include: t (mm:ss), kind, title, scene_number, narration_text (verbatim or close paraphrase of the transcript slice for that scene — REQUIRED, non-empty), objective (one-sentence editorial purpose — REQUIRED, non-empty). Timestamps are advisory only; the pipeline derives final scene timing from transcript segments.`,
  visual_storyboard: `Produce a 8–20 step visual storyboard. Each step: time, visual_type, title, screen_layout, asset_prompt (vivid, image/video generation ready), animation, priority, duration_seconds. Tune to specialty and visual_density.`,
  broll: `Suggest 5–12 B-roll cutaways. Each item MUST have EXACTLY these fields: scene_number (1-based, matching scene_plan), keyword (<=4 words), search_prompt (cinematic generation-ready description), placement_reason (why this clip supports the narration), recommended_start (mm:ss), recommended_end (mm:ss). Do NOT emit legacy fields (prompt, asset_prompt, keywords[], t).`,
  infographics: `Suggest 4–10 medical infographics aligned to the chapters. Each: t, type, title, bullets (3–6), asset_prompt. RESPECT the Grounding Mode declared in the system prompt: in STRICT mode every bullet, title, and asset_prompt must only reference concepts the transcript or project context actually mentions — do NOT introduce adjacent risk factors, conditions, statistics, or recommendations the speaker did not discuss.`,
  thumbnails: `Suggest 3 high-CTR thumbnail concepts. Each: concept, layout, text (≤6 words), palette (hex[]), asset_prompt.`,
  seo: `Produce SEO package for YouTube. Return JSON shaped EXACTLY as { "seo": { "titles": [...5 strings ≤70 chars...], "description": "≤500 chars", "tags": [12-20 strings], "chapters_text": "HH:MM:SS lines", "pinned_comment": "..." } }. Use the top-level key "seo" (NOT "seo_package", "youtube_seo", or any alias). titles, tags, and description must all be non-empty. When the system prompt provides a Presenter Name, use that EXACT spelling — never the transcript's version.`,
  shorts: `Pick 3–5 short clip ideas (15–60s windows). Each: start (mm:ss), end (mm:ss), hook (≤80 chars), caption, asset_prompt.`,
  editorial_decisions: `You are a professional medical video editor. The source is a doctor's talking-head video (Track 0). You make the editing decisions; planners only suggest assets. Produce 12–40 edit_actions densely covering the video — aim for >70% timeline coverage. Each item: scene_number (1-based), action_type (one of: show_broll, show_infographic, show_medical_diagram, show_clinical_image, show_lower_third, show_text_overlay, show_callout, kinetic_typography, highlight_keyword, show_statistic, picture_in_picture, split_screen, show_cta, show_thumbnail_frame, show_logo, show_transition, zoom_crop, ken_burns), start_time (seconds, numeric), end_time (seconds, numeric), layer (Track 0=talking head [reserved], 1=b-roll, 2=infographics/diagrams, 3=lower thirds, 4=kinetic typography, 5=keyword highlights, 6=CTA/end cards), priority (1-10), layout (full_screen, pip_right, pip_left, split_screen, doctor_with_infographic, doctor_with_broll, doctor_with_callout, top_bottom, picture_in_picture), transition_in/transition_out (cut, fade, crossfade, slide, push, zoom, blur, whip, medical_hud), asset_query (concrete search/generation prompt), reason. Use lower thirds for speaker/credentials, kinetic typography for key phrases, highlight_keyword for medical terms, and show_cta near the end. Never replace narration — only enhance it.`,
};

export async function runTaskForProject(
  supabase: any,
  userId: string,
  projectId: string,
  task: TaskKey,
  options?: { pipelineRunId?: string | null; executionId?: string | null },
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

  // --- Execution tracking + recovery chain ---
  const startedAt = new Date();
  const validatorKey = task as TaskValidatorKey;
  const sceneCount = await supabase
    .from("scenes")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .then((r: any) => r.count ?? 0)
    .catch(() => 0);
  const valCtx = { transcriptDuration: Number(project.duration_seconds) || 0, sceneCount };

  const attempts: Array<{
    stage: string;
    valid: boolean;
    errors: string[];
    warnings: string[];
    duration_ms: number;
    model?: string;
    provider?: string;
    raw_text?: string;
    raw_parsed?: unknown;
    normalized?: unknown;
    error_message?: string;
  }> = [];
  let usage = { inputTokens: 0, outputTokens: 0 };
  let res: any = null;
  let resValid = false;
  let lastValidation: ValidationResult = { valid: false, warnings: [], errors: ["not_attempted"] };
  let fallbackStage: string | null = null;
  let retryCount = 0;

  const truncate = (s: string | undefined, n = 4000) =>
    typeof s === "string" && s.length > n ? s.slice(0, n) + `…[+${s.length - n} chars]` : s;

  const tryStage = async (stage: string, runPrompt: string): Promise<void> => {
    const t0 = Date.now();
    try {
      const out = await generateJSON<any>(provider, userKeys, { model, system, prompt: runPrompt, schema });
      usage = {
        inputTokens: usage.inputTokens + (out.usage?.inputTokens ?? 0),
        outputTokens: usage.outputTokens + (out.usage?.outputTokens ?? 0),
      };
      const v = validateTaskOutput(validatorKey, out.data, valCtx);
      attempts.push({
        stage,
        valid: v.valid,
        errors: v.errors,
        warnings: v.warnings,
        duration_ms: Date.now() - t0,
        model: out.model,
        provider: out.provider,
        raw_text: truncate(out.raw?.text),
        raw_parsed: out.raw?.parsed,
        normalized: out.data,
      });
      // Never overwrite an already-valid AI output with a later attempt.
      if (!resValid && (v.valid || res == null)) {
        res = out;
        resValid = v.valid;
      }
      lastValidation = v;
    } catch (err: any) {
      attempts.push({
        stage,
        valid: false,
        errors: [String(err?.message ?? err)],
        warnings: [],
        duration_ms: Date.now() - t0,
        error_message: String(err?.message ?? err),
      });
      lastValidation = { valid: false, warnings: [], errors: [String(err?.message ?? err)] };
    }
  };

  // Stage 1: primary
  await tryStage("primary", prompt);

  // Stage 2 & 3: two retries with the primary prompt
  if (!lastValidation.valid) {
    retryCount = 1;
    await tryStage("retry_1", prompt + "\n\nThe previous response failed validation. Fix it and return strictly valid JSON matching the schema. Every required field must be non-empty.");
  }
  if (!lastValidation.valid) {
    retryCount = 2;
    await tryStage("retry_2", prompt + "\n\nFINAL RETRY. Return ONLY valid JSON matching the schema. No prose, no markdown.");
  }

  // Stage 4: fallback prompt
  if (!lastValidation.valid && FALLBACK_PROMPTS[validatorKey]) {
    fallbackStage = "fallback_prompt";
    const fb = `${FALLBACK_PROMPTS[validatorKey]}\n\nDuration: ${project.duration_seconds ?? "unknown"}s\nTitle: ${project.title}\nTopic: ${project.topic ?? ""}\n\nTranscript:\n${(tx.full_text as string).slice(0, 12000)}`;
    await tryStage("fallback_prompt", fb);
  }

  // Stage 5: deterministic fallback generator
  if (!resValid) {
    const t0 = Date.now();
    let gen: any = null;
    if (task === "scene_plan") gen = await fallbackScenePlan(supabase, projectId, project);
    else if (task === "broll") gen = await fallbackBroll(supabase, projectId, project);
    else if (task === "visual_storyboard") gen = await fallbackVisualStoryboard(supabase, projectId, project);
    else if (task === "editorial_decisions") gen = await fallbackEditorialDecisions(supabase, projectId, project);
    else if (task === "seo") gen = await fallbackSeo(supabase, projectId, project);
    if (gen) {
      // Run through schema for normalization (best-effort)
      let parsed: any = gen;
      try { parsed = schema.parse(gen); } catch { /* generators are already minimal-valid; ignore */ }
      const v = validateTaskOutput(validatorKey, parsed, valCtx);
      attempts.push({
        stage: "fallback_generator",
        valid: v.valid,
        errors: v.errors,
        warnings: v.warnings,
        duration_ms: Date.now() - t0,
        provider: "deterministic",
        normalized: parsed,
      });
      // Only overwrite AI output with deterministic output when we have no valid AI result.
      if (v.valid && !resValid) {
        fallbackStage = "fallback_generator";
        res = { provider: "fallback", model: "deterministic", data: parsed, usage: { inputTokens: 0, outputTokens: 0 } };
        resValid = true;
        lastValidation = v;
      }
    }
  }

  if (!res) {
    // Total failure — still record the execution before throwing.
    await recordExecution({
      supabase, projectId, pipelineRunId: options?.pipelineRunId ?? null,
      executionId: options?.executionId ?? null,
      task, provider, model, startedAt,
      status: "failed", retryCount, fallbackStage, validation: lastValidation,
      attempts, errorMessage: attempts[attempts.length - 1]?.errors?.[0] ?? "no_output",
    });
    throw new Error(`task ${task} produced no usable output: ${lastValidation.errors.join("; ")}`);
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
    // After a contributing task changes, regenerate the asset/timeline chain:
    //   storyboard/broll → asset_candidates → timeline_instructions → render_manifest.
    if (task === "scene_plan" || task === "visual_storyboard" || task === "broll") {
      if (task === "visual_storyboard" || task === "broll") {
        await generateAssetCandidatesForProject(supabase, projectId);
      }
      await compileTimelineForProject(supabase, projectId);
      await buildRenderManifestForProject(supabase, projectId);
    }
    // Editorial decisions overwrite edit_actions; rebuild manifest from the new actions.
    if (task === "editorial_decisions") {
      const actions = Array.isArray((res.data as any)?.edit_actions) ? (res.data as any).edit_actions : [];
      if (actions.length === 0) {
        console.warn("editorial_decisions returned 0 valid edit_actions; skipping manifest rebuild");
      } else {
        // Run the Presence & Layout Intelligence engine on the new edit_actions
        // BEFORE rebuilding the manifest so the manifest carries layout/visibility info.
        try {
          const { runLayoutDecisionsForProject } = await import("./layout/layout-runner.server");
          await runLayoutDecisionsForProject(supabase, userId, projectId);
        } catch (e) {
          console.warn("layout_decisions run failed", e);
        }
        await buildRenderManifestForProject(supabase, projectId);
      }
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

  await recordExecution({
    supabase, projectId, pipelineRunId: options?.pipelineRunId ?? null,
    executionId: options?.executionId ?? null,
    task, provider: res.provider, model: res.model, startedAt,
    status: lastValidation.valid ? "completed" : "completed_with_warnings",
    retryCount, fallbackStage, validation: lastValidation, attempts,
    errorMessage: null,
  });

  return {
    version: nextVersion,
    model: res.model,
    provider: res.provider,
    cost,
    validation: lastValidation,
    retryCount,
    fallbackUsed: !!fallbackStage,
    fallbackStage,
  };
}

async function recordExecution(args: {
  supabase: any;
  projectId: string;
  pipelineRunId: string | null;
  executionId: string | null;
  task: string;
  provider: string;
  model: string;
  startedAt: Date;
  status: string;
  retryCount: number;
  fallbackStage: string | null;
  validation: ValidationResult;
  attempts: any[];
  errorMessage: string | null;
}) {
  const completedAt = new Date();
  const row = {
    pipeline_run_id: args.pipelineRunId,
    project_id: args.projectId,
    task_name: args.task,
    provider: args.provider,
    model: args.model,
    status: args.status,
    started_at: args.startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    duration_ms: completedAt.getTime() - args.startedAt.getTime(),
    retry_count: args.retryCount,
    fallback_used: !!args.fallbackStage,
    fallback_stage: args.fallbackStage,
    validation_passed: args.validation.valid,
    validation_errors: args.validation.errors,
    validation_warnings: args.validation.warnings,
    error_message: args.errorMessage,
    attempts: args.attempts,
  };
  try {
    if (args.executionId) await args.supabase.from("task_executions").update(row).eq("id", args.executionId);
    else await args.supabase.from("task_executions").insert(row);
  } catch (e) {
    console.warn("task_executions insert failed", e);
  }
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
  "editorial_decisions",
];
