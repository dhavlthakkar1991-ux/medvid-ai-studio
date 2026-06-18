import type {
  CreateRenderArgs, ProviderJobHandle, ProviderStatusReport, RenderProvider,
} from "./types";

/**
 * MockProvider — simulates a render lifecycle without any external service.
 * Timing is derived from the createdAt embedded in the provider job id, so
 * getRenderStatus() is stateless across server invocations.
 *   providerJobId format: `mock_<renderType>_<createdMs>_<rand>`
 */
const PREVIEW_MS = { prepare: 2000, render: 8000 };
const FULL_MS    = { prepare: 4000, render: 18000 };

function plan(t: "preview" | "full") { return t === "full" ? FULL_MS : PREVIEW_MS; }
function parseJobId(id: string) {
  const m = id.match(/^mock_(preview|full)_(\d+)_/);
  return m ? { renderType: m[1] as "preview" | "full", createdMs: Number(m[2]) } : null;
}

function computeState(id: string): ProviderStatusReport {
  const parsed = parseJobId(id);
  if (!parsed) return { status: "failed", progress: 0, error: "Invalid mock job id" };
  const p = plan(parsed.renderType);
  const elapsed = Date.now() - parsed.createdMs;
  const total = p.prepare + p.render;
  const isPreview = parsed.renderType === "preview";
  const resolution = isPreview ? "1280x720" : "1920x1080";
  if (elapsed < p.prepare) return { status: "preparing", progress: Math.round((elapsed / p.prepare) * 15), resolution };
  if (elapsed < total) {
    const r = (elapsed - p.prepare) / p.render;
    return { status: "rendering", progress: 15 + Math.round(r * 80), resolution };
  }
  return { status: "completed", progress: 100, outputUrl: `mock://renders/${id}.mp4`, resolution };
}

export const mockProvider: RenderProvider = {
  type: "mock",
  name: "Mock Renderer",
  isConfigured: () => true,
  async createRender(args: CreateRenderArgs): Promise<ProviderJobHandle> {
    const providerJobId = `mock_${args.renderType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      providerJobId,
      status: "preparing",
      requestPayload: {
        provider: "mock",
        render_job_id: args.renderJobId,
        project_id: args.projectId,
        render_type: args.renderType,
        spec_summary: {
          item_count: args.spec.items.length,
          asset_count: args.spec.assets.length,
          graphic_count: args.spec.graphics.length,
          caption_count: args.spec.captions.length,
          duration_seconds: args.spec.canvas.duration_seconds,
          canvas: `${args.spec.canvas.width}x${args.spec.canvas.height}`,
        },
      },
      responsePayload: { provider_job_id: providerJobId, accepted_at: new Date().toISOString() },
    };
  },
  async getRenderStatus(providerJobId) { return computeState(providerJobId); },
  async cancelRender() { /* no-op */ },
  async downloadRender(providerJobId) {
    const s = computeState(providerJobId);
    return { url: s.outputUrl ?? null, durationSeconds: null, resolution: s.resolution ?? null };
  },
};