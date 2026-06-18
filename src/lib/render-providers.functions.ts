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
      .from("render_providers").update({ configuration: data.configuration as any }).eq("id", data.providerId);
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
    // Return as a JSON string — RenderSpec contains free-form fields that
    // don't pass TanStack's strict serializer otherwise.
    return { specJson: JSON.stringify(spec) };
  });

/**
 * Build a full render-handoff bundle: RenderSpec + validation report +
 * asset_manifest + graphics_manifest + worker_handoff. Used by the
 * RenderSpec Inspector readiness panels and by the export package.
 */
export const getRenderBundle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ProjectIdInput.parse(i))
  .handler(async ({ context, data }) => {
    const { buildRenderSpec } = await import("./render/render-spec-builder.server");
    const { validateRenderSpec, buildAssetManifest, buildGraphicsManifest, buildWorkerHandoff } =
      await import("./render/render-validation");
    const spec = await buildRenderSpec(context.supabase, data.projectId, { quality: data.quality });
    const validation = validateRenderSpec(spec);
    const assetManifest = buildAssetManifest(spec);
    const graphicsManifest = buildGraphicsManifest(spec);
    const workerHandoff = buildWorkerHandoff(spec, validation);
    return {
      specJson: JSON.stringify(spec),
      validationJson: JSON.stringify(validation),
      assetManifestJson: JSON.stringify(assetManifest),
      graphicsManifestJson: JSON.stringify(graphicsManifest),
      workerHandoffJson: JSON.stringify(workerHandoff),
    };
  });

/**
 * Render Worker status — reads the default/custom_worker provider configuration
 * and the latest provider job to surface "last contact" + version metadata.
 */
export const getRenderWorkerStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const { data: providers } = await sb
      .from("render_providers")
      .select("*")
      .eq("provider_type", "custom_worker")
      .order("is_default", { ascending: false });
    const provider = (providers ?? [])[0] ?? null;
    const cfg = (provider?.configuration ?? {}) as Record<string, any>;
    const workerUrl: string | null = cfg.worker_url ?? cfg.webhook_url ?? null;
    const simulate = Boolean(cfg.simulate_worker);
    const configured = Boolean(workerUrl) || simulate;

    let lastContactAt: string | null = null;
    let lastStatus: string | null = null;
    let version: string | null = cfg.worker_version ?? null;
    if (provider) {
      const { data: jobs } = await sb
        .from("render_provider_jobs")
        .select("status, updated_at, response_payload")
        .eq("provider_id", provider.id)
        .order("updated_at", { ascending: false })
        .limit(1);
      const j = (jobs ?? [])[0] as any;
      if (j) {
        lastContactAt = j.updated_at ?? null;
        lastStatus = j.status ?? null;
        if (!version && j.response_payload?.worker_version) version = String(j.response_payload.worker_version);
      }
    }

    return {
      provider: provider ? { id: provider.id, name: provider.name, enabled: provider.enabled, isDefault: provider.is_default } : null,
      configured,
      simulate,
      workerUrl,
      version,
      lastContactAt,
      lastStatus,
    };
  });

/**
 * Canonical fix for RenderSpec validation issues. Builds the current spec,
 * validates, then applies deterministic repairs (backfill URLs, drop unused/
 * orphan rows, clamp out-of-bounds items) and rebuilds the manifest.
 */
export const fixRenderSpec = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ProjectIdInput.parse(i))
  .handler(async ({ context, data }) => {
    const { data: project, error: projectError } = await context.supabase
      .from("projects")
      .select("id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (projectError) throw new Error(projectError.message);
    if (!project) throw new Error("Project not found");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { buildRenderSpec } = await import("./render/render-spec-builder.server");
    const { validateRenderSpec } = await import("./render/render-validation");
    const { fixRenderSpecIssues } = await import("./render/render-spec-fix.server");
    const spec = await buildRenderSpec(supabaseAdmin, data.projectId, { quality: data.quality });
    const validation = validateRenderSpec(spec);
    const result = await fixRenderSpecIssues(
      supabaseAdmin,
      data.projectId,
      validation,
      spec.canvas.duration_seconds,
    );
    return { ok: true, ...result };
  });