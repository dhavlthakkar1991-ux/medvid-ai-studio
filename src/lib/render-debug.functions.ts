import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Render diagnostics + system health server functions used by the
 * RenderSpec Inspector, Provider Test Center, Render Job Diagnostics,
 * and System Health dashboard introduced in Phase 2B-5.
 */

const ProviderInput = z.object({ providerId: z.string().uuid() });

/**
 * runProviderDiagnostics
 *   - validates the JSON configuration stored on render_providers
 *   - checks the secret(s) required for the provider type
 *   - if the configuration contains a worker_url/webhook_url, runs a
 *     no-op HEAD/GET probe so users can confirm reachability
 *   - tries the public callback endpoint with a synthetic payload to
 *     verify the app's webhook receiver is online
 */
export const runProviderDiagnostics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ProviderInput.parse(i))
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase
      .from("render_providers").select("*").eq("id", data.providerId).maybeSingle();
    if (error || !row) throw new Error(error?.message ?? "Provider not found");

    const cfg = (row.configuration ?? {}) as Record<string, any>;
    const checks: Array<{ name: string; status: "ok" | "warn" | "fail"; detail: string }> = [];

    // 1. Configuration validation
    if (row.provider_type === "custom_worker") {
      const url = cfg.worker_url || cfg.webhook_url;
      const sim = Boolean(cfg.simulate_worker);
      if (sim) checks.push({ name: "Configuration", status: "ok", detail: "simulate_worker=true — using local lifecycle" });
      else if (!url) checks.push({ name: "Configuration", status: "fail", detail: "worker_url is missing" });
      else checks.push({ name: "Configuration", status: "ok", detail: `worker_url=${url}` });
    } else if (row.provider_type === "creatomate") {
      if (!cfg.webhook_url) checks.push({ name: "Configuration", status: "warn", detail: "webhook_url not set" });
      else checks.push({ name: "Configuration", status: "ok", detail: `webhook_url=${cfg.webhook_url}` });
    } else if (row.provider_type === "mock") {
      checks.push({ name: "Configuration", status: "ok", detail: "Mock provider needs no configuration" });
    } else {
      checks.push({ name: "Configuration", status: "warn", detail: "Provider type not fully implemented" });
    }

    // 2. Required secret presence (presence only — values never leave the server)
    const requiredSecrets: Record<string, string[]> = {
      custom_worker: ["CUSTOM_WORKER_SECRET"],
      creatomate: ["CREATOMATE_API_KEY", "CREATOMATE_WEBHOOK_SECRET"],
      shotstack: ["SHOTSTACK_API_KEY", "SHOTSTACK_WEBHOOK_SECRET"],
      mock: [],
    };
    const needed = requiredSecrets[row.provider_type] ?? [];
    for (const name of needed) {
      const present = Boolean(process.env[name]);
      checks.push({
        name: `Secret: ${name}`,
        status: present ? "ok" : (row.provider_type === "custom_worker" && cfg.simulate_worker ? "warn" : "fail"),
        detail: present ? "Set" : "Not set in Lovable Cloud secrets",
      });
    }

    // 3. Worker / external service reachability (best-effort)
    const workerUrl: string | undefined = cfg.worker_url || (row.provider_type === "custom_worker" ? cfg.webhook_url : undefined);
    if (workerUrl && !cfg.simulate_worker) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(workerUrl.replace(/\/$/, ""), { method: "GET", signal: controller.signal })
          .finally(() => clearTimeout(timer));
        checks.push({
          name: "Worker reachability",
          status: res.ok || res.status === 404 || res.status === 405 ? "ok" : "warn",
          detail: `HTTP ${res.status} from ${workerUrl}`,
        });
      } catch (e: any) {
        checks.push({ name: "Worker reachability", status: "fail", detail: e?.message ?? "fetch failed" });
      }
    }

    // 4. Public callback endpoint round-trip — verifies the app's webhook
    //    receiver is online from outside. We intentionally send an unsigned
    //    payload and expect a 401 — that proves the route is mounted and
    //    verifying signatures.
    try {
      const origin = process.env.SUPABASE_URL?.replace(/^https:\/\/[^.]+\.supabase\.co.*/i, "") || "";
      const base = process.env.PUBLIC_APP_URL || origin || "";
      // Without a configured base URL we can only assert the route module exists.
      if (!base) {
        checks.push({ name: "Callback receiver", status: "warn", detail: "PUBLIC_APP_URL not configured; cannot probe externally" });
      } else {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`${base.replace(/\/$/, "")}/api/public/render-callback`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: row.provider_type, provider_job_id: "diagnostic_probe" }),
          signal: controller.signal,
        }).finally(() => clearTimeout(timer));
        const ok = res.status === 401 || res.status === 404; // signature rejected OR unknown job — both prove route is up
        checks.push({
          name: "Callback receiver",
          status: ok ? "ok" : "warn",
          detail: `HTTP ${res.status} from /api/public/render-callback`,
        });
      }
    } catch (e: any) {
      checks.push({ name: "Callback receiver", status: "warn", detail: e?.message ?? "probe failed" });
    }

    const overall = checks.some((c) => c.status === "fail")
      ? "fail"
      : checks.some((c) => c.status === "warn") ? "warn" : "ok";
    return { overall, checks, provider: { id: row.id, name: row.name, type: row.provider_type } };
  });

/**
 * getSystemHealth — cross-project counters used by the System Health dashboard.
 */
export const getSystemHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const { data: projects } = await sb.from("projects").select("id").eq("user_id", context.userId);
    const ids = (projects ?? []).map((p: any) => p.id);

    const fifteenMinAgo = new Date(Date.now() - 15 * 60_000).toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();

    const [pipelineRuns, renderJobs, providerJobs, providers] = await Promise.all([
      ids.length ? sb.from("pipeline_runs").select("status, started_at").in("project_id", ids).gte("started_at", oneDayAgo) : { data: [] as any[] },
      ids.length ? sb.from("render_jobs").select("status, error_message, created_at").in("project_id", ids) : { data: [] as any[] },
      ids.length ? sb.from("render_provider_jobs").select("status, logs, response_payload, provider_id, created_at").gte("created_at", oneDayAgo) : { data: [] as any[] },
      sb.from("render_providers").select("id, name, provider_type, enabled, is_default"),
    ]);

    const runs = (pipelineRuns.data ?? []) as any[];
    const rj = (renderJobs.data ?? []) as any[];
    const pj = (providerJobs.data ?? []) as any[];
    const pvs = (providers.data ?? []) as any[];

    const pipeline = {
      total: runs.length,
      running: runs.filter((r) => ["running", "started", "preparing"].includes(r.status)).length,
      completed: runs.filter((r) => r.status === "completed").length,
      failed: runs.filter((r) => r.status === "failed").length,
    };
    const render = {
      total: rj.length,
      inFlight: rj.filter((j) => ["queued", "preparing", "rendering"].includes(j.status)).length,
      completed: rj.filter((j) => j.status === "completed").length,
      failed: rj.filter((j) => j.status === "failed").length,
      lastError: rj.find((j) => j.status === "failed" && j.error_message)?.error_message ?? null,
    };
    const providerHealth = pvs.map((p) => {
      const jobs = pj.filter((j) => j.provider_id === p.id);
      return {
        id: p.id, name: p.name, type: p.provider_type, enabled: p.enabled, isDefault: p.is_default,
        jobs24h: jobs.length,
        failed24h: jobs.filter((j) => j.status === "failed").length,
      };
    });
    // Webhook health: any callback received in the last 15 minutes counts
    // as a "recent callback"; otherwise we only assert that the receiver is mounted.
    const webhook = {
      callbacks24h: pj.filter((j) => (j.response_payload as any)?.last_callback).length,
      lastCallbackAt: pj
        .map((j) => (j.response_payload as any)?.last_callback?.at ?? j.created_at)
        .filter(Boolean)
        .sort()
        .reverse()[0] ?? null,
      recent: pj.some((j) => j.created_at >= fifteenMinAgo && (j.response_payload as any)?.last_callback),
    };

    return { pipeline, render, providerHealth, webhook };
  });