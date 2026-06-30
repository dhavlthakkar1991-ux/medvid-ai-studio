import { createHmac } from "crypto";
import { ProviderNotConfiguredError, type CreateRenderArgs, type ProviderJobHandle, type ProviderStatusReport, type RenderProvider } from "./types";
import { specToWorkerCompatGraph } from "../transformers/worker-compat-transformer";

/**
 * CustomWorkerProvider
 *
 *   RenderSpec → POST {worker_url}/render → external worker
 *   external worker → POST /api/public/render-callback → render_provider_jobs
 *
 * The request still includes the historical `ffmpeg_graph` field for payload
 * compatibility. Primary workers should consume `spec` directly and render via
 * the HyperFrames/Remotion workflow.
 *
 * Configuration keys (stored on render_providers.configuration):
 *   - worker_url            string  (required unless simulate_worker)
 *   - callback_url          string  required unless simulate_worker; full URL the worker posts back to
 *   - timeout_ms            number  default 30000
 *   - simulate_worker       boolean default false — skip the HTTP POST and
 *                                   advance the job via timestamp (like mock)
 *   - api_token             string  optional bearer token sent to the worker
 *
 * Secrets:
 *   - CUSTOM_WORKER_SECRET  HMAC-SHA256 signing secret. Worker MUST sign
 *                           callbacks with the same secret using header
 *                           `x-render-signature`.
 */

const SIM_PREFIX = "cw_sim_";
const SIM_TIMING = { prepare: 2000, render: 8000 };

function getConfig(c: Record<string, unknown>) {
  return {
    workerUrl: (c.worker_url ?? c.webhook_url ?? "") as string,
    callbackUrl: (c.callback_url ?? "") as string,
    timeoutMs: Number(c.timeout_ms ?? 30000),
    simulate: Boolean(c.simulate_worker ?? false),
    apiToken: (c.api_token ?? "") as string,
  };
}

function sign(body: string) {
  const secret = process.env.CUSTOM_WORKER_SECRET ?? "";
  if (!secret) return null;
  return createHmac("sha256", secret).update(body).digest("hex");
}

function simulateStatus(providerJobId: string, resolution: string): ProviderStatusReport {
  const m = providerJobId.match(/^cw_sim_(\d+)_/);
  if (!m) return { status: "failed", progress: 0, error: "Invalid simulated job id" };
  const elapsed = Date.now() - Number(m[1]);
  const total = SIM_TIMING.prepare + SIM_TIMING.render;
  if (elapsed < SIM_TIMING.prepare) {
    return { status: "preparing", progress: Math.round((elapsed / SIM_TIMING.prepare) * 15), resolution };
  }
  if (elapsed < total) {
    const r = (elapsed - SIM_TIMING.prepare) / SIM_TIMING.render;
    return { status: "rendering", progress: 15 + Math.round(r * 80), resolution };
  }
  return {
    status: "completed", progress: 100, resolution,
    outputUrl: `custom-worker-sim://renders/${providerJobId}.mp4`,
  };
}

async function fetchLastCallback(providerJobId: string): Promise<Record<string, any> | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("render_provider_jobs").select("response_payload, status")
      .eq("provider_job_id", providerJobId).maybeSingle();
    if (!data) return null;
    const rp: any = data.response_payload ?? {};
    return { ...(rp.last_callback ?? {}), _stored_status: data.status };
  } catch (e) {
    console.warn("custom-worker: fetchLastCallback failed", e);
    return null;
  }
}

export const customWorkerProvider: RenderProvider = {
  type: "custom_worker",
  name: "Custom Worker",
  isConfigured(configuration) {
    const c = getConfig(configuration ?? {});
    if (c.simulate) return true;
    return Boolean(c.workerUrl) && Boolean(c.callbackUrl) && Boolean(process.env.CUSTOM_WORKER_SECRET);
  },

  async createRender(args: CreateRenderArgs): Promise<ProviderJobHandle> {
    const cfg = getConfig(args.configuration ?? {});
    const resolution = args.renderType === "full" ? "1920x1080" : "1280x720";
    const graph = specToWorkerCompatGraph(args.spec);

    if (cfg.simulate) {
      const providerJobId = `${SIM_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      return {
        providerJobId, status: "preparing",
        requestPayload: {
          provider: "custom_worker", mode: "simulate",
          render_job_id: args.renderJobId, project_id: args.projectId,
          render_type: args.renderType, resolution, ffmpeg_graph: graph,
        },
        responsePayload: { provider_job_id: providerJobId, simulated: true, accepted_at: new Date().toISOString() },
      };
    }

    if (!cfg.workerUrl) throw new ProviderNotConfiguredError("Custom Worker", "Set worker_url in provider configuration.");
    if (!cfg.callbackUrl) throw new ProviderNotConfiguredError("Custom Worker", "Set callback_url in provider configuration.");
    if (!process.env.CUSTOM_WORKER_SECRET) throw new ProviderNotConfiguredError("Custom Worker", "CUSTOM_WORKER_SECRET is not set.");

    const providerJobId = `cw_${args.renderType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const requestPayload = {
      provider: "custom_worker",
      provider_job_id: providerJobId,
      render_job_id: args.renderJobId,
      project_id: args.projectId,
      render_type: args.renderType,
      resolution,
      callback_url: cfg.callbackUrl || null,
      ffmpeg_graph: graph,
      spec: args.spec,
    };
    const body = JSON.stringify(requestPayload);
    const signature = sign(body) ?? "";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    let responsePayload: Record<string, unknown> = {};
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-render-signature": signature,
      };
      if (cfg.apiToken) headers["Authorization"] = `Bearer ${cfg.apiToken}`;
      const res = await fetch(`${cfg.workerUrl.replace(/\/$/, "")}/render`, {
        method: "POST", headers, body, signal: controller.signal,
      });
      const text = await res.text();
      let parsed: any = {};
      try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
      if (!res.ok) {
        throw new Error(`Custom worker rejected render (${res.status}): ${typeof parsed === "object" ? JSON.stringify(parsed) : text}`);
      }
      responsePayload = { http_status: res.status, accepted_at: new Date().toISOString(), worker_response: parsed };
    } finally {
      clearTimeout(timer);
    }

    return { providerJobId, status: "queued", requestPayload, responsePayload };
  },

  async getRenderStatus(providerJobId, { configuration }): Promise<ProviderStatusReport> {
    const cfg = getConfig(configuration ?? {});
    const resolution = providerJobId.includes("_full_") ? "1920x1080" : "1280x720";

    if (providerJobId.startsWith(SIM_PREFIX)) return simulateStatus(providerJobId, resolution);

    // Default: trust the webhook-driven state stored in render_provider_jobs.
    const last = await fetchLastCallback(providerJobId);
    if (last) {
      const status = String(last.status ?? last._stored_status ?? "rendering") as ProviderStatusReport["status"];
      return {
        status, progress: Math.max(0, Math.min(100, Number(last.progress ?? 0))),
        outputUrl: last.output_url ?? null, thumbnailUrl: last.thumbnail_url ?? null,
        durationSeconds: last.duration_seconds ?? null,
        resolution: last.resolution ?? resolution,
        error: last.error ?? null, raw: last,
      };
    }

    // Optional polling fallback if worker exposes /status/:id
    if (cfg.workerUrl) {
      try {
        const headers: Record<string, string> = {};
        if (cfg.apiToken) headers["Authorization"] = `Bearer ${cfg.apiToken}`;
        const res = await fetch(`${cfg.workerUrl.replace(/\/$/, "")}/status/${encodeURIComponent(providerJobId)}`, { headers });
        if (res.ok) {
          const raw = await res.json().catch(() => ({}));
          return {
            status: (raw.status ?? "rendering") as ProviderStatusReport["status"],
            progress: Number(raw.progress ?? 0),
            outputUrl: raw.output_url ?? null,
            durationSeconds: raw.duration_seconds ?? null,
            resolution: raw.resolution ?? resolution,
            error: raw.error ?? null, raw,
          };
        }
      } catch (e) {
        console.warn("custom-worker: status poll failed", e);
      }
    }
    return { status: "queued", progress: 0, resolution };
  },

  async cancelRender(providerJobId, { configuration }) {
    if (providerJobId.startsWith(SIM_PREFIX)) return;
    const cfg = getConfig(configuration ?? {});
    if (!cfg.workerUrl) return;
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (cfg.apiToken) headers["Authorization"] = `Bearer ${cfg.apiToken}`;
      const body = JSON.stringify({ provider_job_id: providerJobId });
      const sig = sign(body);
      if (sig) headers["x-render-signature"] = sig;
      await fetch(`${cfg.workerUrl.replace(/\/$/, "")}/cancel`, { method: "POST", headers, body });
    } catch (e) {
      console.warn("custom-worker: cancel failed", e);
    }
  },

  async downloadRender(providerJobId, { configuration }) {
    const resolution = providerJobId.includes("_full_") ? "1920x1080" : "1280x720";
    if (providerJobId.startsWith(SIM_PREFIX)) {
      const s = simulateStatus(providerJobId, resolution);
      return { url: s.outputUrl ?? null, resolution: s.resolution ?? null, durationSeconds: null };
    }
    const last = await fetchLastCallback(providerJobId);
    if (last?.output_url) {
      return {
        url: String(last.output_url),
        resolution: (last.resolution as string) ?? resolution,
        durationSeconds: last.duration_seconds ? Number(last.duration_seconds) : null,
      };
    }
    return { url: null, resolution, durationSeconds: null };
  },
};
