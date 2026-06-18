import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Group candidates + approved assets by spec role for the Assets tab. */
const ROLE_FOR_TYPE: Record<string, string> = {
  clinical_image: "Clinical Images",
  medical_diagram: "Medical Diagrams",
  diagram: "Medical Diagrams",
  broll_video: "B-roll",
  broll: "B-roll",
  infographic: "Infographics",
  icon: "Icons",
  thumbnail: "Icons",
  image: "Clinical Images",
  overlay: "Icons",
};

function roleFor(t: string): string {
  return ROLE_FOR_TYPE[t] ?? "Other";
}

const ProjectIdInput = z.object({ projectId: z.string() });

export const listAssetReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ProjectIdInput.parse(i))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const [{ data: candidates }, { data: assets }, { data: projectAssets }, { data: scenes }] = await Promise.all([
      sb.from("asset_candidates").select("*").eq("project_id", data.projectId).order("priority", { ascending: true }),
      sb.from("assets").select("*").eq("project_id", data.projectId).order("created_at", { ascending: false }),
      sb.from("project_assets").select("*").eq("project_id", data.projectId),
      sb.from("scenes").select("id, scene_number, title").eq("project_id", data.projectId),
    ]);

    const grouped: Record<string, any[]> = {};
    for (const c of (candidates ?? []) as any[]) {
      const role = roleFor(c.asset_type);
      (grouped[role] ??= []).push({ ...c, role });
    }

    return {
      candidates: candidates ?? [],
      assets: assets ?? [],
      projectAssets: projectAssets ?? [],
      scenes: scenes ?? [],
      grouped,
    };
  });

const ReviewInput = z.object({
  candidateId: z.string(),
  action: z.enum(["accept", "reject", "replace", "lock"]),
  note: z.string().optional(),
  replacementQuery: z.string().optional(),
});

export const reviewAssetCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ReviewInput.parse(i))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const userId = context.userId;
    const { data: cand, error } = await sb
      .from("asset_candidates").select("*").eq("id", data.candidateId).maybeSingle();
    if (error || !cand) {
      console.warn("reviewAssetCandidate: candidate not found", {
        candidateId: data.candidateId,
        error: error?.message,
      });
      return { ok: false as const, status: "not_found", assetId: null, error: "Candidate not found" };
    }

    const now = new Date().toISOString();
    let nextStatus: string = cand.status;
    let linkedAssetId: string | null = cand.linked_asset_id ?? null;

    if (data.action === "reject") {
      nextStatus = "rejected";
    } else if (data.action === "lock") {
      nextStatus = "locked";
    } else if (data.action === "accept" || data.action === "replace") {
      const query = data.action === "replace" && data.replacementQuery
        ? data.replacementQuery
        : cand.search_query;
      // Create or reuse an asset for this candidate
      const { data: assetRow, error: aErr } = await sb.from("assets").insert({
        project_id: cand.project_id,
        scene_id: cand.scene_id,
        asset_type: cand.asset_type,
        source_type: "manual",
        source: "review",
        status: "approved",
        title: cand.title ?? cand.search_query?.slice(0, 80) ?? "Approved asset",
        description: cand.description ?? null,
        search_query: query,
        metadata: { from_candidate: cand.id, review_action: data.action },
        reviewed_by: userId,
        reviewed_at: now,
        review_note: data.note ?? null,
      }).select("id").single();
      if (aErr || !assetRow) throw new Error(aErr?.message ?? "Failed to create asset");
      linkedAssetId = assetRow.id;
      nextStatus = data.action === "replace" ? "replaced" : "approved";

      // Register in project_assets registry under the role
      const role = ROLE_FOR_TYPE[cand.asset_type] ?? "Other";
      await sb.from("project_assets").upsert({
        project_id: cand.project_id,
        asset_id: assetRow.id,
        role,
        status: "approved",
        notes: data.note ?? null,
      }, { onConflict: "project_id,asset_id,role" });
    }

    await sb.from("asset_candidates").update({
      status: nextStatus,
      reviewed_by: userId,
      reviewed_at: now,
      review_note: data.note ?? null,
      linked_asset_id: linkedAssetId,
      ...(data.action === "replace" && data.replacementQuery ? { search_query: data.replacementQuery } : {}),
    }).eq("id", cand.id);

    // After any approval/lock change, rebuild the manifest so approved assets
    // are referenced by render_manifest rows.
    if (data.action === "accept" || data.action === "replace" || data.action === "lock") {
      try {
        const { buildRenderManifestForProject } = await import("./render/timeline-builder.server");
        await buildRenderManifestForProject(sb, cand.project_id);
      } catch (e) {
        console.warn("manifest rebuild after review failed", e);
      }
    }

    return { ok: true, status: nextStatus, assetId: linkedAssetId };
  });

/** Bulk-accept every pending/searched candidate for a project. */
export const acceptAllPendingCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ProjectIdInput.parse(i))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const userId = context.userId;
    const { data: cands, error } = await sb
      .from("asset_candidates")
      .select("*")
      .eq("project_id", data.projectId)
      .in("status", ["pending", "searched"]);
    if (error) throw new Error(error.message);
    const now = new Date().toISOString();
    let accepted = 0;
    for (const cand of (cands ?? []) as any[]) {
      const { data: assetRow, error: aErr } = await sb.from("assets").insert({
        project_id: cand.project_id,
        scene_id: cand.scene_id,
        asset_type: cand.asset_type,
        source_type: "manual",
        source: "bulk-accept",
        status: "approved",
        title: cand.title ?? cand.search_query?.slice(0, 80) ?? "Approved asset",
        description: cand.description ?? null,
        search_query: cand.search_query,
        metadata: { from_candidate: cand.id, review_action: "accept_all" },
        reviewed_by: userId,
        reviewed_at: now,
      }).select("id").single();
      if (aErr || !assetRow) continue;
      const role = ROLE_FOR_TYPE[cand.asset_type] ?? "Other";
      await sb.from("project_assets").upsert({
        project_id: cand.project_id,
        asset_id: assetRow.id,
        role,
        status: "approved",
        notes: null,
      }, { onConflict: "project_id,asset_id,role" });
      await sb.from("asset_candidates").update({
        status: "approved",
        reviewed_by: userId,
        reviewed_at: now,
        linked_asset_id: assetRow.id,
      }).eq("id", cand.id);
      accepted += 1;
    }
    if (accepted > 0) {
      try {
        const { buildRenderManifestForProject } = await import("./render/timeline-builder.server");
        await buildRenderManifestForProject(sb, data.projectId);
      } catch (e) {
        console.warn("manifest rebuild after bulk accept failed", e);
      }
    }
    return { ok: true, accepted };
  });

/** Project readiness score. 7 weighted gates; each scored 0..1. */
export const getProjectReadiness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ProjectIdInput.parse(i))
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const pid = data.projectId;
    const [tx, sp, sb_, ed, ld, ac, rm, ti] = await Promise.all([
      sb.from("transcripts").select("project_id", { count: "exact", head: true }).eq("project_id", pid),
      sb.from("analysis_versions").select("id", { count: "exact", head: true }).eq("project_id", pid).eq("task", "scene_plan"),
      sb.from("analysis_versions").select("id", { count: "exact", head: true }).eq("project_id", pid).eq("task", "visual_storyboard"),
      sb.from("analysis_versions").select("id", { count: "exact", head: true }).eq("project_id", pid).eq("task", "editorial_decisions"),
      sb.from("layout_decisions").select("id", { count: "exact", head: true }).eq("project_id", pid),
      sb.from("asset_candidates").select("id, status", { count: "exact" }).eq("project_id", pid),
      sb.from("render_manifest").select("id", { count: "exact", head: true }).eq("project_id", pid),
      sb.from("timeline_items").select("id", { count: "exact", head: true }).eq("project_id", pid),
    ]);
    const totalCand = ac.data?.length ?? 0;
    const approvedCand = (ac.data ?? []).filter((r: any) => r.status === "approved" || r.status === "locked" || r.status === "replaced").length;
    const assetsScore = totalCand === 0 ? 0 : Math.min(1, approvedCand / Math.max(1, totalCand));

    // Timeline validity gate
    let timelineScore = 0;
    let timelineBlockers: string[] = [];
    if ((ti.count ?? 0) > 0) {
      try {
        const { validateTimelineForProject } = await import("./timeline/timeline-composer.server");
        const v = await validateTimelineForProject(sb, pid);
        timelineScore = v.valid ? 1 : 0.5;
        timelineBlockers = v.issues.filter((i: any) => i.level === "error").map((i: any) => i.message);
      } catch { timelineScore = 0.5; }
    }

    const gates = [
      { key: "transcript", label: "Transcript", weight: 0.08, score: (tx.count ?? 0) > 0 ? 1 : 0 },
      { key: "scene_plan", label: "Scene Plan", weight: 0.12, score: (sp.count ?? 0) > 0 ? 1 : 0 },
      { key: "storyboard", label: "Storyboard", weight: 0.12, score: (sb_.count ?? 0) > 0 ? 1 : 0 },
      { key: "editorial", label: "Editorial", weight: 0.12, score: (ed.count ?? 0) > 0 ? 1 : 0 },
      { key: "layout", label: "Layout", weight: 0.08, score: (ld.count ?? 0) > 0 ? 1 : 0 },
      { key: "assets", label: "Assets approved", weight: 0.18, score: assetsScore },
      { key: "timeline", label: "Timeline valid", weight: 0.18, score: timelineScore },
      { key: "manifest", label: "Render Manifest", weight: 0.12, score: (rm.count ?? 0) > 0 ? 1 : 0 },
    ];
    const pct = Math.round(gates.reduce((s, g) => s + g.weight * g.score, 0) * 100);
    type BlockerAction =
      | { kind: "task"; task: string; label: string }
      | { kind: "timeline"; label: string }
      | { kind: "manifest"; label: string }
      | { kind: "approve_assets"; label: string }
      | { kind: "navigate"; tab: string; label: string };
    const blockerActions: { id: string; message: string; fix?: BlockerAction }[] = [];
    if ((tx.count ?? 0) === 0) blockerActions.push({ id: "transcript", message: "Transcript missing", fix: { kind: "navigate", tab: "transcript", label: "Open transcript" } });
    if ((sp.count ?? 0) === 0 && (tx.count ?? 0) > 0) blockerActions.push({ id: "scene_plan", message: "Scene plan missing", fix: { kind: "task", task: "scene_plan", label: "Generate scene plan" } });
    if ((ed.count ?? 0) === 0) blockerActions.push({ id: "editorial", message: "Editorial decisions missing", fix: { kind: "task", task: "editorial_decisions", label: "Generate editorial" } });
    if (totalCand > 0 && approvedCand === 0) blockerActions.push({ id: "assets", message: "No assets approved yet", fix: { kind: "approve_assets", label: "Accept all candidates" } });
    if ((ti.count ?? 0) === 0) blockerActions.push({ id: "timeline", message: "Timeline not composed", fix: { kind: "timeline", label: "Compose timeline" } });
    if ((rm.count ?? 0) === 0) blockerActions.push({ id: "manifest", message: "Render manifest not generated", fix: { kind: "manifest", label: "Build manifest" } });
    for (const tb of timelineBlockers.slice(0, 3)) {
      blockerActions.push({ id: `tl_${tb.slice(0, 20)}`, message: tb, fix: { kind: "timeline", label: "Recompose timeline" } });
    }
    const blockers = blockerActions.map((b) => b.message);
    return {
      percent: pct,
      gates,
      approvedAssets: approvedCand,
      totalCandidates: totalCand,
      readyForRender: pct >= 80 && blockers.length === 0,
      blockers,
      blockerActions,
    };
  });

/** Dashboard-wide asset/readiness summary across the user's projects. */
export const getAssetDashboardSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const userId = context.userId;
    const { data: projects } = await sb.from("projects").select("id").eq("user_id", userId);
    const ids = (projects ?? []).map((p: any) => p.id);
    if (ids.length === 0) {
      return { readyForRender: 0, pendingReview: 0, approved: 0, avgReadiness: 0, projectCount: 0 };
    }
    const [cands, manifests] = await Promise.all([
      sb.from("asset_candidates").select("project_id, status").in("project_id", ids),
      sb.from("render_manifest").select("project_id").in("project_id", ids),
    ]);
    const candByProject: Record<string, { total: number; approved: number }> = {};
    let pending = 0, approved = 0;
    for (const c of (cands.data ?? []) as any[]) {
      const e = (candByProject[c.project_id] ??= { total: 0, approved: 0 });
      e.total += 1;
      if (c.status === "pending" || c.status === "searched") pending += 1;
      if (c.status === "approved" || c.status === "locked" || c.status === "replaced") {
        approved += 1;
        e.approved += 1;
      }
    }
    const manifestByProject = new Set((manifests.data ?? []).map((m: any) => m.project_id));
    let readyCount = 0;
    let totalPct = 0;
    for (const pid of ids) {
      const e = candByProject[pid] ?? { total: 0, approved: 0 };
      const assetRatio = e.total === 0 ? 0 : e.approved / e.total;
      const manifestOk = manifestByProject.has(pid) ? 1 : 0;
      // simple proxy: assets 60% + manifest 40%
      const pct = Math.round((assetRatio * 0.6 + manifestOk * 0.4) * 100);
      totalPct += pct;
      if (pct >= 80) readyCount += 1;
    }
    return {
      readyForRender: readyCount,
      pendingReview: pending,
      approved,
      avgReadiness: ids.length === 0 ? 0 : Math.round(totalPct / ids.length),
      projectCount: ids.length,
    };
  });