import { ProviderNotConfiguredError, type ProviderRenderStatus, type RenderProvider } from "./types";
import { specToCreatomate } from "../transformers/creatomate-transformer";

const API_BASE = "https://api.creatomate.com/v1";

function apiKey(): string {
  const k = process.env.CREATOMATE_API_KEY;
  if (!k) throw new ProviderNotConfiguredError("Creatomate", "Add CREATOMATE_API_KEY in project secrets.");
  return k;
}

function mapStatus(s: string | undefined): ProviderRenderStatus {
  switch (s) {
    case "planned":
    case "waiting":
      return "queued";
    case "transcribing":
    case "rendering":
      return "rendering";
    case "succeeded":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    default:
      return "preparing";
  }
}

function deriveResolution(width: number | undefined, height: number | undefined) {
  if (!width || !height) return null;
  return `${width}x${height}`;
}

async function creatomateFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const msg = (body && (body.message || body.error)) || `Creatomate ${res.status}`;
    throw new Error(`${msg}`);
  }
  return body;
}

export const creatomateProvider: RenderProvider = {
  type: "creatomate",
  name: "Creatomate",
  isConfigured() { return Boolean(process.env.CREATOMATE_API_KEY); },

  async createRender(args) {
    const source = specToCreatomate(args.spec);
    const cfg = args.configuration ?? {};
    const webhookUrl = (cfg.webhook_url as string | undefined) ?? process.env.CREATOMATE_WEBHOOK_URL;

    const body: Record<string, unknown> = {
      source,
      metadata: JSON.stringify({
        render_job_id: args.renderJobId,
        project_id: args.projectId,
        render_type: args.renderType,
      }),
    };
    if (webhookUrl) body.webhook_url = webhookUrl;

    const response = await creatomateFetch("/renders", {
      method: "POST",
      body: JSON.stringify(body),
    });

    // Creatomate returns either an object or an array of renders.
    const first = Array.isArray(response) ? response[0] : response;
    if (!first?.id) throw new Error("Creatomate response missing render id");

    return {
      providerJobId: String(first.id),
      status: mapStatus(first.status),
      requestPayload: {
        provider: "creatomate",
        render_job_id: args.renderJobId,
        project_id: args.projectId,
        render_type: args.renderType,
        element_count: source.elements.length,
        canvas: `${source.width}x${source.height}`,
        duration_seconds: source.duration,
        webhook_url: webhookUrl ?? null,
      },
      responsePayload: { creatomate: first },
    };
  },

  async getRenderStatus(providerJobId) {
    const r = await creatomateFetch(`/renders/${encodeURIComponent(providerJobId)}`);
    return {
      status: mapStatus(r.status),
      progress: typeof r.percentage === "number"
        ? Math.round(r.percentage)
        : (r.status === "succeeded" ? 100 : 0),
      outputUrl: r.url ?? null,
      thumbnailUrl: r.snapshot_url ?? null,
      durationSeconds: typeof r.duration === "number" ? r.duration : null,
      resolution: deriveResolution(r.width, r.height),
      error: r.error_message ?? null,
      raw: r,
    };
  },

  async cancelRender(providerJobId) {
    // Creatomate does not expose a cancel endpoint. Best-effort: do nothing
    // remotely and let the adapter mark the local row as cancelled. A future
    // delete call would be: DELETE /v1/renders/{id} (returns 405 today).
    try {
      await creatomateFetch(`/renders/${encodeURIComponent(providerJobId)}`, { method: "DELETE" });
    } catch {
      /* swallow — provider has no real cancel */
    }
  },

  async downloadRender(providerJobId) {
    const r = await creatomateFetch(`/renders/${encodeURIComponent(providerJobId)}`);
    return {
      url: r.url ?? null,
      durationSeconds: typeof r.duration === "number" ? r.duration : null,
      resolution: deriveResolution(r.width, r.height),
    };
  },
};