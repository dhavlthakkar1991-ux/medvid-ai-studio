import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/jobs/run/$jobId")({
  server: {
    handlers: {
      POST: async ({ params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { transcribeAudio } = await import("@/lib/ai/providers.server");
        const { runTaskForProject, ALL_TASKS } = await import("@/lib/analysis-runner.server");

        const jobId = params.jobId;
        const { data: job } = await supabaseAdmin.from("jobs").select("*").eq("id", jobId).single();
        if (!job) return new Response("job not found", { status: 404 });
        const { data: project } = await supabaseAdmin.from("projects").select("*").eq("id", job.project_id).single();
        if (!project) return new Response("project not found", { status: 404 });
        const { data: settings } = await supabaseAdmin.from("ai_settings").select("*").eq("user_id", project.user_id).maybeSingle();

        const setState = async (state: string, progress: number, error: string | null = null) =>
          supabaseAdmin.from("jobs").update({ state, progress, error }).eq("id", jobId);

        try {
          // Transcription
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

          const txProvider = (settings?.default_transcription_provider as any) ?? "openai";
          const keys = (settings?.provider_keys as Record<string, string>) ?? {};
          const tx = await transcribeAudio(txProvider === "lovable" ? "openai" : txProvider, keys, blob, project.video_path.split("/").pop()!);

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

          // Analysis (run sequentially to respect token order; ~5-15s each)
          await setState("analyzing", 40);
          await supabaseAdmin.from("projects").update({ status: "analyzing" }).eq("id", project.id);

          for (let i = 0; i < ALL_TASKS.length; i++) {
            const t = ALL_TASKS[i];
            try {
              await runTaskForProject(supabaseAdmin, project.user_id, project.id, t);
            } catch (e) {
              console.error(`task ${t} failed`, e);
            }
            await setState("analyzing", 40 + Math.round(((i + 1) / ALL_TASKS.length) * 55));
          }

          await setState("completed", 100);
          await supabaseAdmin.from("projects").update({ status: "completed" }).eq("id", project.id);
          return new Response("ok");
        } catch (e: any) {
          console.error("job run failed", e);
          await setState("failed", 0, String(e?.message ?? e));
          await supabaseAdmin.from("projects").update({ status: "failed" }).eq("id", project.id);
          return new Response("failed", { status: 500 });
        }
      },
    },
  },
});
