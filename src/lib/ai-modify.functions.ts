import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const TASK_KEYS = [
  "chapters",
  "scene_plan",
  "visual_storyboard",
  "broll",
  "infographics",
  "thumbnails",
  "seo",
  "shorts",
  "editorial_decisions",
] as const;

const Input = z.object({
  projectId: z.string().uuid(),
  task: z.enum(TASK_KEYS),
  prompt: z.string().min(3).max(4000),
});

export const aiModifyTaskOutput = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { TaskSchemas } = await import("./ai/schemas");
    const { generateJSON } = await import("./ai/providers.server");
    const { TASK_DEFAULT_MODELS, BUDGET_MODEL } = await import("./ai/types");
    const { normalizeTaskOutput } = await import("./analysis/normalize.server");
    const { buildRenderManifestForProject } = await import("./render/timeline-builder.server");
    const { generateAssetCandidatesForProject } = await import("./assets/asset-matcher.server");
    const { compileTimelineForProject } = await import("./render/timeline-compiler.server");

    const task = data.task;

    const [{ data: project }, { data: settings }, { data: prev }] = await Promise.all([
      supabase.from("projects").select("*").eq("id", data.projectId).single(),
      supabase.from("ai_settings").select("*").eq("user_id", userId).maybeSingle(),
      supabase
        .from("analysis_versions")
        .select("*")
        .eq("project_id", data.projectId)
        .eq("task", task)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (!project) throw new Error("Project not found");
    if (!prev) throw new Error(`No existing ${task} output to modify. Generate it first.`);

    const overrides = (settings?.model_overrides as Record<string, string>) ?? {};
    const provider = ((settings?.default_llm_provider as any) ?? "gemini");
    const budget = !!settings?.budget_mode;
    const model = budget ? BUDGET_MODEL : (overrides[task] || TASK_DEFAULT_MODELS[task]);
    const userKeys = (settings?.provider_keys as Record<string, string>) ?? {};

    const schema = TaskSchemas[task];

    const system = `You are a JSON editor for an AI video production pipeline. You modify an existing task output ("${task}") according to the user's instruction. You MUST return the FULL updated JSON for this task, matching the original schema exactly. Preserve every field that the user did not ask to change. Never include markdown or explanations — only valid JSON.`;

    const currentJson = JSON.stringify(prev.analysis_data, null, 2);
    const prompt = `User instruction:\n${data.prompt}\n\nCurrent ${task} JSON (modify per instruction, return full updated JSON):\n${currentJson}`;

    // Gemini 2.5 Pro frequently returns 503 "Service Unavailable" — fall back
    // to a faster/lighter model on transient upstream errors so the user's
    // edit isn't lost.
    const isTransient = (err: unknown) => {
      const m = String((err as any)?.message ?? err).toLowerCase();
      return m.includes("service unavailable") || m.includes("503") || m.includes("overloaded") || m.includes("timeout");
    };
    let res;
    try {
      res = await generateJSON<any>(provider, userKeys, { model, system, prompt, schema });
    } catch (e) {
      if (!isTransient(e) || model === BUDGET_MODEL) throw e;
      console.warn(`ai-modify: ${model} unavailable, falling back to ${BUDGET_MODEL}`, e);
      res = await generateJSON<any>(provider, userKeys, { model: BUDGET_MODEL, system, prompt, schema });
    }

    const nextVersion = (prev.version ?? 0) + 1;
    const { error: insErr } = await supabase.from("analysis_versions").insert({
      project_id: data.projectId,
      task,
      version: nextVersion,
      provider: res.provider,
      model: res.model,
      models_used: { [task]: res.model },
      analysis_data: res.data,
    });
    if (insErr) throw new Error(insErr.message);

    // Propagate downstream — mirror runTaskForProject's post-write chain.
    try {
      await normalizeTaskOutput(
        supabase,
        data.projectId,
        task,
        res.data,
        Number(project.duration_seconds) || 0,
      );
      if (task === "scene_plan" || task === "visual_storyboard" || task === "broll") {
        if (task === "visual_storyboard" || task === "broll") {
          await generateAssetCandidatesForProject(supabase, data.projectId);
        }
        await compileTimelineForProject(supabase, data.projectId);
        await buildRenderManifestForProject(supabase, data.projectId);
      }
      if (task === "infographics") {
        await generateAssetCandidatesForProject(supabase, data.projectId);
      }
      if (task === "editorial_decisions") {
        try {
          const { runLayoutDecisionsForProject } = await import("./layout/layout-runner.server");
          await runLayoutDecisionsForProject(supabase, userId, data.projectId);
        } catch (e) { console.warn("layout_decisions run failed", e); }
        try { await generateAssetCandidatesForProject(supabase, data.projectId); }
        catch (e) { console.warn("asset candidates regen after editorial failed", e); }
        try {
          const { composeTimelineForProject } = await import("./timeline/timeline-composer.server");
          await composeTimelineForProject(supabase, data.projectId);
        } catch (e) { console.warn("timeline compose after editorial failed", e); }
        await buildRenderManifestForProject(supabase, data.projectId);
      }
    } catch (e) {
      console.warn(`ai-modify propagation failed for ${task}`, e);
    }

    return { ok: true, task, version: nextVersion, provider: res.provider, model: res.model };
  });
