import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Creatomate-specific webhook. Creatomate POSTs its native render object;
 * we translate it into the canonical render_provider_jobs / render_jobs /
 * render_outputs update used by the rest of the system.
 *
 * Signature: HMAC-SHA256 of the raw body using CREATOMATE_WEBHOOK_SECRET,
 * delivered in the `creatomate-signature` (or `x-creatomate-signature`) header.
 * If no secret is set, the endpoint refuses the request.
 */
function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a); const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function mapStatus(s: string | undefined): string {
  switch (s) {
    case "planned":
    case "waiting": return "queued";
    case "transcribing":
    case "rendering": return "rendering";
    case "succeeded": return "completed";
    case "failed": return "failed";
    case "cancelled":
    case "canceled": return "cancelled";
    default: return "preparing";
  }
}

export const Route = createFileRoute("/api/public/render-callback/creatomate")({
  server: {
    handlers: {
      GET: async () => new Response("ok"),
      POST: async ({ request }) => {
        const raw = await request.text();
        const secret = process.env.CREATOMATE_WEBHOOK_SECRET;
        if (!secret) return new Response("CREATOMATE_WEBHOOK_SECRET not configured", { status: 401 });
        const sig =
          request.headers.get("creatomate-signature") ??
          request.headers.get("x-creatomate-signature") ?? "";
        const expected = createHmac("sha256", secret).update(raw).digest("hex");
        if (!safeEqual(sig, expected)) return new Response("Invalid signature", { status: 401 });

        let payload: any;
        try { payload = JSON.parse(raw); } catch { return new Response("Invalid JSON", { status: 400 }); }

        const providerJobId = String(payload?.id ?? "");
        if (!providerJobId) return new Response("Missing render id", { status: 400 });

        const status = mapStatus(payload.status);
        const progress = typeof payload.percentage === "number"
          ? Math.max(0, Math.min(100, Math.round(payload.percentage)))
          : (status === "completed" ? 100 : 0);
        const outputUrl: string | undefined = payload.url ?? undefined;
        const thumbUrl: string | undefined = payload.snapshot_url ?? undefined;
        const errorMsg: string | undefined = payload.error_message ?? undefined;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: pj } = await supabaseAdmin
          .from("render_provider_jobs").select("*")
          .eq("provider_job_id", providerJobId).maybeSingle();
        if (!pj) return new Response("Unknown provider_job_id", { status: 404 });

        const newLog = {
          at: new Date().toISOString(),
          level: status === "failed" ? "error" : "info",
          msg: `creatomate callback: ${status} (${progress}%)`,
        };
        await supabaseAdmin.from("render_provider_jobs").update({
          status,
          response_payload: { ...((pj.response_payload as any) ?? {}), last_callback: payload } as any,
          logs: [...(((pj.logs as any[]) ?? [])), newLog].slice(-50) as any,
        }).eq("id", pj.id);

        const patch: any = { status, progress_percent: progress };
        if (status === "completed" || status === "failed" || status === "cancelled") {
          patch.completed_at = new Date().toISOString();
        }
        if (errorMsg) patch.error_message = errorMsg;
        await supabaseAdmin.from("render_jobs").update(patch).eq("id", pj.render_job_id);

        if (status === "completed" && outputUrl) {
          const { data: rj } = await supabaseAdmin
            .from("render_jobs").select("project_id, render_type")
            .eq("id", pj.render_job_id).maybeSingle();
          if (rj) {
            const { data: existing } = await supabaseAdmin
              .from("render_outputs").select("id").eq("render_job_id", pj.render_job_id).limit(1);
            if (!existing || existing.length === 0) {
              const resolution = (payload.width && payload.height)
                ? `${payload.width}x${payload.height}`
                : (rj.render_type === "full" ? "1920x1080" : "1280x720");
              await supabaseAdmin.from("render_outputs").insert({
                render_job_id: pj.render_job_id,
                project_id: rj.project_id,
                output_type: rj.render_type === "full" ? "landscape" : "preview",
                file_url: outputUrl,
                thumbnail_url: thumbUrl ?? null,
                duration_seconds: Number(payload.duration ?? 0) || 0,
                resolution,
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