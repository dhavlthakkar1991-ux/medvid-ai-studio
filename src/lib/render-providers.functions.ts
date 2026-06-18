import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** List render providers visible to any signed-in user. */
export const listRenderProviders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("render_providers").select("*").order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { providers: data ?? [] };
  });

const ToggleInput = z.object({ providerId: z.string().uuid(), enabled: z.boolean() });
export const setRenderProviderEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ToggleInput.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("render_providers").update({ enabled: data.enabled }).eq("id", data.providerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const DefaultInput = z.object({ providerId: z.string().uuid() });
export const setDefaultRenderProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => DefaultInput.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("render_providers").update({ is_default: false }).neq("id", data.providerId);
    const { error } = await supabaseAdmin
      .from("render_providers").update({ is_default: true, enabled: true }).eq("id", data.providerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const ConfigInput = z.object({ providerId: z.string().uuid(), configuration: z.record(z.unknown()) });
export const updateRenderProviderConfiguration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ConfigInput.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("render_providers").update({ configuration: data.configuration }).eq("id", data.providerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const InspectInput = z.object({ renderJobId: z.string().uuid() });
export const getProviderJobForRender = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => InspectInput.parse(i))
  .handler(async ({ context, data }) => {
    const { data: pj } = await context.supabase
      .from("render_provider_jobs")
      .select("*, render_providers(*)")
      .eq("render_job_id", data.renderJobId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    return { providerJob: pj ?? null };
  });

/** Preview a RenderSpec for a project — useful in debug panels. */
const ProjectIdInput = z.object({ projectId: z.string().uuid(), quality: z.enum(["preview","full"]).default("full") });
export const previewRenderSpec = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ProjectIdInput.parse(i))
  .handler(async ({ context, data }) => {
    const { buildRenderSpec } = await import("./render/render-spec-builder.server");
    const spec = await buildRenderSpec(context.supabase, data.projectId, { quality: data.quality });
    return { spec };
  });