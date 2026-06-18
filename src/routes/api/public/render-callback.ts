import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Public render webhook. External providers (Creatomate, Shotstack, custom
 * workers) POST status updates here. The endpoint MUST verify the caller
 * before touching the database.
 *
 * Expected body:
 *   { provider, provider_job_id, status, progress?, output_url?,
 *     thumbnail_url?, duration_seconds?, resolution?, error? }
 */
function methodNotAllowed() {
  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405, headers: { "Content-Type": "application/json", Allow: "POST" },
  });
}
function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a); const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
function verifySignature(provider: string, body: string, headers: Headers): { ok: boolean; reason?: string } {
  if (provider === "custom_worker") {
    const secret = process.env.CUSTOM_WORKER_SECRET;
    if (!secret) return { ok: false, reason: "missing CUSTOM_WORKER_SECRET" };
    const sig = headers.get("x-render-signature") ?? "";
    const expected = createHmac("sha256", secret).update(body).digest("hex");
    return { ok: safeEqual(sig, expected) };
  }
  if (provider === "creatomate") {
    const secret = process.env.CREATOMATE_WEBHOOK_SECRET;
    if (!secret) return { ok: false, reason: "missing CREATOMATE_WEBHOOK_SECRET" };
    const sig = headers.get("x-creatomate-signature") ?? "";
    const expected = createHmac("sha256", secret).update(body).digest("hex");
    return { ok: safeEqual(sig, expected) };
  }
  if (provider === "shotstack") {
    const secret = process.env.SHOTSTACK_WEBHOOK_SECRET;
    if (!secret) return { ok: false, reason: "missing SHOTSTACK_WEBHOOK_SECRET" };
    const bearer = (headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    return { ok: safeEqual(bearer, secret) };
  }
  return { ok: false, reason: `unsupported provider: ${provider}` };
}

export const Route = createFileRoute("/api/public/render-callback")({
  server: {
    handlers: {
      GET: async () => methodNotAllowed(),
      POST: async ({ request }) => {
        const rawBody = await request.text();
        let payload: any;
        try { payload = JSON.parse(rawBody); } catch { return new Response("Invalid JSON", { status: 400 }); }

        const provider = String(payload?.provider ?? "");
        const providerJobId = String(payload?.provider_job_id ?? "");
        if (!provider || !providerJobId) return new Response("Missing provider or provider_job_id", { status: 400 });

        const verified = verifySignature(provider, rawBody, request.headers);
        if (!verified.ok) {
          console.warn("render-callback verify failed", { provider, reason: verified.reason });
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: pj } = await supabaseAdmin
          .from("render_provider_jobs").select("*")
          .eq("provider_job_id", providerJobId).maybeSingle();
        if (!pj) return new Response("Unknown provider_job_id", { status: 404 });

        const status = String(payload.status ?? "rendering");
        const progress = Math.max(0, Math.min(100, Number(payload.progress ?? 0)));
        const outputUrl: string | undefined = payload.output_url;
        const thumbUrl: string | undefined = payload.thumbnail_url;
        const errorMsg: string | undefined = payload.error;

        const newLog = {
          at: new Date().toISOString(),
          level: status === "failed" ? "error" : "info",
          msg: `provider callback: ${status} (${progress}%)`,
        };
        await supabaseAdmin.from("render_provider_jobs").update({
          status,
          response_payload: { ...((pj.response_payload as any) ?? {}), last_callback: payload } as any,
          logs: [...(((pj.logs as any[]) ?? [])), newLog].slice(-50) as any,
        }).eq("id", pj.id);

        const renderJobPatch: any = { progress_percent: progress, status };
        if (status === "completed" || status === "failed" || status === "cancelled") {
          renderJobPatch.completed_at = new Date().toISOString();
        }
        if (errorMsg) renderJobPatch.error_message = errorMsg;
        await supabaseAdmin.from("render_jobs").update(renderJobPatch).eq("id", pj.render_job_id);

        if (status === "completed" && outputUrl) {
          const { data: rj } = await supabaseAdmin
            .from("render_jobs").select("project_id, render_type")
            .eq("id", pj.render_job_id).maybeSingle();
          if (rj) {
            const { data: existing } = await supabaseAdmin
              .from("render_outputs").select("id").eq("render_job_id", pj.render_job_id).limit(1);
            if (!existing || existing.length === 0) {
              await supabaseAdmin.from("render_outputs").insert({
                render_job_id: pj.render_job_id,
                project_id: rj.project_id,
                output_type: rj.render_type === "full" ? "landscape" : "preview",
                file_url: outputUrl,
                thumbnail_url: thumbUrl ?? null,
                duration_seconds: Number(payload.duration_seconds ?? 0) || 0,
                resolution: payload.resolution ?? (rj.render_type === "full" ? "1920x1080" : "1280x720"),
                file_size: Number(payload.file_size ?? 0) || 0,
              });
            }
          }
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});