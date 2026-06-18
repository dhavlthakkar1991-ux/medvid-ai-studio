import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("projects")
      .select("id, title, topic, status, duration_seconds, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const ContextSchema = z.object({
  audience: z.string().nullable(),
  specialty: z.string().nullable(),
  brand_voice: z.string().nullable(),
  target_platform: z.string().nullable(),
  content_type: z.string().nullable(),
  visual_style: z.string().nullable(),
  scene_patterns: z.array(z.string()),
  infographic_types: z.array(z.string()),
  broll_types: z.array(z.string()),
  thumbnail_style: z.record(z.string(), z.unknown()),
  render_intent: z.string().nullable(),
  visual_density: z.string().nullable(),
  retention_priority: z.string().nullable(),
  presenter_name: z.string().nullable().optional(),
  grounding_mode: z.string().nullable().optional(),
  template_id: z.string().nullable().optional(),
  specialty_id: z.string().nullable().optional(),
});

const CreateProjectInput = z.object({
  title: z.string().min(1),
  topic: z.string().optional().nullable(),
  specialty_template_id: z.string().nullable(),
  video_path: z.string().nullable(),
  duration_seconds: z.number().nullable(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  fps: z.number().nullable().optional(),
  file_size: z.number().nullable().optional(),
  context: ContextSchema,
});

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateProjectInput.parse(input))
  .handler(async ({ context, data }) => {
    const { data: p, error } = await context.supabase
      .from("projects")
      .insert({
        user_id: context.userId,
        title: data.title,
        topic: data.topic ?? null,
        specialty_template_id: data.specialty_template_id,
        video_path: data.video_path,
        duration_seconds: data.duration_seconds,
        width: data.width ?? null,
        height: data.height ?? null,
        fps: data.fps ?? null,
        file_size: data.file_size ?? null,
        status: "draft",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const ctxRow = {
      project_id: p.id,
      ...data.context,
      grounding_mode: data.context.grounding_mode ?? "strict",
    } as any;
    const { error: cerr } = await context.supabase.from("project_context").insert(ctxRow);
    if (cerr) throw new Error(cerr.message);
    return { id: p.id };
  });

export const getProject = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const [proj, ctx, tx, vers, jobs, usage] = await Promise.all([
      context.supabase.from("projects").select("*").eq("id", data.id).maybeSingle(),
      context.supabase.from("project_context").select("*").eq("project_id", data.id).maybeSingle(),
      context.supabase.from("transcripts").select("*").eq("project_id", data.id).maybeSingle(),
      context.supabase.from("analysis_versions").select("*").eq("project_id", data.id).order("created_at", { ascending: false }),
      context.supabase.from("jobs").select("*").eq("project_id", data.id).order("created_at", { ascending: false }).limit(1),
      context.supabase.from("usage_logs").select("estimated_cost, task, model").eq("project_id", data.id),
    ]);
    if (proj.error) throw new Error(proj.error.message);
    if (!proj.data) return { project: null, context: null, transcript: null, versions: [], latestJob: null, usage: [] };
    const latestJob = jobs.data?.[0] ?? null;
    const terminal = new Set(["completed", "completed_with_warnings", "needs_review", "failed"]);
    const active = new Set(["queued", "transcribing", "analyzing"]);
    if (latestJob && terminal.has(proj.data.status) && active.has(latestJob.state)) {
      latestJob.state = proj.data.status;
      latestJob.progress = 100;
      latestJob.error = null;
    }
    return {
      project: proj.data,
      context: ctx.data,
      transcript: tx.data,
      versions: vers.data ?? [],
      latestJob,
      usage: usage.data ?? [],
    };
  });

export const createUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ filename: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const ext = data.filename.split(".").pop() || "mp4";
    const path = `${context.userId}/${crypto.randomUUID()}.${ext}`;
    const { data: signed, error } = await context.supabase.storage
      .from("videos")
      .createSignedUploadUrl(path);
    if (error) throw new Error(error.message);
    return { path, token: signed.token, signedUrl: signed.signedUrl };
  });

const UpdateTranscriptInput = z.object({
  projectId: z.string(),
  fullText: z.string().min(1),
});

/** Edit the rendered transcript text. Returns updated row. */
export const updateTranscript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpdateTranscriptInput.parse(i))
  .handler(async ({ context, data }) => {
    const { data: proj, error: pErr } = await context.supabase
      .from("projects").select("id, user_id").eq("id", data.projectId).maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!proj || proj.user_id !== context.userId) throw new Error("Project not found");
    const { error } = await context.supabase
      .from("transcripts")
      .update({ full_text: data.fullText, updated_at: new Date().toISOString() })
      .eq("project_id", data.projectId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Return a short-lived signed URL for the project's source video. */
export const getProjectVideoUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ projectId: z.string().uuid() }).parse(i))
  .handler(async ({ context, data }) => {
    const { data: p, error } = await context.supabase
      .from("projects").select("id, user_id, video_path")
      .eq("id", data.projectId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!p || p.user_id !== context.userId) throw new Error("Project not found");
    if (!p.video_path) throw new Error("No video uploaded");
    const { data: signed, error: sErr } = await context.supabase.storage
      .from("videos").createSignedUrl(p.video_path, 60 * 10);
    if (sErr) throw new Error(sErr.message);
    return { url: signed.signedUrl };
  });

const SetDurationInput = z.object({
  projectId: z.string().uuid(),
  durationSeconds: z.number().positive().max(60 * 60 * 4),
});

/**
 * Authoritative override for projects.duration_seconds.
 * Also re-composes the multi-track timeline and rebuilds the render manifest
 * so the presenter-video track and downstream readiness reflect the real
 * length immediately.
 */
export const setProjectDuration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SetDurationInput.parse(i))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const { data: p, error } = await sb
      .from("projects").select("id, user_id, duration_seconds")
      .eq("id", data.projectId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!p || p.user_id !== context.userId) throw new Error("Project not found");
    const duration = Math.round(data.durationSeconds * 1000) / 1000;
    const previous = Number(p.duration_seconds) || 0;
    const { error: uErr } = await sb
      .from("projects").update({ duration_seconds: duration }).eq("id", data.projectId);
    if (uErr) throw new Error(uErr.message);

    let composed: any = null;
    let manifest = false;
    let manifestError: string | null = null;
    try {
      const { composeTimelineForProject } = await import("./timeline/timeline-composer.server");
      composed = await composeTimelineForProject(sb, data.projectId);
    } catch (e: any) {
      console.warn("composeTimeline failed after duration update", e);
    }
    try {
      const { buildRenderManifestForProject } = await import("./render/timeline-builder.server");
      await buildRenderManifestForProject(sb, data.projectId);
      manifest = true;
    } catch (e: any) {
      manifestError = e?.message ?? "manifest build failed";
    }
    return { ok: true, previous, duration, composed, manifest, manifestError };
  });
