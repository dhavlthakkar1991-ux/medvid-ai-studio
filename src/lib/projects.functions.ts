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
    return {
      project: proj.data,
      context: ctx.data,
      transcript: tx.data,
      versions: vers.data ?? [],
      latestJob: jobs.data?.[0] ?? null,
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
