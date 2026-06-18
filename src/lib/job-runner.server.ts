/**
 * Step-based, resumable pipeline runner.
 *
 * One HTTP invocation processes a single step (transcribe OR one analysis task
 * OR finalize) and returns. The client polls and re-fires the runner URL until
 * the job reaches `completed` / `completed_with_warnings` / `needs_review` / `failed`.
 *
 * This keeps each Worker invocation well under runtime limits.
 */
export async function runAnalysisJob(jobId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { transcribeAudio } = await import("@/lib/ai/providers.server");
  const { runTaskForProject, ALL_TASKS } = await import("@/lib/analysis-runner.server");
  const { writeTranscriptSegments } = await import("@/lib/analysis/normalize.server");
  const { buildRenderManifestForProject } = await import("@/lib/render/timeline-builder.server");

  const { data: job } = await supabaseAdmin.from("jobs").select("*").eq("id", jobId).single();
  if (!job) return { body: "job not found", status: 404 };
  if (["completed", "completed_with_warnings", "needs_review", "failed"].includes(job.state)) {
    return { body: "done", status: 200 };
  }
  const { data: project } = await supabaseAdmin.from("projects").select("*").eq("id", job.project_id).single();
  if (!project) return { body: "project not found", status: 404 };
  const { data: settings } = await supabaseAdmin.from("ai_settings").select("*").eq("user_id", project.user_id).maybeSingle();

  const setState = async (state: string, progress: number, error: string | null = null) =>
    supabaseAdmin.from("jobs").update({ state, progress, error }).eq("id", jobId);

  // Find or create the active pipeline_run for this project.
  let pipelineRunId: string | null = null;
  let pipelineStartedAt: Date | null = null;
  {
    const { data: existing } = await supabaseAdmin
      .from("pipeline_runs")
      .select("id, started_at")
      .eq("project_id", project.id)
      .eq("status", "running")
      .order("started_at", { ascending: false })
      .limit(1);
    if (existing && existing.length > 0) {
      pipelineRunId = existing[0].id;
      pipelineStartedAt = new Date(existing[0].started_at);
    } else {
      const { data: pr } = await supabaseAdmin
        .from("pipeline_runs")
        .insert({ project_id: project.id, pipeline_version: "v2", status: "running" })
        .select("id, started_at")
        .single();
      pipelineRunId = pr?.id ?? null;
      pipelineStartedAt = pr?.started_at ? new Date(pr.started_at) : new Date();
    }
  }
  if (!pipelineRunId) {
    await setState("failed", 0, "Could not create pipeline run.");
    return { body: "pipeline_run_failed", status: 500 };
  }
  const runId: string = pipelineRunId;

  try {
    // ---- STEP 1: transcribe if needed -----------------------------------
    const { data: existingTx } = await supabaseAdmin
      .from("transcripts")
      .select("full_text")
      .eq("project_id", project.id)
      .maybeSingle();

    if (!existingTx || !existingTx.full_text) {
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
      const preferredProvider = String(settings?.default_transcription_provider ?? "lovable");
      const implementedProviders = ["lovable", "openai", "groq", "gemini"];
      const txProvider = implementedProviders.includes(preferredProvider) && keys[preferredProvider]
        ? preferredProvider
        : preferredProvider === "lovable" ? "lovable" : keys.openai ? "openai" : keys.groq ? "groq" : keys.gemini ? "gemini" : "lovable";

      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Transcription timed out.")), 120000);
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
      // Persist duration. Prefer the project value (extracted client-side at
      // upload from the actual video file), then the provider value, then
      // word timings, then a word-count estimate (~2.5 words/sec).
      let resolvedDuration = Number(project.duration_seconds) || 0;
      if (!resolvedDuration) resolvedDuration = Number(tx.durationSeconds) || 0;
      if (!resolvedDuration && Array.isArray(tx.words) && tx.words.length > 0) {
        resolvedDuration = Number(tx.words[tx.words.length - 1]?.end) || 0;
      }
      if (!resolvedDuration && tx.text) {
        const wc = tx.text.trim().split(/\s+/).filter(Boolean).length;
        if (wc > 0) resolvedDuration = Math.max(15, Math.round(wc / 2.5));
      }
      if (resolvedDuration && !Number(project.duration_seconds)) {
        await supabaseAdmin.from("projects").update({ duration_seconds: resolvedDuration }).eq("id", project.id);
        project.duration_seconds = resolvedDuration;
      } else if (resolvedDuration) {
        project.duration_seconds = resolvedDuration;
      }
      try {
        await writeTranscriptSegments(
          supabaseAdmin,
          project.id,
          tx.text,
          tx.words,
          resolvedDuration || Number(project.duration_seconds) || 0,
        );
      } catch (e) {
        console.warn("transcript segmentation failed", e);
      }

      await setState("analyzing", 20);
      await supabaseAdmin.from("projects").update({ status: "analyzing" }).eq("id", project.id);
      return { body: "transcribed", status: 200 };
    }

    // ---- STEP 2: run the next pending analysis task ---------------------
    const { data: execRows } = await supabaseAdmin
      .from("task_executions")
      .select("id, task_name, status, started_at, retry_count, attempts")
      .eq("project_id", project.id)
      .eq("pipeline_run_id", runId);
    // Mark stale "running" rows as failed so the pipeline can retry/skip them.
    // A worker invocation can die mid-task (timeout, crash) and leave the row
    // in `running` forever, which blocks progress and causes endless polling.
    const STALE_MS = 150_000; // long enough for slow AI calls, short enough to auto-recover
    const now = Date.now();
    const stale = (execRows ?? []).filter(
      (r: any) => r.status === "running" && r.started_at && now - new Date(r.started_at).getTime() > STALE_MS,
    );
    for (const r of stale) {
      await supabaseAdmin.from("task_executions").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: "Task timed out — worker invocation did not complete.",
      }).eq("id", r.id);
      (r as any).status = "failed";
    }
    const activeRunning = (execRows ?? []).filter((r: any) => r.status === "running");
    if (activeRunning.length > 0) {
      // Duplicate invocations can happen from browser refreshes or callback races.
      // Do not treat an in-flight task as complete; otherwise the runner can skip
      // ahead and start dependent tasks out of order.
      return { body: `busy:${activeRunning[0].task_name}`, status: 200 };
    }
    const isRetryableFailed = (r: any) =>
      r.status === "failed" &&
      (Number(r.retry_count) || 0) < 1 &&
      (!Array.isArray(r.attempts) || r.attempts.length === 0);
    const doneSet = new Set(
      (execRows ?? [])
        .filter(
          (r: any) =>
            r.status === "completed" ||
            r.status === "completed_with_warnings" ||
            (r.status === "failed" && !isRetryableFailed(r)),
        )
        .map((r: any) => r.task_name as string),
    );
    const pending = ALL_TASKS.filter((t) => !doneSet.has(t));

    if (pending.length > 0) {
      const task = pending[0];
      const doneCount = ALL_TASKS.length - pending.length;
      await setState("analyzing", 20 + Math.round((doneCount / ALL_TASKS.length) * 70));
      const retryable = (execRows ?? []).find((r: any) => r.task_name === task && isRetryableFailed(r));
      const claimQuery = retryable
        ? supabaseAdmin
            .from("task_executions")
            .update({
              status: "running",
              started_at: new Date().toISOString(),
              completed_at: null,
              error_message: null,
              retry_count: (Number(retryable.retry_count) || 0) + 1,
            })
            .eq("id", retryable.id)
        : supabaseAdmin.from("task_executions").insert({
            pipeline_run_id: runId,
            project_id: project.id,
            task_name: task,
            status: "running",
            provider: "pending",
            model: "pending",
            attempts: [],
          });
      const { data: claimed, error: claimError } = await claimQuery.select("id").single();
      if (claimError || !claimed) {
        // Another runner invocation claimed this task first. Return cleanly; the
        // browser poller will pick up the next progress update instead of
        // launching duplicate AI calls.
        return { body: `claimed:${task}`, status: 200 };
      }
      try {
        await runTaskForProject(supabaseAdmin, project.user_id, project.id, task, { pipelineRunId, executionId: claimed.id });
      } catch (error) {
        console.error(`task ${task} failed`, error);
        // Record a synthetic failed execution so we don't loop on this task.
        try {
          await supabaseAdmin.from("task_executions").update({
            provider: "unknown",
            model: "unknown",
            status: "failed",
            completed_at: new Date().toISOString(),
            duration_ms: 0,
            retry_count: 1,
            fallback_used: false,
            error_message: String((error as any)?.message ?? error),
            attempts: [],
          }).eq("id", claimed.id);
        } catch {}
      }
      await setState("analyzing", 20 + Math.round(((doneCount + 1) / ALL_TASKS.length) * 70));
      if (doneCount + 1 < ALL_TASKS.length) {
        return { body: `task:${task}`, status: 200 };
      }
      // Last task is done; finalize in the same invocation so the pipeline
      // cannot sit at 90% waiting for one more external retry/nudge.
    }

    // ---- STEP 3: finalize -----------------------------------------------
    try {
      const { runLayoutDecisionsForProject } = await import("@/lib/layout/layout-runner.server");
      await runLayoutDecisionsForProject(supabaseAdmin, project.user_id, project.id);
      await buildRenderManifestForProject(supabaseAdmin, project.id);
    } catch (e) {
      console.warn("final layout/manifest build failed", e);
    }

    const { CRITICAL_TASKS } = await import("@/lib/qa/validators");
    const { data: finalExecs } = await supabaseAdmin
      .from("task_executions")
      .select("task_name, status, fallback_used, validation_passed")
      .eq("project_id", project.id)
      .eq("pipeline_run_id", runId);
    const outcomes = (finalExecs ?? []).map((r: any) => ({
      task: r.task_name as string,
      valid: r.status !== "failed" && r.validation_passed !== false,
      fallbackUsed: !!r.fallback_used,
      errored: r.status === "failed",
    }));
    const criticalFailures = outcomes
      .filter((o) => (CRITICAL_TASKS as string[]).includes(o.task) && (o.errored || !o.valid))
      .map((o) => o.task);
    const warnings = outcomes.filter((o) => !o.valid || o.fallbackUsed).map((o) => o.task);
    const projectStatus = criticalFailures.length > 0
      ? "needs_review"
      : warnings.length > 0
        ? "completed_with_warnings"
        : "completed";

    await setState(projectStatus, 100);
    await supabaseAdmin.from("projects").update({ status: projectStatus }).eq("id", project.id);

    const completedAt = new Date();
    if (pipelineRunId) {
      await supabaseAdmin.from("pipeline_runs").update({
        status: projectStatus,
        completed_at: completedAt.toISOString(),
        duration_ms: completedAt.getTime() - (pipelineStartedAt?.getTime() ?? completedAt.getTime()),
        warnings_count: warnings.length,
        failures_count: outcomes.filter((o) => o.errored || !o.valid).length,
        critical_failures: criticalFailures,
      }).eq("id", pipelineRunId);
    }
    return { body: "ok", status: 200 };
  } catch (error: any) {
    console.error("job step failed", error);
    const message = String(error?.message ?? error);
    await setState("failed", 0, message);
    await supabaseAdmin.from("projects").update({ status: "failed" }).eq("id", project.id);
    if (pipelineRunId) {
      const completedAt = new Date();
      await supabaseAdmin.from("pipeline_runs").update({
        status: "failed",
        completed_at: completedAt.toISOString(),
        duration_ms: completedAt.getTime() - (pipelineStartedAt?.getTime() ?? completedAt.getTime()),
      }).eq("id", pipelineRunId);
    }
    return { body: message, status: 200 };
  }
}
