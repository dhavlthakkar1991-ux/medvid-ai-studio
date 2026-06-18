/**
 * Render Adapter — single entry point for all rendering.
 *
 *   Manifest V6 → buildRenderSpec() → RenderSpec → Adapter → Provider
 *
 * Server functions and webhooks only ever talk to the adapter. No
 * provider-specific knowledge leaks above this layer.
 */
import { buildRenderSpec } from "./render-spec-builder.server";
import type { RenderSpec } from "./render-spec";
import { mockProvider } from "./providers/mock-provider.server";
import { creatomateProvider } from "./providers/creatomate-provider.server";
import { shotstackProvider } from "./providers/shotstack-provider.server";
import { customWorkerProvider } from "./providers/custom-worker-provider.server";
import type { ProviderType, RenderProvider, ProviderStatusReport } from "./providers/types";

type Sb = any;

const REGISTRY: Record<ProviderType, RenderProvider> = {
  mock: mockProvider,
  creatomate: creatomateProvider,
  shotstack: shotstackProvider,
  custom_worker: customWorkerProvider,
};

export function getProviderByType(type: ProviderType): RenderProvider {
  const p = REGISTRY[type];
  if (!p) throw new Error(`Unknown provider type: ${type}`);
  return p;
}

export async function resolveDefaultProviderRow(sb: Sb) {
  const { data: rows } = await sb
    .from("render_providers").select("*")
    .eq("enabled", true).order("is_default", { ascending: false });
  if (rows && rows.length > 0) return rows[0];
  const { data: fallback } = await sb
    .from("render_providers").select("*").eq("provider_type", "mock").limit(1).maybeSingle();
  if (!fallback) throw new Error("No render providers configured (mock missing).");
  return fallback;
}

export async function adapterCreateRender(
  sb: Sb,
  args: { projectId: string; renderJobId: string; renderType: "preview" | "full" },
): Promise<{ providerRow: any; providerJobId: string; spec: RenderSpec }> {
  const providerRow = await resolveDefaultProviderRow(sb);
  const impl = getProviderByType(providerRow.provider_type as ProviderType);
  const spec = await buildRenderSpec(sb, args.projectId, { quality: args.renderType });

  const handle = await impl.createRender({
    spec, renderType: args.renderType,
    projectId: args.projectId, renderJobId: args.renderJobId,
    configuration: providerRow.configuration ?? {},
  });

  await Promise.all([
    sb.from("render_provider_jobs").insert({
      render_job_id: args.renderJobId,
      provider_id: providerRow.id,
      provider_job_id: handle.providerJobId,
      status: handle.status,
      request_payload: handle.requestPayload,
      response_payload: handle.responsePayload,
      logs: [{ at: new Date().toISOString(), level: "info", msg: `Created render via ${impl.name}` }],
    }),
    sb.from("render_jobs").update({
      provider: providerRow.provider_type,
      provider_id: providerRow.id,
      provider_job_id: handle.providerJobId,
      render_spec: spec,
      manifest_version: 6,
    }).eq("id", args.renderJobId),
  ]);

  return { providerRow, providerJobId: handle.providerJobId, spec };
}

export async function adapterPoll(
  sb: Sb, renderJobId: string,
): Promise<{ status: string; progress: number; report: ProviderStatusReport | null }> {
  const { data: pj } = await sb
    .from("render_provider_jobs").select("*, render_providers(*)")
    .eq("render_job_id", renderJobId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!pj || !pj.provider_job_id) return { status: "queued", progress: 0, report: null };
  const providerRow = pj.render_providers ?? (await sb
    .from("render_providers").select("*").eq("id", pj.provider_id).maybeSingle()).data;
  const impl = getProviderByType(providerRow.provider_type as ProviderType);
  const report = await impl.getRenderStatus(pj.provider_job_id, {
    renderJobId, configuration: providerRow.configuration ?? {},
  });
  await sb.from("render_provider_jobs")
    .update({ status: report.status, response_payload: { ...(pj.response_payload ?? {}), last_report: report } })
    .eq("id", pj.id);
  return { status: report.status, progress: report.progress, report };
}

export async function adapterCancel(sb: Sb, renderJobId: string): Promise<void> {
  const { data: pj } = await sb
    .from("render_provider_jobs").select("*")
    .eq("render_job_id", renderJobId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!pj || !pj.provider_job_id) return;
  const { data: providerRow } = await sb
    .from("render_providers").select("*").eq("id", pj.provider_id).maybeSingle();
  const impl = getProviderByType(providerRow.provider_type as ProviderType);
  try {
    await impl.cancelRender(pj.provider_job_id, {
      renderJobId, configuration: providerRow.configuration ?? {},
    });
  } catch (e) { console.warn("provider cancel failed", e); }
  await sb.from("render_provider_jobs").update({ status: "cancelled" }).eq("id", pj.id);
}

export async function adapterDownload(
  sb: Sb, renderJobId: string,
): Promise<{ url: string | null; durationSeconds?: number | null; resolution?: string | null }> {
  const { data: pj } = await sb
    .from("render_provider_jobs").select("*, render_providers(*)")
    .eq("render_job_id", renderJobId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!pj || !pj.provider_job_id) return { url: null };
  const providerRow = pj.render_providers ?? (await sb
    .from("render_providers").select("*").eq("id", pj.provider_id).maybeSingle()).data;
  const impl = getProviderByType(providerRow.provider_type as ProviderType);
  return impl.downloadRender(pj.provider_job_id, {
    renderJobId, configuration: providerRow.configuration ?? {},
  });
}