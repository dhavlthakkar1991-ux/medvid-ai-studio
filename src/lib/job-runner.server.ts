export async function runAnalysisJob(jobId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { transcribeAudio } = await import("@/lib/ai/providers.server");
  const { runTaskForProject, ALL_TASKS } = await import("@/lib/analysis-runner.server");
  const { writeTranscriptSegments } = await import("@/lib/analysis/normalize.server");
  const { buildRenderManifestForProject } = await import("@/lib/render/timeline-builder.server");

  const { data: job } = await supabaseAdmin.from("jobs").select("*").eq("id", jobId).single();
  if (!job) return { body: "job not found", status: 404 };
  const { data: project } = await supabaseAdmin.from("projects").select("*").eq("id", job.project_id).single();
  if (!project) return { body: "project not found", status: 404 };
  const { data: settings } = await supabaseAdmin.from("ai_settings").select("*").eq("user_id", project.user_id).maybeSingle();

  const setState = async (state: string, progress: number, error: string | null = null) =>
    supabaseAdmin.from("jobs").update({ state, progress, error }).eq("id", jobId);

  // Create pipeline_run for this execution.
  const pipelineStartedAt = new Date();
  const { data: pipelineRun } = await supabaseAdmin
    .from("pipeline_runs")
    .insert({ project_id: project.id, pipeline_version: "v2", status: "running" })
    .select("id")
    .single();
  const pipelineRunId: string | null = pipelineRun?.id ?? null;

  try {
    await setState("transcribing", 10);
    await supabaseAdmin.from("projects").update({ status: "transcribing" }).eq("id", project.id);

    if (!project.video_path) throw new Error("No video uploaded.");
    const { data: signed, error: dlErr } = await supabaseAdmin.storage
      .from("videos")
      .createSignedUrl(project.video_path, 60 * 60);
    if (dlErr || !signed) throw new Error(dlErr?.message ?? "Failed to read video.");
    const audioRes = await fetch(signed.signedUrl);
    if (!audioRes.ok) throw new Error(`Could not fetch uploaded video (${audioRes.status}).`);
    const blob = await audioRes.blob();

    const keys = (settings?.provider_keys as Record<string, string>) ?? {};
    const preferredProvider = String(settings?.default_transcription_provider ?? "openai") === "lovable"
      ? "openai"
      : String(settings?.default_transcription_provider ?? "openai");
    const implementedProviders = ["openai", "groq", "gemini"];
    const txProvider = implementedProviders.includes(preferredProvider) && keys[preferredProvider]
      ? preferredProvider
      : keys.gemini
        ? "gemini"
        : keys.openai
          ? "openai"
          : keys.groq
            ? "groq"
            : preferredProvider;
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Transcription timed out. Please retry with a shorter video or a dedicated transcription provider.")), 120000);
    });
    const tx = await Promise.race([
      transcribeAudio(txProvider as any, keys, blob, project.video_path.split("/").pop()!),
      timeout,
    ]);

    await supabaseAdmin.from("transcripts").upsert({
      project_id: project.id,
      full_text: tx.text,
      words: tx.words as any,
      language: tx.language,
      provider_used: tx.provider,
    });
    if (tx.durationSeconds) {
      await supabaseAdmin.from("projects").update({ duration_seconds: tx.durationSeconds }).eq("id", project.id);
    }
    // Populate canonical transcript_segments for the rendering layer.
    try {
      await writeTranscriptSegments(
        supabaseAdmin,
        project.id,
        tx.text,
        tx.words,
        tx.durationSeconds || Number(project.duration_seconds) || 0,
      );
    } catch (e) {
      console.warn("transcript segmentation failed", e);
    }

    await setState("analyzing", 40);
    await supabaseAdmin.from("projects").update({ status: "analyzing" }).eq("id", project.id);

    const taskOutcomes: Array<{ task: string; valid: boolean; fallbackUsed: boolean; errored: boolean }> = [];
    for (let i = 0; i < ALL_TASKS.length; i++) {
      const task = ALL_TASKS[i];
      try {
        const out = await runTaskForProject(supabaseAdmin, project.user_id, project.id, task, { pipelineRunId });
        taskOutcomes.push({ task, valid: out.validation?.valid ?? true, fallbackUsed: !!out.fallbackUsed, errored: false });
      } catch (error) {
        console.error(`task ${task} failed`, error);
        taskOutcomes.push({ task, valid: false, fallbackUsed: false, errored: true });
      }
      await setState("analyzing", 40 + Math.round(((i + 1) / ALL_TASKS.length) * 55));
    }

    // Final canonical manifest build (defensive; runner already rebuilds after each contributing task).
    try {
      // Ensure layout decisions exist for every edit_action before final manifest build.
      const { runLayoutDecisionsForProject } = await import("@/lib/layout/layout-runner.server");
      await runLayoutDecisionsForProject(supabaseAdmin, project.user_id, project.id);
      await buildRenderManifestForProject(supabaseAdmin, project.id);
    } catch (e) {
      console.warn("final layout/manifest build failed", e);
    }

    // Decide project + pipeline status.
    const { CRITICAL_TASKS } = await import("@/lib/qa/validators");
    const criticalFailures = taskOutcomes
      .filter((o) => (CRITICAL_TASKS as string[]).includes(o.task) && (o.errored || !o.valid))
      .map((o) => o.task);
    const warnings = taskOutcomes.filter((o) => !o.valid || o.fallbackUsed).map((o) => o.task);
    const projectStatus = criticalFailures.length > 0
      ? "needs_review"
      : warnings.length > 0
        ? "completed_with_warnings"
        : "completed";
    await setState("completed", 100);
    await supabaseAdmin.from("projects").update({ status: projectStatus }).eq("id", project.id);

    const completedAt = new Date();
    if (pipelineRunId) {
      await supabaseAdmin.from("pipeline_runs").update({
        status: projectStatus,
        completed_at: completedAt.toISOString(),
        duration_ms: completedAt.getTime() - pipelineStartedAt.getTime(),
        warnings_count: warnings.length,
        failures_count: taskOutcomes.filter((o) => o.errored || !o.valid).length,
        critical_failures: criticalFailures,
      }).eq("id", pipelineRunId);
    }
    return { body: "ok", status: 200 };
  } catch (error: any) {
    console.error("job run failed", error);
    await setState("failed", 0, String(error?.message ?? error));
    await supabaseAdmin.from("projects").update({ status: "failed" }).eq("id", project.id);
    if (pipelineRunId) {
      const completedAt = new Date();
      await supabaseAdmin.from("pipeline_runs").update({
        status: "failed",
        completed_at: completedAt.toISOString(),
        duration_ms: completedAt.getTime() - pipelineStartedAt.getTime(),
      }).eq("id", pipelineRunId);
    }
    return { body: "failed", status: 500 };
  }
}
